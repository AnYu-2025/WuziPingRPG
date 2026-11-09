/**
 * Node 侧的 PNG 编解码器 —— 注册进 `@photo/io` 的注册表。
 *
 * 这就是 io 那条分层设计的兑现：BMP / PPM 是**零依赖格式**，任何端都能跑；
 * 而 PNG 需要 deflate，浏览器靠 Canvas、Node 靠 zlib —— 于是"哪些格式可用"
 * 是**运行时注册**的结果，而不是编译期分支。内核全程不感知差异。
 *
 * 实现范围（刻意收窄并**显式拒绝**而非硬猜）：
 *   ✅ 8 位、非隔行、colorType 0 / 2 / 4 / 6（灰度 / RGB / 灰度A / RGBA）
 *   ❌ 16 位、调色板（colorType 3）、Adam7 隔行 —— 明确报错并说明原因
 * 宁可吵，也不要静默解出一张错的图。
 *
 * 位置上它属于"外壳"（用了 node:zlib），因此落在 apps/cli 而非 packages/io。
 * 将来若 Electron 壳也要用，再提升为 packages/io-node —— 现在只有一个 Node 壳，
 * 提前抽象只是负担。
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { createRaster, type EncodeOptions, type ImageCodec, type RasterImage } from '@photo/io';

/** 8 字节 PNG 文件签名。 */
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ───────────────────────────── CRC32 ───────────────────────────── */

const CRC_TABLE: Int32Array = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** PNG 分块校验和（RFC 1950 附录 D 的多项式）。 */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ────────────────────────── 可增长字节写入 ────────────────────────── */

class ByteWriter {
  private buffer: Uint8Array;
  private length = 0;

  constructor(capacity = 1024) {
    this.buffer = new Uint8Array(Math.max(16, capacity));
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  u32(value: number): void {
    this.reserve(4);
    this.buffer[this.length] = (value >>> 24) & 0xff;
    this.buffer[this.length + 1] = (value >>> 16) & 0xff;
    this.buffer[this.length + 2] = (value >>> 8) & 0xff;
    this.buffer[this.length + 3] = value & 0xff;
    this.length += 4;
  }

  bytes(source: Uint8Array): void {
    this.reserve(source.length);
    this.buffer.set(source, this.length);
    this.length += source.length;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

function pushChunk(writer: ByteWriter, type: string, data: Uint8Array): void {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) typeBytes[i] = type.charCodeAt(i);

  writer.u32(data.length);
  writer.bytes(typeBytes);
  writer.bytes(data);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writer.u32(crc32(crcInput));
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

/* ───────────────────────────── 编码 ───────────────────────────── */

/** 质量 10..100 映射为 deflate 级别 1..9（PNG 无损，质量只影响体积与耗时）。 */
function qualityToLevel(quality?: number): number {
  if (quality === undefined || !Number.isFinite(quality)) return 6;
  const q = Math.max(10, Math.min(100, quality));
  return Math.max(1, Math.min(9, Math.round((q / 100) * 9)));
}

/**
 * 把 RGBA 像素打包成"已过滤扫描线"（每行首字节为滤波器类型）。
 *
 * 统一起见一律用滤波器 0（None）：本工具是"修图"，不是"归档压缩"。
 * 逐行挑滤波器能再省几个百分点体积，代价是编码复杂度和 CPU，
 * 这里不值得。
 */
export function packScanlines(
  width: number,
  height: number,
  channels: number,
  pixels: Uint8ClampedArray | Uint8Array,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  let write = 0;
  for (let y = 0; y < height; y += 1) {
    out[write] = 0;
    write += 1;
    let read = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      out[write] = pixels[read];
      out[write + 1] = pixels[read + 1];
      out[write + 2] = pixels[read + 2];
      if (channels === 4) out[write + 3] = pixels[read + 3];
      write += channels;
      read += 4;
    }
  }
  return out;
}

export interface PngAssembly {
  readonly width: number;
  readonly height: number;
  /** 颜色类型：0 灰度 / 2 RGB / 4 灰度+Alpha / 6 RGBA。 */
  readonly colorType: number;
  /** 已过滤扫描线（每行首字节为滤波器类型）。 */
  readonly scanlines: Uint8Array;
  /** 默认 0（非隔行）。仅用于构造负例测试。 */
  readonly interlace?: number;
  readonly quality?: number;
}

/**
 * 低层 PNG 组装：IHDR + IDAT + IEND。
 *
 * 生产路径的 `encodePng` 也走这里，因此测试构造的灰度 / 隔行样本
 * 与真实产物共用同一套字节布局 —— 测的是同一条路径。
 */
export function assemblePng(spec: PngAssembly): Uint8Array {
  const compressed = deflateSync(spec.scanlines, { level: qualityToLevel(spec.quality) });

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, spec.width, false);
  view.setUint32(4, spec.height, false);
  ihdr[8] = 8;
  ihdr[9] = spec.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = spec.interlace ?? 0;

  const writer = new ByteWriter(compressed.length + 128);
  writer.bytes(SIGNATURE);
  pushChunk(writer, 'IHDR', ihdr);
  pushChunk(writer, 'IDAT', compressed);
  pushChunk(writer, 'IEND', new Uint8Array(0));
  return writer.finish();
}

/**
 * 编码 PNG。
 *
 * 全图不透明时写 colorType 2（RGB，3 通道）—— 照片类输入不带 alpha，
 * 省掉四分之一体积且兼容性最好；含透明像素才退到 RGBA。
 */
export function encodePng(image: RasterImage, options?: EncodeOptions): Uint8Array {
  const { width, height, data } = image;

  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }

