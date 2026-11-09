import type { CurveLut } from './types.js';

/**
 * 色阶（Levels）—— 单通道的「掐头去尾 + 增益」。
 *
 * ── 语义 ────────────────────────────────────────────────────────────
 * 把输入区间 `[lo, hi]` 线性拉伸到 `[0, 255]`，再乘 `gain`，最后钳到 0..255：
 *
 *     out(v) = clamp( (v - lo) / (hi - lo) * 255 * gain, 0, 255 )
 *
 * 这正是 legacy「自动增强」那条 LUT 的**参数化**形态：
 * 逐通道取 1% 分位当 lo/hi（拉开层次），再用灰世界增益校正偏色。
 *
 * ── 为什么不复用「曲线」──────────────────────────────────────────────
 * 曲线（`CurvePoints`）走的是 Fritsch–Carlson 单调三次插值，控制点之间是**平滑**过渡。
 * 而色阶是一条折线：平坦 → 斜坡 → 平坦，两个拐点是**尖角**。
 * 若用控制点表达折线，插值会把尖角磨圆 —— 斜坡两端变成缓入缓出，
 * 极端情况下与真值相差几十级灰度。"自动增强"要求与 legacy 效果一致，
 * 因此色阶必须有自己的一等表示，而不是借曲线的壳。
 *
 * 附带收益：文档里只存 3 组 `{lo, hi, gain}`（共 9 个数），
 * 而不是 256 个控制点。这也让"手动色阶"面板成为后续可加项（legacy 本就有「色阶」区）。
 */
export interface LevelChannel {
  /** 暗部端点，0..255。 */
  readonly lo: number;
  /** 亮部端点，大于 lo，最大 255。 */
  readonly hi: number;
  /** 增益（灰世界白平衡），0.8..1.25。 */
  readonly gain: number;
}

/** 三通道色阶。 */
export type LevelsState = Readonly<Record<'r' | 'g' | 'b', LevelChannel>>;

function identityChannel(): LevelChannel {
  return { lo: 0, hi: 255, gain: 1 };
}

/** 中性色阶（恒等）。 */
export function identityLevels(): LevelsState {
  const c = identityChannel();
  return { r: c, g: c, b: c };
}

/** 单通道是否恒等（可跳过该通道的查表）。 */
export function isIdentityChannel(c: LevelChannel): boolean {
  return c.lo === 0 && c.hi === 255 && c.gain === 1;
}

/** 整组是否恒等 —— identity 时整段跳过，不进像素循环。 */
export function isIdentityLevels(levels: LevelsState): boolean {
  return (
    isIdentityChannel(levels.r) && isIdentityChannel(levels.g) && isIdentityChannel(levels.b)
  );
}

/**
 * 由通道参数构建 256 项 LUT。
 *
 * 两点刻意为之：
 *   1. 写法与 legacy 的 `(v - lo) / (hi - lo) * 255 * g` **运算次序一致**，
 *      避免浮点结合律差异让最后一个 bit 摆动，进而让取整结果差 1。
 *   2. 结果写进 `Uint8ClampedArray` —— 由它完成「钳到 0..255 且取整」，
 *      因此"低于 lo 一律 0、高于饱和点一律 255"的行为与 legacy 逐字节一致，
 *      不在别处再钳一次（两次钳制是同类错误的两份实现）。
 *
 * `hi - lo` 为 0（或负）时按 1 处理 —— 与 legacy `bounds` 返回 `max(lo+1, hi)` 的保证对齐，
 * 避免除零产生 Infinity 后被静默钳成纯白。
 */
export function buildLevelLut(c: LevelChannel): CurveLut {
  const span = c.hi > c.lo ? c.hi - c.lo : 1;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - c.lo) / span) * 255 * c.gain;
  return lut;
}
