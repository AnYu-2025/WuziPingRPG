package com.scan.camera

import java.io.File
import java.nio.file.Files

/** 直接运行真实生产类；覆盖丢页、页序、取消后文件完整性及自动拍摄的历史故障。 */
fun main() {
    var checks = 0
    fun verify(value: Boolean, label: String) { check(value) { label }; checks++; println("PASS $label") }
    val tempParent = File("build/regression-temp").canonicalFile.apply { mkdirs() }
    val root = Files.createTempDirectory(tempParent.toPath(), "scan-camera-regression-").toFile()
    try {
        val store = PageStore(root)
        fun page(name: String, content: String = name) = File(store.pagesDir, name).apply { writeText(content) }
        val one = page("page_20261002_1.jpg")
        val ten = page("page_20261002_10.jpg")
        val two = page("page_20261002_2.jpg")
        val legacy = page("capture_20261003.jpg")
        verify(store.load() == listOf(one, two, ten, legacy), "旧版导入 1/2/10 自然顺序与直接拍摄恢复")
        store.saveOrder(listOf(ten, one, legacy, two))
        verify(PageStore(root).load() == listOf(ten, one, legacy, two), "重启后保留拖动页序")
        val added = page("page_20261102.jpg")
        verify(store.load() == listOf(ten, one, legacy, two, added), "文件与页序清单对账，未登记文件不丢失")
        File(root, "page-order.txt").appendText("\n../../private.jpg\npage_20261002_1.jpg")
        verify(store.load().size == 5, "拒绝越界页名并去除清单重复项")
        val pending = page("capture_pending.jpg")
        verify(pending !in store.load(pending.absolutePath) && pending.isFile, "等待裁边的旧拍摄不被清理或重复恢复")
        val staged = store.newCapture().apply { writeText("recover me") }
        store.load(staged.absolutePath)
        verify(staged.isFile, "新版待确认拍摄保留")
        store.load()
        verify(!staged.exists() && store.deleted().any { it.readText() == "recover me" }, "中断拍摄进入回收站可找回")
        store.keepOriginal(one, one)
        val originalText = one.readText()
        one.setLastModified(1)
        val now = System.currentTimeMillis()
        verify(store.moveToTrash(one), "删除页面进入回收站")
        val deleted = store.deleted().first { it.name == one.name }
        verify(deleted.lastModified() >= now-1000, "回收站按删除时间计时，不按拍摄时间")
        store.purgeTrash(now+PageStore.RETENTION_MS-2000)
        verify(deleted.isFile, "未满 48 小时仍可恢复")
        verify(store.restore(deleted) == one && one.readText() == originalText, "恢复页面保留原始数据")
        verify(store.original(one).readText() == originalText, "删除及恢复保留重裁原图")
        val replacement = File(root, "replacement.jpg").apply { writeText("new pixels") }
        store.replace(one, replacement)
        verify(one.readText() == "new pixels" && store.original(one).readText() == originalText, "原子替换保留首份原图")
        runCatching { PageStore.atomicWrite(one) { it.write("partial".toByteArray()); error("disk failure") } }
        verify(one.readText() == "new pixels", "写入中途失败不破坏旧页面")
        verify(store.pagesDir.listFiles()!!.none { it.extension == "tmp" }, "失败写入清理临时文件")
        store.moveToTrash(one)
        store.purgeTrash(System.currentTimeMillis()+PageStore.RETENTION_MS+1000)
        verify(store.deleted().none { it.name == one.name } && store.original(one) == one, "过期页面与原图成对清理")
        verify(store.restore(File(root, "replacement.jpg")) == null, "恢复操作拒绝回收站外文件")

        val full = floatArrayOf(0f,0f,1f,0f,1f,1f,0f,1f)
        verify(ScanRules.validQuad(full), "完整页面四角有效")
        verify(!ScanRules.validQuad(floatArrayOf(0f,0f,1f,1f,1f,0f,0f,1f)), "拒绝交叉四边形")
        verify(!ScanRules.validQuad(floatArrayOf(0f,0f,0f,0f,0f,0f,0f,0f)), "拒绝退化选框")
        verify(!ScanRules.validQuad(floatArrayOf(Float.NaN,0f,1f,0f,1f,1f,0f,1f)), "拒绝非数值坐标")
        val asymmetric = floatArrayOf(.1f,.2f,.9f,.1f,.8f,.9f,.2f,.8f)
        val rotated = ScanRules.rotateQuad(asymmetric)
        verify(kotlin.math.abs(rotated[0]-.2f)<.0001f && kotlin.math.abs(rotated[1]-.2f)<.0001f, "旋转后重新定位左上角")
        var back = asymmetric
        repeat(4) { back = ScanRules.rotateQuad(back) }
        verify(back.indices.all { kotlin.math.abs(back[it]-asymmetric[it])<.0001f }, "连续四次旋转恢复原坐标")
        val gate = AutoCaptureGate()
        val signature = IntArray(256) { 100 }
        verify(!gate.update(full,signature,1000,false), "稳定时间不足不拍摄")
        verify(gate.update(full,signature,1900,false), "稳定 900ms 后触发一次")
        verify(!gate.update(full,signature,6000,false) && !gate.update(full,signature,9000,false), "同一页持续停留不重复拍摄")
        repeat(3) { gate.update(null,IntArray(256){180},10000L+it*100,false) }
        verify(!gate.update(full,signature,11000,false) && gate.update(full,signature,11900,false), "翻页变化后重新稳定拍摄")
        gate.reset()
        gate.update(full,signature,13000,false)
        verify(!gate.update(full,signature,15000,true), "处理或导出期间不自动拍摄")
        gate.update(full,signature,16000,false)
        verify(gate.update(full,signature,16900,false), "忙碌解除后重新计算稳定时间")

        verify(ExportRules.safeBaseName("  章节1.pdf ", "默认") == "章节1", "自定义文件名不重复添加 PDF 后缀")
        verify(ExportRules.safeBaseName("../a:b\\c\n", "默认") == "abc", "文件名清理非法字符和控制字符")
        verify(ExportRules.safeBaseName(" ... ", "默认") == "默认", "空文件名使用默认值")
        verify(ExportRules.colorCopyBaseName("扫描_20261110_120000.pdf") == "扫描_20261110_120000_彩色",
            "彩色版沿用原文件名并添加彩色后缀")
        verify(ExportRules.colorCopyBaseName("章节1.pdf") == "章节1_彩色", "自定义文件名生成彩色版后缀")
        verify(ExportRules.colorCopyBaseName("章节1_彩色.pdf") == "章节1_彩色", "彩色版文件名不重复叠加后缀")
        verify(ExportRules.colorCopyBaseName("../a:b\\c\n.pdf") == "abc_彩色", "彩色版文件名同样清理非法字符")
        val longColorName = ExportRules.colorCopyBaseName("页".repeat(120))
        verify(longColorName.length <= 100 && longColorName.endsWith(ExportRules.COLOR_SUFFIX),
            "超长文件名截断后仍保留彩色后缀")
        verify(ExportRules.safeBaseName(ExportRules.colorCopyBaseName("章节1.pdf"), "默认") + ".pdf" == "章节1_彩色.pdf",
            "彩色版最终文件名带 PDF 后缀")
        verify(ExportRules.exportMode(EnhanceMode.GRAY, colorCopy = false) == EnhanceMode.GRAY,
            "普通导出保持默认灰度")
        verify(ExportRules.exportMode(EnhanceMode.BW, colorCopy = false) == EnhanceMode.BW,
            "普通导出保持当前黑白模式")
        verify(ExportRules.exportMode(EnhanceMode.COLOR, colorCopy = false) == EnhanceMode.COLOR,
            "普通导出保持当前原色模式")
        verify(ExportRules.exportMode(EnhanceMode.GRAY, colorCopy = true) == EnhanceMode.COLOR,
            "灰度模式下的彩色版强制使用原色")
        verify(ExportRules.exportMode(EnhanceMode.BW, colorCopy = true) == EnhanceMode.COLOR,
            "黑白模式下的彩色版强制使用原色")
        verify(AppSettings().mode == EnhanceMode.GRAY.name, "默认增强模式仍为灰度")
        val key = ExportRules.ocrKey("page",1,100,2400,1800,"GRAY",50,50)
        verify(key != ExportRules.ocrKey("page",1,100,3200,2400,"GRAY",50,50), "OCR 分辨率切换使缓存失效")
        verify(key != ExportRules.ocrKey("page",1,101,2400,1800,"GRAY",50,50), "文件内容尺寸变化使缓存失效")
        runQuadChecks(::verify)
        println("$checks regression checks passed")
    } finally {
        check(root.canonicalFile.parentFile == tempParent && root.name.startsWith("scan-camera-regression-"))
        root.deleteRecursively()
    }
}
