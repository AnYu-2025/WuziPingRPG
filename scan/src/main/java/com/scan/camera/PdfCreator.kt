package com.scan.camera

import android.content.ContentResolver
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.io.File
import java.io.FilterOutputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executor
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToInt

enum class EnhanceMode { COLOR, GRAY, BW }

/** 可取消的逐页合成。图片和文字层使用同一实际尺寸，OCR 失败明确计数。 */
object PdfCreator {
    private val ocrCache = object : LinkedHashMap<String, List<OcrLine>>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<OcrLine>>?) = size > 64
    }
    fun clearCache() = synchronized(ocrCache) { ocrCache.clear() }
    const val PAGE_W = 595
    const val PAGE_H = 842
    data class OcrLine(val text: String, val rect: Rect)
    data class Result(val uri: Uri, val displayName: String, val location: String, val text: String,
                      val size: Long = 0, val recognizedPages: Int = 0, val missedPages: List<Int> = emptyList(),
                      val textSaved: Boolean = false, val ocrRequested: Boolean = false)

    private fun checkCancelled(cancelled: () -> Boolean) {
        if (cancelled()) throw CancellationException("已取消")
    }

    fun createPdf(files: List<File>, mode: EnhanceMode, resolver: ContentResolver, ocr: Boolean,
                  post: AppSettings = AppSettings(), customName: String? = null,
                  isCancelled: () -> Boolean = { false }, onProgress: (Int, Int) -> Unit = { _, _ -> }): Result {
        require(files.isNotEmpty()) { "没有可导出的页面" }
        val maxDim = if (post.resOverride in listOf(2400, 2800, 3200)) post.resOverride else Quality.maxDim
        val doc = PdfDocument()
        val recognizer = if (ocr) TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build()) else null
        val text = StringBuilder()
        val missed = mutableListOf<Int>()
        var recognized = 0
        val created = mutableListOf<Uri>()
        var committed = false
        try {
            files.forEachIndexed { index, file ->
                checkCancelled(isCancelled); onProgress(index, files.size)
                var bitmap: Bitmap? = null
                try {
                    val sizes = listOf(maxDim, 2400, 1600).filter { it <= maxDim }.distinct()
                    for ((attempt, size) in sizes.withIndex()) {
                        try { bitmap = ImagePipeline.processed(file, mode, post, size); break }
                        catch (e: OutOfMemoryError) { if (attempt == sizes.lastIndex) throw e }
                    }
                    val image = bitmap ?: error("无法读取页面")
                    checkCancelled(isCancelled)
                    val lines = if (recognizer == null) emptyList() else {
                        val key = ExportRules.ocrKey(file.absolutePath, file.lastModified(), file.length(),
                            image.width, image.height, mode.name, post.sharpen, post.contrast)
                        synchronized(ocrCache) { ocrCache[key] } ?: runOcr(recognizer, image, isCancelled).also {
                            if (it.isNotEmpty()) synchronized(ocrCache) { ocrCache[key] = it }
                        }
                    }
                    checkCancelled(isCancelled)
                    if (ocr && lines.isEmpty()) missed.add(index+1)
                    if (lines.isNotEmpty()) {
                        recognized++
                        text.appendLine("—— 第 ${index+1} 页 ——")
                        lines.forEach { text.appendLine(it.text) }
                        text.appendLine()
                    }
                    renderPage(doc, image, index+1, lines, post.fitAuto)
                } finally { bitmap?.recycle() }
            }
            onProgress(files.size, files.size); checkCancelled(isCancelled)
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val displayName = ExportRules.safeBaseName(customName, "扫描_$stamp")+".pdf"
            val uri = insertPending(resolver, displayName, "application/pdf").also { created.add(it) }
            resolver.openOutputStream(uri)?.use { out ->
                doc.writeTo(CancellableOutput(out, isCancelled))
            } ?: error("无法写入 PDF 文件")
            checkCancelled(isCancelled)
            var realName = displayName
            var size = 0L
            resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) { realName = it.getString(0) ?: displayName; size = it.getLong(1) }
            }
            val ocrText = text.toString().trim()
            var textSaved = false
            if (ocrText.isNotEmpty()) {
                var txt: Uri? = null
                try {
                    txt = insertPending(resolver, realName.removeSuffix(".pdf")+".txt", "text/plain").also { created.add(it) }
                    resolver.openOutputStream(txt)?.use {
                        CancellableOutput(it, isCancelled).write(ocrText.toByteArray(Charsets.UTF_8))
                    } ?: error("无法写入文字文件")
                    checkCancelled(isCancelled)
                    textSaved = true
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) {
                    txt?.let { failed -> runCatching { resolver.delete(failed, null, null) }; created.remove(failed) }
                }
            }
            checkCancelled(isCancelled)
            created.forEach { published ->
                check(resolver.update(published, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) > 0)
            }
            committed = true
            return Result(uri, realName, "Download/扫描相机/$realName", ocrText, size,
                recognized, missed, textSaved, ocr)
        } finally {
            if (!committed) created.forEach { runCatching { resolver.delete(it, null, null) } }
            recognizer?.close(); doc.close()
        }
    }

    private fun insertPending(resolver: ContentResolver, name: String, mime: String): Uri =
        resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS+"/扫描相机")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }) ?: error("无法创建输出文件，请检查存储空间")

    private class CancellableOutput(out: OutputStream, val cancelled: () -> Boolean) : FilterOutputStream(out) {
        override fun write(b: Int) { checkCancelled(cancelled); out.write(b) }
        override fun write(b: ByteArray, off: Int, len: Int) { checkCancelled(cancelled); out.write(b, off, len) }
    }

    private fun runOcr(recognizer: TextRecognizer, bitmap: Bitmap, cancelled: () -> Boolean): List<OcrLine> {
        checkCancelled(cancelled)
        val copy = try { bitmap.copy(Bitmap.Config.ARGB_8888, false) ?: return emptyList() }
            catch (_: OutOfMemoryError) { return emptyList() }
        var handedOff = false
        try {
            val task = recognizer.process(InputImage.fromBitmap(copy, 0))
            // 即使取消/超时，模型仍可能访问 Bitmap，交给任务结束回调释放。
            task.addOnCompleteListener(Executor { it.run() }) { copy.recycle() }
            handedOff = true
            val started = android.os.SystemClock.elapsedRealtime()
            while (!task.isComplete) {
                checkCancelled(cancelled)
                if (android.os.SystemClock.elapsedRealtime()-started > 90_000) return emptyList()
                Thread.sleep(60)
            }
            checkCancelled(cancelled)
            if (!task.isSuccessful) return emptyList()
            return task.result.textBlocks.flatMap { block ->
                block.lines.filter { it.text.isNotBlank() && it.boundingBox != null }
                    .map { OcrLine(it.text, Rect(it.boundingBox!!)) }
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { return emptyList() }
        finally { if (!handedOff && !copy.isRecycled) copy.recycle() }
    }

    private fun renderPage(doc: PdfDocument, bitmap: Bitmap, pageNo: Int, lines: List<OcrLine>, fitAuto: Boolean) {
        // 原始比例：长边对齐 A4 长边，短边按图像比例；A4：固定 595×842
        val pageW: Int
        val pageH: Int
        if (fitAuto) {
            val scale = PAGE_H.toFloat() / maxOf(bitmap.width, bitmap.height)
            pageW = (bitmap.width * scale).roundToInt().coerceIn(32, 4000)
            pageH = (bitmap.height * scale).roundToInt().coerceIn(32, 4000)
        } else {
            pageW = PAGE_W
            pageH = PAGE_H
        }
        val page = doc.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create())
        val canvas = page.canvas
        canvas.drawColor(Color.WHITE)
        val scale = minOf(pageW / bitmap.width.toFloat(), pageH / bitmap.height.toFloat())
        val w = bitmap.width * scale
        val h = bitmap.height * scale
        val left = (pageW - w) / 2f
        val top = (pageH - h) / 2f
        val paint = Paint().apply {
            isFilterBitmap = true
            isAntiAlias = true
        }
        canvas.drawBitmap(bitmap, null, RectF(left, top, left + w, top + h), paint)
        if (lines.isNotEmpty()) drawInvisibleText(canvas, lines, left, top, w, h, bitmap)
        doc.finishPage(page)
    }

    /**
     * 把 OCR 文字以 alpha=1 的近透明色写在图像上方：
     * 肉眼不可见，但在 PDF 阅读器里可搜索、可选中复制。
     */
    private fun drawInvisibleText(
        canvas: Canvas,
        lines: List<OcrLine>,
        left: Float,
        top: Float,
        w: Float,
        h: Float,
        bitmap: Bitmap
    ) {
        val paint = Paint().apply { color = 0x01000000; isAntiAlias = true }
        val sx = w / bitmap.width
        val sy = h / bitmap.height
        for (line in lines) {
            val r = line.rect
            val boxL = left + r.left * sx
            val boxT = top + r.top * sy
            val boxW = r.width() * sx
            val boxH = r.height() * sy
            if (boxH < 3f || boxW < 3f) continue
            paint.textSize = boxH
            paint.textScaleX = 1f
            val tw = paint.measureText(line.text)
            if (tw > 1f) paint.textScaleX = (boxW / tw).coerceIn(0.4f, 2.5f)
            val fm = paint.fontMetrics
            canvas.drawText(line.text, boxL, boxT - fm.ascent, paint)
        }
    }
}
