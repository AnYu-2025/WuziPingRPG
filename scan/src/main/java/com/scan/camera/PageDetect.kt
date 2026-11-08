package com.scan.camera

import androidx.camera.core.ImageProxy

/** 相机 Y 平面按旋转角转正，再交给共用轮廓检测器。 */
object PageDetect {
    /** 把相机帧的 Y 平面转成"摆正后"的灰度矩阵（处理旋转角），返回 (灰度, 宽, 高) */
    fun toUprightGray(image: ImageProxy): Triple<IntArray, Int, Int>? {
        val plane = image.planes.getOrNull(0) ?: return null
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val w = image.width
        val h = image.height
        if (w <= 0 || h <= 0) return null

        val start = buffer.position()
        fun y(x: Int, y: Int): Int = (buffer.get(start + y * rowStride + x * pixelStride).toInt() and 0xFF)

        return when (val rotation = image.imageInfo.rotationDegrees % 360) {
            90 -> {
                // 顺时针 90°：旧 (x,y) → 新 (h-1-y, x)，新宽 h、新高 w
                val g = IntArray(h * w)
                for (yy in 0 until h) for (xx in 0 until w) g[xx * h + (h - 1 - yy)] = y(xx, yy)
                Triple(g, h, w)
            }
            180 -> {
                val g = IntArray(w * h)
                for (yy in 0 until h) for (xx in 0 until w) g[(h - 1 - yy) * w + (w - 1 - xx)] = y(xx, yy)
                Triple(g, w, h)
            }
            270 -> {
                // 顺时针 270°（=逆时针 90°）：旧 (x,y) → 新 (y, w-1-x)，新宽 h、新高 w
                val g = IntArray(h * w)
                for (yy in 0 until h) for (xx in 0 until w) g[(w - 1 - xx) * h + yy] = y(xx, yy)
                Triple(g, h, w)
            }
            else -> {
                if (rotation != 0) return null
                val g = IntArray(w * h)
                for (yy in 0 until h) for (xx in 0 until w) g[yy * w + xx] = y(xx, yy)
                Triple(g, w, h)
            }
        }
    }

    fun detectQuad(gray: IntArray, w: Int, h: Int): FloatArray? = PageContour.detectQuad(gray, w, h)
}
