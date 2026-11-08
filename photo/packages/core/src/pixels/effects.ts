import type { PixelBuffer } from '../types.js';
import { boxBlur } from './blur.js';
import { alphaFill, drawLine } from './compose.js';
import { clamp01, clamp255 } from './sampling.js';

/**
 * 重负载像素运算的像素数上限。
 *
 * legacy 是在此处**静默 return**（enhanceCanvas / applyGrade），
 * 用户完全不知道自己的图为什么"没效果"（P1-3）。
 * 现在这个常量由 **pipeline 在构建计划时读取并转为显式 PlanWarning**，
 * 运算本身不再偷偷跳过 —— 上层的"是否执行"由计划统一裁决。
 */
export const MAX_HEAVY_PIXELS = 30_000_000;

/** 确定性伪随机（mulberry32）。固定种子 → 颗粒/雨丝图案跨帧稳定不闪烁。 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 磨皮柔肤：保边表面模糊。
 * 只对"与低通的差小于阈值 T"的像素做平滑，因此低反差皮肤被磨平、
 * 高反差边缘（发丝、睫毛、轮廓）保持不变。
 *
 * 与 legacy 的差异（有意为之，属修正）：legacy 在千万像素以上会**降到
 * 半尺寸**处理再放大回去 —— 这会让预览与导出、大图与小图得到不同观感，
 * 正是病根 1 的又一处症状。这里始终全分辨率处理，结果只取决于图像内容。
 *
 * @param scratch 可选的复用缓冲（见 boxBlur），用于消除每次调用的巨量分配。
 */
export function soften(buf: PixelBuffer, amount: number, scratch?: Float32Array): void {
  const amt = amount / 100;
  if (amt <= 0) return;
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;
  const r = Math.max(2, Math.min(9, Math.round(Math.min(w, h) / 300)));
  const blur = boxBlur(d, w, h, r, scratch);
  const T = 22;
  const n = w * h;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const j = p * 3;
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const bl = (blur[j] + blur[j + 1] + blur[j + 2]) / 3;
    let k = 1 - Math.abs(lum - bl) / T;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    k = k * k * (3 - 2 * k);
    const b = k * amt;
    if (b <= 0.001) continue;
    d[i] = clamp255(d[i] + (blur[j] - d[i]) * b);
    d[i + 1] = clamp255(d[i + 1] + (blur[j + 1] - d[i + 1]) * b);
    d[i + 2] = clamp255(d[i + 2] + (blur[j + 2] - d[i + 2]) * b);
  }
}

/**
 * 锐化 + 去雾清晰（像素级）。
 *
 * 去雾：局部对比拉伸（原值 - 低通）× 强度 + 黑白场重映射 + 微饱和提升。
 * 锐化：3×3 拉普拉斯核（中心正、上下左右负），邻域边缘钳制。
 *
 * 与 legacy 的差异（属**修正**）：legacy 的 enhanceCanvas 在同一个循环里
 * 先用去雾改写 d，又用"去雾前的副本 src"做锐化卷积，结果当 sharpen>0 时
 * **去雾的改动会被锐化结果整体覆盖**，即 dehaze 静默失效。这里改为
 * 正确的顺序语义：先完成去雾，再在去雾结果上做锐化。
 *
 * @param scratch 可选的复用缓冲（见 boxBlur）。
 */
export function enhance(
  buf: PixelBuffer,
  sharpen: number,
  dehaze: number,
  scratch?: Float32Array,
): void {
  const shp = sharpen / 100;
  const deh = dehaze / 100;
  if (shp <= 0 && deh <= 0) return;
  const w = buf.width;
  const h = buf.height;
  if (w * h > MAX_HEAVY_PIXELS) return;
  const d = buf.data;

  if (deh > 0) {
    const radius = Math.max(4, Math.round(Math.min(w, h) / 60));
    const blur = boxBlur(d, w, h, radius, scratch);
    const amt = deh * 0.85;
    const bp = deh * 38;
    const wp = 255 - deh * 14;
    const span = Math.max(1, wp - bp);
    const satBoost = 1 + deh * 0.35;
    for (let i = 0; i < d.length; i += 4) {
      const j = (i >> 2) * 3;
      let r = d[i] + (d[i] - blur[j]) * amt;
      let g = d[i + 1] + (d[i + 1] - blur[j + 1]) * amt;
      let b = d[i + 2] + (d[i + 2] - blur[j + 2]) * amt;
      r = ((r - bp) / span) * 255;
      g = ((g - bp) / span) * 255;
      b = ((b - bp) / span) * 255;
      const avg = (r + g + b) / 3;
      d[i] = clamp255(avg + (r - avg) * satBoost);
      d[i + 1] = clamp255(avg + (g - avg) * satBoost);
      d[i + 2] = clamp255(avg + (b - avg) * satBoost);
    }
  }

  if (shp > 0) {
    const src = Uint8ClampedArray.from(d);
    const core = 1 + 4 * shp * 0.9;
    const side = -shp * 0.9;
    const at = (xx: number, yy: number): number => {
      const cx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
      const cy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
      return (cy * w + cx) * 4;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c0 = at(x, y);
        const cl = at(x - 1, y);
        const cr = at(x + 1, y);
        const cu = at(x, y - 1);
        const cd = at(x, y + 1);
        d[c0] = clamp255(src[c0] * core + (src[cl] + src[cr] + src[cu] + src[cd]) * side);
        d[c0 + 1] = clamp255(
          src[c0 + 1] * core + (src[cl + 1] + src[cr + 1] + src[cu + 1] + src[cd + 1]) * side,
        );
        d[c0 + 2] = clamp255(
          src[c0 + 2] * core + (src[cl + 2] + src[cr + 2] + src[cu + 2] + src[cd + 2]) * side,
        );
      }
    }
  }
}

