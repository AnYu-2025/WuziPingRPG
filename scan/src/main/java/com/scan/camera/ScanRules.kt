package com.scan.camera

import kotlin.math.abs

/** 不依赖 Android 的几何及稳定判定，供裁边、拍摄及回归测试共用。 */
object ScanRules {
    fun validQuad(q: FloatArray): Boolean {
        if (q.size != 8 || q.any { !it.isFinite() || it !in 0f..1f }) return false
        var area = 0f
        var sign = 0f
        for (i in 0..3) {
            val j = (i + 1) % 4; val k = (i + 2) % 4
            val dx = q[2*j] - q[2*i]; val dy = q[2*j+1] - q[2*i+1]
            if (dx*dx + dy*dy < 0.0004f) return false
            val cross = dx*(q[2*k+1]-q[2*j+1]) - dy*(q[2*k]-q[2*j])
            if (abs(cross) < 0.0001f || (sign != 0f && cross*sign < 0f)) return false
            sign = cross
            area += q[2*i]*q[2*j+1] - q[2*j]*q[2*i+1]
        }
        return abs(area) >= 0.01f
    }

    fun rotateQuad(q: FloatArray): FloatArray {
        // 保持左上、右上、右下、左下语义，避免旋转后透视变换把照片转回去。
        val out = FloatArray(8)
        for (i in 0..3) {
            val src = (i + 3) % 4
            out[2*i] = 1f-q[2*src+1]
            out[2*i+1] = q[2*src]
        }
        return out
    }
}

/** 拍摄后必须检测到场景变化才重新武装，防止同一页每隔几秒重复拍摄。 */
class AutoCaptureGate {
    private var previous: FloatArray? = null
    private var stableSince = 0L
    private var lastShot = Long.MIN_VALUE / 2
    private var shotSignature: IntArray? = null
    private var changedFrames = 0
    private var armed = true
    var progress = 0f
        private set

    @Synchronized fun reset() {
        previous = null; stableSince = 0; shotSignature = null
        lastShot = Long.MIN_VALUE / 2
        changedFrames = 0; armed = true; progress = 0f
    }

    @Synchronized fun update(quad: FloatArray?, signature: IntArray, now: Long, busy: Boolean): Boolean {
        val shot = shotSignature
        if (!armed && shot != null && shot.size == signature.size) {
            val difference = signature.indices.sumOf { abs(signature[it]-shot[it]) }.toFloat()/signature.size
            changedFrames = if (difference > 16f) changedFrames+1 else 0
            if (changedFrames >= 3) { armed = true; previous = null; stableSince = 0 }
        }
        if (busy || quad == null || !armed) {
            previous = null; stableSince = 0; progress = 0f; return false
        }
        val old = previous
        val stable = old != null && quad.indices.all { abs(quad[it]-old[it]) < 0.014f }
        if (!stable || stableSince == 0L) stableSince = now
        previous = quad.copyOf()
        progress = ((now-stableSince)/900f).coerceIn(0f, 1f)
        if (progress >= 1f && now-lastShot >= 2600) {
            lastShot = now; shotSignature = signature.copyOf(); armed = false; progress = 0f
            return true
        }
        return false
    }
}
