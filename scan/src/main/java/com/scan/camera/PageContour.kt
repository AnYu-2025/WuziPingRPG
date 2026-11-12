package com.scan.camera

import java.util.Arrays
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * 可在 JVM 直接验证的书页四角检测，实时预览和拍后裁边共用。
 *
 * 先用整图 Otsu 抠出页面（亮纸 / 暗纸都试），不行再减掉缓慢光照后重试，
 * 最后才沿梯度找四条边。角点取凸包上的四个极值，不再对几十个点做四重循环。
 * 找不到可信页面时返回 null，由调用方决定退回整帧还是居中框。
 */
object PageContour {
    private var mask: ByteArray? = null
    private var comp: IntArray? = null
    private var queue: IntArray? = null
    private var wsW = 0
    private var wsH = 0

    @Synchronized fun detectQuad(gray: IntArray, w: Int, h: Int): FloatArray? {
        if (w < 64 || h < 64 || gray.size != w * h || gray.any { it !in 0..255 }) return null
        ensureWorkspace(w, h)
        val primary = segment(gray, w, h, relaxed = false)
        // 已经是大半张纸就不必再跑光照校正，避免角点被第二次分割带偏。
        if (primary != null && quadArea(primary) >= 0.48f) return primary
        val recovered = usableRecovery(
            segment(flattenIllumination(gray, w, h), w, h, relaxed = true) ?: edgeQuad(gray, w, h)
        )
        if (primary == null) return recovered
        if (recovered != null && quadArea(recovered) > quadArea(primary) * 1.22f) return recovered
        return primary
    }

    /** 贴着画面四边的“页面”多半是把整幅图抠出来了，不能拿来替换或误报。 */
    private fun usableRecovery(quad: FloatArray?): FloatArray? {
        if (quad == null) return null
        var touching = 0
        for (i in 0 until 4) {
            val x = quad[2 * i]
            val y = quad[2 * i + 1]
            if (x < 0.03f || x > 0.97f || y < 0.03f || y > 0.97f) touching++
        }
        return if (touching >= 3) null else quad
    }

    private fun segment(gray: IntArray, w: Int, h: Int, relaxed: Boolean): FloatArray? {
        val n = w * h
        val hist = IntArray(256)
        for (i in 0 until n) hist[gray[i]]++
        val threshold = otsu(hist, n)
        val preferred = pageLooksBright(gray, w, h, threshold)
        return maskQuad(gray, w, h, threshold, preferred, relaxed)
            ?: maskQuad(gray, w, h, threshold, !preferred, relaxed)
    }

    private fun pageLooksBright(gray: IntArray, w: Int, h: Int, threshold: Int): Boolean {
        val sx = intArrayOf(w / 2, w * 2 / 5, w * 3 / 5, w / 2, w / 2)
        val sy = intArrayOf(h / 2, h / 2, h / 2, h * 2 / 5, h * 3 / 5)
        var votes = 0
        for (i in sx.indices) if (gray[sy[i] * w + sx[i]] >= threshold) votes++
        return votes >= 3
    }

