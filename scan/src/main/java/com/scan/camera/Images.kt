package com.scan.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import kotlin.math.roundToInt

/** 图片解码工具：按目标尺寸采样解码，并按 EXIF 信息摆正方向 */
object Images {

    /** 解码文件为最长边不超过 [maxDim] 的位图（已按 EXIF 旋转到位） */
    fun decodeScaled(file: File, maxDim: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        // 粗采样：解码结果落在 [maxDim/2, 2*maxDim) 区间
        var sample = 1
        val maxSide = maxOf(bounds.outWidth, bounds.outHeight)
        while (maxSide / (sample * 2) >= maxDim) sample *= 2

        val raw = BitmapFactory.decodeFile(
            file.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sample }
        ) ?: return null
        var current = raw
        try {
        val rotated = rotateByExif(raw, file)
        current = rotated

        // 精确缩放到 maxDim 以内，保证输出分辨率稳定
        val big = maxOf(rotated.width, rotated.height)
        if (big <= maxDim) return rotated
        val scale = maxDim.toFloat() / big
        val out = Bitmap.createScaledBitmap(
            rotated,
            (rotated.width * scale).roundToInt().coerceAtLeast(1),
            (rotated.height * scale).roundToInt().coerceAtLeast(1),
            true
        )
        if (out != rotated) rotated.recycle()
        return out
        } catch (e: Throwable) {
            if (!current.isRecycled) current.recycle()
            if (!raw.isRecycled) raw.recycle()
            throw e
        }
    }

    fun thumbnail(file: File): Bitmap? = decodeScaled(file, 256)

    /** Laplacian 方差清晰度评分（越大越清晰），用于多帧防抖选片 */
    fun sharpnessScore(file: File): Double {
        val bmp = decodeScaled(file, 256) ?: return 0.0
        val w = bmp.width
        val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        bmp.recycle()
        val g = IntArray(w * h)
        for (i in px.indices) {
            val p = px[i]
            g[i] = ((p shr 16 and 0xFF) * 299 + (p shr 8 and 0xFF) * 587 + (p and 0xFF) * 114) / 1000
        }
        var sum = 0.0
        var sum2 = 0.0
        var cnt = 0
        for (y in 1 until h - 1) {
            val row = y * w
            for (x in 1 until w - 1) {
                val i = row + x
                val l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i]
                sum += l
                sum2 += l.toDouble() * l
                cnt++
            }
        }
        if (cnt == 0) return 0.0
        val mean = sum / cnt
        return sum2 / cnt - mean * mean
    }

    private fun rotateByExif(bitmap: Bitmap, file: File): Bitmap {
        val orientation = try {
            ExifInterface(file.absolutePath)
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (e: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated != bitmap) bitmap.recycle()
        return rotated
    }
}
