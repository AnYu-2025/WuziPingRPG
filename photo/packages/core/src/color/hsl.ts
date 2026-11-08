import type { BandAdjust, BandAdjustMap, BandSpec, HslBand } from './types.js';
import { hsvToRgb, rgbToHsv, type Triple } from './hsv.js';

/** 八色分调的色彩带定义（中心色相 + 展示色）。 */
export const HSL_BANDS: readonly BandSpec[] = [
  { key: 'red', hue: 0, label: '红', css: '#e5484d' },
  { key: 'orange', hue: 30, label: '橙', css: '#f76b15' },
  { key: 'yellow', hue: 60, label: '黄', css: '#ffd60a' },
  { key: 'green', hue: 120, label: '绿', css: '#46a758' },
  { key: 'cyan', hue: 180, label: '青', css: '#12a594' },
  { key: 'blue', hue: 240, label: '蓝', css: '#3e63dd' },
  { key: 'purple', hue: 270, label: '紫', css: '#8e4ec6' },
  { key: 'magenta', hue: 300, label: '品', css: '#d6409f' },
];

export const HSL_BAND_KEYS: readonly HslBand[] = HSL_BANDS.map((b) => b.key);

/** 影响半径（度）。色相距离超过它即完全不产生影响。 */
export const BAND_RADIUS = 60;

/** 饱和度低于此值的像素视为无色，不做分色调整（避免噪点被上色）。 */
export const BAND_MIN_SATURATION = 0.02;

/** 全零调整。 */
export function zeroBands(): Record<HslBand, BandAdjust> {
  const out = {} as Record<HslBand, BandAdjust>;
  for (const k of HSL_BAND_KEYS) out[k] = { h: 0, s: 0, l: 0 };
  return out;
}

/**
 * 余弦平滑权重：色相距离 0 处为 1，距离等于半径处为 0，中间平滑过渡。
 *
 * 用余弦而非线性，是为了让相邻色带的贡献在边界处**连续可导**，
 * 避免线性权重在带边界产生可见的硬边（色阶断层）。
 */
export function bandWeight(hue: number, bandHue: number): number {
  let dist = Math.abs(hue - bandHue);
  if (dist > 180) dist = 360 - dist;
  if (dist >= BAND_RADIUS) return 0;
  return (Math.cos((dist / BAND_RADIUS) * Math.PI) + 1) / 2;
}

/** 是否存在任何非零的分色调整（用于跳过整段计算）。 */
export function hasAnyBandAdjust(adjusts: BandAdjustMap): boolean {
  for (const k of HSL_BAND_KEYS) {
    const a = adjusts[k];
    if (a !== undefined && (a.h !== 0 || a.s !== 0 || a.l !== 0)) return true;
  }
  return false;
}

const scratchAdjust: Triple = [0, 0, 0];
const scratchHsv: Triple = [0, 0, 0];

/**
 * 累加某色相下所有色带的贡献，写入 out = [Δhue, Δsat, Δlight]。
 * Δsat / Δlight 为百分比（-100..100），Δhue 为度。
 */
export function accumulateBandAdjust(
  hue: number,
  adjusts: BandAdjustMap,
  out: Triple,
): Triple {
  let dh = 0;
  let ds = 0;
  let dl = 0;
  for (const band of HSL_BANDS) {
    const a = adjusts[band.key];
    if (a.h === 0 && a.s === 0 && a.l === 0) continue;
    const w = bandWeight(hue, band.hue);
    if (w === 0) continue;
    dh += a.h * w;
    ds += a.s * w;
    dl += a.l * w;
  }
  out[0] = dh;
  out[1] = ds;
  out[2] = dl;
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 对单个像素施加八色分调，结果 RGB 写入 out。
 *
 * 流程：RGB → HSV → 按色相加权累加调整 → HSV → RGB。
 * 低饱和像素直接原样返回（防止灰噪点被染色）。
 */
export function applyBandAdjustToRgb(
  r: number,
  g: number,
  b: number,
  adjusts: BandAdjustMap,
  out: Triple,
): Triple {
  rgbToHsv(r, g, b, scratchHsv);
  const hue = scratchHsv[0];
  const sat = scratchHsv[1];
  const val = scratchHsv[2];

  if (sat <= BAND_MIN_SATURATION) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }

  accumulateBandAdjust(hue, adjusts, scratchAdjust);
  const dh = scratchAdjust[0];
  const ds = scratchAdjust[1];
  const dl = scratchAdjust[2];

  if (dh === 0 && ds === 0 && dl === 0) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }

  return hsvToRgb(hue + dh, clamp01(sat * (1 + ds / 100)), clamp01(val * (1 + dl / 100)), out);
}
