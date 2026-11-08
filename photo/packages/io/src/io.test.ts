import { describe, expect, it } from 'vitest';

import { bmpCodec, decodeBmp, encodeBmp } from './bmp.js';
import { BUILTIN_CODECS, createRegistry, detectFormat } from './detect.js';
import { decodePpm, encodePpm } from './ppm.js';
import { createRaster, getPixel, setPixel, type RasterImage } from './types.js';

function sampleImage(w: number, h: number): RasterImage {
  const img = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(img, x, y, (x * 37) % 256, (y * 61) % 256, (x + y * 7) % 256, ((x + y) * 3) % 256);
    }
  }
  return img;
}

/** 手工构造 24 位 BMP，用来验证行对齐（4 字节）与 BGR 顺序。 */
function makeBmp24(rows: readonly (readonly [number, number, number][])[]): Uint8Array {
  const h = rows.length;
  const w = rows[0].length;
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelBytes = rowSize * h;
  const out = new Uint8Array(54 + pixelBytes);
  const dv = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, pixelBytes, true);
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y; // 自下而上
    const rowStart = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rows[srcRow][x];
      const d = rowStart + x * 3;
      out[d] = b;
      out[d + 1] = g;
      out[d + 2] = r;
    }
  }
  return out;
}

describe('BMP', () => {
  it('32 位往返逐像素一致（含 alpha）', () => {
    const img = sampleImage(7, 5);
    const bytes = encodeBmp(img);
    const back = decodeBmp(bytes);
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });

  it('解码 24 位 BMP：BGR 顺序与行 4 字节对齐都正确', () => {
    // 宽度 3 → 每行 9 字节，需补 3 字节到 12；若忽略对齐会整体错位
    const rows: [number, number, number][][] = [
      [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ],
      [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
      ],
    ];
    const img = decodeBmp(makeBmp24(rows));
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(getPixel(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(img, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(img, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(getPixel(img, 0, 1)).toEqual([10, 20, 30, 255]);
    expect(getPixel(img, 2, 1)).toEqual([70, 80, 90, 255]);
  });

  it('不支持的位深明确报错，而不是给出错图', () => {
    const bytes = encodeBmp(sampleImage(2, 2));
    // 把位深改成 8（调色板模式）
    new DataView(bytes.buffer).setUint16(28, 8, true);
    expect(() => decodeBmp(bytes)).toThrow(/位深/);
  });

  it('压缩方式非 BI_RGB 时明确报错', () => {
    const bytes = encodeBmp(sampleImage(2, 2));
    new DataView(bytes.buffer).setUint32(30, 1, true); // RLE8
    expect(() => decodeBmp(bytes)).toThrow(/压缩/);
  });

  it('非 BMP 字节报错', () => {
    expect(() => decodeBmp(new Uint8Array([1, 2, 3, 4]))).toThrow(/BM/);
  });

  it('被截断的像素数据报错', () => {
    const bytes = encodeBmp(sampleImage(4, 4));
    expect(() => decodeBmp(bytes.subarray(0, bytes.length - 8))).toThrow(/截断|不足/);
  });
});

describe('PPM / PGM', () => {
  it('P6 往返保留 RGB，alpha 归一为 255', () => {
    const img = sampleImage(5, 3);
    const back = decodePpm(encodePpm(img));
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) {
        const a = getPixel(img, x, y);
        const b = getPixel(back, x, y);
        expect(b[0]).toBe(a[0]);
        expect(b[1]).toBe(a[1]);
        expect(b[2]).toBe(a[2]);
        expect(b[3]).toBe(255);
      }
    }
  });

  it('头部可含注释与多行空白', () => {
    const header = 'P6\n# 这是注释\n3 2\n# 又一行注释\n255\n';
    const body = new Uint8Array(3 * 2 * 3).fill(128);
    const bytes = new Uint8Array(header.length + body.length);
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    bytes.set(body, header.length);
    const img = decodePpm(bytes);
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(getPixel(img, 1, 1)).toEqual([128, 128, 128, 255]);
  });

  it('P5 灰度展开为 RGB', () => {
    const header = 'P5\n2 1\n255\n';
    const bytes = new Uint8Array(header.length + 2);
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    bytes[header.length] = 40;
    bytes[header.length + 1] = 200;
    const img = decodePpm(bytes);
    expect(getPixel(img, 0, 0)).toEqual([40, 40, 40, 255]);
    expect(getPixel(img, 1, 0)).toEqual([200, 200, 200, 255]);
  });

  it('maxval 非 255 明确报错', () => {
    const header = 'P6\n1 1\n65535\n';
    const bytes = new Uint8Array(header.length + 6);
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    expect(() => decodePpm(bytes)).toThrow(/maxval/);
  });

  it('像素数据不足报错', () => {
    const header = 'P6\n10 10\n255\n';
    const bytes = new Uint8Array(header.length + 5);
    for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
    expect(() => decodePpm(bytes)).toThrow(/数据不足/);
  });
});

describe('格式探测与注册表', () => {
  it('按 magic bytes 识别，不信任扩展名', () => {
    expect(detectFormat(encodeBmp(sampleImage(2, 2)))).toBe('bmp');
    expect(detectFormat(encodePpm(sampleImage(2, 2)))).toBe('ppm');
    expect(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe('unknown');
  });

  it('内置注册表能解码 BMP 与 PPM', () => {
    const reg = createRegistry();
    const img = sampleImage(4, 4);
    expect(reg.decode(encodeBmp(img)).width).toBe(4);
    expect(reg.decode(encodePpm(img)).height).toBe(4);
    expect(reg.list().length).toBe(BUILTIN_CODECS.length);
  });

  it('未注册格式在解码时明确报错并列出可用格式', () => {
    const reg = createRegistry();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => reg.decode(png)).toThrow(/没有可用的解码器.*png/s);
  });

  it('可注册平台编解码器（模拟 Node 的 PNG 能力）', () => {
    const reg = createRegistry();
    reg.register({
      format: 'png',
      extensions: ['.png'],
      lossless: true,
      canDecode: (b) => b[0] === 0x89 && b[1] === 0x50,
      decode: () => sampleImage(2, 2),
      encode: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(reg.decode(png).width).toBe(2);
    expect(reg.encode('png', sampleImage(1, 1))[0]).toBe(0x89);
    expect(() => reg.encode('webp', sampleImage(1, 1))).toThrow(/没有可用的编码器/);
  });

  it('RasterImage 与 core 的 PixelBuffer 结构一致（可互换）', () => {
    const img = sampleImage(3, 3);
    // 只做结构断言：字段名与类型必须与 core 的 PixelBuffer 完全对应。
    const asPixelBuffer: { width: number; height: number; data: Uint8ClampedArray } = img;
    expect(asPixelBuffer.width).toBe(3);
    expect(asPixelBuffer.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('bmpCodec 元信息可用', () => {
    expect(bmpCodec.format).toBe('bmp');
    expect(bmpCodec.lossless).toBe(true);
    expect(bmpCodec.canDecode(encodeBmp(sampleImage(1, 1)))).toBe(true);
  });
});
