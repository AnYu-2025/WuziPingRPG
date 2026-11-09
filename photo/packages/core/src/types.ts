/**
 * 内核共享的基础类型。
 *
 * PixelBuffer 与 DOM 的 ImageData 结构完全一致（width/height/data），
 * 因此浏览器侧的 ImageData 可以**直接**传给内核函数，无需转换。
 * 但本类型不引用 DOM，内核因此保持零平台依赖。
 */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** 创建指定尺寸的空白像素缓冲（全透明黑）。 */
export function createPixelBuffer(width: number, height: number): PixelBuffer {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/** 像素总数。 */
export function pixelCount(buf: { width: number; height: number }): number {
  return buf.width * buf.height;
}

/**
 * 拼图 / 切图模式。
 * single 单图精修 · h 横拼 · v 竖拼 · grid 网格拼 · cut 切图（分片）
 */
export type CollageMode = 'single' | 'h' | 'v' | 'grid' | 'cut';

/** 导出用途一键预设。 */
export type ExportUse = 'moment' | 'small' | 'print';

/** 图片导出格式。 */
export type ImageFormat = 'jpeg' | 'webp' | 'png';
