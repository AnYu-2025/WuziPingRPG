package com.scan.camera

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.util.AttributeSet
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 变焦转盘：沿圆环拖动精确调节变焦（转一整圈 = 2 倍变化量），
 * 中心实时显示倍率，点按圆心复位 1x。与双指缩放共用相机的 zoomState。
 */
class ZoomDialView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    var onZoomChange: ((Float) -> Unit)? = null
    var onReset: (() -> Unit)? = null

    private var zoom = 1f
    private var maxZoom = 6f
    private var minZoom = 1f

    private var lastAngle = 0f
    private var downZoom = 1f
    private var accumulated = 0f
    private var downX = 0f
    private var downY = 0f
    private var downAt = 0L
    private var dragging = false
    private var activePointer = -1
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    private val density get() = resources.displayMetrics.density
    private val ringPaint = Paint().apply {
        color = 0x40FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = density
        isAntiAlias = true
    }
    private val bgPaint = Paint().apply { color = 0x59000000.toInt(); isAntiAlias = true }
    private val tickPaint = Paint().apply {
        color = 0x8CFFFFFF.toInt()
        strokeWidth = 1.5f * density
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val tickPaintMajor = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        strokeWidth = 2.5f * density
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val arcPaint = Paint().apply {
        color = 0xFFD97757.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val textPaint = Paint().apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 13f * density
        isAntiAlias = true
        isFakeBoldText = true
    }
    private val arcRect = RectF()

    fun setZoom(z: Float, max: Float, min: Float = 1f) {
        minZoom = min
        maxZoom = max(minZoom, max)
        if (dragging) return // 拖动中忽略相机回报的中间值，避免显示被拉回抖动
        val nz = z.coerceIn(minZoom, maxZoom)
        if (abs(nz - zoom) > 0.0005f) {
            zoom = nz
            invalidate()
        }
    }

    /** 变焦一圈的变化量（越小越精细） */
    private val rangePerTurn = 1.5f

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val r = min(width, height) / 2f - 2f * density
        canvas.drawCircle(cx, cy, r, bgPaint)

        // 刻度环随变焦转动，给出"机械旋钮"的反馈
        val rot = Math.toDegrees(((zoom - minZoom) / rangePerTurn * 2 * Math.PI).toDouble()).toFloat()
        val tickOuter = r - 3f * density
        val tickInner = tickOuter - 5f * density
        canvas.save()
        canvas.rotate(rot, cx, cy)
        for (i in 0 until 24) {
            val ang = Math.toRadians((i * 15).toDouble())
            val sin = Math.sin(ang).toFloat()
            val cos = Math.cos(ang).toFloat()
            canvas.drawLine(
                cx + cos * tickInner, cy + sin * tickInner,
                cx + cos * tickOuter, cy + sin * tickOuter,
                if (i % 6 == 0) tickPaintMajor else tickPaint
            )
        }
        canvas.restore()

        canvas.drawCircle(cx, cy, r, ringPaint)

        // 变焦进度弧（从正上方顺时针）
        val frac = ((zoom - minZoom) / (maxZoom - minZoom)).coerceIn(0f, 1f)
        if (frac > 0.003f) {
            arcRect.set(cx - r, cy - r, cx + r, cy + r)
            canvas.drawArc(arcRect, -90f, 360f * frac, false, arcPaint)
        }

        canvas.drawText(String.format(Locale.US, "%.1f×", zoom), cx, cy + textPaint.textSize / 3f, textPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val cx = width / 2f
        val cy = height / 2f
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                activePointer = event.getPointerId(0)
                anchor(event.x, event.y, cx, cy)
                downAt = SystemClock.elapsedRealtime()
                dragging = false
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (activePointer == -1) {
                    activePointer = event.getPointerId(event.actionIndex)
                    anchor(event.getX(event.actionIndex), event.getY(event.actionIndex), cx, cy)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val idx = event.findPointerIndex(activePointer)
                if (idx < 0) return true
                val dist = hypot(event.getX(idx) - downX, event.getY(idx) - downY)
                if (!dragging && dist <= touchSlop) {
                    // 起手死区：位移未超 slop 前持续重锚，中心微抖不会注入变焦
                    lastAngle = angleOf(event.getX(idx), event.getY(idx), cx, cy)
                    return true
                }
                if (dist > touchSlop) dragging = true
                if (maxZoom - minZoom < 0.05f) return true // 定焦机型：无变焦可调
                val a = angleOf(event.getX(idx), event.getY(idx), cx, cy)
                var d = a - lastAngle
                while (d > Math.PI.toFloat()) d -= (2 * Math.PI).toFloat()
                while (d < -Math.PI.toFloat()) d += (2 * Math.PI).toFloat()
                lastAngle = a
                accumulated += d
                val raw = downZoom + accumulated / (2 * Math.PI).toFloat() * rangePerTurn
                val nz = snapToDetent(raw.coerceIn(minZoom, maxZoom))
                if (abs(nz - zoom) > 0.001f) {
                    // 跨过整数倍率时给一次触感反馈（floor 判定，棘位恰在整数上）
                    if (nz.toInt() != zoom.toInt() && nz >= 1f) {
                        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    }
                    zoom = nz
                    dragging = true
                    onZoomChange?.invoke(zoom)
                    invalidate()
                }
                if (hypot(event.getX(idx) - downX, event.getY(idx) - downY) > touchSlop) dragging = true
            }
            MotionEvent.ACTION_POINTER_UP -> {
                if (event.getPointerId(event.actionIndex) == activePointer) {
                    // 被跟踪的手指抬起：改锚到剩余手指，避免角度突跳导致变焦跳变
                    var rebind = -1
                    var rebindIdx = -1
                    for (i in 0 until event.pointerCount) {
                        val id = event.getPointerId(i)
                        if (id != activePointer) {
                            rebind = id
                            rebindIdx = i
                            break
                        }
                    }
                    activePointer = rebind
                    if (rebindIdx >= 0) anchor(event.getX(rebindIdx), event.getY(rebindIdx), cx, cy)
                }
            }
            MotionEvent.ACTION_UP -> {
                activePointer = -1
                if (!dragging && SystemClock.elapsedRealtime() - downAt < 300) performClick()
                dragging = false
            }
            MotionEvent.ACTION_CANCEL -> {
                activePointer = -1
                dragging = false
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        onReset?.invoke()
        return true
    }

    /** 整数倍率附近磁性吸附，停在了 1.0/2.0/3.0 上会"咔哒"归位 */
    private fun snapToDetent(v: Float): Float {
        val r = v.roundToInt().toFloat()
        return if (r >= minZoom && r <= maxZoom && abs(v - r) < 0.05f) r else v
    }

    private fun anchor(x: Float, y: Float, cx: Float, cy: Float) {
        lastAngle = angleOf(x, y, cx, cy)
        downZoom = zoom
        accumulated = 0f
        downX = x
        downY = y
    }

    private fun angleOf(x: Float, y: Float, cx: Float, cy: Float): Float =
        atan2((y - cy).toDouble(), (x - cx).toDouble()).toFloat()
}
