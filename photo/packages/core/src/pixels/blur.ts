import { createPixelBuffer, type PixelBuffer } from '../types.js';

/**
 * 盒式模糊所需的 scratch 长度（元素个数）。
 * 需要两块 RGB 平面：横向中间结果 + 纵向最终结果。
 */
export function boxScratchLength(w: number, h: number): number {
  return w * h * 3 * 2;
}

/**
 * 滑动窗口盒式模糊（O(n)，与半径无关）。
 *
 * 返回值是长度 w·h·3 的 RGB 平面（Float32），与 legacy 的 boxBlur 同构 ——
 * 磨皮（表面模糊）与去雾（局部对比）都以它为低通基准。
 *
 * @param scratch 可选的复用缓冲，长度需 >= boxScratchLength(w,h)。
 *   legacy 每次调用都新分配 `Float32Array(w·h·3)`：6000×4000 时单次 288 MB
 *   （见 P1-4）。执行层（executePlan / RenderCache）持有一块 scratch 并复用，
 *   把"每阶段一次分配"降为"每次渲染一次分配"。不传则退化为临时分配，
 *   保持纯函数语义。
 *
 * 边界用**边缘钳制**（clamp），因此模糊后的图像边缘不会变暗，
 * 这正是不做钳制时会出现"四周发黑"的原因。
 */
export function boxBlur(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  scratch?: Float32Array,
): Float32Array {
  const n = w * h;
  const n3 = n * 3;
  const need = n3 * 2;
  const pool = scratch !== undefined && scratch.length >= need ? scratch : new Float32Array(need);
  const tmp = pool.subarray(0, n3);
  const out = pool.subarray(n3, n3 * 2);
  const rad = Math.max(1, Math.round(r));
  const div = 2 * rad + 1;

  // 横向
  for (let y = 0; y < h; y++) {
    let ar = 0;
    let ag = 0;
    let ab = 0;
    for (let x = -rad; x <= rad; x++) {
      const xx = Math.min(w - 1, Math.max(0, x));
      const j = (y * w + xx) * 4;
      ar += data[j];
      ag += data[j + 1];
      ab += data[j + 2];
    }
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 3;
      tmp[j] = ar / div;
      tmp[j + 1] = ag / div;
      tmp[j + 2] = ab / div;
      const jo = (y * w + Math.max(0, x - rad)) * 4;
      const jn = (y * w + Math.min(w - 1, x + rad + 1)) * 4;
      ar += data[jn] - data[jo];
      ag += data[jn + 1] - data[jo + 1];
      ab += data[jn + 2] - data[jo + 2];
    }
  }

  // 纵向
  for (let x = 0; x < w; x++) {
    let ar = 0;
    let ag = 0;
    let ab = 0;
    for (let y = -rad; y <= rad; y++) {
      const yy = Math.min(h - 1, Math.max(0, y));
      const j = (yy * w + x) * 3;
      ar += tmp[j];
      ag += tmp[j + 1];
      ab += tmp[j + 2];
    }
    for (let y = 0; y < h; y++) {
      const j = (y * w + x) * 3;
      out[j] = ar / div;
      out[j + 1] = ag / div;
      out[j + 2] = ab / div;
      const jo = (Math.max(0, y - rad) * w + x) * 3;
      const jn = (Math.min(h - 1, y + rad + 1) * w + x) * 3;
      ar += tmp[jn] - tmp[jo];
      ag += tmp[jn + 1] - tmp[jo + 1];
      ab += tmp[jn + 2] - tmp[jo + 2];
    }
  }

  return out;
}

/** 对整块缓冲做盒式模糊，返回新缓冲（alpha 保持不变）。 */
export function blurBuffer(src: PixelBuffer, radius: number, scratch?: Float32Array): PixelBuffer {
  const { width: w, height: h } = src;
  const rgb = boxBlur(src.data, w, h, radius, scratch);
  const out = createPixelBuffer(w, h);
  const od = out.data;
  const sd = src.data;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const j = p * 3;
    od[i] = rgb[j];
    od[i + 1] = rgb[j + 1];
    od[i + 2] = rgb[j + 2];
    od[i + 3] = sd[i + 3];
  }
  return out;
}