  const channels = opaque ? 3 : 4;
  const colorType = opaque ? 2 : 6;
  return assemblePng({
    width,
    height,
    colorType,
    scanlines: packScanlines(width, height, channels, data),
    quality: options?.quality,
  });
}

/* ───────────────────────────── 解码 ───────────────────────────── */

/** 按签名识别 PNG。 */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) return false;
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

/** 颜色类型 → 通道数。调色板与未知类型直接拒绝，不做猜测。 */
function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    case 3:
      throw new Error('暂不支持调色板 PNG（colorType 3）。请先转存为 RGB / RGBA。');
    default:
      throw new Error(`未知的 PNG 颜色类型：${colorType}。`);
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Paeth 预测器（PNG 滤波器 4）。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 逐行反滤波（就地写回 out，上一行直接用视图 —— 无需复制）。 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`PNG 像素数据不完整：需要 ${expected} 字节，实际 ${raw.length} 字节。`);
  }

  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const sourceStart = y * (stride + 1) + 1;
    const row = out.subarray(y * stride, (y + 1) * stride);
    row.set(raw.subarray(sourceStart, sourceStart + stride));

    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = channels; i < stride; i += 1) {
          row[i] = (row[i] + row[i - channels]) & 0xff;
        }
        break;
      case 2:
        for (let i = 0; i < stride; i += 1) {
          row[i] = (row[i] + previous[i]) & 0xff;
        }
        break;
      case 3:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= channels ? row[i - channels] : 0;
          row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= channels ? row[i - channels] : 0;
          const up = previous[i];
          const upLeft = i >= channels ? previous[i - channels] : 0;
          row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`PNG 第 ${y} 行使用了未知滤波器 ${filter}。`);
    }
    previous = row;
  }
  return out;
}

/** 解码 PNG → RGBA。 */
export function decodePng(bytes: Uint8Array): RasterImage {
  if (!isPng(bytes)) throw new Error('不是 PNG 文件（签名不符）。');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  const idat: Uint8Array[] = [];

  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = readChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`PNG 分块 ${type} 被截断。`);
    }
    if (crc32(bytes, offset + 4, dataEnd) !== readU32(bytes, dataEnd)) {
      throw new Error(`PNG 分块 ${type} 的 CRC 校验失败（数据损坏）。`);
    }

    if (type === 'IHDR') {
      width = readU32(bytes, dataStart);
      height = readU32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
      sawHeader = true;
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!sawHeader) throw new Error('PNG 缺少 IHDR 分块。');
  if (width <= 0 || height <= 0) throw new Error(`PNG 尺寸非法：${width}×${height}。`);
  if (interlace !== 0) throw new Error('暂不支持隔行扫描（Adam7）PNG。');
  if (bitDepth !== 8) throw new Error(`暂不支持 ${bitDepth} 位 PNG，仅支持 8 位。`);
  if (idat.length === 0) throw new Error('PNG 不含 IDAT 像素数据。');

  const channels = channelsFor(colorType);
  const pixels = unfilter(inflateSync(concatBytes(idat)), width, height, channels);

  // 统一展开成 RGBA：内核与 io 的契约都是 4 通道，不在这里引入第二种像素布局。
  const image = createRaster(width, height);
  const out = image.data;
  const stride = width * channels;
  for (let y = 0; y < height; y += 1) {
    let read = y * stride;
    let write = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (channels === 1) {
        const v = pixels[read];
        out[write] = v;
        out[write + 1] = v;
        out[write + 2] = v;
        out[write + 3] = 255;
      } else if (channels === 2) {
        const v = pixels[read];
        out[write] = v;
        out[write + 1] = v;
        out[write + 2] = v;
        out[write + 3] = pixels[read + 1];
      } else if (channels === 3) {
        out[write] = pixels[read];
        out[write + 1] = pixels[read + 1];
        out[write + 2] = pixels[read + 2];
        out[write + 3] = 255;
      } else {
        out[write] = pixels[read];
        out[write + 1] = pixels[read + 1];
        out[write + 2] = pixels[read + 2];
        out[write + 3] = pixels[read + 3];
      }
      read += channels;
      write += 4;
    }
  }
  return image;
}

/** 注册进 `@photo/io` 注册表的 PNG 编解码器。 */
export const pngCodec: ImageCodec = {
  format: 'png',
  extensions: ['.png'],
  lossless: true,
  canDecode: isPng,
  decode: decodePng,
  encode: encodePng,
};