/**
 * 暗角：以画布中心为圆心的径向变暗。
 * 复刻 Canvas2D radialGradient 语义：内半径 min(w,h)·0.3 处不透明度为 0，
 * 外半径 max(w,h)·0.75 处达 |amount|/140，中间线性过渡。
 */
export function vignette(buf: PixelBuffer, amount: number): void {
  if (amount <= 0) return;
  const w = buf.width;
  const h = buf.height;
  const cx = w / 2;
  const cy = h / 2;
  const r0 = Math.min(w, h) * 0.3;
  const r1 = Math.max(w, h) * 0.75;
  const maxA = amount / 140;
  const span = Math.max(1e-6, r1 - r0);
  alphaFill(buf, 0, 0, 0, (p) => {
    const px = (p % w) + 0.5;
    const py = Math.floor(p / w) + 0.5;
    const dist = Math.hypot(px - cx, py - cy);
    const t = clamp01((dist - r0) / span);
    return t * maxA;
  });
}

/**
 * 颗粒：确定性随机噪点。
 *
 * 与 legacy 的差异（属**统一**）：legacy 预览用固定点数 `grain·60`，
 * 导出用 `grain·max(w,h)/28` —— 同一张图在屏幕上和导出的颗粒密度不同，
 * 又是病根 1 的一处漂移。这里统一为按图幅缩放的后者。
 */
export function grain(buf: PixelBuffer, amount: number): void {
  if (amount <= 0) return;
  const w = buf.width;
  const h = buf.height;
  const d = buf.data;
  const alpha = clamp01(amount / 160);
  const n = Math.round((amount * Math.max(w, h)) / 28);
  const R = makeRng(1234567);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(R() * w);
    const y = Math.floor(R() * h);
    if (x < 0 || y < 0 || x >= w || y >= h) {
      R();
      R();
      continue;
    }
    const white = R() > 0.5;
    const v = white ? 255 : 0;
    const j = (y * w + x) * 4;
    d[j] = clamp255(d[j] + (v - d[j]) * alpha);
    d[j + 1] = clamp255(d[j + 1] + (v - d[j + 1]) * alpha);
    d[j + 2] = clamp255(d[j + 2] + (v - d[j + 2]) * alpha);
  }
}

/** 雾气：自上而下渐浓的冷白叠加。 */
function fog(buf: PixelBuffer, amount: number): void {
  if (amount <= 0) return;
  const h = buf.height;
  const a = amount / 100;
  const stops: readonly (readonly [number, number])[] = [
    [0, a * 0.18],
    [0.55, a * 0.3],
    [1, a * 0.55],
  ];
  alphaFill(buf, 235, 242, 248, (p) => {
    const t = clamp01((Math.floor(p / buf.width) + 0.5) / h);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        lo = stops[i];
        hi = stops[i + 1];
        break;
      }
    }
    const seg = hi[0] - lo[0];
    const k = seg <= 0 ? 0 : (t - lo[0]) / seg;
    return lo[1] + (hi[1] - lo[1]) * k;
  });
}

/** 雨丝：固定种子的斜向细线。 */
function rain(buf: PixelBuffer, amount: number): void {
  if (amount <= 0) return;
  const w = buf.width;
  const h = buf.height;
  const R = makeRng(20260614);
  const n = Math.min(8000, Math.round((amount * Math.max(w, h)) / 45));
  const lenBase = h / 22;
  const ang = -0.28;
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const y = R() * h;
    const len = lenBase * (0.6 + R() * 0.8);
    const alpha = 0.1 + R() * 0.2;
    const lineWidth = Math.max(1, (w / 1400) * (0.8 + R() * 0.8));
    drawLine(buf, x, y, x + Math.sin(ang) * len, y + Math.cos(ang) * len, 210, 228, 245, alpha, lineWidth);
  }
}

/** 雨天氛围：先雾后雨（与 legacy 的绘制顺序一致）。 */
export function weather(buf: PixelBuffer, rainAmount: number, fogAmount: number): void {
  fog(buf, fogAmount);
  rain(buf, rainAmount);
}
