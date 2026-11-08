package com.scan.camera

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class CropActivity : AppCompatActivity() {
    private lateinit var cropView: CropOverlayView
    private var bitmap: Bitmap? = null
    private var rotation = 0
    private var working = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_crop)
        cropView = findViewById(R.id.cropView)
        val path = intent.getStringExtra(EXTRA_PATH) ?: return finish()
        rotation = savedInstanceState?.getInt(EXTRA_ROTATION) ?: 0
        val suggested = savedInstanceState?.getFloatArray(EXTRA_QUAD) ?: intent.getFloatArrayExtra(EXTRA_SUGGESTED)
        val editing = intent.getBooleanExtra(EXTRA_EDIT, false)
        findViewById<TextView>(R.id.retakeBtn).text = if (editing) "取消" else getString(R.string.retake)
        enableControls(false)
        lifecycleScope.launch {
            try {
                val bmp = withContext(Dispatchers.IO) {
                    val decoded = Images.decodeScaled(File(path), 2400) ?: error("无法读取照片")
                    if (rotation == 0) decoded else {
                        try {
                            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height,
                                Matrix().apply { postRotate(rotation.toFloat()) }, true)
                        } finally { decoded.recycle() }
                    }
                }
                bitmap = bmp
                cropView.setBitmap(bmp)
                findViewById<TextView>(R.id.cropTitle).text = getString(R.string.crop_dimensions, bmp.width, bmp.height)
                val quad = if (suggested != null && ScanRules.validQuad(suggested)) suggested
                    else withContext(Dispatchers.IO) { PageWarp.suggestQuad(bmp) }
                cropView.setQuad(quad)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { Toast.makeText(this@CropActivity, e.message, Toast.LENGTH_LONG).show(); finish() }
            catch (_: OutOfMemoryError) { Toast.makeText(this@CropActivity, "照片过大，内存不足", Toast.LENGTH_LONG).show(); finish() }
            finally { working = false; enableControls(true) }
        }
        findViewById<View>(R.id.autoBtn).setOnClickListener {
            val bmp = bitmap ?: return@setOnClickListener
            if (working) return@setOnClickListener
            working = true; enableControls(false)
            lifecycleScope.launch {
                try { cropView.setQuad(withContext(Dispatchers.IO) { PageWarp.suggestQuad(bmp) }) }
                finally { working = false; enableControls(true) }
            }
        }
        findViewById<View>(R.id.rotateBtn).setOnClickListener {
            val bmp = bitmap ?: return@setOnClickListener
            if (working) return@setOnClickListener
            working = true; enableControls(false)
            val quad = cropView.getQuad()
            lifecycleScope.launch {
                try {
                    val rotated = withContext(Dispatchers.IO) {
                        Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height,
                            Matrix().apply { postRotate(90f) }, true)
                    }
                    bitmap = rotated
                    cropView.setBitmap(rotated)
                    cropView.setQuad(ScanRules.rotateQuad(quad))
                    if (rotated !== bmp) bmp.recycle()
                    rotation = (rotation+90)%360
                } catch (_: OutOfMemoryError) {
                    Toast.makeText(this@CropActivity, "内存不足，无法旋转", Toast.LENGTH_SHORT).show()
                } finally { working = false; enableControls(true) }
            }
        }
        findViewById<View>(R.id.retakeBtn).setOnClickListener {
            setResult(RESULT_RETAKE, Intent().putExtra(EXTRA_PATH, path)); finish()
        }
        findViewById<View>(R.id.confirmBtn).setOnClickListener {
            if (working || bitmap == null) return@setOnClickListener
            if (!ScanRules.validQuad(cropView.getQuad())) {
                Toast.makeText(this, "请调整四角，避免交叉或选框过小", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            setResult(RESULT_CONFIRM, Intent().putExtra(EXTRA_PATH, path)
                .putExtra(EXTRA_QUAD, cropView.getQuad()).putExtra(EXTRA_ROTATION, rotation))
            finish()
        }
    }

    private fun enableControls(enabled: Boolean) {
        listOf(R.id.confirmBtn, R.id.autoBtn, R.id.rotateBtn).forEach { findViewById<View>(it).isEnabled = enabled }
        cropView.isEnabled = enabled
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putFloatArray(EXTRA_QUAD, cropView.getQuad())
        outState.putInt(EXTRA_ROTATION, rotation)
        super.onSaveInstanceState(outState)
    }

    companion object {
        const val EXTRA_PATH = "crop_path"
        const val EXTRA_QUAD = "crop_quad"
        const val EXTRA_SUGGESTED = "crop_suggested"
        const val EXTRA_ROTATION = "crop_rotation"
        const val EXTRA_EDIT = "edit"
        const val RESULT_RETAKE = RESULT_FIRST_USER+1
        const val RESULT_CONFIRM = RESULT_FIRST_USER+2
    }
}
