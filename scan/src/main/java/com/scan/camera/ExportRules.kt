package com.scan.camera

object ExportRules {
    fun safeBaseName(name: String?, fallback: String): String = name?.trim()
        ?.removeSuffix(".pdf")?.removeSuffix(".PDF")
        ?.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "")
        ?.trim(' ', '.')?.take(100)?.takeIf { it.isNotBlank() } ?: fallback

    fun ocrKey(path: String, modified: Long, bytes: Long, width: Int, height: Int,
               mode: String, sharpen: Int, contrast: Int): String =
        "$path|$modified|$bytes|${width}x$height|$mode|$sharpen|$contrast|v240"
}
