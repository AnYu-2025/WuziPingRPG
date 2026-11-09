package com.scan.camera

import java.util.Arrays
import kotlin.math.abs
import kotlin.math.hypot

/** 可在 JVM 直接验证的轮廓检测，共用于实时预览和照片智能裁边。 */
object PageContour {
    // 工作缓冲（仅分析线程访问，按帧复用）
    private var mask: ByteArray? = null
    private var comp: IntArray? = null
    private var queue: IntArray? = null
    private var wsW = 0
    private var wsH = 0

    /**
     * 检测书页四角，返回归一化四边形（顺序：左上、右上、右下、左下）。
     * 找不到可信的页面区域时返回 null。
     */
    @Synchronized fun detectQuad(gray: IntArray, w: Int, h: Int): FloatArray? {
        if (w < 64 || h < 64 || gray.size != w*h || gray.any { it !in 0..255 }) return null
        ensureWorkspace(w, h)
        val m = mask!!
        val c = comp!!
        val q = queue!!
        val n = w * h

        val hist = IntArray(256)
        for (i in 0 until n) hist[gray[i]]++
        val t = otsu(hist, n)

        // 画面中心附近 5 点投票：页面在阈值的亮侧还是暗侧
        var votes = 0
        val sx = intArrayOf(w / 2, w * 2 / 5, w * 3 / 5, w / 2, w / 2)
        val sy = intArrayOf(h / 2, h / 2, h / 2, h * 2 / 5, h * 3 / 5)
        for (i in sx.indices) if (gray[sy[i] * w + sx[i]] >= t) votes++
        val pageBright = votes >= 3
        var pageArea = 0
        for (i in 0 until n) {
            val page = if (pageBright) gray[i] >= t else gray[i] < t
            m[i] = if (page) 1 else 0
            if (page) pageArea++
        }
        val frac = pageArea.toFloat() / n
        if (frac < 0.15f || frac > 0.95f) return null

        majorityFilter(m, w, h)

        // 边界洪泛：与边框连通的 0 像素 = 背景(2)；页面内部的文字孔洞保持非背景
        var head = 0
        var tail = 0
        for (x in 0 until w) {
            if (m[x].toInt() == 0) { m[x] = 2; q[tail++] = x }
            if (m[(h - 1) * w + x].toInt() == 0) { m[(h - 1) * w + x] = 2; q[tail++] = (h - 1) * w + x }
        }
        for (y in 0 until h) {
            if (m[y * w].toInt() == 0) { m[y * w] = 2; q[tail++] = y * w }
            if (m[y * w + w - 1].toInt() == 0) { m[y * w + w - 1] = 2; q[tail++] = y * w + w - 1 }
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

        // 最大非背景连通域 = 页面（含文字孔洞）
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
        if (bestArea < n * 0.2f) return null
        // 二次校验 1：页面组件必须包含画面中心（用户总是把中心对准页面）
        if (c[(h / 2) * w + w / 2] != bestId) return null
        // 二次校验 2：组件内反极性孔洞占比过高（>40%）说明极性可能判反（把桌面当了页面）
        if (bestOnes * 5 < bestArea * 3) return null

        // 提取该组件每行左右极值点
        val px = FloatArray(2 * h)
        val py = FloatArray(2 * h)
        var pc = 0
        var minY = h
        var maxY = -1
        for (y in 0 until h) {
            var minx = -1
            var maxx = -1
            val row = y * w
            for (x in 0 until w) {
                if (m[row + x].toInt() != 2 && c[row + x] == bestId) {
                    if (minx < 0) minx = x
                    maxx = x
                }
            }
            if (minx >= 0) {
                px[pc] = minx.toFloat(); py[pc] = y.toFloat(); pc++
                px[pc] = maxx.toFloat(); py[pc] = y.toFloat(); pc++
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
        if (pc < 8 || maxY - minY < h * 0.25f) return null

        // 凸包（Andrew 单调链）
        val hx = FloatArray(2 * pc)
        val hy = FloatArray(2 * pc)
        val hullN = convexHull(px, py, pc, hx, hy)
        if (hullN < 4) return null

        // 简化到 ≤ 48 点（均匀抽样，保持环序）
        val stride = (hullN + 47) / 48
        val sn = (hullN + stride - 1) / stride
        val sx2 = FloatArray(sn)
        val sy2 = FloatArray(sn)
        var k2 = 0
        var i2 = 0
        while (i2 < hullN) {
            sx2[k2] = hx[i2]
            sy2[k2] = hy[i2]
            k2++
            i2 += stride
        }

        // 最大面积内接四边形
        val qi = maxAreaQuad(sx2, sy2, k2) ?: return null
        val cx4 = FloatArray(4)
        val cy4 = FloatArray(4)
        for (j in 0 until 4) {
            cx4[j] = sx2[qi[j]]
            cy4[j] = sy2[qi[j]]
        }

        // 环序 → 左上/右上/右下/左下：起点取 min(x+y)，方向按有符号面积
        var sa = 0f
        for (j in 0 until 4) {
            val jj = (j + 1) % 4
            sa += cx4[j] * cy4[jj] - cx4[jj] * cy4[j]
        }
        var tl = 0
        var bestSum = Float.MAX_VALUE
        for (j in 0 until 4) {
            val s = cx4[j] + cy4[j]
            if (s < bestSum) { bestSum = s; tl = j }
        }
        val order = if (sa > 0) intArrayOf(0, 1, 2, 3) else intArrayOf(0, 3, 2, 1)
        val quad = FloatArray(8)
        for (j in 0 until 4) {
            val src = (tl + order[j]) % 4
            quad[2 * j] = cx4[src] / w
            quad[2 * j + 1] = cy4[src] / h
        }
        return if (plausible(quad)) quad else null
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

    /** 3x3 多数滤波：去零星噪点、平滑边界，比开运算温和 */
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

    /** 凸多边形最大面积内接四边形，返回 4 个顶点在环序中的下标 */
    private fun maxAreaQuad(hx: FloatArray, hy: FloatArray, k: Int): IntArray? {
        if (k < 4) return null
        var best = 0f
        var bi = 0; var bj = 0; var bk = 0; var bl = 0
        for (a in 0 until k - 3) {
            for (b in a + 1 until k - 2) {
                for (cc in b + 1 until k - 1) {
                    val abBC = tri(hx[a], hy[a], hx[b], hy[b], hx[cc], hy[cc])
                    for (d in cc + 1 until k) {
                        val area = abBC + tri(hx[a], hy[a], hx[cc], hy[cc], hx[d], hy[d])
                        if (area > best) {
                            best = area
                            bi = a; bj = b; bk = cc; bl = d
                        }
                    }
                }
            }
        }
        return if (best <= 0f) null else intArrayOf(bi, bj, bk, bl)
    }

    private fun tri(ax: Float, ay: Float, bx: Float, by: Float, cx: Float, cy: Float): Float =
        abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2f

    /** 面积占比与边长的粗校验，剔除明显不是页面的框 */
    private fun plausible(q: FloatArray): Boolean {
        fun edge(i: Int, j: Int): Float {
            val dx = q[2 * i] - q[2 * j]
            val dy = q[2 * i + 1] - q[2 * j + 1]
            return hypot(dx, dy)
        }
        var area = 0f
        for (i in 0 until 4) {
            val j = (i + 1) % 4
            area += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]
        }
        val ratio = abs(area) / 2f
        if (ratio < 0.15f) return false
        // 页面几乎充满画面时边缘不在画面内，跟踪无意义，交回静态引导框
        if (ratio > 0.93f) return false
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
