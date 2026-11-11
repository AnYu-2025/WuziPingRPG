package com.scan.camera

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import kotlin.math.abs
import kotlin.math.hypot

/**
 * 取景辅助层（轻量样式，参考主流文档扫描仪）：
 * - 检测到书页边缘：四角 L 形括角 + 细连线贴合页面，平滑动画跟随，不压暗画面
 * - 未检测到或超时：静态 A4 位置的四角括角
 * 相机画面按 FILL_CENTER 铺满取景区，检测坐标随之映射。
 */
class PageFrameOverlay @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private var quad: FloatArray? = null
    private var confident = true
    private var frameAspect = 4f / 3f
    private var lastQuadAt = 0L
    private var previewView: android.view.View? = null
    private var frameVisible = true

    // 对焦点反馈动画状态
    private var focusX = 0f
    private var focusY = 0f
    private var focusProgress = 1f // 1 = 不可见
    private var focusAnim: ValueAnimator? = null

    // 自动拍摄稳定进度（0 = 不显示）
    private var autoProgress = 0f
    private val autoBarPaint = Paint().apply { color = 0x66FFFFFF.toInt(); isAntiAlias = true }
    private val autoFillPaint = Paint().apply { color = 0xFFD97757.toInt(); isAntiAlias = true }

    // 暗光提示
    private var darkHint = false
    private val darkPaint = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        textSize = 12f * density
        isAntiAlias = true
        textAlign = Paint.Align.CENTER
    }
    private val darkText = context.getString(R.string.dark_hint)

    private val density get() = resources.displayMetrics.density
    private val bracketPaint = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2.5f * density
        isAntiAlias = true
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val edgePaint = Paint().apply {
        color = 0x4DFFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = density
        isAntiAlias = true
    }
    private val path = Path()

    private val focusPaint = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f * density
        isAntiAlias = true
    }

    private val staticTimeoutRunnable = Runnable {
        quad = null
        invalidate()
    }

    /**
     * 检测结果（null 视为本次无更新），四边形为相机帧归一化坐标。
     * 跟踪器已经做了平滑，这里直接落位，避免再套一层追赶动画把框拖出残影。
     * locked=false 表示这是丢失检测后的整帧 / 居中建议框。
     */
    fun setDetection(q: FloatArray?, aspect: Float, locked: Boolean = true) {
        if (q == null || q.size != 8 || aspect <= 0.1f) return
        frameAspect = aspect
        confident = locked
        lastQuadAt = SystemClock.elapsedRealtime()
        removeCallbacks(staticTimeoutRunnable)
        postDelayed(staticTimeoutRunnable, 1600)
        quad = q.copyOf()
        invalidate()
    }

    /**
     * 绑定取景视图：相机画面 FILL_CENTER 铺满整个 PreviewView，
     * 而本叠加层只是被上下栏夹住的取景带，检测坐标必须按 PreviewView 的显示矩形映射。
     */
    fun attachPreview(v: android.view.View) {
        previewView = v
    }

    /** 取景框是否显示（对焦反馈不受影响） */
    fun setFrameVisible(v: Boolean) {
        frameVisible = v
        invalidate()
    }

    /** 在触点显示对焦反馈圆环（触点为 previewView 本地坐标，内部换算到本叠加层） */
    fun showFocusAt(previewX: Float, previewY: Float) {
        val pv = previewView
        if (pv != null) {
            focusX = previewX + (pv.left - this@PageFrameOverlay.left)
            focusY = previewY + (pv.top - this@PageFrameOverlay.top)
        } else {
            focusX = previewX
            focusY = previewY
        }
        focusAnim?.cancel()
        focusAnim = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 800
            addUpdateListener { va ->
                focusProgress = va.animatedValue as Float
                invalidate()
            }
        }
        focusAnim?.start()
    }

    /** 自动拍摄稳定进度（0~1，0 表示不显示） */
    fun setAutoProgress(f: Float) {
        val nf = f.coerceIn(0f, 1f)
        if (abs(nf - autoProgress) > 0.02f || (nf == 0f) != (autoProgress == 0f)) {
            autoProgress = nf
            invalidate()
        }
    }

    /** 暗光提示开关 */
    fun setDarkHint(v: Boolean) {
        if (darkHint != v) {
            darkHint = v
            invalidate()
        }
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w < 40f || h < 40f) return
        if (frameVisible) {
            val q = quad
            val fresh = q != null && SystemClock.elapsedRealtime() - lastQuadAt < 1600
            if (q != null && fresh) drawQuad(canvas, w, h, q) else drawStatic(canvas, w, h)
        }
        drawFocusMarker(canvas)
        drawAutoBar(canvas, w)
        if (darkHint) {
            canvas.drawText(darkText, w / 2f, 34f * density, darkPaint)
        }
    }

    private fun drawAutoBar(canvas: Canvas, w: Float) {
        if (autoProgress <= 0.01f) return
        val barW = 140f * density
        val barH = 4f * density
        val left = (w - barW) / 2f
        val top = 10f * density
        canvas.drawRoundRect(left, top, left + barW, top + barH, barH / 2f, barH / 2f, autoBarPaint)
        canvas.drawRoundRect(
            left, top, left + barW * autoProgress, top + barH, barH / 2f, barH / 2f, autoFillPaint
        )
    }

    private fun drawFocusMarker(canvas: Canvas) {
        if (focusProgress >= 1f) return
        val base = 20f * density
        val r = base + 16f * density * focusProgress
        focusPaint.alpha = ((1f - focusProgress) * 240).toInt().coerceIn(0, 255)
        canvas.drawCircle(focusX, focusY, r, focusPaint)
        focusPaint.alpha = ((1f - focusProgress) * 255).toInt().coerceIn(0, 255)
        canvas.drawCircle(focusX, focusY, 2.5f * density, focusPaint)
        focusPaint.alpha = 255
    }

    /** 相机画面按 FILL_CENTER 铺满取景区，检测坐标随之映射 */
    private fun displayRect(w: Float, h: Float): RectF {
        val dw: Float
        val dh: Float
        if (w / h >= frameAspect) {
            dw = w
            dh = w / frameAspect
        } else {
            dw = h * frameAspect
            dh = h
        }
        return RectF((w - dw) / 2f, (h - dh) / 2f, (w + dw) / 2f, (h + dh) / 2f)
    }

    private fun drawQuad(canvas: Canvas, w: Float, h: Float, q: FloatArray) {
        val pv = previewView
        val rect = if (pv != null && pv.width > 40 && pv.height > 40) {
            val pw = pv.width.toFloat()
            val ph = pv.height.toFloat()
            val dw: Float
            val dh: Float
            if (pw / ph >= frameAspect) {
                dw = pw
                dh = pw / frameAspect
            } else {
                dw = ph * frameAspect
                dh = ph
            }
            val ox = (pv.left - this@PageFrameOverlay.left).toFloat()
            val oy = (pv.top - this@PageFrameOverlay.top).toFloat()
            RectF((pw - dw) / 2f, (ph - dh) / 2f, (pw + dw) / 2f, (ph + dh) / 2f).apply { offset(ox, oy) }
        } else {
            displayRect(w, h)
        }
        fun px(i: Int) = rect.left + q[2 * i] * rect.width()
        fun py(i: Int) = rect.top + q[2 * i + 1] * rect.height()

        val edgeAlpha = if (confident) 0xB0 else 0x66
        val bracketAlpha = if (confident) 0xF2 else 0x88
        edgePaint.color = (edgeAlpha shl 24) or 0x00FFFFFF
        bracketPaint.color = (bracketAlpha shl 24) or 0x00FFFFFF
        // 页面边缘细连线
        path.reset()
        path.moveTo(px(0), py(0))
        for (i in 1 until 4) path.lineTo(px(i), py(i))
        path.close()
        canvas.drawPath(path, edgePaint)

        // 四角 L 形括角
        val len = 22f * density
        for (i in 0 until 4) {
            val cx = px(i)
            val cy = py(i)
            val prev = (i + 3) % 4
            val next = (i + 1) % 4
            var ax = px(prev) - cx
            var ay = py(prev) - cy
            var bx = px(next) - cx
            var by = py(next) - cy
            val al = hypot(ax, ay)
            val bl = hypot(bx, by)
            if (al < 1f || bl < 1f) continue
            ax = ax / al * len
            ay = ay / al * len
            bx = bx / bl * len
            by = by / bl * len
            path.reset()
            path.moveTo(cx + ax, cy + ay)
            path.lineTo(cx, cy)
            path.lineTo(cx + bx, cy + by)
            canvas.drawPath(path, bracketPaint)
        }
    }

    private fun drawStatic(canvas: Canvas, w: Float, h: Float) {
        val aspect = 0.72f // A4 宽高比
        var fh = h * 0.8f
        var fw = fh * aspect
        if (fw > w * 0.82f) {
            fw = w * 0.82f
            fh = fw / aspect
        }
        val l = (w - fw) / 2f
        val t = (h - fh) / 2f
        val r = l + fw
        val b = t + fh
        val len = 24f * density

        path.reset()
        path.moveTo(l + len, t); path.lineTo(l, t); path.lineTo(l, t + len)
        path.moveTo(r - len, t); path.lineTo(r, t); path.lineTo(r, t + len)
        path.moveTo(r - len, b); path.lineTo(r, b); path.lineTo(r, b - len)
        path.moveTo(l + len, b); path.lineTo(l, b); path.lineTo(l, b - len)
        canvas.drawPath(path, bracketPaint)
    }
}