    private fun maskQuad(
        gray: IntArray, w: Int, h: Int, threshold: Int, pageBright: Boolean, relaxed: Boolean
    ): FloatArray? {
        val m = mask!!
        val c = comp!!
        val q = queue!!
        val n = w * h
        var pageArea = 0
        for (i in 0 until n) {
            val page = if (pageBright) gray[i] >= threshold else gray[i] < threshold
            m[i] = if (page) 1 else 0
            if (page) pageArea++
        }
        val frac = pageArea.toFloat() / n
        val minFrac = if (relaxed) 0.12f else 0.15f
        val maxFrac = if (relaxed) 0.985f else 0.97f
        if (frac < minFrac || frac > maxFrac) return null

        majorityFilter(m, w, h)

        var head = 0
        var tail = 0
        for (x in 0 until w) {
            if (m[x].toInt() == 0) { m[x] = 2; q[tail++] = x }
            val bottom = (h - 1) * w + x
            if (m[bottom].toInt() == 0) { m[bottom] = 2; q[tail++] = bottom }
        }
        for (y in 0 until h) {
            val left = y * w
            val right = y * w + w - 1
            if (m[left].toInt() == 0) { m[left] = 2; q[tail++] = left }
            if (m[right].toInt() == 0) { m[right] = 2; q[tail++] = right }
        }
        while (head < tail) {
            val i = q[head++]
            val x = i % w
            val y = i / w
            if (x > 0 && m[i - 1].toInt() == 0) { m[i - 1] = 2; q[tail++] = i - 1 }
            if (x < w - 1 && m[i + 1].toInt() == 0) { m[i + 1] = 2; q[tail++] = i + 1 }
            if (y > 0 && m[i - w].toInt() == 0) { m[i - w] = 2; q[tail++] = i - w }
            if (y < h - 1 && m[i + w].toInt() == 0) { m[i + w] = 2; q[tail++] = i + w }
        }

        Arrays.fill(c, 0)
        var bestId = 0
        var bestArea = 0
        var bestOnes = 0
        var compId = 0
        for (start in 0 until n) {
            if (m[start].toInt() == 2 || c[start] != 0) continue
            compId++
            var area = 0
            var ones = 0
            head = 0; tail = 0
            c[start] = compId
            q[tail++] = start
            while (head < tail) {
                val i = q[head++]
                area++
                if (m[i].toInt() == 1) ones++
                val x = i % w
                val y = i / w
                if (x > 0 && m[i - 1].toInt() != 2 && c[i - 1] == 0) { c[i - 1] = compId; q[tail++] = i - 1 }
                if (x < w - 1 && m[i + 1].toInt() != 2 && c[i + 1] == 0) { c[i + 1] = compId; q[tail++] = i + 1 }
                if (y > 0 && m[i - w].toInt() != 2 && c[i - w] == 0) { c[i - w] = compId; q[tail++] = i - w }
                if (y < h - 1 && m[i + w].toInt() != 2 && c[i + w] == 0) { c[i + w] = compId; q[tail++] = i + w }
            }
            if (area > bestArea) { bestArea = area; bestId = compId; bestOnes = ones }
        }
        val minArea = if (relaxed) 0.16f else 0.2f
        if (bestArea < n * minArea) return null
        // 孔洞太多通常是把桌面当成了页面
        if (bestOnes * 5 < bestArea * 3) return null

        val px = FloatArray(2 * h)
        val py = FloatArray(2 * h)
        var pc = 0
        var minY = h
        var maxY = -1
        var sumX = 0.0
        var sumY = 0.0
        var count = 0
        for (y in 0 until h) {
            var minx = -1
            var maxx = -1
            val row = y * w
            for (x in 0 until w) {
                if (m[row + x].toInt() != 2 && c[row + x] == bestId) {
                    if (minx < 0) minx = x
                    maxx = x
                    sumX += x
                    sumY += y
                    count++
                }
            }
            if (minx >= 0) {
                px[pc] = minx.toFloat(); py[pc] = y.toFloat(); pc++
                px[pc] = maxx.toFloat(); py[pc] = y.toFloat(); pc++
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
        if (pc < 8 || count == 0 || maxY - minY < h * 0.22f) return null
        val cx = (sumX / count / w).toFloat()
        val cy = (sumY / count / h).toFloat()
        val band = if (relaxed) 0.08f else 0.12f
        // 不再要求正中心像素落在页面上，但页面重心仍要在画面中部，避免抠到角落反光
        if (cx !in band..(1f - band) || cy !in band..(1f - band)) return null

        val hx = FloatArray(2 * pc)
        val hy = FloatArray(2 * pc)
        val hullN = convexHull(px, py, pc, hx, hy)
        return cornersOf(hx, hy, hullN, w, h)
    }

    /** 大窗口减光照，把同一张纸上的阴影拉平，桌面和纸的差别还留着。 */
    private fun flattenIllumination(gray: IntArray, w: Int, h: Int): IntArray {
        val radius = (min(w, h) / 5).coerceIn(8, 48)
        val stride = w + 1
        val integral = LongArray(stride * (h + 1))
        for (y in 1..h) {
            var row = 0L
            for (x in 1..w) {
                row += gray[(y - 1) * w + (x - 1)]
                integral[y * stride + x] = integral[(y - 1) * stride + x] + row
            }
        }
        fun sum(x0: Int, y0: Int, x1: Int, y1: Int): Long {
            return integral[y1 * stride + x1] - integral[y0 * stride + x1] -
                integral[y1 * stride + x0] + integral[y0 * stride + x0]
        }
        val out = IntArray(gray.size)
        for (y in 0 until h) {
            val y0 = (y - radius).coerceAtLeast(0)
            val y1 = (y + radius + 1).coerceAtMost(h)
            for (x in 0 until w) {
                val x0 = (x - radius).coerceAtLeast(0)
                val x1 = (x + radius + 1).coerceAtMost(w)
                val area = (x1 - x0) * (y1 - y0)
                val mean = sum(x0, y0, x1, y1).toFloat() / area
                out[y * w + x] = (gray[y * w + x] - mean + 128f).toInt().coerceIn(0, 255)
            }
        }
        return out
    }

    /** 区域分割失败时，用强梯度的凸包四角兜底。均匀画面没有边，返回 null。 */
    private fun edgeQuad(gray: IntArray, w: Int, h: Int): FloatArray? {
        val mags = IntArray(w * h)
        var maxMag = 0
        for (y in 1 until h - 1) {
            for (x in 1 until w - 1) {
                val i = y * w + x
                val mag = abs(gray[i + 1] - gray[i - 1]) + abs(gray[i + w] - gray[i - w])
                mags[i] = mag
                if (mag > maxMag) maxMag = mag
            }
        }
        if (maxMag < 36) return null
        val thresh = (maxMag * 0.45f).toInt().coerceAtLeast(28)
        var strong = 0
        for (mag in mags) if (mag >= thresh) strong++
        if (strong < 48) return null
        val stride = (strong / 1200).coerceAtLeast(1)
        val xs = ArrayList<Float>(strong / stride + 1)
        val ys = ArrayList<Float>(strong / stride + 1)
        var seen = 0
        for (y in 1 until h - 1) {
            val row = y * w
            for (x in 1 until w - 1) {
                if (mags[row + x] >= thresh) {
                    seen++
                    if (seen % stride == 0) {
                        xs.add(x.toFloat())
                        ys.add(y.toFloat())
                    }
                }
            }
        }
        if (xs.size < 48) return null
        val px = FloatArray(xs.size) { xs[it] }
        val py = FloatArray(ys.size) { ys[it] }
        val hx = FloatArray(px.size * 2)
        val hy = FloatArray(py.size * 2)
        val hullN = convexHull(px, py, px.size, hx, hy)
        val quad = cornersOf(hx, hy, hullN, w, h) ?: return null
        if (quadArea(quad) > 0.94f) return null
        return if (edgesSupported(px, py, px.size, quad, w, h)) quad else null
    }

    private fun edgesSupported(xs: FloatArray, ys: FloatArray, n: Int, quad: FloatArray, w: Int, h: Int): Boolean {
        val tol = max(3.5f, min(w, h) * 0.025f)
        val counts = IntArray(4)
        val ax = FloatArray(4) { quad[it * 2] * w }
        val ay = FloatArray(4) { quad[it * 2 + 1] * h }
        for (i in 0 until n) {
            var best = 0
            var bestD = Float.MAX_VALUE
            for (edge in 0 until 4) {
                val j = (edge + 1) % 4
                val d = distPointSeg(xs[i], ys[i], ax[edge], ay[edge], ax[j], ay[j])
                if (d < bestD) { bestD = d; best = edge }
            }
            if (bestD <= tol) counts[best]++
        }
        return counts.all { it >= 5 }
    }

    private fun cornersOf(hx: FloatArray, hy: FloatArray, k: Int, w: Int, h: Int): FloatArray? {
        if (k < 4) return null
        var tl = 0; var tr = 0; var br = 0; var bl = 0
        var tlScore = Float.POSITIVE_INFINITY
        var trScore = Float.NEGATIVE_INFINITY
        var brScore = Float.NEGATIVE_INFINITY
        var blScore = Float.POSITIVE_INFINITY
        for (i in 0 until k) {
            val x = hx[i]
            val y = hy[i]
            val sum = x + y
            val diff = x - y
            if (sum < tlScore) { tlScore = sum; tl = i }
            if (diff > trScore) { trScore = diff; tr = i }
            if (sum > brScore) { brScore = sum; br = i }
            if (diff < blScore) { blScore = diff; bl = i }
        }
        if (setOf(tl, tr, br, bl).size < 4) return null
        val quad = floatArrayOf(
            hx[tl] / w, hy[tl] / h,
            hx[tr] / w, hy[tr] / h,
            hx[br] / w, hy[br] / h,
            hx[bl] / w, hy[bl] / h
        )
        return if (plausible(quad) && ScanRules.validQuad(quad)) quad else null
    }

    private fun ensureWorkspace(w: Int, h: Int) {
        if (wsW == w && wsH == h && mask != null) return
        wsW = w
        wsH = h
        val n = w * h
        mask = ByteArray(n)
        comp = IntArray(n)
        queue = IntArray(n)
    }

    private fun majorityFilter(m: ByteArray, w: Int, h: Int) {
        val src = m.copyOf()
        for (y in 0 until h) {
            val y0 = (y - 1).coerceAtLeast(0)
            val y2 = (y + 1).coerceAtMost(h - 1)
            for (x in 0 until w) {
                val x0 = (x - 1).coerceAtLeast(0)
                val x2 = (x + 1).coerceAtMost(w - 1)
                var s = 0
                for (yy in y0..y2) {
                    val row = yy * w
                    for (xx in x0..x2) if (src[row + xx].toInt() == 1) s++
                }
                m[y * w + x] = if (s >= 5) 1 else 0
            }
        }
    }

    private fun convexHull(px: FloatArray, py: FloatArray, pc: Int, outX: FloatArray, outY: FloatArray): Int {
        val sorted = (0 until pc).sortedWith(compareBy({ px[it] }, { py[it] }))
        val ux = FloatArray(pc)
        val uy = FloatArray(pc)
        var un = 0
        for (i in sorted) {
            if (un > 0 && abs(px[i] - ux[un - 1]) < 0.5f && abs(py[i] - uy[un - 1]) < 0.5f) continue
            ux[un] = px[i]
            uy[un] = py[i]
            un++
        }
        if (un < 3) return 0
        val tx = FloatArray(2 * un)
        val ty = FloatArray(2 * un)
        var k = 0
        for (i in 0 until un) {
            while (k >= 2 && cross(tx[k - 2], ty[k - 2], tx[k - 1], ty[k - 1], ux[i], uy[i]) <= 0f) k--
            tx[k] = ux[i]; ty[k] = uy[i]; k++
        }
        val lower = k
        for (i in un - 2 downTo 0) {
            while (k > lower && cross(tx[k - 2], ty[k - 2], tx[k - 1], ty[k - 1], ux[i], uy[i]) <= 0f) k--
            tx[k] = ux[i]; ty[k] = uy[i]; k++
        }
        val hn = k - 1
        for (i in 0 until hn) {
            outX[i] = tx[i]
            outY[i] = ty[i]
        }
        return hn
    }

    private fun cross(ox: Float, oy: Float, ax: Float, ay: Float, bx: Float, by: Float): Float =
        (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)

    private fun plausible(q: FloatArray): Boolean {
        fun edge(i: Int, j: Int): Float = hypot(q[2 * i] - q[2 * j], q[2 * i + 1] - q[2 * j + 1])
        val ratio = quadArea(q)
        if (ratio < 0.15f || ratio > 0.97f) return false
        return edge(0, 1) > 0.2f && edge(1, 2) > 0.2f && edge(2, 3) > 0.2f && edge(3, 0) > 0.2f
    }

    internal fun otsu(hist: IntArray, total: Int): Int {
        var sum = 0L
        for (i in 0..255) sum += i.toLong() * hist[i]
        var sumB = 0L
        var wB = 0L
        var best = 0.0
        var thresh = 128
        for (t in 0..255) {
            wB += hist[t]
            if (wB == 0L) continue
            val wF = total - wB
            if (wF == 0L) break
            sumB += t.toLong() * hist[t]
            val mB = sumB.toDouble() / wB
            val mF = (sum - sumB).toDouble() / wF
            val v = wB.toDouble() * wF * (mB - mF) * (mB - mF)
            if (v > best) {
                best = v
                thresh = t
            }
        }
        return (thresh + 1).coerceAtMost(255)
    }
}
