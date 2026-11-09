import { describe, expect, it } from 'vitest';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import type { CurvePoint } from './types.js';
import {
  buildCurveLut,
  composeCurveLuts,
  identityCurve,
  isIdentityCurve,
  normalizeCurvePoints,
} from './curve.js';
import { hsvToRgb, luma, rgbToHsv, type Triple } from './hsv.js';
import {
  BAND_RADIUS,
  HSL_BANDS,
  HSL_BAND_KEYS,
  accumulateBandAdjust,
  applyBandAdjustToRgb,
  bandWeight,
  hasAnyBandAdjust,
  zeroBands,
} from './hsl.js';
import { computeHistogram, cumulativeDistribution, HIST_BUCKETS } from './histogram.js';

describe('buildCurveLut', () => {
  it('恒等曲线逐项精确：lut[x] === x', () => {
    const lut = buildCurveLut(identityCurve());
    for (let x = 0; x < 256; x++) {
      expect(lut[x], `x=${x}`).toBe(x);
    }
  });

  it('单调不减的控制点 → 单调不减的 LUT（Fritsch–Carlson 不过冲）', () => {
    const cases: CurvePoint[][] = [
      [[0, 0], [64, 20], [128, 140], [192, 220], [255, 255]],
      [[0, 0], [85, 30], [170, 200], [255, 255]],
      [[0, 0], [100, 150], [200, 180], [255, 255]],
      [[0, 20], [128, 128], [255, 235]],
      [[0, 0], [127, 20], [128, 236], [255, 255]],
    ];
    for (const pts of cases) {
      const lut = buildCurveLut(pts);
      for (let x = 1; x < 256; x++) {
        expect(lut[x], `pts=${JSON.stringify(pts)} x=${x}`).toBeGreaterThanOrEqual(lut[x - 1]);
      }
    }
  });

  it('单调不增的控制点 → 单调不增的 LUT', () => {
    const lut = buildCurveLut([[0, 255], [128, 160], [255, 0]]);
    for (let x = 1; x < 256; x++) {
      expect(lut[x]).toBeLessThanOrEqual(lut[x - 1]);
    }
  });

  it('S 型曲线增强对比：暗部压低、亮部抬高、中灰基本不动', () => {
    const lut = buildCurveLut([[0, 0], [64, 36], [128, 128], [192, 220], [255, 255]]);
    expect(lut[64]).toBeLessThan(64);
    expect(lut[192]).toBeGreaterThan(192);
    expect(lut[128]).toBe(128);
  });

  it('定义域外取端点值', () => {
    const lut = buildCurveLut([[30, 80], [200, 220]]);
    for (let x = 0; x <= 30; x++) expect(lut[x]).toBe(80);
    for (let x = 200; x < 256; x++) expect(lut[x]).toBe(220);
  });

  it('单点控制等价于常量输出', () => {
    const lut = buildCurveLut([[128, 77]]);
    for (let x = 0; x < 256; x++) expect(lut[x]).toBe(77);
  });

  it('空输入回退为恒等曲线', () => {
    const lut = buildCurveLut([]);
    for (let x = 0; x < 256; x++) expect(lut[x]).toBe(x);
  });

  it('输入点顺序不影响结果', () => {
    const a = buildCurveLut([[255, 255], [0, 0], [128, 96]]);
    const b = buildCurveLut([[128, 96], [0, 0], [255, 255]]);
    for (let x = 0; x < 256; x++) expect(a[x]).toBe(b[x]);
  });

  it('同 x 的重复点被去重（保留 y 升序的第一个）', () => {
    const deduped = buildCurveLut([[0, 0], [128, 40], [128, 96], [255, 255]]);
    const ref = buildCurveLut([[0, 0], [128, 40], [255, 255]]);
    for (let x = 0; x < 256; x++) expect(deduped[x]).toBe(ref[x]);
  });

  it('坐标越界被钳制到 0..255', () => {
    const lut = buildCurveLut([[-50, -20], [300, 400]]);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });
});

describe('normalizeCurvePoints / isIdentityCurve', () => {
  it('排序并去重同 x', () => {
    const p = normalizeCurvePoints([[200, 10], [0, 0], [200, 99], [100, 50]]);
    expect(p).toEqual([[0, 0], [100, 50], [200, 10]]);
  });

  it('恒等判定', () => {
    expect(isIdentityCurve(identityCurve())).toBe(true);
    expect(isIdentityCurve([[0, 0], [255, 254]])).toBe(false);
    expect(isIdentityCurve([[0, 0], [128, 128], [255, 255]])).toBe(false);
  });
});

