import type { CurveLut, CurvePoint, CurvePoints } from './types.js';

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** 恒等曲线（点斜线），输出与输入完全相同。 */
export function identityCurve(): CurvePoint[] {
  return [
    [0, 0],
    [255, 255],
  ];
}

/** 全部通道是否都是恒等曲线（用于跳过整段调色计算）。 */
export function isIdentityCurve(points: CurvePoints): boolean {
  const p = normalizeCurvePoints(points);
  return p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255;
}

/**
 * 归一化控制点：坐标钳到 0..255、按 x 升序排序、相邻同 x 只保留一个。
 * 返回值长度 >= 1；空输入回退为恒等曲线。
 */
export function normalizeCurvePoints(points: CurvePoints): CurvePoint[] {
  const clamped: CurvePoint[] = points.map(
    ([x, y]) => [clamp255(x), clamp255(y)] as CurvePoint,
  );
  clamped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const out: CurvePoint[] = [];
  for (const p of clamped) {
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last === undefined || last[0] !== p[0]) out.push(p);
  }
  return out.length > 0 ? out : identityCurve();
}

/**
 * 构建 256 项查找表，使用 Fritsch–Carlson 单调三次 Hermite 插值。
 *
 * 选型理由（与 legacy 一致，但要写明白）：
 *   普通 Catmull–Rom 样条在控制点处会产生过冲（overshoot），
 *   在曲线上表现为亮部莫名变暗、暗部莫名发灰，并引入假色。
 *   Fritsch–Carlson 通过限制切线（割线斜率异号时切线取 0，
 *   同号时用加权调和平均）保证插值结果**严格单调**，
 *   因此"拉一个 S 型"只会增强对比，不会产生反向的局部极值。
 *
 * 性质（由单测锁定）：
 *   1. 恒等曲线的 LUT 满足 lut[x] === x，逐项精确。
 *   2. 单调不减的控制点 → 单调不减的 LUT。
 *   3. 定义域外（x <= p[0][0] 或 x >= p[n-1][0]）取端点值。
 */
export function buildCurveLut(points: CurvePoints): CurveLut {
  const lut = new Uint8ClampedArray(256);
  const p = normalizeCurvePoints(points);
  const n = p.length;

  if (n === 1) {
    const v = p[0][1];
    for (let x = 0; x < 256; x++) lut[x] = v;
    return lut;
  }

  // 段长 h[i] 与割线斜率 delta[i]
  const h = new Array<number>(n - 1);
  const delta = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]);
    delta[i] = (p[i + 1][1] - p[i][1]) / h[i];
  }

  // 各控制点处的切线 m[i]
  const m = new Array<number>(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const d0 = delta[i - 1];
    const d1 = delta[i];
    if (d0 * d1 <= 0) {
      // 极值点：切线归零，避免过冲
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }

  const first = p[0];
  const last = p[n - 1];
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= first[0]) {
      lut[x] = first[1];
      continue;
    }
    if (x >= last[0]) {
      lut[x] = last[1];
      continue;
    }
    while (seg < n - 2 && x > p[seg + 1][0]) seg++;

    const t = (x - p[seg][0]) / h[seg];
    const t2 = t * t;
    const t3 = t2 * t;
    lut[x] =
      (2 * t3 - 3 * t2 + 1) * p[seg][1] +
      (t3 - 2 * t2 + t) * h[seg] * m[seg] +
      (-2 * t3 + 3 * t2) * p[seg + 1][1] +
      (t3 - t2) * h[seg] * m[seg + 1];
  }
  return lut;
}

/** 主通道（rgb）与分量通道（r/g/b）串联成单个通道 LUT：out = master[chan[x]]。 */
export function composeCurveLuts(master: CurveLut, channel: CurveLut): CurveLut {
  const out = new Uint8ClampedArray(256);
  for (let x = 0; x < 256; x++) out[x] = master[channel[x]];
  return out;
}
