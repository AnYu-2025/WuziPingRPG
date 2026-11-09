import { describe, expect, it } from 'vitest';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { gridBoundaries, sliceGrid } from './slice.js';

/** 造一张每个像素都不同的图 —— 位置写错、行序颠倒都会立刻暴露。 */
function pattern(width: number, height: number): PixelBuffer {
  const buf = createPixelBuffer(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      buf.data[i] = (x * 7) & 0xff;
      buf.data[i + 1] = (y * 11) & 0xff;
      buf.data[i + 2] = (x * y) & 0xff;
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

/** 把切片按 (row, col) 贴回一张空图 —— 位置写错、重叠或漏切都会对不上。 */
function reassemble(
  tiles: readonly { row: number; col: number; pixels: PixelBuffer }[],
  w: number,
  h: number,
): PixelBuffer {
  const out = createPixelBuffer(w, h);
  // 在行 / 列上累计各片的宽高（不依赖 sliceGrid 的内部边界实现）
  const cols = Math.max(...tiles.map((t) => t.col)) + 1;
  const rows = Math.max(...tiles.map((t) => t.row)) + 1;
  const colW: number[] = new Array(cols).fill(0);
  const rowH: number[] = new Array(rows).fill(0);
  for (const t of tiles) {
    colW[t.col] = t.pixels.width;
    rowH[t.row] = t.pixels.height;
  }
  for (const t of tiles) {
    let x0 = 0;
    for (let c = 0; c < t.col; c += 1) x0 += colW[c];
    let y0 = 0;
    for (let r = 0; r < t.row; r += 1) y0 += rowH[r];
    for (let y = 0; y < t.pixels.height; y += 1) {
      const from = y * t.pixels.width * 4;
      const to = ((y0 + y) * w + x0) * 4;
      out.data.set(t.pixels.data.subarray(from, from + t.pixels.width * 4), to);
    }
  }
  return out;
}

describe('gridBoundaries', () => {
  it('首尾固定，中间单调不减', () => {
    const b = gridBoundaries(1000, 3);
    expect(b[0]).toBe(0);
    expect(b[b.length - 1]).toBe(1000);
    for (let i = 1; i < b.length; i += 1) expect(b[i]).toBeGreaterThanOrEqual(b[i - 1]);
  });

  it('相邻差之和恒等于长度（不整除也不丢不超）', () => {
    for (const [len, parts] of [
      [1000, 3],
      [1001, 3],
      [7, 4],
      [3, 3],
      [2, 2],
      [1000, 7],
    ] as const) {
      const b = gridBoundaries(len, parts);
      let sum = 0;
      for (let i = 1; i < b.length; i += 1) sum += b[i] - b[i - 1];
      expect(sum).toBe(len);
      expect(b).toHaveLength(parts + 1);
    }
  });

  it('1000 切 3 列：333 / 334 / 333（误差摊在中段）', () => {
    const b = gridBoundaries(1000, 3);
    expect(b).toEqual([0, 333, 667, 1000]);
  });
});

describe('sliceGrid · 不变量', () => {
  it('任意尺寸 × 任意宫格：拼回去逐字节等于原图', () => {
    for (const [w, h] of [
      [1000, 1000],
      [1001, 667],
      [640, 480],
      [333, 333],
      [5, 7],
      [2, 2],
    ] as const) {
      const src = pattern(w, h);
      for (const [cols, rows] of [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [3, 2],
      ] as const) {
        if (cols > w || rows > h) continue;
        const tiles = sliceGrid(src, cols, rows);
        expect(tiles).toHaveLength(cols * rows);
        const back = reassemble(tiles, w, h);
        expect(back.width).toBe(w);
        expect(back.height).toBe(h);
        // 逐字节比较（大缓冲不用 toEqual，早退更快）
        expect(sameBytes(back.data, src.data)).toBe(true);
      }
    }
  });

  it('每片都是原图对应位置的拷贝（抽查 3×3 的左上与右下）', () => {
    const src = pattern(9, 9);
    const tiles = sliceGrid(src, 3, 3);
    const first = tiles[0];
    expect([first.row, first.col]).toEqual([0, 0]);
    expect(first.pixels.width).toBe(3);
    expect(pixelAt(first.pixels, 0, 0)).toEqual(pixelAt(src, 0, 0));
    expect(pixelAt(first.pixels, 2, 2)).toEqual(pixelAt(src, 2, 2));

    const last = tiles[tiles.length - 1];
    expect([last.row, last.col]).toEqual([2, 2]);
    expect(pixelAt(last.pixels, 0, 0)).toEqual(pixelAt(src, 6, 6));
    expect(pixelAt(last.pixels, 2, 2)).toEqual(pixelAt(src, 8, 8));
  });

  it('顺序是行优先：row 外层、col 内层', () => {
    const tiles = sliceGrid(pattern(30, 30), 3, 2);
    expect(tiles.map((t) => `${t.row}${t.col}`)).toEqual(['00', '01', '02', '10', '11', '12']);
  });

  it('切片是拷贝：改切片不影响原图', () => {
    const src = pattern(10, 10);
    const before = src.data[0];
    const tiles = sliceGrid(src, 2, 2);
    tiles[0].pixels.data[0] = 0xfe;
    expect(src.data[0]).toBe(before);
  });

  it('1×1 就是整张图的等价拷贝', () => {
    const src = pattern(17, 5);
    const tiles = sliceGrid(src, 1, 1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].pixels.width).toBe(17);
    expect(tiles[0].pixels.height).toBe(5);
    expect(sameBytes(tiles[0].pixels.data, src.data)).toBe(true);
  });

  it('切到极限：cols===width 时每片宽 1', () => {
    const tiles = sliceGrid(pattern(4, 4), 4, 4);
    expect(tiles).toHaveLength(16);
    for (const t of tiles) {
      expect(t.pixels.width).toBe(1);
      expect(t.pixels.height).toBe(1);
    }
  });
});

describe('sliceGrid · 拒绝静默少切', () => {
  it('列数超过像素宽 → 抛错（不能有分不到像素的列）', () => {
    expect(() => sliceGrid(pattern(2, 2), 3, 1)).toThrow(/切成 3×1/);
  });

  it('行数超过像素高 → 抛错', () => {
    expect(() => sliceGrid(pattern(2, 2), 1, 3)).toThrow(/切成 1×3/);
  });

  it('小数 / 0 被收拢到合法整数', () => {
    expect(sliceGrid(pattern(4, 4), 2.9, 0)).toHaveLength(2); // 2 列 × 1 行
  });
});

function pixelAt(buf: PixelBuffer, x: number, y: number): number[] {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
