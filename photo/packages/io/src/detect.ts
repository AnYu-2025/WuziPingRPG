import { bmpCodec } from './bmp.js';
import { jpegCodec } from './jpeg.js';
import { ppmCodec } from './ppm.js';
import type { ImageCodec, RasterImage } from './types.js';

/**
 * 格式探测与编解码注册表。
 *
 * 探测**只看 magic bytes，不看扩展名** —— 扩展名是用户可控的谎言，
 * 而字节是事实。legacy 只按扩展名分派，遇到改名的文件就会走错分支。
 */

/**
 * 内置的零依赖编解码器。
 *
 * JPEG 只在这里注册**解码**能力：`jpegCodec.encode` 明确抛错（本轮没做编码器），
 * 所以"已注册"不等于"能导出成这个格式"，导出清单要看 `lossless` / 实际调用结果。
 */
export const BUILTIN_CODECS: readonly ImageCodec[] = [bmpCodec, ppmCodec, jpegCodec];

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

export type KnownFormat = 'bmp' | 'ppm' | 'png' | 'jpeg' | 'unknown';

/** 识别格式（仅凭字节）。 */
export function detectFormat(bytes: Uint8Array): KnownFormat {
  if (bmpCodec.canDecode(bytes)) return 'bmp';
  if (ppmCodec.canDecode(bytes)) return 'ppm';
  if (matches(bytes, PNG_SIGNATURE)) return 'png';
  if (matches(bytes, JPEG_SIGNATURE)) return 'jpeg';
  return 'unknown';
}

function matches(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

export interface CodecRegistry {
  register(codec: ImageCodec): void;
  list(): readonly ImageCodec[];
  /** 找到能解该字节的编解码器。 */
  resolve(bytes: Uint8Array): ImageCodec | undefined;
  decode(bytes: Uint8Array): RasterImage;
  encode(format: string, image: RasterImage, quality?: number): Uint8Array;
}

/**
 * 创建编解码注册表。
 *
 * 外壳把平台能力注册进来：Node 端注册 PNG（基于 zlib），
 * 浏览器端注册 Canvas 解码器。上层代码只跟注册表打交道，
 * 因此"哪些格式可用"是一个运行时能力问题，而不是编译期分支。
 */
export function createRegistry(
  initial: readonly ImageCodec[] = BUILTIN_CODECS,
): CodecRegistry {
  const codecs: ImageCodec[] = [...initial];

  return {
    register(codec) {
      const i = codecs.findIndex((c) => c.format === codec.format);
      if (i >= 0) codecs[i] = codec;
      else codecs.push(codec);
    },
    list() {
      return codecs;
    },
    resolve(bytes) {
      return codecs.find((c) => c.canDecode(bytes));
    },
    decode(bytes) {
      const codec = codecs.find((c) => c.canDecode(bytes));
      if (codec === undefined) {
        throw new Error(`没有可用的解码器（探测到格式：${detectFormat(bytes)}）。` +
          `已注册：${codecs.map((c) => c.format).join(', ')}`);
      }
      return codec.decode(bytes);
    },
    encode(format, image, quality) {
      const codec = codecs.find((c) => c.format === format);
      if (codec === undefined) {
        throw new Error(`没有可用的编码器：${format}。已注册：${codecs.map((c) => c.format).join(', ')}`);
      }
      const options = quality === undefined ? undefined : { quality };
      return codec.encode(image, options);
    },
  };
}
