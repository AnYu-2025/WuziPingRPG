package com.scan.camera

import java.io.File

/** 一页：对应的原始照片文件 + 列表里显示的缩略图 */
data class Page(val file: File, val thumbnail: android.graphics.Bitmap)
