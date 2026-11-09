package com.scan.camera

import android.graphics.Bitmap
import java.util.concurrent.Executors
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 纸质书拍照增强：对比拉伸 + 非锐化掩模 + 自适应二值化（积分图 / Bradley 算法）。
 * 所有逐像素操作按行分块并行到全部 CPU 核心（各块写不相交的行，天然线程安全），
 * 大图下的合成时间约为单线程的三分之一。
 * 锐化与对比强度由「后期处理」面板控制。
 */
object ImageEnhance {

    private val pool = Executors.newFixedThreadPool(
        Runtime.getRuntime().availableProcessors().coerceIn(2, 8)
    )

    /** 把 0..h-1 行切成若干段并行执行 body(yStart, yEndExclusive)，阻塞至全部完成 */
    private inline fun parallelRows(h: Int, crossinline body: (Int, Int) -> Unit) {
        val cores = Runtime.getRuntime().availableProcessors().coerceIn(2, 8)
        val band = (h + cores - 1) / cores
        if (band <= 0) return
        val futures = (0 until h step band).map { y0 ->
            pool.submit { body(y0, min(y0 + band, h)) }
        }
        // 即使一块失败也等待其他块结束，避免调用方释放仍在被工作线程访问的像素。
        var failure: Throwable? = null
        futures.forEach { future ->
            try { future.get() } catch (e: Exception) { if (failure == null) failure = e.cause ?: e }
        }
        failure?.let { throw it }
    }

    /** 灰度 + 对比拉伸 + 轻量锐化，改善拍照发灰、文字发虚的问题 */
    fun grayStretch(
        src: Bitmap,
        sharpen: Float = 0.5f,
        contrast: Float = 50f
    ): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        toGrayInPlace(px, w, h)
        stretchInPlace(px, w, h, contrast)
        unsharpInPlace(px, w, h, sharpen)
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val row = y * w
                for (x in 0 until w) {
                    val g = px[row + x]
                    px[row + x] = (0xFF shl 24) or (g shl 16) or (g shl 8) or g
                }
            }
        }
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        out.setPixels(px, 0, w, 0, 0, w, h)
        return out
    }

    /** 自适应黑白：按局部均值加偏置做阈值，能抵抗手影和光照不均 */
    fun adaptiveBinary(
        src: Bitmap,
        sharpen: Float = 0.5f,
        contrast: Float = 50f
    ): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        toGrayInPlace(px, w, h)
        stretchInPlace(px, w, h, contrast)
        unsharpInPlace(px, w, h, sharpen)

        // 积分图：用 Long 承载高分辨率下的像素和（行间串行，保持单线程）
        val iw = w + 1
        val integral = LongArray(iw * (h + 1))
        for (y in 0 until h) {
            var rowSum = 0L
            for (x in 0 until w) {
                rowSum += px[y * w + x].toLong()
                integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum
            }
        }

        val win = (minOf(w, h) / 12).coerceAtLeast(8)
        // 阈值判定逐像素独立 → 并行；整数运算避免浮点：g*count*100 < sum*85
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val y1c = (y - win).coerceAtLeast(0)
                val y2c = (y + win).coerceAtMost(h - 1)
                for (x in 0 until w) {
                    val x1 = (x - win).coerceAtLeast(0)
                    val x2 = (x + win).coerceAtMost(w - 1)
                    val count = (x2 - x1 + 1) * (y2c - y1c + 1)
                    val sum = integral[(y2c + 1) * iw + (x2 + 1)] - integral[y1c * iw + (x2 + 1)] -
                        integral[(y2c + 1) * iw + x1] + integral[y1c * iw + x1]
                    val idx = y * w + x
                    val isBlack = px[idx].toLong() * count * 100L < sum * 85L
                    px[idx] = if (isBlack) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
                }
            }
        }
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        out.setPixels(px, 0, w, 0, 0, w, h)
        return out
    }

    /**
     * 对比拉伸（原地）：contrast 0-100。
     * 0 = 不增强；50 = 直方图两端各 1% 拉伸（默认）；100 = 各 2%。
     * 直方图统计单线程，逐像素映射并行。
     */
    private fun stretchInPlace(px: IntArray, w: Int, h: Int, contrast: Float) {
        val clip = (px.size * (contrast / 50f) / 100f).toInt()
        if (clip <= 0) return
        val hist = IntArray(256)
        for (g in px) hist[g]++
        var lo = 0
        var acc = 0
        for (i in 0..255) {
            acc += hist[i]
            if (acc >= clip && i < 255) { lo = i; break }
        }
        var hi = 255
        acc = 0
        for (i in 255 downTo 0) {
            acc += hist[i]
            if (acc >= clip && i > 0) { hi = i; break }
        }
        if (hi <= lo) return
        val range = hi - lo
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val row = y * w
                for (x in 0 until w) {
                    val i = row + x
                    px[i] = ((px[i] - lo) * 255 / range).coerceIn(0, 255)
                }
            }
        }
    }

    /** 3x3 高斯差的非锐化掩模，轻度提锐文字边缘。amount 0-1。模糊与合成两趟各自并行 */
    private fun unsharpInPlace(px: IntArray, w: Int, h: Int, amount: Float) {
        if (amount <= 0.01f || w < 3 || h < 3) return
        val blur = IntArray(px.size)
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val yUp = (y - 1).coerceAtLeast(0)
                val yDown = (y + 1).coerceAtMost(h - 1)
                for (x in 0 until w) {
                    val xL = (x - 1).coerceAtLeast(0)
                    val xR = (x + 1).coerceAtMost(w - 1)
                    val s = px[yUp * w + xL] + 2 * px[yUp * w + x] + px[yUp * w + xR] +
                        2 * px[y * w + xL] + 4 * px[y * w + x] + 2 * px[y * w + xR] +
                        px[yDown * w + xL] + 2 * px[yDown * w + x] + px[yDown * w + xR]
                    blur[y * w + x] = s / 16
                }
            }
        }
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val row = y * w
                for (x in 0 until w) {
                    val i = row + x
                    px[i] = (px[i] + ((px[i] - blur[i]) * amount).roundToInt()).coerceIn(0, 255)
                }
            }
        }
    }

    /** 就地转灰度：每个像素只依赖自身，写回原数组 */
    private fun toGrayInPlace(px: IntArray, w: Int, h: Int) {
        parallelRows(h) { y0, y1 ->
            for (y in y0 until y1) {
                val row = y * w
                for (x in 0 until w) {
                    val p = px[row + x]
                    val r = p shr 16 and 0xFF
                    val g = p shr 8 and 0xFF
                    val b = p and 0xFF
                    px[row + x] = (r * 299 + g * 587 + b * 114) / 1000
                }
            }
        }
    }
}
