import { createRaster, encodeBmp, setPixel } from '@photo/io';
import { describe, expect, it } from 'vitest';
import { assemblePng, crc32, decodePng, encodePng, isPng, packScanlines, pngCodec } from './node-png.js';

const IHDR_DATA_OFFSET = 16; // 8(签名) + 4(长度) + 4(类型)
const IHDR_CRC_OFFSET = 29; // 16 + 13(数据)

/** 改动 IHDR 数据并同步重算 CRC —— 否则会先撞上 CRC 校验，测不到目标分支。 */
function patchIhdr(png: Uint8Array, mutate: (ihdr: Uint8Array) => void): Uint8Array {
  const copy = png.slice();
  mutate(copy.subarray(IHDR_DATA_OFFSET, IHDR_DATA_OFFSET + 13));
  const crc = crc32(copy, IHDR_DATA_OFFSET - 4, IHDR_DATA_OFFSET + 13);
  copy[IHDR_CRC_OFFSET] = (crc >>> 24) & 0xff;
  copy[IHDR_CRC_OFFSET + 1] = (crc >>> 16) & 0xff;
  copy[IHDR_CRC_OFFSET + 2] = (crc >>> 8) & 0xff;
  copy[IHDR_CRC_OFFSET + 3] = crc & 0xff;
  return copy;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 按 PNG 规范做正向滤波（与解码器互为逆运算）。 */
function forwardFilter(
  type: number,
  row: Uint8Array,
  previous: Uint8Array,
  channels: number,
): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= channels ? row[i - channels] : 0;
    const up = previous[i];
    const upLeft = i >= channels ? previous[i - channels] : 0;
    let predictor = 0;
    if (type === 1) predictor = left;
    else if (type === 2) predictor = up;
    else if (type === 3) predictor = (left + up) >> 1;
    else if (type === 4) predictor = paeth(left, up, upLeft);
    out[i] = (row[i] - predictor) & 0xff;
  }
  return out;
}

function filterRows(
  rows: readonly Uint8Array[],
  channels: number,
  type: number,
): Uint8Array {
  const stride = rows[0]?.length ?? 0;
  const out = new Uint8Array((stride + 1) * rows.length);
  let previous: Uint8Array = new Uint8Array(stride);
  rows.forEach((row, index) => {
    out[index * (stride + 1)] = type;
    out.set(forwardFilter(type, row, previous, channels), index * (stride + 1) + 1);
    previous = row;
  });
  return out;
}

describe('encodePng / decodePng 往返', () => {
  it('含透明像素时用 RGBA（colorType 6）并完整保留 alpha', () => {
    const image = createRaster(2, 2);
    setPixel(image, 0, 0, 255, 0, 0, 255);
    setPixel(image, 1, 0, 0, 255, 0, 128);
    setPixel(image, 0, 1, 0, 0, 255, 0);
    setPixel(image, 1, 1, 10, 20, 30, 200);

    const encoded = encodePng(image);
    expect(encoded[25]).toBe(6); // IHDR.colorType
    expect(encoded[24]).toBe(8); // IHDR.bitDepth

    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...image.data]);
  });

  it('全图不透明时降为 RGB（colorType 2），像素仍逐字节一致', () => {
    const image = createRaster(3, 1);
    setPixel(image, 0, 0, 1, 2, 3, 255);
    setPixel(image, 1, 0, 4, 5, 6, 255);
    setPixel(image, 2, 0, 7, 8, 9, 255);

    const encoded = encodePng(image);
    expect(encoded[25]).toBe(2);

    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(3);
    expect([...decoded.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
  });

  it('产物以 IEND 收尾，且签名正确', () => {
    const encoded = encodePng(createRaster(1, 1));
    expect(isPng(encoded)).toBe(true);
    const tail = String.fromCharCode(...encoded.slice(encoded.length - 8, encoded.length - 4));
    expect(tail).toBe('IEND');
  });

  it('质量参数映射到 deflate 级别，不影响像素', () => {
    const image = createRaster(4, 4);
    const low = encodePng(image, { quality: 10 });
    const high = encodePng(image, { quality: 100 });
    expect([...decodePng(low).data]).toEqual([...decodePng(high).data]);
  });
});

