/**
 * 调色参数模型。
 *
 * 与 legacy 的全局 S 对象相比，这里有三点根本差别：
 *   1. 显式类型 + 显式取值范围，越界由 clampParams 统一治理；
 *   2. NEUTRAL 是唯一的中性基准，"预设强度"就是朝 NEUTRAL 插值；
 *   3. 全部是纯函数，参数对象可序列化 —— 这是文档模型能成立的前提。
 */

/** 十二项调色参数。 */
export interface AdjustParams {
  /** 亮度 %，50..150 */
  readonly brightness: number;
  /** 对比 %，50..150 */
  readonly contrast: number;
  /** 饱和 %，0..200 */
  readonly saturate: number;
  /** 曝光，-100..100 */
  readonly exposure: number;
  /** 色温（暖正冷负），-50..50 */
  readonly warm: number;
  /** 暗角，0..100 */
  readonly vignette: number;
  /** 颗粒，0..50 */
  readonly grain: number;
  /** 锐化，0..100 */
  readonly sharpen: number;
  /** 去雾清晰，0..100 */
  readonly dehaze: number;
  /** 磨皮柔肤，0..100 */
  readonly soften: number;
  /** 雨丝，0..100 */
  readonly rain: number;
  /** 雾气，0..100 */
  readonly fog: number;
}

export type AdjustKey = keyof AdjustParams;

export const ADJUST_KEYS = [
  'brightness',
  'contrast',
  'saturate',
  'exposure',
  'warm',
  'vignette',
  'grain',
  'sharpen',
  'dehaze',
  'soften',
  'rain',
  'fog',
] as const satisfies readonly AdjustKey[];

/** 各参数的合法闭区间。越界钳制与 UI 滑杆范围共用此表。 */
export const PARAM_RANGE: Readonly<Record<AdjustKey, readonly [number, number]>> = {
  brightness: [50, 150],
  contrast: [50, 150],
  saturate: [0, 200],
  exposure: [-100, 100],
  warm: [-50, 50],
  vignette: [0, 100],
  grain: [0, 50],
  sharpen: [0, 100],
  dehaze: [0, 100],
  soften: [0, 100],
  rain: [0, 100],
  fog: [0, 100],
};

/** 无滤镜中性值。预设强度插值的基准。 */
export const NEUTRAL: AdjustParams = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  exposure: 0,
  warm: 0,
  vignette: 0,
  grain: 0,
  sharpen: 0,
  dehaze: 0,
  soften: 0,
  rain: 0,
  fog: 0,
};

/** 是否是中性参数（完全无调整）。 */
export function isNeutral(p: AdjustParams): boolean {
  for (const k of ADJUST_KEYS) {
    if (p[k] !== NEUTRAL[k]) return false;
  }
  return true;
}

function clampValue(v: number, range: readonly [number, number]): number {
  if (!Number.isFinite(v)) return range[0];
  return Math.max(range[0], Math.min(range[1], v));
}

/** 把全部参数钳制到合法范围。 */
export function clampParams(p: AdjustParams): AdjustParams {
  const out = {} as Record<AdjustKey, number>;
  for (const k of ADJUST_KEYS) out[k] = clampValue(p[k], PARAM_RANGE[k]);
  return out as AdjustParams;
}

/** 保留一位小数，避免浮点毛刺在 UI 上显示成 100.00000000000001。 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 按 k ∈ [0,1] 把 target 朝 NEUTRAL 插值。
 * k=1 得到完整预设，k=0.55 得到五成半强度的效果。这是"预设强度"的唯一实现。
 */
export function mixWithNeutral(target: AdjustParams, k: number): AdjustParams {
  const t = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 1;
  const out = {} as Record<AdjustKey, number>;
  for (const key of ADJUST_KEYS) {
    out[key] = round1(NEUTRAL[key] + (target[key] - NEUTRAL[key]) * t);
  }
  return clampParams(out as AdjustParams);
}

/** 在现有参数上叠加增量（口语微调用），结果自动钳制。 */
export function addParams(base: AdjustParams, delta: Partial<AdjustParams>): AdjustParams {
  const out = {} as Record<AdjustKey, number>;
  for (const k of ADJUST_KEYS) {
    out[k] = base[k] + (delta[k] ?? 0);
  }
  return clampParams(out as AdjustParams);
}
