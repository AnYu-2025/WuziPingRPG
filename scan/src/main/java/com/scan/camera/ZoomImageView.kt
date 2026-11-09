package com.scan.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View

/** 双指放大、单指平移、双击复位；放大时不让分页手势抢事件。 */
class ZoomImageView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private var bitmap: Bitmap? = null
    private var zoom = 1f
    private var panX = 0f; private var panY = 0f
    private var lastX = 0f; private var lastY = 0f
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val scaler = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val next = (zoom*detector.scaleFactor).coerceIn(1f, 6f)
            panX = (panX-(detector.focusX-width/2f))*(next/zoom)+(detector.focusX-width/2f)
            panY = (panY-(detector.focusY-height/2f))*(next/zoom)+(detector.focusY-height/2f)
            zoom = next; clamp(); invalidate(); return true
        }
    })
    private val taps = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDoubleTap(e: MotionEvent): Boolean {
            zoom = if (zoom > 1f) 1f else 2.5f
            panX = -(e.x-width/2f)*(zoom-1f); panY = -(e.y-height/2f)*(zoom-1f)
            clamp(); invalidate(); return true
        }
    })
    fun setImage(bitmap: Bitmap?) {
        this.bitmap = bitmap; zoom = 1f; panX = 0f; panY = 0f; invalidate()
    }
    private fun clamp() {
        val b = bitmap ?: return
        val scale = minOf(width.toFloat()/b.width, height.toFloat()/b.height)
        val x = ((b.width*scale*zoom-width)/2f).coerceAtLeast(0f)
        val y = ((b.height*scale*zoom-height)/2f).coerceAtLeast(0f)
        panX = panX.coerceIn(-x, x); panY = panY.coerceIn(-y, y)
    }
    override fun onDraw(canvas: Canvas) {
        val b = bitmap?.takeUnless { it.isRecycled } ?: return
        val scale = minOf(width.toFloat()/b.width, height.toFloat()/b.height)*zoom
        canvas.save(); canvas.translate(width/2f+panX, height/2f+panY); canvas.scale(scale, scale)
        canvas.drawBitmap(b, -b.width/2f, -b.height/2f, paint); canvas.restore()
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaler.onTouchEvent(event); taps.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { lastX = event.x; lastY = event.y }
            MotionEvent.ACTION_MOVE -> {
                if (!scaler.isInProgress && zoom > 1f && event.pointerCount == 1) {
                    panX += event.x-lastX; panY += event.y-lastY; clamp(); invalidate()
                }
                lastX = event.x; lastY = event.y
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val index = if (event.actionIndex == 0) 1 else 0
                lastX = event.getX(index); lastY = event.getY(index)
            }
            MotionEvent.ACTION_UP -> performClick()
        }
        parent?.requestDisallowInterceptTouchEvent(zoom > 1f || event.pointerCount > 1)
        return true
    }
    override fun performClick(): Boolean = super.performClick()
}
