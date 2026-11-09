package com.scan.camera

import android.app.ActivityManager
import android.content.Context

/** 依据设备可用内存决定 PDF 合成的目标分辨率（长边像素，约 2400~3200，即 290~388 DPI） */
object Quality {
    @Volatile
    var maxDim: Int = 2400
        private set

    private var tier = 2400

    fun init(context: Context) {
        val am = context.getSystemService(ActivityManager::class.java)
        val large = am?.largeMemoryClass ?: 192
        tier = when {
            large >= 400 -> 3200
            large >= 256 -> 2800
            else -> 2400
        }
        maxDim = tier
    }

    /** 用户在「后期处理」里选择的分辨率档位：0 = 按机型自动 */
    fun applyOverride(mode: Int) {
        maxDim = if (mode == 2400 || mode == 2800 || mode == 3200) mode else tier
    }
}
