import type { BandAdjustMap, CurveLut } from '../color/types.js';
import { buildCurveLut, composeCurveLuts, isIdentityCurve } from '../color/curve.js';
import { applyBandAdjustToRgb, hasAnyBandAdjust } from '../color/hsl.js';
import {
  buildLevelLut,
  isIdentityLevels,
  type LevelsState,
} from '../color/levels.js';
import type { Triple } from '../color/hsv.js';
import type { AdjustParams } from '../presets/params.js';
import type { CurveSet } from '../document/types.js';
import type { PixelBuffer } from '../types.js';
import { overlayFill } from './compose.js';
import { clamp255 } from './sampling.js';

/**
 * 基础调色：亮度 / 曝光 / 对比 / 饱和。
 *
 * 语义与 legacy 的 CSS filter 串 `brightness(b%) brightness(exp%) contrast(c%) saturate(s%)`
 * **等价**，但改为纯像素运算 —— 因此不再依赖浏览器对 filter 的实现，
 * 预览与导出在同一尺寸下逐字节一致。
 *
 * 运算顺序（务必与 legacy filter 串顺序一致）：
 *   1. 亮度乘法（亮度与曝光合并为一次乘法，因为两次 brightness 相乘）
 *   2. 对比：绕中灰 127.5 拉伸
 *   3. 饱和：朝感知亮度插值
 */
export function applyColorParams(buf: PixelBuffer, p: AdjustParams): void {
  const mul = (p.brightness / 100) * ((100 + p.exposure * 0.8) / 100);
  const con = p.contrast / 100;
  const sat = p.saturate / 100;
  if (Math.abs(mul - 1) < 1e-9 && Math.abs(con - 1) < 1e-9 && Math.abs(sat - 1) < 1e-9) return;

  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * mul;
    let g = d[i + 1] * mul;
    let b = d[i + 2] * mul;

    r = (r - 127.5) * con + 127.5;
    g = (g - 127.5) * con + 127.5;
    b = (b - 127.5) * con + 127.5;

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    d[i] = clamp255(lum + (r - lum) * sat);
    d[i + 1] = clamp255(lum + (g - lum) * sat);
    d[i + 2] = clamp255(lum + (b - lum) * sat);
  }
}

/**
 * 色温：暖调用 overlay 叠暖橙、冷调用 overlay 叠冷蓝，不透明度 = |warm|/120。
 * 与 legacy 的 `S.warm` 完全同参。
 */
export function applyWarm(buf: PixelBuffer, warm: number): void {
  if (warm === 0) return;
  const alpha = Math.abs(warm) / 120;
  if (warm > 0) overlayFill(buf, 0xff, 0x9a, 0x3c, alpha);
  else overlayFill(buf, 0x3c, 0xa9, 0xff, alpha);
}

/** 曲线是否全部为恒等（可整段跳过）。 */
export function isCurveSetIdentity(curves: CurveSet): boolean {
  return (
    isIdentityCurve(curves.rgb) &&
    isIdentityCurve(curves.r) &&
    isIdentityCurve(curves.g) &&
    isIdentityCurve(curves.b)
  );
}

/** 由通道曲线组构建三条通道 LUT：out = master[chan[x]]。 */
export function buildGradeLuts(curves: CurveSet): { r: CurveLut; g: CurveLut; b: CurveLut } {
  const master = buildCurveLut(curves.rgb);
  const r = buildCurveLut(curves.r);
  const g = buildCurveLut(curves.g);
  const b = buildCurveLut(curves.b);
  return {
    r: composeCurveLuts(master, r),
    g: composeCurveLuts(master, g),
    b: composeCurveLuts(master, b),
  };
}

const scratchHsl: Triple = [0, 0, 0];

/**
 * 专业调色：RGB 曲线 → HSL 八色分调，在**一遍像素循环**内完成。
 * 与 legacy 的 applyGrade 同构，但 LUT 与分调表在进入循环前备好，
 * 且不依赖 Canvas / getImageData，可在任意后端沿用。
 */
export function applyGrade(buf: PixelBuffer, curves: CurveSet, bands: BandAdjustMap): void {
  const useCurves = !isCurveSetIdentity(curves);
  const useBands = hasAnyBandAdjust(bands);
  if (!useCurves && !useBands) return;

  const luts = useCurves ? buildGradeLuts(curves) : null;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    if (luts) {
      r = luts.r[r];
      g = luts.g[g];
      b = luts.b[b];
    }
    if (useBands) {
      applyBandAdjustToRgb(r, g, b, bands, scratchHsl);
      r = scratchHsl[0];
      g = scratchHsl[1];
      b = scratchHsl[2];
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

/**
 * 色阶：逐通道查表（`out = lut[in]`）。
 *
 * 与 `applyGrade` 的分工：`applyGrade` 走的是**曲线**（单调三次插值的平滑 LUT），
 * 色阶走的是**折线**（平坦→斜坡→平坦，拐点是尖角）。两者都要，不能互替 ——
 * 理由见 `color/levels.ts` 的文件头。
 *
 * 恒等时整段跳过（`isIdentityLevels`），因此"没按自动增强"的图不付任何代价。
 */
export function applyLevels(buf: PixelBuffer, levels: LevelsState): void {
  if (isIdentityLevels(levels)) return;
  const lr = buildLevelLut(levels.r);
  const lg = buildLevelLut(levels.g);
  const lb = buildLevelLut(levels.b);
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
}
