/**
 * 均分切片 —— 把一张图按 `cols × rows` 切成互不重叠、且**覆盖全部像素**的小块。
 *
 * 用途只有一个但很实在：切图模式的「分片导出」。用户看到 3×3 的宫格线，
 * 点导出时就该拿到 9 张能直接发朋友圈的方图。
 *
 * ── 为什么边界用 round 而不是整除 ────────────────────────────────
 * 1000 / 3 = 333.33…。若把每片宽度取 `floor(1000/3) = 333`，三片只覆盖 999 列，
 * **最右边一列像素凭空消失**（用户不会发现，但拼回去就是缺一条）；
 * 若取 `ceil = 334`，三片覆盖 1002 列，**越界**。
 * 于是按 `round(i · L / n)` 算累计边界：`0, 333, 667, 1000` ——
 * 每片宽度 333/334/333，误差均匀摊开，`Σ宽度 = L` 恒成立，
 * 像素既不会丢也不会重复。这是所有可靠的图片切片器共用的做法。
 */

import { createPixelBuffer, type PixelBuffer } from '../types.js';

/** 一块切片在宫格中的位置（`row` / `col` 均为 0 起算）。 */
export interface GridTile {
  readonly row: number;
  readonly col: number;
  readonly pixels: PixelBuffer;
}

/**
 * 计算 `[0, length]` 上的 `parts + 1` 个累计边界。
 *
 * 首项恒为 0、末项恒为 `length`，中间项按比例取整 —— 因此边界单调不减、
 * 且相邻差的累加必然精确等于 `length`。
 */
export function gridBoundaries(length: number, parts: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= parts; i += 1) {
    out.push(Math.round((i * length) / parts));
  }
  return out;
}

/**
 * 按 `cols × rows` 均分切片，返回**行优先**（`row` 外层、`col` 内层）的切片表。
 *
 * 行优先这个顺序是有意的：调用方用它生成 `_r{row}c{col}` 这样的文件名，
 * 按数组顺序写进 ZIP 后，解压出来的排列与用户看到的宫格一致。
 *
 * `cols > width` 或 `rows > height` 时**抛错**而不是悄悄少切几片 ——
 * 一张 2 像素宽的图切成 3 列，必然有列分不到像素，那说明调用方算错了，
 * 不该由这里含糊过去（"绝不静默"是内核的一贯取向）。
 */
export function sliceGrid(source: PixelBuffer, cols: number, rows: number): readonly GridTile[] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));

  if (c > source.width || r > source.height) {
    throw new Error(
      `无法把 ${source.width}×${source.height} 的图切成 ${c}×${r}：` +
        `每个方向至少要 ${c > r ? c : r} 像素。`,
    );
  }

  const xs = gridBoundaries(source.width, c);
  const ys = gridBoundaries(source.height, r);
  const tiles: GridTile[] = [];

  for (let row = 0; row < r; row += 1) {
    const y0 = ys[row];
    const y1 = ys[row + 1];
    for (let col = 0; col < c; col += 1) {
      const x0 = xs[col];
      const x1 = xs[col + 1];
      tiles.push({ row, col, pixels: cropRegion(source, x0, y0, x1 - x0, y1 - y0) });
    }
  }

  return tiles;
}

/** 复制一块矩形区域到新缓冲（不做任何插值 —— 切片是取，不是缩放）。 */
function cropRegion(
  source: PixelBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
): PixelBuffer {
  const out = createPixelBuffer(width, height);
  const src = source.data;
  const dst = out.data;
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * source.width + x) * 4;
    const to = row * width * 4;
    /* 用 set 而不是手写循环：转成 subarray 视图后一次拷贝，
     * 长度相等的同类型数组拷贝是规范保证的快速路径。 */
    dst.set(src.subarray(from, from + width * 4), to);
  }
  return out;
}
