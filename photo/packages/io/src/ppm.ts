import type { ImageCodec, RasterImage } from './types.js';

/**
 * Netpbm 编解码：P6（二进制 RGB）与 P5（二进制灰度）。
 *
 * 与 BMP 同样定位：**零依赖、任意端可跑**，用作无头验证与黄金样本。
 * PPM 还有个额外好处 —— 头部是纯 ASCII，人眼可读，
 * 调试"到底是渲染错了还是编码错了"时非常省事。
 */

const HASH = 0x23; // '#'
const LF = 0x0a; // '\n'

interface Cursor {
  pos: number;
}

/**
 * 读取下一个 ASCII 记号，跳过空白与 `#` 注释。
 * 返回后 cursor 停在记号之后（即其后的空白字符上）。
 */
function nextToken(bytes: Uint8Array, cur: Cursor): string {
  for (;;) {
    if (cur.pos >= bytes.length) return '';
    const c = bytes[cur.pos];
    if (c === HASH) {
      while (cur.pos < bytes.length && bytes[cur.pos] !== LF) cur.pos++;
    } else if (c <= 0x20) {
      cur.pos++;
    } else {
      break;
    }
  }
  const start = cur.pos;
  while (cur.pos < bytes.length && bytes[cur.pos] > 0x20) cur.pos++;
  const slice = bytes.subarray(start, cur.pos);
  let s = '';
  for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
  return s;
}

export function isPpm(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes[0] !== 0x50) return false; // 'P'
  return bytes[1] === 0x36 /* '6' */ || bytes[1] === 0x35; /* '5' */
}

export function decodePpm(bytes: Uint8Array): RasterImage {
  const cur: Cursor = { pos: 0 };
  const magic = nextToken(bytes, cur);
  if (magic !== 'P6' && magic !== 'P5') {
    throw new Error(`不是 Netpbm P5/P6 文件：magic=${magic || '(空)'}`);
  }
  const width = Number.parseInt(nextToken(bytes, cur), 10);
  const height = Number.parseInt(nextToken(bytes, cur), 10);
  const maxValue = Number.parseInt(nextToken(bytes, cur), 10);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`PPM 尺寸非法：${width}×${height}`);
  }
  if (maxValue !== 255) {
    throw new Error(`暂不支持 maxval=${maxValue}（仅支持 8 位 / maxval=255）`);
  }

  // 规范要求 maxval 之后恰好一个空白字符
  if (cur.pos < bytes.length && bytes[cur.pos] <= 0x20) cur.pos++;

  const channels = magic === 'P6' ? 3 : 1;
  const need = width * height * channels;
  if (cur.pos + need > bytes.length) {
    throw new Error(`PPM 像素数据不足：需要 ${need} 字节，实得 ${bytes.length - cur.pos}`);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  let src = cur.pos;
  for (let p = 0; p < width * height; p++) {
    const d = p * 4;
    if (channels === 3) {
      out[d] = bytes[src];
      out[d + 1] = bytes[src + 1];
      out[d + 2] = bytes[src + 2];
      src += 3;
    } else {
      const g = bytes[src];
      out[d] = g;
      out[d + 1] = g;
      out[d + 2] = g;
      src += 1;
    }
    out[d + 3] = 255;
  }

  return { width, height, data: out };
}

export function encodePpm(image: RasterImage): Uint8Array {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) throw new Error('PPM 尺寸非法');
  const header = `P6\n${width} ${height}\n255\n`;
  const headerBytes = new Uint8Array(header.length);
  for (let i = 0; i < header.length; i++) headerBytes[i] = header.charCodeAt(i);

  const out = new Uint8Array(header.length + width * height * 3);
  out.set(headerBytes, 0);
  let dst = header.length;
  for (let p = 0; p < width * height; p++) {
    const s = p * 4;
    out[dst] = data[s];
    out[dst + 1] = data[s + 1];
    out[dst + 2] = data[s + 2];
    dst += 3;
  }
  return out;
}

export const ppmCodec: ImageCodec = {
  format: 'ppm',
  extensions: ['.ppm', '.pgm'],
  lossless: true,
  canDecode: isPpm,
  decode: decodePpm,
  encode: encodePpm,
};