describe('decodePng 支持的颜色类型', () => {
  it('灰度（colorType 0）展开为 RGBA', () => {
    const scanlines = new Uint8Array([0, 10, 20, 0, 30, 40]);
    const decoded = decodePng(
      assemblePng({ width: 2, height: 2, colorType: 0, scanlines }),
    );
    expect([...decoded.data]).toEqual([
      10, 10, 10, 255,
      20, 20, 20, 255,
      30, 30, 30, 255,
      40, 40, 40, 255,
    ]);
  });

  it('灰度 + Alpha（colorType 4）保留 alpha', () => {
    const scanlines = new Uint8Array([0, 10, 200, 20, 100]);
    const decoded = decodePng(
      assemblePng({ width: 2, height: 1, colorType: 4, scanlines }),
    );
    expect([...decoded.data]).toEqual([10, 10, 10, 200, 20, 20, 20, 100]);
  });

  it('五种滤波器都能正确还原', () => {
    const rows = [
      new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      new Uint8Array([100, 110, 120, 130, 140, 150, 160, 170, 180]),
      new Uint8Array([200, 5, 250, 1, 2, 3, 4, 5, 6]),
    ];
    const expected: number[] = [];
    for (const row of rows) {
      for (let i = 0; i < row.length; i += 3) {
        expected.push(row[i], row[i + 1], row[i + 2], 255);
      }
    }

    for (const type of [0, 1, 2, 3, 4]) {
      const decoded = decodePng(
        assemblePng({
          width: 3,
          height: 3,
          colorType: 2,
          scanlines: filterRows(rows, 3, type),
        }),
      );
      expect([...decoded.data], `滤波器 ${type} 还原失败`).toEqual(expected);
    }
  });
});

describe('decodePng 的显式拒绝（宁可吵，不猜）', () => {
  const valid = (): Uint8Array =>
    assemblePng({
      width: 2,
      height: 1,
      colorType: 2,
      scanlines: new Uint8Array([0, 1, 2, 3, 4, 5, 6]),
    });

  it('签名不符', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow('不是 PNG');
  });

  it('数据被截断', () => {
    expect(() => decodePng(valid().slice(0, 20))).toThrow('截断');
  });

  it('CRC 校验失败（数据损坏）', () => {
    const corrupted = valid().slice();
    // IDAT 数据首字节：8(签名) + 25(IHDR 分块) + 8(IDAT 长度与类型) = 41
    corrupted[41] = (corrupted[41] + 1) & 0xff;
    expect(() => decodePng(corrupted)).toThrow('CRC');
  });

  it('16 位位深', () => {
    expect(() => decodePng(patchIhdr(valid(), (ihdr) => {
      ihdr[8] = 16;
    }))).toThrow('仅支持 8 位');
  });

  it('调色板图片', () => {
    expect(() => decodePng(patchIhdr(valid(), (ihdr) => {
      ihdr[9] = 3;
    }))).toThrow('调色板');
  });

  it('未知颜色类型', () => {
    expect(() => decodePng(patchIhdr(valid(), (ihdr) => {
      ihdr[9] = 7;
    }))).toThrow('未知的 PNG 颜色类型');
  });

  it('Adam7 隔行扫描', () => {
    const interlaced = assemblePng({
      width: 2,
      height: 1,
      colorType: 2,
      scanlines: new Uint8Array([0, 1, 2, 3, 4, 5, 6]),
      interlace: 1,
    });
    expect(() => decodePng(interlaced)).toThrow('隔行');
  });

  it('像素数据不足', () => {
    // 声明 4 行却只给 1 行扫描线
    const short = assemblePng({
      width: 2,
      height: 4,
      colorType: 2,
      scanlines: new Uint8Array([0, 1, 2, 3, 4, 5, 6]),
    });
    expect(() => decodePng(short)).toThrow('不完整');
  });
});

describe('packScanlines / pngCodec', () => {
  it('packScanlines 逐行加滤波器字节', () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([...packScanlines(2, 1, 4, pixels)]).toEqual([0, 1, 2, 3, 255, 4, 5, 6, 255]);

    const rgb = new Uint8ClampedArray([1, 2, 3, 9, 4, 5, 6, 9]);
    expect([...packScanlines(2, 1, 3, rgb)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('crc32 对已知输入稳定', () => {
    const bytes = new Uint8Array([0x49, 0x45, 0x4e, 0x44]); // "IEND"
    expect(crc32(bytes)).toBe(0xae426082);
    expect(crc32(bytes)).toBe(crc32(bytes.slice()));
  });

  it('pngCodec 只认 PNG', () => {
    expect(pngCodec.format).toBe('png');
    expect(pngCodec.lossless).toBe(true);
    expect(pngCodec.extensions).toContain('.png');
    expect(pngCodec.canDecode(encodePng(createRaster(1, 1)))).toBe(true);
    expect(pngCodec.canDecode(encodeBmp(createRaster(1, 1)))).toBe(false);
  });
});
