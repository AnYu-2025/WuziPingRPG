package com.scan.camera

import kotlin.math.abs

/** 裁边几何、时间平滑和页面四角。不依赖 Android，RegressionChecks 与本地 kotlinc 都跑这份。 */
fun runQuadChecks(verify: (Boolean, String) -> Unit) {
    val w = 320
    val h = 400
    val rectangle = IntArray(w * h) { i -> if (i % w in 55..265 && i / w in 45..355) 235 else 25 }
    val detected = PageContour.detectQuad(rectangle, w, h)
    verify(detected != null && ScanRules.validQuad(detected), "深色桌面亮纸页可检测有效四角")
    verify(
        detected != null && abs(detected[0] - 55f / w) < .04f && abs(detected[1] - 45f / h) < .04f,
        "检测角点与真实页边误差小于画面 4%"
    )
    val inverted = IntArray(w * h) { 255 - rectangle[it] }
    verify(PageContour.detectQuad(inverted, w, h) != null, "浅色背景深色页面自动识别极性")
    verify(PageContour.detectQuad(IntArray(w * h) { 220 }, w, h) == null, "均匀低对比画面不误报页面")
    val hist = IntArray(256).apply { this[25] = 1000; this[235] = 1000 }
    verify(PageContour.otsu(hist, 2000) in 26..235, "Otsu 阈值将等于暗峰的背景留在背景侧")

    val offCenter = IntArray(w * h) { i ->
        val x = i % w
        val y = i / w
        if (x in 30..210 && y in 15..190) 230 else 20
    }
    val off = PageContour.detectQuad(offCenter, w, h)
    verify(off != null && ScanRules.validQuad(off), "页面不压住正中心时仍给出凸四边形")
    verify(off != null && abs(off[1] - 15f / h) < .06f, "偏上的页面顶边仍靠近真实边缘")

    val trap = IntArray(w * h) { i ->
        val x = i % w
        val y = i / w
        if (y !in 50..350) 18 else {
            val t = (y - 50) / 300f
            val left = 70 + (30 - 70) * t
            val right = 250 + (290 - 250) * t
            if (x.toFloat() in left..right) 220 else 18
        }
    }
    val trapezoid = PageContour.detectQuad(trap, w, h)
    verify(trapezoid != null && ScanRules.validQuad(trapezoid), "梯形书页得到有效四角")
    verify(
        trapezoid != null && abs(trapezoid[0] - 70f / w) < .06f && abs(trapezoid[2] - 250f / w) < .06f,
        "梯形上边两个角点贴近真实页边"
    )

    val shaded = IntArray(w * h) { i ->
        val x = i % w
        val y = i / w
        if (x in 40..280 && y in 36..360) (60 + (x - 40) * 150 / 240 + (y % 17) / 3) else 22
    }
    val shade = PageContour.detectQuad(shaded, w, h)
    verify(shade != null && ScanRules.validQuad(shade), "左右亮度差很大的纸页仍能检出")
    verify(shade != null && shade[0] < 0.25f && shade[2] > 0.7f, "阴影纸页左右边界没有缩成半页")

    val base = floatArrayOf(.2f, .2f, .8f, .2f, .8f, .8f, .2f, .8f)
    val nudged = QuadEdit.moveCorner(base, 0, .24f, .26f)
    verify(ScanRules.validQuad(nudged) && abs(nudged[0] - .24f) < .001f && abs(nudged[1] - .26f) < .001f, "小幅拖角点会跟手")
    val crossed = QuadEdit.moveCorner(base, 2, .3f, .3f)
    verify(ScanRules.validQuad(crossed), "把角拖进对面时仍保持凸四边形")
    verify(crossed[4] > .45f || crossed[5] > .45f, "越界的角点退回到还没交叉的位置")
    val bowtie = floatArrayOf(0f, 0f, 1f, 1f, 1f, 0f, 0f, 1f)
    verify(!ScanRules.validQuad(bowtie), "拒绝自交四边形")
    val edge = QuadEdit.moveEdge(base, 0, 0f, .1f)
    verify(ScanRules.validQuad(edge) && abs(edge[1] - .3f) < .02f && abs(edge[3] - .3f) < .02f, "拖上边中点时两个端点一起下移")
    val collapsed = QuadEdit.moveEdge(base, 0, 0f, .9f)
    verify(
        ScanRules.validQuad(collapsed) && collapsed[1] > .5f && collapsed[1] < collapsed[7] && collapsed[3] < collapsed[5],
        "边拖过头会停在还没翻过去的位置"
    )
    val mid = QuadEdit.edgeMidpoint(base, 0)
    verify(abs(mid[0] - .5f) < .001f && abs(mid[1] - .2f) < .001f, "上边中点落在两端中间")
    verify(CropHandles.CORNER_HIT_DP >= 44f && CropHandles.EDGE_HIT_DP >= 28f, "角点和边中点的触控热区足够大")
    verify(CropHandles.LOUPE_ZOOM >= 2f, "拖动放大镜至少两倍")
    verify(ScanRules.validQuad(ScanRules.centeredQuad()) && ScanRules.validQuad(ScanRules.fullFrameQuad()), "失败回退框本身合法")

    val motion = QuadMotion()
    val page = floatArrayOf(.1f, .1f, .8f, .12f, .78f, .9f, .12f, .88f)
    val first = motion.update(page)
    verify(first.indices.all { abs(first[it] - page[it]) < .0001f }, "第一帧检测直接锁定")
    val noisy = page.copyOf()
    noisy[0] = page[0] + .008f
    val smoothed = motion.update(noisy)
    verify(abs(smoothed[0] - page[0]) < .004f && abs(smoothed[0] - noisy[0]) > .004f, "小抖动被平滑，不会跳到噪声点")
    val far = page.copyOf()
    far[0] = page[0] + .25f
    val held = motion.update(far)
    verify(abs(held[0] - smoothed[0]) < .001f && motion.confident, "单帧大跳先按住当前框")
    val followed = motion.update(far)
    verify(followed[0] > held[0] + .05f && followed[0] < far[0] - .02f && ScanRules.validQuad(followed), "连续两帧才朝新位置移动")
    repeat(5) { motion.update(null) }
    verify(!motion.fallback && motion.confident, "短暂丢失仍保持上一帧")
    val gaveUp = motion.update(null)
    verify(motion.fallback && !motion.confident && ScanRules.validQuad(gaveUp), "持续丢失后退回建议框")
    verify(abs(gaveUp[0] - .08f) < .001f, "普通页面丢失时用居中框")
    val wide = QuadMotion()
    wide.update(floatArrayOf(.02f, .02f, .98f, .03f, .97f, .98f, .03f, .97f))
    repeat(6) { wide.update(null) }
    verify(wide.fallback && wide.update(null)[0] <= .03f, "接近整页的选框丢失时退回整帧")
    val relock = wide.update(page)
    verify(!wide.fallback && abs(relock[0] - page[0]) < .001f, "建议框之后重新检出会立刻锁上")
}

fun main() {
    var checks = 0
    runQuadChecks { ok, label ->
        check(ok) { label }
        checks++
        println("PASS $label")
    }
    println("$checks quad checks passed")
}
