package com.scan.camera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 书页选框的透视变换与自动建议 */
object PageWarp {

    /**
     * 按归一化四边形（顺序：左上、右上、右下、左下）做透视校正。
     * 输出尺寸取对边长度均值，最长边不超过 [maxDim]，比例不变。
     * 选框退化时原样返回 src，由调用方判断。
     */
    fun warp(src: Bitmap, quad: FloatArray, maxDim: Int = 2400): Bitmap {
        require(ScanRules.validQuad(quad)) { "无效选框" }
        val srcPts = FloatArray(8)
        for (i in 0 until 4) {
            srcPts[2 * i] = quad[2 * i] * src.width
            srcPts[2 * i + 1] = quad[2 * i + 1] * src.height
        }

        fun dist(i: Int, j: Int): Double = hypot(
            (srcPts[2 * i] - srcPts[2 * j]).toDouble(),
            (srcPts[2 * i + 1] - srcPts[2 * j + 1]).toDouble()
        )

        val wRaw = ((dist(0, 1) + dist(3, 2)) / 2).coerceAtLeast(32.0)
        val hRaw = ((dist(0, 3) + dist(1, 2)) / 2).coerceAtLeast(32.0)
        val big = maxOf(wRaw, hRaw)
        val k = if (big > maxDim) maxDim / big else 1.0
        val w = (wRaw * k).roundToInt().coerceIn(32, 4096)
        val h = (hRaw * k).roundToInt().coerceIn(32, 4096)
        val dst = floatArrayOf(0f, 0f, w.toFloat(), 0f, w.toFloat(), h.toFloat(), 0f, h.toFloat())

        val matrix = Matrix()
        val ok = matrix.setPolyToPoly(srcPts, 0, dst, 0, 4)
        if (!ok) return src

        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(src, matrix, Paint().apply {
            isFilterBitmap = true
            isAntiAlias = true
        })
        return out
    }

    /**
     * 启发式自动选框：小图上 Otsu 二值化找页面区域（自动判断页面比背景亮或暗），
     * 形状不合理（低对比、杂物干扰）时回退到居中内缩框。
     */
    fun suggestQuad(bmp: Bitmap): FloatArray {
        val default = floatArrayOf(0.07f, 0.05f, 0.93f, 0.05f, 0.93f, 0.95f, 0.07f, 0.95f)
        val maxSide = max(bmp.width, bmp.height)
        if (maxSide <= 0) return default
        val scale = min(1f, 320f / maxSide)
        val sw = (bmp.width * scale).roundToInt().coerceAtLeast(16)
        val sh = (bmp.height * scale).roundToInt().coerceAtLeast(16)
        val small = Bitmap.createScaledBitmap(bmp, sw, sh, true)
        val px = IntArray(sw * sh)
        small.getPixels(px, 0, sw, 0, 0, sw, sh)
        // 同尺寸时 createScaledBitmap 会返回原实例，此时不能回收
        if (small !== bmp) small.recycle()

        val hist = IntArray(256)
        val gray = IntArray(px.size)
        for (i in px.indices) {
            val p = px[i]
            val g = ((p shr 16 and 0xFF) * 299 + (p shr 8 and 0xFF) * 587 + (p and 0xFF) * 114) / 1000
            gray[i] = g
            hist[g]++
        }
        PageContour.detectQuad(gray, sw, sh)?.takeIf { ScanRules.validQuad(it) }?.let { return it }
        val t = otsu(hist, px.size)

        // 中心附近采样投票：页面在阈值的亮侧还是暗侧
        var votes = 0
        val samples = listOf(
            sw / 2 to sh / 2, sw * 2 / 5 to sh / 2, sw * 3 / 5 to sh / 2,
            sw / 2 to sh * 2 / 5, sw / 2 to sh * 3 / 5
        )
        for ((sx, sy) in samples) if (gray[sy * sw + sx] >= t) votes++
        val pageBright = votes >= samples.size / 2 + 1

        var pageCount = 0
        val rowCounts = IntArray(sh)
        val colCounts = IntArray(sw)
        for (y in 0 until sh) {
            for (x in 0 until sw) {
                val g = gray[y * sw + x]
                val isPage = if (pageBright) g >= t else g < t
                if (isPage) {
                    pageCount++
                    rowCounts[y]++
                    colCounts[x]++
                }
            }
        }
        val frac = pageCount.toFloat() / px.size
        if (frac < 0.15f || frac > 0.95f) return default

        // 用行列密度阈值剔除零星亮斑（反光、杂物）
        val rowTh = (sw * 0.06f).toInt().coerceAtLeast(1)
        val colTh = (sh * 0.06f).toInt().coerceAtLeast(1)
        var top = 0
        while (top < sh && rowCounts[top] < rowTh) top++
        var bottom = sh - 1
        while (bottom > top && rowCounts[bottom] < rowTh) bottom--
        var left = 0
        while (left < sw && colCounts[left] < colTh) left++
        var right = sw - 1
        while (right > left && colCounts[right] < colTh) right--

        val bw = right - left
        val bh = bottom - top
        if (bw < sw * 0.25f || bh < sh * 0.25f) return default
        val aspect = bw.toFloat() / bh
        if (aspect < 0.3f || aspect > 1.6f) return default

        // 略微内缩，避免把桌面算进页面
        val insX = bw * 0.02f
        val insY = bh * 0.02f
        val l = ((left + insX) / sw).coerceIn(0f, 1f)
        val r = ((right - insX) / sw).coerceIn(0f, 1f)
        val tp = ((top + insY) / sh).coerceIn(0f, 1f)
        val bt = ((bottom - insY) / sh).coerceIn(0f, 1f)
        return floatArrayOf(l, tp, r, tp, r, bt, l, bt)
    }

    internal fun otsu(hist: IntArray, total: Int): Int = PageContour.otsu(hist, total)
}
