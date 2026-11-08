package com.scan.camera

import android.content.Context

/** 应用设置：后期处理参数 + 各开关，持久化到 SharedPreferences */
data class AppSettings(
    val sharpen: Int = 50,      // 锐化强度 0-100
    val contrast: Int = 50,     // 对比增强 0-100
    val resOverride: Int = 0,   // 生成分辨率：0=按机型自动，或 2400/2800/3200
    val mode: String = "GRAY",  // 合成模式（EnhanceMode.name）
    val clearAfterPdf: Boolean = false, // 生成 PDF 后自动清空页面
    val auto: Boolean = false,  // 自动拍摄
    val burst: Boolean = true,  // 多帧防抖（手动快门连拍 3 张选最清晰）
    val autoTorch: Boolean = false, // 暗光自动开闪光灯
    val split: Boolean = false, // 双页自动拆分
    val fitAuto: Boolean = false, // PDF 版式：false=A4，true=原始比例
    val frame: Boolean = true,  // 取景框
    val crop: Boolean = true,   // 拍后校正
    val ocr: Boolean = true     // 文字识别
)

object SettingsStore {

    private const val FILE = "scan_settings"

    fun load(context: Context): AppSettings {
        val sp = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        return AppSettings(
            sharpen = sp.getInt("sharpen", 50).coerceIn(0, 100),
            contrast = sp.getInt("contrast", 50).coerceIn(0, 100),
            resOverride = sp.getInt("res", 0),
            mode = sp.getString("mode", "GRAY") ?: "GRAY",
            clearAfterPdf = sp.getBoolean("clearAfterPdf", false),
            auto = sp.getBoolean("auto", false),
            burst = sp.getBoolean("burst", true),
            autoTorch = sp.getBoolean("autoTorch", false),
            split = sp.getBoolean("split", false),
            fitAuto = sp.getBoolean("fitAuto", false),
            frame = sp.getBoolean("frame", true),
            crop = sp.getBoolean("crop", true),
            ocr = sp.getBoolean("ocr", true)
        )
    }

    fun save(context: Context, s: AppSettings) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putInt("sharpen", s.sharpen)
            .putInt("contrast", s.contrast)
            .putInt("res", s.resOverride)
            .putString("mode", s.mode)
            .putBoolean("clearAfterPdf", s.clearAfterPdf)
            .putBoolean("auto", s.auto)
            .putBoolean("burst", s.burst)
            .putBoolean("autoTorch", s.autoTorch)
            .putBoolean("split", s.split)
            .putBoolean("fitAuto", s.fitAuto)
            .putBoolean("frame", s.frame)
            .putBoolean("crop", s.crop)
            .putBoolean("ocr", s.ocr)
            .apply()
    }
}
