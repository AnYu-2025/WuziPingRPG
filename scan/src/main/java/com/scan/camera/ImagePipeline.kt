package com.scan.camera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import java.io.File
import kotlin.math.roundToInt

/** 拍摄、导入、重裁和导出共用朝向、图像处理及文件提交规则。调用方在后台线程运行。 */
object ImagePipeline {
    fun enhance(src: Bitmap, mode: EnhanceMode, settings: AppSettings): Bitmap = when (mode) {
        EnhanceMode.COLOR -> src
        EnhanceMode.GRAY -> ImageEnhance.grayStretch(src, settings.sharpen/100f, settings.contrast.toFloat())
        EnhanceMode.BW -> ImageEnhance.adaptiveBinary(src, settings.sharpen/100f, settings.contrast.toFloat())
    }

    fun processed(file: File, mode: EnhanceMode, settings: AppSettings, maxDim: Int): Bitmap {
        val src = Images.decodeScaled(file, maxDim) ?: error("无法读取图片：${file.name}")
        try {
            val result = enhance(src, mode, settings)
            if (result !== src) src.recycle()
            return result
        } catch (e: Throwable) { src.recycle(); throw e }
    }

    fun save(bitmap: Bitmap, target: File) {
        PageStore.atomicWrite(target) { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it)) { "图片写入失败" } }
    }

    fun prepare(source: File, store: PageStore, quad: FloatArray? = null, rotation: Int = 0,
                split: Boolean = false, maxDim: Int = Quality.maxDim): List<File> {
        val sizes = listOf(maxDim, 2400, 1600).filter { it <= maxDim }.distinct()
        for ((index, size) in sizes.withIndex()) {
            try { return prepareOnce(source, store, quad, rotation, split, size) }
            catch (e: OutOfMemoryError) { if (index == sizes.lastIndex) throw e }
        }
        error("无法处理照片")
    }

    private fun prepareOnce(source: File, store: PageStore, quad: FloatArray?, rotation: Int,
                            split: Boolean, maxDim: Int): List<File> {
        val src = Images.decodeScaled(source, maxDim) ?: error("无法读取照片")
        var working = src
        val outs = mutableListOf<File>()
        var pieces: List<Bitmap> = emptyList()
        try {
            if (rotation % 360 != 0) {
                val rotated = Bitmap.createBitmap(working, 0, 0, working.width, working.height,
                    Matrix().apply { postRotate(rotation.toFloat()) }, true)
                if (rotated !== working) working.recycle()
                working = rotated
            }
            if (quad != null) {
                require(ScanRules.validQuad(quad)) { "选框过小或交叉，请重新调整四角" }
                val warped = PageWarp.warp(working, quad, maxDim)
                if (warped !== working) working.recycle()
                working = warped
            }
            pieces = if (split) splitSpread(working)?.let { listOf(it.first, it.second) } ?: listOf(working)
                     else listOf(working)
            pieces.forEach { bmp ->
                val page = store.newPage()
                outs.add(page)
                save(bmp, page)
                // 单页保存未裁原片；双页保存各自分片作为后续重裁底图。
                store.keepOriginal(page, if (pieces.size == 1) source else page)
            }
            return outs
        } catch (e: Throwable) {
            outs.forEach { it.delete(); store.original(it).takeIf { original -> original != it }?.delete() }
            throw e
        } finally {
            pieces.filter { it !== working }.forEach { if (!it.isRecycled) it.recycle() }
            if (!working.isRecycled) working.recycle()
            if (!src.isRecycled) src.recycle()
        }
    }

    fun splitSpread(bmp: Bitmap): Pair<Bitmap, Bitmap>? {
        val w = bmp.width; val h = bmp.height
        if (w < h*1.15f || w < 600) return null
        val aw = 400; val ah = (h.toFloat()/w*aw).roundToInt().coerceIn(8, 4000)
        val small = Bitmap.createScaledBitmap(bmp, aw, ah, true)
        val px = IntArray(aw*ah)
        small.getPixels(px, 0, aw, 0, 0, aw, ah)
        if (small !== bmp) small.recycle()
        val cols = FloatArray(aw)
        for (y in 0 until ah) for (x in 0 until aw) {
            val p = px[y*aw+x]
            cols[x] += ((p shr 16 and 255)*299+(p shr 8 and 255)*587+(p and 255)*114)/1000f/ah
        }
        val smooth = FloatArray(aw) { x -> (-3..3).sumOf { cols[(x+it).coerceIn(0, aw-1)].toDouble() }.toFloat()/7 }
        val seam = (140..260).minBy { smooth[it] }
        val leftRef = smooth.slice(60..100).average().toFloat()
        val rightRef = smooth.slice(300..340).average().toFloat()
        if (minOf(leftRef, rightRef)-smooth[seam] < 25f) return null
        val splitX = (seam.toFloat()/aw*w).roundToInt().coerceIn(w/5, w*4/5)
        val left = Bitmap.createBitmap(splitX, h, Bitmap.Config.ARGB_8888)
        try {
            Canvas(left).drawBitmap(bmp, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG))
            val right = Bitmap.createBitmap(w-splitX, h, Bitmap.Config.ARGB_8888)
            Canvas(right).drawBitmap(bmp, -splitX.toFloat(), 0f, Paint(Paint.FILTER_BITMAP_FLAG))
            return left to right
        } catch (e: Throwable) { left.recycle(); throw e }
    }
}
