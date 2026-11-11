package com.scan.camera

import kotlin.math.abs
import kotlin.math.hypot

/** 裁边手柄的触控尺寸。测试锁住下限，避免再缩回难捏的小圆点。 */
object CropHandles {
    const val CORNER_HIT_DP = 48f
    const val EDGE_HIT_DP = 36f
    const val CORNER_RADIUS_DP = 15f
    const val EDGE_RADIUS_DP = 11f
    const val LOUPE_ZOOM = 2.6f
}

/** 选框拖动：角点和边中点都走这里，非法位置会沿原轨迹退回到仍凸、不自交的位置。 */
object QuadEdit {
    fun moveCorner(quad: FloatArray, index: Int, x: Float, y: Float): FloatArray {
        if (!ScanRules.validQuad(quad) || index !in 0..3) return quad.copyOf()
        val target = quad.copyOf()
        target[2 * index] = x.coerceIn(0f, 1f)
        target[2 * index + 1] = y.coerceIn(0f, 1f)
        return approach(quad, target)
    }

    /** edge 0 上、1 右、2 下、3 左，位移同时作用在这条边的两个端点。 */
    fun moveEdge(quad: FloatArray, edge: Int, dx: Float, dy: Float): FloatArray {
        if (!ScanRules.validQuad(quad)) return quad.copyOf()
        val i = ((edge % 4) + 4) % 4
        val j = (i + 1) % 4
        val target = quad.copyOf()
        target[2 * i] = (quad[2 * i] + dx).coerceIn(0f, 1f)
        target[2 * i + 1] = (quad[2 * i + 1] + dy).coerceIn(0f, 1f)
        target[2 * j] = (quad[2 * j] + dx).coerceIn(0f, 1f)
        target[2 * j + 1] = (quad[2 * j + 1] + dy).coerceIn(0f, 1f)
        return approach(quad, target)
    }

    fun edgeMidpoint(quad: FloatArray, edge: Int): FloatArray {
        val i = ((edge % 4) + 4) % 4
        val j = (i + 1) % 4
        return floatArrayOf(
            (quad[2 * i] + quad[2 * j]) / 2f,
            (quad[2 * i + 1] + quad[2 * j + 1]) / 2f
        )
    }

    /** 在起点和目标之间取最远的合法选框。转向反了说明边已经互相穿过，停在穿过之前。 */
    private fun approach(from: FloatArray, to: FloatArray): FloatArray {
        if (keepsOrder(from, to)) return to
        var lo = 0f
        var hi = 1f
        var best = from.copyOf()
        repeat(14) {
            val mid = (lo + hi) / 2f
            val candidate = FloatArray(8) { index -> from[index] + (to[index] - from[index]) * mid }
            if (keepsOrder(from, candidate)) {
                best = candidate
                lo = mid
            } else {
                hi = mid
            }
        }
        return best
    }

    private fun keepsOrder(reference: FloatArray, candidate: FloatArray): Boolean {
        if (!ScanRules.validQuad(candidate)) return false
        return winding(reference) * winding(candidate) > 0f
    }

    private fun winding(q: FloatArray): Float {
        var area = 0f
        for (i in 0 until 4) {
            val j = (i + 1) % 4
            area += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]
        }
        return area
    }
}

/**
 * 实时预览的选框跟踪。
 * 小抖动用低通压掉；单帧跳变先按住，连续两帧才跟上；
 * 连续丢失后退回整页或居中的框，而不是闪回静态角标。
 */
class QuadMotion {
    var fallback: Boolean = false
        private set
    var confident: Boolean = false
        private set

    private var shown: FloatArray? = null
    private var candidate: FloatArray? = null
    private var candidateHits = 0
    private var misses = 0

    @Synchronized fun reset() {
        shown = null
        candidate = null
        candidateHits = 0
        misses = 0
        fallback = false
        confident = false
    }

    @Synchronized fun update(detected: FloatArray?): FloatArray {
        if (detected != null && ScanRules.validQuad(detected)) {
            misses = 0
            val current = shown
            if (current == null || fallback) {
                shown = detected.copyOf()
                candidate = null
                candidateHits = 0
                fallback = false
                confident = true
                return shown!!.copyOf()
            }
            val jump = maxDelta(current, detected)
            if (jump > 0.08f) {
                val pending = candidate
                if (pending != null && maxDelta(pending, detected) <= 0.035f) candidateHits++
                else {
                    candidate = detected.copyOf()
                    candidateHits = 1
                }
                if (candidateHits >= 2) {
                    shown = blend(current, detected, 0.72f)
                    candidate = null
                    candidateHits = 0
                }
                fallback = false
                confident = true
                return shown!!.copyOf()
            }
            candidate = null
            candidateHits = 0
            val alpha = when {
                jump < 0.012f -> 0.22f
                jump < 0.04f -> 0.45f
                else -> 0.68f
            }
            shown = blend(current, detected, alpha)
            fallback = false
            confident = true
            return shown!!.copyOf()
        }
        candidate = null
        candidateHits = 0
        misses++
        val held = shown
        if (held != null && !fallback && misses < 6) {
            confident = true
            fallback = false
            return held.copyOf()
        }
        val previous = held
        val next = if (previous != null && quadArea(previous) > 0.72f) {
            ScanRules.fullFrameQuad()
        } else {
            ScanRules.centeredQuad()
        }
        shown = next
        fallback = true
        confident = false
        return next.copyOf()
    }

    private fun blend(from: FloatArray, to: FloatArray, alpha: Float): FloatArray {
        val mixed = FloatArray(8) { index -> from[index] + (to[index] - from[index]) * alpha }
        return if (ScanRules.validQuad(mixed)) mixed else from.copyOf()
    }

    private fun maxDelta(a: FloatArray, b: FloatArray): Float {
        var max = 0f
        for (i in 0 until 8) {
            val d = abs(a[i] - b[i])
            if (d > max) max = d
        }
        return max
    }
}

internal fun quadArea(q: FloatArray): Float {
    if (q.size != 8) return 0f
    var area = 0f
    for (i in 0 until 4) {
        val j = (i + 1) % 4
        area += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]
    }
    return abs(area) / 2f
}

internal fun distPointSeg(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
    val abx = bx - ax
    val aby = by - ay
    val len2 = abx * abx + aby * aby
    if (len2 < 1e-6f) return hypot(px - ax, py - ay)
    val t = (((px - ax) * abx + (py - ay) * aby) / len2).coerceIn(0f, 1f)
    return hypot(px - (ax + abx * t), py - (ay + aby * t))
}
