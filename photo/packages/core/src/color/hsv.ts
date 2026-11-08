import type { Hsv, Rgb } from './types.js';

/**
 * 三分量元组，用于在热循环中**避免对象分配**。
 * 4K 图有 830 万像素，若每次换算都新建 {h,s,v} 对象会产生数百 MB 的
 * 短命对象，把 GC 拖垮。因此本模块的所有换算都写入调用方提供的 out。
 */
export type Triple = [number, number, number];

const EPS = 0.0001;

/**
 * RGB(0..255) → HSV(h ∈ [0,360), s ∈ [0,1], v ∈ [0,1])，结果写入 out。
 * @returns 传入的 out，便于链式调用。
 */
export function rgbToHsv(r: number, g: number, b: number, out: Triple): Triple {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const d = mx - mn;

  let h = 0;
  if (d > EPS) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  out[0] = h;
  out[1] = mx < 1e-6 ? 0 : d / mx;
  out[2] = mx;
  return out;
}

/** HSV → RGB(0..255)，结果写入 out。返回值不做钳制，由调用方按需处理。 */
export function hsvToRgb(h: number, s: number, v: number, out: Triple): Triple {
  const hh = (((h % 360) + 360) % 360);
  const ss = s < 0 ? 0 : s > 1 ? 1 : s;
  const vv = v < 0 ? 0 : v;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r: number;
  let g: number;
  let b: number;
  if (hh < 60) {
    r = c; g = x; b = 0;
  } else if (hh < 120) {
    r = x; g = c; b = 0;
  } else if (hh < 180) {
    r = 0; g = c; b = x;
  } else if (hh < 240) {
    r = 0; g = x; b = c;
  } else if (hh < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  out[0] = (r + m) * 255;
  out[1] = (g + m) * 255;
  out[2] = (b + m) * 255;
  return out;
}

/** 便利版：对象进出。仅用于非热路径（配置、测试）。 */
export function rgbToHsvObject(rgb: Rgb): Hsv {
  const t: Triple = [0, 0, 0];
  rgbToHsv(rgb.r, rgb.g, rgb.b, t);
  return { h: t[0], s: t[1], v: t[2] };
}

/** 便利版：对象进出。仅用于非热路径。 */
export function hsvToRgbObject(hsv: Hsv): Rgb {
  const t: Triple = [0, 0, 0];
  hsvToRgb(hsv.h, hsv.s, hsv.v, t);
  return { r: t[0], g: t[1], b: t[2] };
}

/** 感知亮度（Rec.709 系数），0..255。 */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
