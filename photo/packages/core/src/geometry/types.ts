/**
 * 几何基础类型。
 *
 * 设计约束（这是本模块存在的全部理由）：
 *   所有几何 API 一律接收/返回 Size / Rect / Point 结构体，
 *   **禁止在函数签名里出现并排的两个裸数字表示宽高**。
 *
 * 历史教训（legacy v0.11 的 P1-1）：
 *   `drawOne(img, border, border, h, w)` —— 传入的是 (…, 高, 宽)，
 *   函数体里又做了一次 min/max 推断，最终横图旋转 90° 时
 *   绘制尺寸变成 788×1400（宽高比 0.563）而原图是 1.778，
 *   画面被横向压扁 3.16 倍。同类的"顺序靠人脑记"错误在本层不可能再发生。
 */

/** 直角旋转角度，顺时针，单位度。 */
export type Rotate = 0 | 90 | 180 | 270;

/** 二维尺寸，单位像素。宽高必须为正。 */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/** 矩形区域，原点在左上角。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 二维点。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 把任意数值归一化为合法 Rotate。 */
export function normalizeRotate(value: number): Rotate {
  const v = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return (v === 0 || v === 90 || v === 180 || v === 270 ? v : 0) as Rotate;
}

/** 尺寸是否有效（宽高均为有限正数）。 */
export function isValidSize(size: Size): boolean {
  return (
    Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0
  );
}

/** 构造 Size，并对非正数做保护（避免下游出现除零）。 */
export function size(w: number, h: number): Size {
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** 宽高比 w / h。 */
export function aspectOf(s: Size): number {
  return s.w / s.h;
}
