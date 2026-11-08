import type { PixelBuffer } from '../types.js';
import { clamp01, clamp255 } from './sampling.js';

/** 解析 `#rrggbb` / `#rgb` 颜色为 [r, g, b]，无法解析时返回黑色。 */
export function parseHexColor(hex: string): [number, number, number] {
  const s = hex.trim();
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (m3) {
    const c = m3[1];
    return [
      parseInt(c[0] + c[0], 16),
      parseInt(c[1] + c[1], 16),
      parseInt(c[2] + c[2], 16),
    ];
  }
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m6) {
    const c = m6[1];
    return [
      parseInt(c.slice(0, 2), 16),
      parseInt(c.slice(2, 4), 16),
      parseInt(c.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

/** 用不透明纯色填满整块缓冲。 */
export function fill(buf: PixelBuffer, r: number, g: number, b: number, a = 255): void {
  const d = buf.data;
  const rr = clamp255(r);
  const gg = clamp255(g);
  const bb = clamp255(b);
  const aa = clamp255(a);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rr;
    d[i + 1] = gg;
    d[i + 2] = bb;
    d[i + 3] = aa;
  }
}

/**
 * overlay 混合模式（与 Canvas2D 的 `globalCompositeOperation='overlay'` 同义）：
 *
 *     base < 0.5 ：  2·base·blend
 *     base >= 0.5：  1 - 2·(1-base)·(1-blend)
 *
 * 结果再按 alpha 与 base 做线性插值，等价于"以 alpha 为不透明度的 overlay 图层"。
 * legacy 的暖色调（warm）就是 `overlay` + 纯色 + globalAlpha，这里复刻同一语义，
 * 但改为**纯像素运算**，因此预览与导出必然一致。
 */
export function overlayFill(buf: PixelBuffer, r: number, g: number, b: number, alpha: number): void {
  const a = clamp01(alpha);
  if (a <= 0) return;
  const br = r / 255;
  const bg = g / 255;
  const bb = b / 255;
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = d[i + c] / 255;
      const blend = c === 0 ? br : c === 1 ? bg : bb;
      const ov = base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);
      d[i + c] = clamp255((base + (ov - base) * a) * 255);
    }
  }
}

/** 普通 alpha 合成：用纯色以 alpha 覆盖整块缓冲（vignette / fog 用）。 */
export function alphaFill(buf: PixelBuffer, r: number, g: number, b: number, alphaAt: (i: number) => number): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = clamp01(alphaAt(i >> 2));
    if (a <= 0) continue;
    d[i] = clamp255(d[i] + (r - d[i]) * a);
    d[i + 1] = clamp255(d[i + 1] + (g - d[i + 1]) * a);
    d[i + 2] = clamp255(d[i + 2] + (b - d[i + 2]) * a);
  }
}

/** 把源缓冲按 alpha 拷贝到目标缓冲的 (dx, dy) 处，越界部分裁掉。 */
export function blit(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number, alpha = 1): void {
  const a = clamp01(alpha);
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(dst.width, Math.floor(dx) + src.width);
  const y1 = Math.min(dst.height, Math.floor(dy) + src.height);
  const sd = src.data;
  const dd = dst.data;
  for (let y = y0; y < y1; y++) {
    const sy = y - Math.floor(dy);
    for (let x = x0; x < x1; x++) {
      const sx = x - Math.floor(dx);
      const si = (sy * src.width + sx) * 4;
      const di = (y * dst.width + x) * 4;
      const sa = (sd[si + 3] / 255) * a;
      if (sa <= 0) continue;
      dd[di] = clamp255(dd[di] + (sd[si] - dd[di]) * sa);
      dd[di + 1] = clamp255(dd[di + 1] + (sd[si + 1] - dd[di + 1]) * sa);
      dd[di + 2] = clamp255(dd[di + 2] + (sd[si + 2] - dd[di + 2]) * sa);
      dd[di + 3] = clamp255(dd[di + 3] + (255 - dd[di + 3]) * sa);
    }
  }
}

/**
 * 画一条线段（带宽度），用于雨丝。
 * 做法：沿线段以半像素步长游走，在半径 width/2 的圆盘内按 alpha 混合。
 * 完全确定性 —— 同样的输入必得同样的像素，预览与导出不会出现
 * "同一场雨在两处长得不一样"的问题。
 */
export function drawLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
  width: number,
): void {
  const a = clamp01(alpha);
  if (a <= 0) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return;
  const steps = Math.max(1, Math.ceil(len * 2));
  const rad = Math.max(0.5, width / 2);
  const d = buf.data;
  const hit = (px: number, py: number): void => {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (cx < 0 || cy < 0 || cx >= buf.width || cy >= buf.height) return;
    const i = (cy * buf.width + cx) * 4;
    d[i] = clamp255(d[i] + (r - d[i]) * a);
    d[i + 1] = clamp255(d[i + 1] + (g - d[i + 1]) * a);
    d[i + 2] = clamp255(d[i + 2] + (b - d[i + 2]) * a);
  };
  const span = Math.max(1, Math.ceil(rad * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    for (let oy = -span; oy <= span; oy++) {
      for (let ox = -span; ox <= span; ox++) {
        if (ox * ox + oy * oy > rad * rad) continue;
        hit(px + ox, py + oy);
      }
    }
  }
}
