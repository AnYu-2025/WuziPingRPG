/**
 * 采样与数值钳制 —— 像素层最底部的基础设施。
 *
 * 这一层的存在理由（对应病根 1）：渲染中所有"取一个像素"的动作都从
 * 这里出，采样语义（边界如何处理、是否插值）**只有一份定义**。
 * legacy 的预览与导出各自用 Canvas2D 的 drawImage 与自己的绘制分支，
 * 边界语义与插值由浏览器在不同尺寸下以不同方式决定，因此两者必然漂移。
 */

/** 钳制到 [lo, hi]（浮点）。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 钳制到 [0, 255]（浮点，不取整）。 */
export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 钳制到 [0, 1]。 */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 钳制到 [lo, hi] 并向下取整为整数索引。 */
export function clampIndex(v: number, lo: number, hi: number): number {
  const i = Math.floor(v);
  return i < lo ? lo : i > hi ? hi : i;
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 双线性采样（以像素中心为整数点）。
 *
 * @param data   源像素缓冲（RGBA，8 位）
 * @param w      源宽
 * @param h      源高
 * @param u      连续图像坐标 x，取值域 [0, w]
 * @param v      连续图像坐标 y，取值域 [0, h]
 * @param out    长度 >= 4 的输出数组，写入 [r, g, b, a]
 * @returns      是否采到有效样本（完全越界时为 false，out 置零）
 *
 * 边界语义：越界样本**直接不参与**加权，权重按参与样本归一化。
 * 这样做的效果是旋转/缩放后图像边缘不会出现"被边缘像素向外拉伸"
 * 产生的假色黑边；同时完全落在源图外的目标像素得到 alpha=0，
 * 使下方的背景（边框色 / 模糊底）能正确透出。
 */
export function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  u: number,
  v: number,
  out: Float64Array,
): boolean {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  let ar = 0;
  let ag = 0;
  let ab = 0;
  let aa = 0;
  let wsum = 0;

  for (let dy = 0; dy < 2; dy++) {
    const yy = y0 + dy;
    if (yy < 0 || yy >= h) continue;
    const wy = dy === 0 ? 1 - fy : fy;
    const rowBase = yy * w;
    for (let dx = 0; dx < 2; dx++) {
      const xx = x0 + dx;
      if (xx < 0 || xx >= w) continue;
      const wt = (dx === 0 ? 1 - fx : fx) * wy;
      if (wt <= 0) continue;
      const j = (rowBase + xx) * 4;
      ar += data[j] * wt;
      ag += data[j + 1] * wt;
      ab += data[j + 2] * wt;
      aa += data[j + 3] * wt;
      wsum += wt;
    }
  }

  if (wsum <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    return false;
  }

  out[0] = ar / wsum;
  out[1] = ag / wsum;
  out[2] = ab / wsum;
  out[3] = aa / wsum;
  return true;
}