describe('composeCurveLuts', () => {
  it('分量通道与主通道串联', () => {
    const master = buildCurveLut([[0, 0], [255, 128]]); // 压暗
    const chan = buildCurveLut(identityCurve());
    const out = composeCurveLuts(master, chan);
    for (let x = 0; x < 256; x++) expect(out[x]).toBe(master[x]);
  });
});

describe('rgbToHsv / hsvToRgb', () => {
  it('已知色值', () => {
    const t: Triple = [0, 0, 0];
    rgbToHsv(255, 0, 0, t);
    expect(t[0]).toBeCloseTo(0, 4);
    expect(t[1]).toBeCloseTo(1, 4);
    expect(t[2]).toBeCloseTo(1, 4);

    rgbToHsv(0, 255, 0, t);
    expect(t[0]).toBeCloseTo(120, 4);

    rgbToHsv(0, 0, 255, t);
    expect(t[0]).toBeCloseTo(240, 4);

    rgbToHsv(128, 128, 128, t);
    expect(t[1]).toBe(0);
  });

  it('往返误差不超过 1 级', () => {
    const hsv: Triple = [0, 0, 0];
    const rgb: Triple = [0, 0, 0];
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          rgbToHsv(r, g, b, hsv);
          hsvToRgb(hsv[0], hsv[1], hsv[2], rgb);
          expect(Math.abs(rgb[0] - r), `rgb(${r},${g},${b})`).toBeLessThanOrEqual(1);
          expect(Math.abs(rgb[1] - g), `rgb(${r},${g},${b})`).toBeLessThanOrEqual(1);
          expect(Math.abs(rgb[2] - b), `rgb(${r},${g},${b})`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('负角度与超范围角度归一化', () => {
    const a: Triple = [0, 0, 0];
    const b: Triple = [0, 0, 0];
    hsvToRgb(-90, 1, 1, a);
    hsvToRgb(270, 1, 1, b);
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
    expect(a[2]).toBeCloseTo(b[2], 6);
  });
});

describe('bandWeight', () => {
  it('中心权重为 1，半径处为 0', () => {
    expect(bandWeight(0, 0)).toBeCloseTo(1, 6);
    expect(bandWeight(BAND_RADIUS, 0)).toBeCloseTo(0, 6);
    expect(bandWeight(BAND_RADIUS + 30, 0)).toBe(0);
  });

  it('半程权重为 0.5', () => {
    expect(bandWeight(30, 0)).toBeCloseTo(0.5, 6);
  });

  it('正确处理跨越 0/360 的色相', () => {
    expect(bandWeight(350, 0)).toBeCloseTo(bandWeight(10, 0), 6);
    expect(bandWeight(350, 0)).toBeGreaterThan(0.9);
  });

  it('权重随距离单调不增', () => {
    let prev = Infinity;
    for (let d = 0; d <= BAND_RADIUS; d += 2) {
      const w = bandWeight(d, 0);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
  });
});

describe('accumulateBandAdjust / applyBandAdjustToRgb', () => {
  it('全零调整时 hasAnyBandAdjust 为 false', () => {
    expect(hasAnyBandAdjust(zeroBands())).toBe(false);
  });

  it('任一带非零即判定为污染', () => {
    const b = zeroBands();
    b.blue = { h: 0, s: 20, l: 0 };
    expect(hasAnyBandAdjust(b)).toBe(true);
  });

  it('中心色相获得满权重', () => {
    const adjusts = zeroBands();
    adjusts.red = { h: 0, s: 50, l: 0 };
    const out: Triple = [0, 0, 0];
    accumulateBandAdjust(0, adjusts, out);
    expect(out[1]).toBeCloseTo(50, 5);
  });

  it('相邻色带平滑叠加，且无断层', () => {
    const adjusts = zeroBands();
    adjusts.red = { h: 0, s: 100, l: 0 };
    adjusts.orange = { h: 0, s: 100, l: 0 };
    const out: Triple = [0, 0, 0];

    // 0° 是红带中心：红满权重 1 + 橙权重 0.5 → 150
    accumulateBandAdjust(0, adjusts, out);
    expect(out[1]).toBeCloseTo(150, 5);

    // 30° 是橙带中心：红权重 0.5 + 橙满权重 1 → 150
    accumulateBandAdjust(30, adjusts, out);
    expect(out[1]).toBeCloseTo(150, 5);

    // 15° 才是红橙中点：两边各 (cos45°+1)/2 ≈ 0.8536 → 170.71
    accumulateBandAdjust(15, adjusts, out);
    expect(out[1]).toBeCloseTo(170.71, 1);
  });

  it('色相全圈扫描：相邻 1° 的变化受权重斜率上界约束，不存在断层', () => {
    // 权重函数 w(θ) = (cos(π·Δ/60) + 1) / 2，其导数绝对值上界为 π/120 ≈ 0.02618 /度。
    // 两个色带同时生效，最坏叠加为 2 × 0.02618 × 100(调整量) ≈ 5.24。
    // 若权重退化为阶跃（而非余弦平滑），相邻 1° 会出现数十级的跳变，本用例即会失败。
    const adjusts = zeroBands();
    adjusts.red = { h: 0, s: 100, l: 0 };
    adjusts.orange = { h: 0, s: 100, l: 0 };

    const out: Triple = [0, 0, 0];
    accumulateBandAdjust(0, adjusts, out);
    let prev = out[1];
    let maxDelta = 0;
    for (let hue = 1; hue <= 360; hue++) {
      accumulateBandAdjust(hue, adjusts, out);
      maxDelta = Math.max(maxDelta, Math.abs(out[1] - prev));
      prev = out[1];
    }
    expect(maxDelta).toBeLessThan(6);
  });

  it('低饱和像素（灰）不被染色', () => {
    const adjusts = zeroBands();
    adjusts.red = { h: 0, s: 100, l: 0 };
    const out: Triple = [0, 0, 0];
    applyBandAdjustToRgb(128, 128, 128, adjusts, out);
    expect([out[0], out[1], out[2]]).toEqual([128, 128, 128]);
  });

  it('红色像素在红色带提饱和后饱和度上升', () => {
    const adjusts = zeroBands();
    adjusts.red = { h: 0, s: 50, l: 0 };
    const before: Triple = [0, 0, 0];
    const after: Triple = [0, 0, 0];
    rgbToHsv(200, 100, 100, before);
    applyBandAdjustToRgb(200, 100, 100, adjusts, after);
    rgbToHsv(after[0], after[1], after[2], after);
    expect(after[1]).toBeGreaterThan(before[1]);
  });

  it('零调整时像素原样返回', () => {
    const out: Triple = [0, 0, 0];
    applyBandAdjustToRgb(200, 100, 50, zeroBands(), out);
    expect([out[0], out[1], out[2]]).toEqual([200, 100, 50]);
  });

  it('输出恒在 0..255 合法范围', () => {
    const adjusts = zeroBands();
    for (const k of HSL_BAND_KEYS) adjusts[k] = { h: 30, s: 100, l: 100 };
    const out: Triple = [0, 0, 0];
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          applyBandAdjustToRgb(r, g, b, adjusts, out);
          for (const v of out) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
          }
        }
      }
    }
  });

  it('色带表覆盖全部八个带且色相唯一', () => {
    expect(HSL_BANDS.length).toBe(8);
    const hues = new Set(HSL_BANDS.map((b) => b.hue));
    expect(hues.size).toBe(8);
  });
});

