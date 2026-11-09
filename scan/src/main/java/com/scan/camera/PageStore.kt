package com.scan.camera

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/** 页面、原始照片和顺序统一管理。所有文件提交采用同目录临时文件 + 原子替换。 */
class PageStore(private val root: File) {
    val pagesDir = File(root, "pages").apply { mkdirs() }
    val stagingDir = File(root, "staging").apply { mkdirs() }
    private val originals = File(root, "originals").apply { mkdirs() }
    private val trash = File(root, "trash").apply { mkdirs() }
    private val orderFile = File(root, "page-order.txt")

    fun newCapture(): File = File(stagingDir, "capture_${UUID.randomUUID()}.jpg")
    fun newPage(): File = File(pagesDir, "page_${System.currentTimeMillis()}_${UUID.randomUUID()}.jpg")
    fun original(page: File): File = File(originals, page.name).takeIf { it.isFile } ?: page

    @Synchronized
    fun saveOrder(files: List<File>) {
        atomicWrite(orderFile) { out ->
            out.write(files.map { it.name }.distinct().joinToString("\n").toByteArray(Charsets.UTF_8))
        }
    }

    /** 兼容 2.3 的 page/capture 文件；不再把用户已拍的 capture 照片当垃圾删除。 */
    @Synchronized
    fun load(pendingPath: String? = null): List<File> {
        val previous = if (orderFile.isFile) orderFile.readLines().filter(::validName) else emptyList()
        val all = pagesDir.listFiles()?.filter {
            it.isFile && it.length() > 0 && validName(it.name) && it.absolutePath != pendingPath
        }.orEmpty()
        val byName = all.associateBy { it.name }
        val ordered = previous.mapNotNull { byName[it] }.distinct()
        val extra = all.filter { it.name !in previous }.sortedWith { a, b ->
            naturalCompare(a.name.substringAfter('_'), b.name.substringAfter('_'))
        }
        val result = ordered + extra
        saveOrder(result)
        // 新版未确认的拍摄也保留供用户找回，不在启动时静默删除。
        stagingDir.listFiles()?.filter {
            it.extension == "jpg" && it.length() > 0 && it.absolutePath != pendingPath
        }?.forEach { file ->
            recoverCapture(file)
        }
        purgeTrash()
        return result
    }

    fun keepOriginal(page: File, source: File) {
        val target = File(originals, page.name)
        if (!target.exists()) atomicWrite(target) { out -> source.inputStream().use { it.copyTo(out) } }
    }

    fun recoverCapture(file: File) {
        if (!file.isFile || file.length() == 0L || file.parentFile?.canonicalFile != stagingDir.canonicalFile) return
        val recovered = newPage()
        if (file.renameTo(recovered)) moveToTrash(recovered)
    }

    /** 替换页面失败时旧页面仍存在。 */
    fun replace(page: File, source: File) {
        keepOriginal(page, page)
        atomicWrite(page) { out -> source.inputStream().use { it.copyTo(out) } }
        page.setLastModified(System.currentTimeMillis())
    }

    fun moveToTrash(page: File): Boolean {
        if (!page.isFile) return false
        val target = File(trash, page.name)
        if (target.exists() || !page.renameTo(target)) return false
        target.setLastModified(System.currentTimeMillis())
        return true
    }

    fun deleted(): List<File> = trash.listFiles()?.filter { it.isFile && validName(it.name) }
        ?.sortedByDescending { it.lastModified() }.orEmpty()

    fun restore(file: File): File? {
        if (file.parentFile?.canonicalFile != trash.canonicalFile || !validName(file.name)) return null
        val target = File(pagesDir, file.name)
        if (target.exists() || !file.renameTo(target)) return null
        return target
    }

    fun purgeTrash(now: Long = System.currentTimeMillis()) {
        deleted().filter { now - it.lastModified() >= RETENTION_MS }.forEach {
            if (it.delete()) File(originals, it.name).delete()
        }
    }

    companion object {
        const val RETENTION_MS = 48L * 60 * 60 * 1000
        private fun validName(name: String) =
            name.matches(Regex("(?:page|capture|burst)_[a-zA-Z0-9_-]+\\.jpg"))

        internal fun naturalCompare(a: String, b: String): Int {
            val parts = Regex("[0-9]+|[^0-9]+")
            val aa = parts.findAll(a).map { it.value }.toList()
            val bb = parts.findAll(b).map { it.value }.toList()
            for (i in 0 until minOf(aa.size, bb.size)) {
                val x = aa[i]; val y = bb[i]
                val diff = if (x[0].isDigit() && y[0].isDigit()) {
                    val xx = x.trimStart('0').ifEmpty { "0" }
                    val yy = y.trimStart('0').ifEmpty { "0" }
                    xx.length.compareTo(yy.length).takeIf { it != 0 } ?: xx.compareTo(yy)
                } else x.compareTo(y)
                if (diff != 0) return diff
            }
            return aa.size.compareTo(bb.size)
        }

        fun atomicWrite(target: File, writer: (FileOutputStream) -> Unit) {
            target.parentFile?.mkdirs()
            val tmp = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
            try {
                FileOutputStream(tmp).use { out -> writer(out); out.fd.sync() }
                try {
                    Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
                } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                    Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            } finally {
                tmp.delete()
            }
        }
    }
}
