/**
 * @photo/io —— 图片编解码层。
 *
 * 零平台依赖：不引用 DOM、不引用 Node。因此本包的 BMP / PPM 编解码
 * 可以在 浏览器 / Worker / Node / 移动 WebView 中原样运行。
 *
 * 定位：
 *   - **零依赖格式（BMP / PPM / JPEG 解码）** 由本包提供 —— 任何端都能跑，
 *     用于跨端一致性与无头验证。JPEG 只有解码（D15），编码仍归各端；
 *   - **平台格式（PNG / WebP）** 由各端把能力注册进 `createRegistry`：
 *     Node 用 `zlib`，浏览器用 `createImageBitmap` + `OffscreenCanvas`。
 *
 * `RasterImage` 与 `@photo/core` 的 `PixelBuffer` 结构完全一致，
 * 因此内核的渲染结果可以直接交给本包编码，无需任何转换。
 */

export type { RasterImage, ImageCodec, EncodeOptions } from './types.js';
export { createRaster, getPixel, setPixel } from './types.js';

export { isBmp, decodeBmp, encodeBmp, bmpCodec } from './bmp.js';
export { isPpm, decodePpm, encodePpm, ppmCodec } from './ppm.js';
export { isJpeg, decodeJpeg, jpegCodec } from './jpeg.js';
export {
  crc32,
  utf8Bytes,
  zipStore,
  pushUniqueName,
  type ZipEntry,
  type ZipOptions,
} from './zip.js';
export {
  BUILTIN_CODECS,
  detectFormat,
  createRegistry,
  type CodecRegistry,
  type KnownFormat,
} from './detect.js';
