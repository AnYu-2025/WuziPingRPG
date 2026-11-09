package com.scan.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

/**
 * 框选校正视图：居中显示照片，叠加可拖动的四角选框。
 * 支持双指缩放、单指平移（放大后）与双击复位，便于像素级对齐；
 * 选框坐标以相对照片的 0..1 归一化存储，与显示尺寸/变换无关。
 */
class CropOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private var bitmap: Bitmap? = null
    private val drawRect = RectF()
    // 顺序：左上、右上、右下、左下
    private val quad = floatArrayOf(0.07f, 0.05f, 0.93f, 0.05f, 0.93f, 0.95f, 0.07f, 0.95f)
    private var dragIndex = -1

    // 缩放/平移（围绕视图中心）
    private var viewScale = 1f
    private var panX = 0f
    private var panY = 0f
    private var lastTouchX = 0f
    private var lastTouchY = 0f

    private val density get() = resources.displayMetrics.density
    private val photoPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val dimPaint = Paint().apply { color = 0x5A000000 }
    private val linePaint = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f * density
        isAntiAlias = true
    }
    private val handleFillPaint = Paint().apply { color = Color.WHITE; isAntiAlias = true }
    private val handleStrokePaint = Paint().apply {
        color = 0xFFD97757.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2.5f * density
        isAntiAlias = true
    }
    private val path = Path()

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val ns = (viewScale * detector.scaleFactor).coerceIn(1f, 4f)
                if (ns != viewScale) {
                    val cx = width / 2f
                    val cy = height / 2f
                    // 缩放时尽量保持双指焦点下的内容不动
                    panX += (detector.focusX - cx) * (1f - ns / viewScale)
                    panY += (detector.focusY - cy) * (1f - ns / viewScale)
                    viewScale = ns
                    clampPan()
                    invalidate()
                }
                return true
            }
        }
    )
    private val tapDetector = GestureDetector(
        context,
        object : GestureDetector.SimpleOnGestureListener() {
            override fun onDoubleTap(e: MotionEvent): Boolean {
                viewScale = 1f
                panX = 0f
                panY = 0f
                invalidate()
                return true
            }
        }
    )

    fun setBitmap(b: Bitmap?) {
        bitmap = b
        viewScale = 1f
        panX = 0f
        panY = 0f
        invalidate()
    }

    fun currentBitmap(): Bitmap? = bitmap

    fun setQuad(q: FloatArray) {
        if (ScanRules.validQuad(q)) System.arraycopy(q, 0, quad, 0, 8)
        invalidate()
    }

    fun getQuad(): FloatArray = quad.copyOf()

    private fun clampPan() {
        val maxX = (viewScale - 1f) * width / 2f
        val maxY = (viewScale - 1f) * height / 2f
        panX = panX.coerceIn(-maxX, maxX)
        panY = panY.coerceIn(-maxY, maxY)
    }

    /** 未变换视图坐标 → 屏幕坐标 */
    private fun tx(x: Float) = (x - width / 2f) * viewScale + width / 2f + panX
    private fun ty(y: Float) = (y - height / 2f) * viewScale + height / 2f + panY

    /** 屏幕坐标 → 未变换视图坐标 */
    private fun fromScreenX(x: Float) = (x - width / 2f - panX) / viewScale + width / 2f
    private fun fromScreenY(y: Float) = (y - height / 2f - panY) / viewScale + height / 2f

    override fun onDraw(canvas: Canvas) {
        val bmp = bitmap ?: return
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        if (bw <= 0 || bh <= 0) return
        val scale = minOf(width / bw, height / bh)
        val dw = bw * scale
        val dh = bh * scale
        drawRect.set((width - dw) / 2f, (height - dh) / 2f, (width + dw) / 2f, (height + dh) / 2f)

        // 照片随缩放/平移变换绘制
        val saveCount = canvas.save()
        canvas.translate(panX, panY)
        canvas.scale(viewScale, viewScale, width / 2f, height / 2f)
        canvas.drawBitmap(bmp, null, drawRect, photoPaint)
        canvas.restoreToCount(saveCount)

        // 框与手柄在屏幕空间绘制，线宽和手柄大小不随缩放变化
        path.reset()
        path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        path.moveTo(tx(px(0)), ty(py(0)))
        for (i in 1 until 4) path.lineTo(tx(px(i)), ty(py(i)))
        path.close()
        path.fillType = Path.FillType.EVEN_ODD
        canvas.drawPath(path, dimPaint)

        path.reset()
        path.moveTo(tx(px(0)), ty(py(0)))
        for (i in 1 until 4) path.lineTo(tx(px(i)), ty(py(i)))
        path.close()
        canvas.drawPath(path, linePaint)

        for (i in 0 until 4) {
            val x = tx(px(i))
            val y = ty(py(i))
            canvas.drawCircle(x, y, 10f * density, handleFillPaint)
            canvas.drawCircle(x, y, 10f * density, handleStrokePaint)
        }
    }

    private fun px(i: Int) = drawRect.left + quad[2 * i] * drawRect.width()
    private fun py(i: Int) = drawRect.top + quad[2 * i + 1] * drawRect.height()

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!isEnabled) return false
        scaleDetector.onTouchEvent(event)
        tapDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragIndex = -1
                var best = Float.MAX_VALUE
                val touch = 32f * density
                for (i in 0 until 4) {
                    val d = hypot(event.x - tx(px(i)), event.y - ty(py(i)))
                    if (d < touch && d < best) {
                        best = d
                        dragIndex = i
                    }
                }
                lastTouchX = event.x
                lastTouchY = event.y
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                // 双指进入：暂停角点拖动，交给缩放手势
                dragIndex = -1
            }
            MotionEvent.ACTION_MOVE -> {
                if (scaleDetector.isInProgress) return true
                if (dragIndex >= 0) {
                    val vx = fromScreenX(event.x)
                    val vy = fromScreenY(event.y)
                    if (drawRect.width() > 0f && drawRect.height() > 0f) {
                        val candidate = quad.copyOf()
                        candidate[2 * dragIndex] = ((vx - drawRect.left) / drawRect.width()).coerceIn(0f, 1f)
                        candidate[2 * dragIndex + 1] = ((vy - drawRect.top) / drawRect.height()).coerceIn(0f, 1f)
                        if (ScanRules.validQuad(candidate)) candidate.copyInto(quad)
                    }
                } else if (viewScale > 1f) {
                    panX += event.x - lastTouchX
                    panY += event.y - lastTouchY
                    clampPan()
                }
                lastTouchX = event.x
                lastTouchY = event.y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
                dragIndex = -1
                lastTouchX = event.x
                lastTouchY = event.y
            }
        }
        invalidate()
        return true
    }

    override fun performClick(): Boolean = super.performClick()
}
