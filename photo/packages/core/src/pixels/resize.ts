import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { sampleBilinear } from './sampling.js';

/** 拷贝一块缓冲。 */
export function cloneBuffer(src: PixelBuffer): PixelBuffer {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

function copyBuffer(src: PixelBuffer): PixelBuffer {
  return cloneBuffer(src);
}

/**
 * 水平重采样。
 * 缩小（dstN < srcN）走**面积平均**（box filter），放大走双线性。
 *
 * 之所以不能一律用双线性：把 4000px 的原图直接降到 1400px 时，
 * 双线性只取 2 个邻居，会丢失高频并产生锯齿；面积平均把每个目标像素
 * 覆盖到的所有源像素等权平均，才是正确的缩放质量（对应 legacy 依赖
 * Canvas2D 的 imageSmoothing 才能得到的观感）。
 */
function resizeHorizontal(src: PixelBuffer, dstW: number): PixelBuffer {
  const { width: srcW, height: h, data } = src;
  const out = createPixelBuffer(dstW, h);
  const od = out.data;

  if (dstW === srcW) {
    od.set(data);
    return out;
  }

  const shrink = dstW < srcW;
  const ratio = srcW / dstW;

  if (shrink) {
    for (let y = 0; y < h; y++) {
      const row = y * srcW;
      for (let x = 0; x < dstW; x++) {
        const x0 = x * ratio;
        const x1 = (x + 1) * ratio;
        const i0 = Math.floor(x0);
        const i1 = Math.min(srcW, Math.ceil(x1));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let wsum = 0;
        for (let i = i0; i < i1; i++) {
          const cover = Math.min(x1, i + 1) - Math.max(x0, i);
          if (cover <= 0) continue;
          const j = (row + i) * 4;
          r += data[j] * cover;
          g += data[j + 1] * cover;
          b += data[j + 2] * cover;
          a += data[j + 3] * cover;
          wsum += cover;
        }
        const k = wsum > 0 ? 1 / wsum : 0;
        const o = (y * dstW + x) * 4;
        od[o] = r * k;
        od[o + 1] = g * k;
        od[o + 2] = b * k;
        od[o + 3] = a * k;
      }
    }
    return out;
  }

  // 放大：逐行双线性
  const tmpSrc = { width: srcW, height: h, data } as PixelBuffer;
  const scratch = new Float64Array(4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < dstW; x++) {
      const u = ((x + 0.5) * srcW) / dstW;
      sampleBilinear(tmpSrc.data, srcW, h, u, y + 0.5, scratch);
      const o = (y * dstW + x) * 4;
      od[o] = scratch[0];
      od[o + 1] = scratch[1];
      od[o + 2] = scratch[2];
      od[o + 3] = scratch[3];
    }
  }
  return out;
}

/** 垂直重采样。语义同水平方向。 */
function resizeVertical(src: PixelBuffer, dstH: number): PixelBuffer {
  const { width: w, height: srcH, data } = src;
  const out = createPixelBuffer(w, dstH);
  const od = out.data;

  if (dstH === srcH) {
    od.set(data);
    return out;
  }

  const shrink = dstH < srcH;
  const ratio = srcH / dstH;

  if (shrink) {
    for (let y = 0; y < dstH; y++) {
      const y0 = y * ratio;
      const y1 = (y + 1) * ratio;
      const j0 = Math.floor(y0);
      const j1 = Math.min(srcH, Math.ceil(y1));
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let wsum = 0;
        for (let j = j0; j < j1; j++) {
          const cover = Math.min(y1, j + 1) - Math.max(y0, j);
          if (cover <= 0) continue;
          const jj = (j * w + x) * 4;
          r += data[jj] * cover;
          g += data[jj + 1] * cover;
          b += data[jj + 2] * cover;
          a += data[jj + 3] * cover;
          wsum += cover;
        }
        const k = wsum > 0 ? 1 / wsum : 0;
        const o = (y * w + x) * 4;
        od[o] = r * k;
        od[o + 1] = g * k;
        od[o + 2] = b * k;
        od[o + 3] = a * k;
      }
    }
    return out;
  }

  const scratch = new Float64Array(4);
  for (let y = 0; y < dstH; y++) {
    const v = ((y + 0.5) * srcH) / dstH;
    for (let x = 0; x < w; x++) {
      sampleBilinear(data, w, srcH, x + 0.5, v, scratch);
      const o = (y * w + x) * 4;
      od[o] = scratch[0];
      od[o + 1] = scratch[1];
      od[o + 2] = scratch[2];
      od[o + 3] = scratch[3];
    }
  }
  return out;
}

/** 等比缩放到指定尺寸（宽高各自独立重采样）。 */
export function resizeBuffer(src: PixelBuffer, dstW: number, dstH: number): PixelBuffer {
  const w = Math.max(1, Math.round(dstW));
  const h = Math.max(1, Math.round(dstH));
  if (w === src.width && h === src.height) return copyBuffer(src);
  return resizeVertical(resizeHorizontal(src, w), h);
}
