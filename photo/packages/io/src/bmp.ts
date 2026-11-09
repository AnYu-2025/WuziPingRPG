import type { ImageCodec, RasterImage } from './types.js';

/**
 * BMP 编解码（未压缩，24 / 32 位）。
 *
 * 为什么内置 BMP：它是一个**零依赖、任何端都能跑**的位图格式
 * （没有压缩、没有熵编码），因此非常适合做
 *   1. 内核渲染的无头验证（写入 BMP → 读回 → 逐像素断言）；
 *   2. 跨端一致的中间格式；
 *   3. 单元测试的黄金样本（不需要任何图像库）。
 *
 * 支持范围（够用即止，不做无用功）：
 *   - 解码：BITMAPINFOHEADER（40 字节）及以上、BI_RGB、24 或 32 位、
 *           正/负高度（自下而上 / 自上而下）。
 *   - 编码：32 位 BGRA、自下而上，保留 alpha。
 *   调色板（1/4/8 位）、RLE 压缩一律明确报错，不静默给出错图。
 */

const FILE_HEADER_SIZE = 14;
const DIB_HEADER_SIZE = 40;
const PIXEL_OFFSET = FILE_HEADER_SIZE + DIB_HEADER_SIZE;

export function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function decodeBmp(bytes: Uint8Array): RasterImage {
  if (!isBmp(bytes)) throw new Error('不是 BMP 文件：缺少 BM 签名');
  if (bytes.length < PIXEL_OFFSET) throw new Error('BMP 头不完整');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const dibSize = dv.getUint32(14, true);
  if (dibSize < DIB_HEADER_SIZE) {
    throw new Error(`不支持的 BMP DIB 头（${dibSize} 字节）：仅支持 BITMAPINFOHEADER 及以上`);
  }

  const width = dv.getInt32(18, true);
  const rawHeight = dv.getInt32(22, true);
  const planes = dv.getUint16(26, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;

  if (width <= 0 || height === 0) throw new Error('BMP 尺寸非法');
  if (planes !== 1) throw new Error(`不支持的 BMP 平面数：${planes}`);
  if (compression !== 0) {
    throw new Error(`不支持的 BMP 压缩方式：${compression}（仅支持 BI_RGB 未压缩）`);
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`不支持的 BMP 位深：${bpp}（仅支持 24 / 32 位）`);
  }

  const bytesPerPx = bpp / 8;
  // BMP 的每一行按 4 字节对齐
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  if (dataOffset + rowSize * height > bytes.length) {
    throw new Error('BMP 像素数据长度不足，文件可能被截断');
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const s = rowStart + x * bytesPerPx;
      const d = (y * width + x) * 4;
      // BMP 存的是 BGR(A)
      out[d] = bytes[s + 2];
      out[d + 1] = bytes[s + 1];
      out[d + 2] = bytes[s];
      out[d + 3] = bpp === 32 ? bytes[s + 3] : 255;
    }
  }

  return { width, height, data: out };
}

export function encodeBmp(image: RasterImage): Uint8Array {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) throw new Error('BMP 尺寸非法');

  const rowSize = width * 4;
  const pixelBytes = rowSize * height;
  const fileSize = PIXEL_OFFSET + pixelBytes;
  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);

  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(6, 0, true);
  dv.setUint32(10, PIXEL_OFFSET, true);

  dv.setUint32(14, DIB_HEADER_SIZE, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // 正高度 = 自下而上
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 32, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, pixelBytes, true);
  dv.setInt32(38, 2835, true); // ~72 DPI
  dv.setInt32(42, 2835, true);
  dv.setUint32(46, 0, true);
  dv.setUint32(50, 0, true);

  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    const rowStart = PIXEL_OFFSET + y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + x) * 4;
      const d = rowStart + x * 4;
      out[d] = data[s + 2];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s];
      out[d + 3] = data[s + 3];
    }
  }

  return out;
}

export const bmpCodec: ImageCodec = {
  format: 'bmp',
  extensions: ['.bmp'],
  lossless: true,
  canDecode: isBmp,
  decode: decodeBmp,
  encode: encodeBmp,
};
