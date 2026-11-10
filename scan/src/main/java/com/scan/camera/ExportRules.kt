package com.scan.camera

object ExportRules {
    const val COLOR_SUFFIX = "_彩色"

    fun safeBaseName(name: String?, fallback: String): String = name?.trim()
        ?.removeSuffix(".pdf")?.removeSuffix(".PDF")
        ?.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "")
        ?.trim(' ', '.')?.take(100)?.takeIf { it.isNotBlank() } ?: fallback

    /** 彩色版沿用原 PDF 文件名，并明确加「_彩色」；重复点击不会叠加后缀。 */
    fun colorCopyBaseName(displayName: String?): String {
        val base = safeBaseName(displayName, "扫描")
        if (base.endsWith(COLOR_SUFFIX)) return base
        // PdfCreator 还会把自定义名截到 100 字符，先留出后缀位置，避免「_彩色」被截掉。
        return base.take(100 - COLOR_SUFFIX.length).trimEnd(' ', '.') + COLOR_SUFFIX
    }

    /** 彩色版动作固定使用原色，普通导出保持用户当前选择。 */
    fun exportMode(current: EnhanceMode, colorCopy: Boolean): EnhanceMode =
        if (colorCopy) EnhanceMode.COLOR else current

    fun ocrKey(path: String, modified: Long, bytes: Long, width: Int, height: Int,
               mode: String, sharpen: Int, contrast: Int): String =
        "$path|$modified|$bytes|${width}x$height|$mode|$sharpen|$contrast|v240"
}