describe('computeHistogram', () => {
  function solid(r: number, g: number, b: number, w = 4, h = 4): PixelBuffer {
    const buf = createPixelBuffer(w, h);
    for (let i = 0; i < buf.data.length; i += 4) {
      buf.data[i] = r;
      buf.data[i + 1] = g;
      buf.data[i + 2] = b;
      buf.data[i + 3] = 255;
    }
    return buf;
  }

  it('统计像素总数', () => {
    const hist = computeHistogram(solid(10, 20, 30, 8, 8));
    expect(hist.count).toBe(64);
    const sum = hist.r.reduce((a, v) => a + v, 0);
    expect(sum).toBe(64);
  });

  it('纯黑图全部落在第 0 桶', () => {
    const hist = computeHistogram(solid(0, 0, 0));
    expect(hist.luma[0]).toBe(16);
    expect(hist.luma[HIST_BUCKETS - 1]).toBe(0);
  });

  it('纯白图全部落在最高桶', () => {
    const hist = computeHistogram(solid(255, 255, 255));
    expect(hist.luma[HIST_BUCKETS - 1]).toBe(16);
    expect(hist.r[HIST_BUCKETS - 1]).toBe(16);
  });

  it('累积分布末尾为 1', () => {
    const hist = computeHistogram(solid(128, 128, 128));
    const cdf = cumulativeDistribution(hist.luma);
    expect(cdf[cdf.length - 1]).toBeCloseTo(1, 10);
  });
});

describe('luma', () => {
  it('Rec.709 权重之和为 1', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 6);
    expect(luma(0, 0, 0)).toBe(0);
  });
});
