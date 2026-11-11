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
 * 框选校正视图：居中显示照片，叠加可拖动的四角和边中点。
 * 角点拖出凸四边形时会沿手指方向退回到最后一个合法位置；
 * 拖动手柄时在指尖旁显示放大镜。选框以相对照片的 0..1 存储。
 */
class CropOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private var bitmap: Bitmap? = null
    private val drawRect = RectF()
    // 顺序：左上、右上、右下、左下
    private val quad = floatArrayOf(0.08f, 0.08f, 0.92f, 0.08f, 0.92f, 0.92f, 0.08f, 0.92f)
    private var dragCorner = -1
    private var dragEdge = -1
    private val gestureQuad = FloatArray(8)
    private var grabX = 0f
    private var grabY = 0f
    private var loupe = false
    private var loupeNx = 0.5f
    private var loupeNy = 0.5f
    private var loupeScreenX = 0f
    private var loupeScreenY = 0f

    private var viewScale = 1f
    private var panX = 0f
    private var panY = 0f
    private var lastTouchX = 0f
    private var lastTouchY = 0f

    private val density get() = resources.displayMetrics.density
    private val photoPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val dimPaint = Paint().apply { color = 0x66000000 }
    private val linePaint = Paint().apply {
        color = 0xF2FFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2.2f * density
        isAntiAlias = true
        strokeJoin = Paint.Join.ROUND
    }
    private val handleFillPaint = Paint().apply { color = Color.WHITE; isAntiAlias = true }
    private val handleStrokePaint = Paint().apply {
        color = 0xFFD97757.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2.5f * density
        isAntiAlias = true
    }
    private val loupeRim = Paint().apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
        isAntiAlias = true
    }
    private val loupeCross = Paint().apply {
        color = 0xFFD97757.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 1.5f * density
        isAntiAlias = true
    }
    private val path = Path()
    private val loupeClip = Path()

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val ns = (viewScale * detector.scaleFactor).coerceIn(1f, 4f)
                if (ns != viewScale) {
                    val cx = width / 2f
                    val cy = height / 2f
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

    private fun tx(x: Float) = (x - width / 2f) * viewScale + width / 2f + panX
    private fun ty(y: Float) = (y - height / 2f) * viewScale + height / 2f + panY
    private fun fromScreenX(x: Float) = (x - width / 2f - panX) / viewScale + width / 2f
    private fun fromScreenY(y: Float) = (y - height / 2f - panY) / viewScale + height / 2f

    private fun updateDrawRect() {
        val bmp = bitmap ?: return
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        if (bw <= 0f || bh <= 0f || width <= 0 || height <= 0) return
        val scale = min(width / bw, height / bh)
        val dw = bw * scale
        val dh = bh * scale
        drawRect.set((width - dw) / 2f, (height - dh) / 2f, (width + dw) / 2f, (height + dh) / 2f)
    }

    override fun onDraw(canvas: Canvas) {
        val bmp = bitmap ?: return
        updateDrawRect()
        if (drawRect.width() <= 0f) return

        val saveCount = canvas.save()
        canvas.translate(panX, panY)
        canvas.scale(viewScale, viewScale, width / 2f, height / 2f)
        canvas.drawBitmap(bmp, null, drawRect, photoPaint)
        canvas.restoreToCount(saveCount)

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

        val cornerR = CropHandles.CORNER_RADIUS_DP * density
        val edgeR = CropHandles.EDGE_RADIUS_DP * density
        for (i in 0 until 4) {
            val mid = QuadEdit.edgeMidpoint(quad, i)
            val mx = tx(drawRect.left + mid[0] * drawRect.width())
            val my = ty(drawRect.top + mid[1] * drawRect.height())
            canvas.drawCircle(mx, my, edgeR, handleFillPaint)
            canvas.drawCircle(mx, my, edgeR, handleStrokePaint)
        }
        for (i in 0 until 4) {
            val x = tx(px(i))
            val y = ty(py(i))
            canvas.drawCircle(x, y, cornerR, handleFillPaint)
            canvas.drawCircle(x, y, cornerR, handleStrokePaint)
        }
        if (loupe) drawLoupe(canvas, bmp)
    }

    private fun drawLoupe(canvas: Canvas, bmp: Bitmap) {
        val radius = 56f * density
        var cx = loupeScreenX
        var cy = loupeScreenY - radius - 28f * density
        if (cy - radius < 8f * density) cy = loupeScreenY + radius + 36f * density
        cx = cx.coerceIn(radius + 8f * density, width - radius - 8f * density)
        cy = cy.coerceIn(radius + 8f * density, height - radius - 8f * density)
        val bmpX = loupeNx.coerceIn(0f, 1f) * bmp.width
        val bmpY = loupeNy.coerceIn(0f, 1f) * bmp.height
        val screenScale = drawRect.width() / bmp.width * viewScale * CropHandles.LOUPE_ZOOM
        loupeClip.reset()
        loupeClip.addCircle(cx, cy, radius, Path.Direction.CW)
        val save = canvas.save()
        canvas.clipPath(loupeClip)
        canvas.drawColor(0xFF1A1A1A.toInt())
        canvas.translate(cx, cy)
        canvas.scale(screenScale, screenScale)
        canvas.translate(-bmpX, -bmpY)
        canvas.drawBitmap(bmp, 0f, 0f, photoPaint)
        canvas.restoreToCount(save)
        canvas.drawCircle(cx, cy, radius, loupeRim)
        val arm = 10f * density
        canvas.drawLine(cx - arm, cy, cx + arm, cy, loupeCross)
        canvas.drawLine(cx, cy - arm, cx, cy + arm, loupeCross)
    }

    private fun px(i: Int) = drawRect.left + quad[2 * i] * drawRect.width()
    private fun py(i: Int) = drawRect.top + quad[2 * i + 1] * drawRect.height()

    private fun normX(screenX: Float) =
        ((fromScreenX(screenX) - drawRect.left) / drawRect.width())
    private fun normY(screenY: Float) =
        ((fromScreenY(screenY) - drawRect.top) / drawRect.height())

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!isEnabled) return false
        updateDrawRect()
        scaleDetector.onTouchEvent(event)
        tapDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragCorner = -1
                dragEdge = -1
                loupe = false
                var best = Float.MAX_VALUE
                val cornerHit = CropHandles.CORNER_HIT_DP * density
                for (i in 0 until 4) {
                    val d = hypot(event.x - tx(px(i)), event.y - ty(py(i)))
                    if (d < cornerHit && d < best) {
                        best = d
                        dragCorner = i
                    }
                }
                if (dragCorner < 0 && drawRect.width() > 0f) {
                    val edgeHit = CropHandles.EDGE_HIT_DP * density
                    for (i in 0 until 4) {
                        val j = (i + 1) % 4
                        val d = distPointSeg(
                            event.x, event.y,
                            tx(px(i)), ty(py(i)),
                            tx(px(j)), ty(py(j))
                        )
                        if (d < edgeHit && d < best) {
                            best = d
                            dragEdge = i
                        }
                    }
                }
                if ((dragCorner >= 0 || dragEdge >= 0) && drawRect.width() > 0f) {
                    quad.copyInto(gestureQuad)
                    grabX = normX(event.x)
                    grabY = normY(event.y)
                    loupe = true
                }
                lastTouchX = event.x
                lastTouchY = event.y
                loupeScreenX = event.x
                loupeScreenY = event.y
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                dragCorner = -1
                dragEdge = -1
                loupe = false
            }
            MotionEvent.ACTION_MOVE -> {
                if (scaleDetector.isInProgress) {
                    loupe = false
                    return true
                }
                if (drawRect.width() > 0f && dragCorner >= 0) {
                    QuadEdit.moveCorner(gestureQuad, dragCorner, normX(event.x), normY(event.y)).copyInto(quad)
                    loupeNx = quad[2 * dragCorner]
                    loupeNy = quad[2 * dragCorner + 1]
                    loupe = true
                } else if (drawRect.width() > 0f && dragEdge >= 0) {
                    QuadEdit.moveEdge(
                        gestureQuad, dragEdge,
                        normX(event.x) - grabX,
                        normY(event.y) - grabY
                    ).copyInto(quad)
                    val mid = QuadEdit.edgeMidpoint(quad, dragEdge)
                    loupeNx = mid[0]
                    loupeNy = mid[1]
                    loupe = true
                } else if (viewScale > 1f) {
                    panX += event.x - lastTouchX
                    panY += event.y - lastTouchY
                    clampPan()
                }
                loupeScreenX = event.x
                loupeScreenY = event.y
                lastTouchX = event.x
                lastTouchY = event.y
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
                dragCorner = -1
                dragEdge = -1
                loupe = false
                lastTouchX = event.x
                lastTouchY = event.y
            }
        }
        invalidate()
        return true
    }

    override fun performClick(): Boolean = super.performClick()
}
