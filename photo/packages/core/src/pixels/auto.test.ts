import { describe, expect, it } from 'vitest';
import { buildLevelLut, identityLevels, isIdentityLevels, type LevelChannel } from '../color/levels.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { analyzeAuto } from './auto.js';
import { applyLevels } from './color.js';

/** 首个不同字节的下标：相同返回 -1，长度不同返回 -2。早退，避免深比较大缓冲。 */
function firstByteDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** 由像素表构造单行缓冲（统计只看 RGB，故 alpha 统一给 255）。 */
function fromPixels(rows: readonly (readonly [number, number, number])[]): PixelBuffer {
  const buf = createPixelBuffer(rows.length, 1);
  rows.forEach((p, i) => {
    buf.data[i * 4] = p[0];
    buf.data[i * 4 + 1] = p[1];
    buf.data[i * 4 + 2] = p[2];
    buf.data[i * 4 + 3] = 255;
  });
  return buf;
}

/**
 * legacy `renderer.js#mkLUT` 的逐字复刻 —— 用于把"算法一致"变成**可断言的等式**：
 *     t[v] = (v - lo) / (hi - lo) * 255 * g   （写入 Uint8ClampedArray 即 clamp+取整）
 */
function legacyLut(lo: number, hi: number, gain: number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) t[v] = ((v - lo) / (hi - lo)) * 255 * gain;
  return t;
}

describe('色阶 LUT', () => {
  it('buildLevelLut 与 legacy 公式逐字节一致（含两端钳制）', () => {
    const cases: readonly LevelChannel[] = [
      { lo: 0, hi: 255, gain: 1 },
      { lo: 12, hi: 238, gain: 1.05 },
      { lo: 40, hi: 160, gain: 0.8 },
      { lo: 30, hi: 200, gain: 1.25 },
      /* 极端：动态范围刚好卡在兜底阈值上。 */
      { lo: 100, hi: 124, gain: 1 },
    ];
    for (const c of cases) {
      const got = buildLevelLut(c);
      const want = legacyLut(c.lo, c.hi, c.gain);
      expect(firstByteDiff(got, want), `lo=${c.lo} hi=${c.hi} gain=${c.gain}`).toBe(-1);
    }
  });

  it('平坦段被钳到 0 / 255，且整条 LUT 单调不减', () => {
    const lut = buildLevelLut({ lo: 50, hi: 200, gain: 1 });
    for (let v = 0; v <= 50; v++) expect(lut[v]).toBe(0);
    for (let v = 200; v < 256; v++) expect(lut[v]).toBe(255);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
    /* 恒等参数必须逐值还原（否则"没增强"也会改图）。 */
    const id = buildLevelLut({ lo: 0, hi: 255, gain: 1 });
    for (let v = 0; v < 256; v++) expect(id[v]).toBe(v);
  });

  it('hi <= lo 的退化输入不会产生 Infinity 刷白', () => {
    const lut = buildLevelLut({ lo: 200, hi: 200, gain: 1 });
    for (const v of lut) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('applyLevels', () => {
  it('恒等时整段跳过，像素逐字节不变', () => {
    const buf = fromPixels([
      [10, 200, 30],
      [255, 0, 128],
    ]);
    const before = new Uint8ClampedArray(buf.data);
    applyLevels(buf, identityLevels());
    expect(firstByteDiff(buf.data, before)).toBe(-1);
  });

  it('对每个通道独立查表（非破坏 alpha）', () => {
    const buf = fromPixels([[100, 100, 100]]);
    applyLevels(buf, {
      r: { lo: 0, hi: 200, gain: 1 },
      g: { lo: 100, hi: 200, gain: 1 },
      b: { lo: 0, hi: 255, gain: 1 },
    });
    expect(buf.data[0]).toBe(128); // 100/200*255 = 127.5 → 128
    expect(buf.data[1]).toBe(0); // 落在 lo 以下 → 0
    expect(buf.data[2]).toBe(100); // 恒等
    expect(buf.data[3]).toBe(255); // alpha 不动
  });
});

describe('analyzeAuto（自动增强分析）', () => {
  it('无偏灰阶渐变：全通道拉满动态范围且增益为 1', () => {
    const rows: [number, number, number][] = [];
    for (let v = 0; v < 100; v++) rows.push([v, v, v]);
    const levels = analyzeAuto(fromPixels(rows));
    /* 100 像素、1% 分位 = 1 像素 → lo=0、hi=99；三通道均值相同 → 增益 1。 */
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(levels[ch].lo).toBe(0);
      expect(levels[ch].hi).toBe(99);
      expect(levels[ch].gain).toBe(1);
    }
  });

  it('红通道整体偏暗：增益向上钳到 1.25（灰世界校正，不拉成黑白）', () => {
    const rows: [number, number, number][] = [];
    for (let i = 0; i < 100; i++) rows.push([0, 100, 100]);
    const levels = analyzeAuto(fromPixels(rows));
    expect(levels.r.gain).toBe(1.25); // 想拉到 66.7 倍，被上限拦住
    expect(levels.g.gain).toBe(0.8); // 想压到 0.667，被下限拦住
    expect(levels.b.gain).toBe(0.8);
  });

  it('低动态范围图：两端向外各扩 12 级（legacy 的兜底逻辑）', () => {
    /* 全部像素都挤在 100..110，跨越 < 24 级 → 触发兜底。 */
    const rows: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) rows.push([100 + i, 100 + i, 100 + i]);
    const levels = analyzeAuto(fromPixels(rows));
    expect(levels.r.hi - levels.r.lo).toBeGreaterThanOrEqual(24);
    expect(levels.r.lo).toBeLessThan(100);
    expect(levels.r.hi).toBeGreaterThan(110);
  });

  it('幂等：同一张图多次分析结果完全相同（不读编辑状态）', () => {
    const buf = fromPixels([
      [12, 200, 40],
      [90, 15, 230],
      [200, 180, 20],
    ]);
    expect(analyzeAuto(buf)).toEqual(analyzeAuto(buf));
  });

  it('空缓冲退化为中性色阶，而不是抛错或产生 NaN', () => {
    /* 刻意手工构造，不用 createPixelBuffer —— 后者会把尺寸钳到至少 1×1。 */
    const empty: PixelBuffer = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    expect(isIdentityLevels(analyzeAuto(empty))).toBe(true);
  });

  it('纯黑 1×1：增益与端点都是有限值（除零保护生效）', () => {
    const levels = analyzeAuto(createPixelBuffer(1, 1));
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(Number.isFinite(levels[ch].gain)).toBe(true);
      expect(Number.isFinite(levels[ch].lo)).toBe(true);
      expect(Number.isFinite(levels[ch].hi)).toBe(true);
      /* 均值 0 → avgLuma/max(1,0) = 0 → 被下限钳到 0.8，而不是 Infinity 或 0。 */
      expect(levels[ch].gain).toBe(0.8);
    }
  });

  it('已经通透的中性图：结果为恒等（自动增强是空操作而非乱改）', () => {
    /* 0 与 255 各占 1/100（= 恰好等于 1% 分位），中间 1..98 铺满 →
     * lo=0、hi=255，三通道均值相同 → 增益 1 ⇒ 整组恒等。 */
    const rows: [number, number, number][] = [[0, 0, 0]];
    for (let v = 1; v <= 98; v++) rows.push([v, v, v]);
    rows.push([255, 255, 255]);
    const levels = analyzeAuto(fromPixels(rows));
    expect(isIdentityLevels(levels)).toBe(true);
  });
});
