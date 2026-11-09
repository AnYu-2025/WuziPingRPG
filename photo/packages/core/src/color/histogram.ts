import type { PixelBuffer } from '../types.js';
import type { Histogram } from './types.js';
import { luma } from './hsv.js';

/** 直方图桶数。256 级压成 64 桶，既省内存又足够 UI 展示。 */
export const HIST_BUCKETS = 64;

const BUCKET_SCALE = HIST_BUCKETS / 256;

/**
 * 统计 RGB 与感知亮度直方图。
 *
 * 纯函数，不分配中间数组（除结果本身），可在 Worker 或主线程安全调用。
 */
export function computeHistogram(buf: PixelBuffer): Histogram {
  const r = new Uint32Array(HIST_BUCKETS);
  const g = new Uint32Array(HIST_BUCKETS);
  const b = new Uint32Array(HIST_BUCKETS);
  const lum = new Uint32Array(HIST_BUCKETS);
  const d = buf.data;
  const total = buf.width * buf.height;

  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const rv = d[p];
    const gv = d[p + 1];
    const bv = d[p + 2];
    r[(rv * BUCKET_SCALE) | 0]++;
    g[(gv * BUCKET_SCALE) | 0]++;
    b[(bv * BUCKET_SCALE) | 0]++;
    lum[(luma(rv, gv, bv) * BUCKET_SCALE) | 0]++;
  }

  return { r, g, b, luma: lum, count: total };
}

/** 取直方图的最大桶值，用于归一化绘制（至少为 1，避免除零）。 */
export function histogramPeak(hist: Histogram): number {
  let max = 1;
  for (let i = 0; i < HIST_BUCKETS; i++) {
    if (hist.r[i] > max) max = hist.r[i];
    if (hist.g[i] > max) max = hist.g[i];
    if (hist.b[i] > max) max = hist.b[i];
  }
  return max;
}

/** 计算累积分布，返回每个桶的累计占比（0..1）。用于自动色阶等算法。 */
export function cumulativeDistribution(channel: Uint32Array): Float64Array {
  const out = new Float64Array(channel.length);
  let acc = 0;
  for (let i = 0; i < channel.length; i++) {
    acc += channel[i];
    out[i] = acc;
  }
  const total = acc || 1;
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
