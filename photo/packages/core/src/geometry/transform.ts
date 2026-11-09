import type { Point, Rect, Rotate, Size } from './types.js';
import { size } from './types.js';

/** 是否为直角旋转（宽高互换的充要条件）。 */
export function isQuarterTurn(rotate: Rotate): boolean {
  return rotate === 90 || rotate === 270;
}

/**
 * 旋转后的画布尺寸 —— **宽高互换的唯一合法入口**。
 *
 * 除本函数外，代码中任何地方都不得自行交换 w/h，也不得用 min/max 之类
 * 的启发式去"猜"哪边是宽。legacy v0.11 的 P1-1 正是在这里靠猜出错的。
 */
export function rotatedSize(src: Size, rotate: Rotate): Size {
  return isQuarterTurn(rotate) ? size(src.h, src.w) : size(src.w, src.h);
}

/**
 * 在「已旋转的画布坐标系」中，绘制原图应当使用的尺寸。
 *
 * ── 推导 ──────────────────────────────────────────────────────────
 * 画布绘制流程为：
 *     ctx.translate(cw/2, ch/2);
 *     ctx.rotate(θ · π/180);
 *     ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
 *
 * 把局部矩形 (dw, dh) 的四角映射到屏幕可得其屏幕包围盒：
 *     θ ∈ {0, 180}  →  宽 = dw,  高 = dh
 *     θ ∈ {90, 270} →  宽 = dh,  高 = dw
 * 要求包围盒恰好等于画布尺寸 (cw, ch)，解得：
 *     θ ∈ {0, 180}  →  dw = cw, dh = ch
 *     θ ∈ {90, 270} →  dw = ch, dh = cw
 * 两种情形可统一写作：
 *     drawSize = rotatedSize(canvasSize, θ)          ← 即本函数
 *
 * 而且当 canvasSize = rotatedSize(srcSize, θ) 时（铺满画布的常见情形），
 *     drawSize = rotatedSize(rotatedSize(srcSize, θ), θ) = srcSize
 * 即：**旋转坐标系里的绘制尺寸应当恒等于原图尺寸**，与角度无关。
 *
 * ── 对照 legacy 的错误 ─────────────────────────────────────────────
 * legacy drawOne() 写的是：
 *     const w = Math.min(dw, dh), h = Math.max(dw, dh);
 * 对 1600×900 横图（预览 1400×788，dw=788, dh=1400）得到局部 788×1400，
 * 宽高比 0.563，而原图是 1.778 —— 横向压扁 3.16 倍。
 * 正确结果应为 1400×788。竖图恰好与 min/max 的输出一致，因此该 bug
 * 在只测竖图时不会被发现。本函数的返回值为任何尺寸与角度组合唯一确定，
 * 不存在"恰好对"的情况。
 */
export function drawSizeFor(canvasSize: Size, rotate: Rotate): Size {
  return rotatedSize(canvasSize, rotate);
}

/** 等比缩放，使长边不超过 maxEdge。maxEdge <= 0 表示保持原尺寸。 */
export function fitToLongEdge(src: Size, maxEdge: number): Size {
  if (!(maxEdge > 0)) return size(src.w, src.h);
  const longest = Math.max(src.w, src.h);
  if (longest <= maxEdge) return size(src.w, src.h);
  const k = maxEdge / longest;
  return size(src.w * k, src.h * k);
}

/** 等比缩放，使 src 完整放入 box（contain）。 */
export function fitContain(src: Size, box: Size): { scale: number; size: Size } {
  const scale = Math.min(box.w / src.w, box.h / src.h);
  return { scale, size: size(src.w * scale, src.h * scale) };
}

/** 等比缩放，使 src 铺满 box（cover），并给出居中后的偏移。 */
export function fitCover(
  src: Size,
  box: Size,
): { scale: number; size: Size; offset: Point } {
  const scale = Math.max(box.w / src.w, box.h / src.h);
  const drawn = size(src.w * scale, src.h * scale);
  return {
    scale,
    size: drawn,
    offset: { x: (box.w - drawn.w) / 2, y: (box.h - drawn.h) / 2 },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 把矩形钳制到 [0,0,bounds.w,bounds.h] 内；完全越界时返回零面积矩形。 */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const x = clamp(rect.x, 0, bounds.w);
  const y = clamp(rect.y, 0, bounds.h);
  const w = clamp(rect.x + rect.w, 0, bounds.w) - x;
  const h = clamp(rect.y + rect.h, 0, bounds.h) - y;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

/** 归一化矩形：允许负宽高（反向框选），统一为左上角 + 正宽高。 */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

/**
 * 把用户在屏幕上框选的显示区域，换算为原图坐标系中的像素矩形。
 *
 * @param display      显示坐标下的矩形（相对画布内容区左上角，CSS px）
 * @param displayScale 画布的显示缩放系数 f（canvas 被 CSS transform: scale(f)）
 * @param contentSize  画布内容区尺寸（即预览渲染分辨率，非原图分辨率）
 * @param imageSize    原图自然尺寸
 *
 * 映射关系：图像像素 = 显示坐标 ÷ 显示缩放 × (原图尺寸 / 内容区尺寸)
 */
export function mapDisplayRectToImage(
  display: Rect,
  displayScale: number,
  contentSize: Size,
  imageSize: Size,
): Rect {
  const safeScale = displayScale > 0 ? displayScale : 1;
  const norm = normalizeRect(display);
  const kx = imageSize.w / (contentSize.w * safeScale);
  const ky = imageSize.h / (contentSize.h * safeScale);
  return clampRect(
    { x: norm.x * kx, y: norm.y * ky, w: norm.w * kx, h: norm.h * ky },
    imageSize,
  );
}
