/**
 * IO 层基础类型。
 *
 * `RasterImage` 与 `@photo/core` 的 `PixelBuffer` **结构完全一致**
 * （width / height / data: Uint8ClampedArray，RGBA 8 位）。
 * 这里刻意不 import core —— 让 io 成为零跨包依赖的独立层，
 * 同时因为是结构化类型，core 的函数可以直接吃 io 解出来的图，无需转换。
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** RGBA，每像素 4 字节。 */
  readonly data: Uint8ClampedArray;
}

export interface EncodeOptions {
  /** 有损格式的质量（10..100）。无损格式忽略。 */
  readonly quality?: number;
}

/**
 * 编解码器。
 *
 * 之所以抽象成接口：不同端能提供的解码能力不同 ——
 * Node 有 zlib（可做 PNG），浏览器有 Canvas（几乎什么都能解），
 * 而 BMP / PPM 是**任何端都能跑的零依赖格式**（本包提供）。
 * 外壳按能力注册即可，内核与上层完全不感知差异。
 */
export interface ImageCodec {
  readonly format: string;
  readonly extensions: readonly string[];
  readonly lossless: boolean;
  canDecode(bytes: Uint8Array): boolean;
  decode(bytes: Uint8Array): RasterImage;
  encode(image: RasterImage, options?: EncodeOptions): Uint8Array;
}

/** 创建一块透明黑底图。 */
export function createRaster(width: number, height: number): RasterImage {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/** 单像素 RGBA 写入（内部工具）。 */
export function setPixel(
  img: RasterImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

/** 取单像素 RGBA（内部工具）。 */
export function getPixel(img: RasterImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}
