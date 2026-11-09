import { describe, expect, it } from 'vitest';

import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { invert, multiply, rotation, scaling, translation } from './affine.js';
import { boxBlur } from './blur.js';
import { fill, parseHexColor } from './compose.js';
import { grain, MAX_HEAVY_PIXELS, soften } from './effects.js';
import { renderAffine, rasterize } from './raster.js';
import { resizeBuffer } from './resize.js';
import { sampleBilinear } from './sampling.js';
import type { Rotate } from '../geometry/types.js';

function solid(w: number, h: number, r: number, g: number, b: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, r, g, b, 255);
  return buf;
}

function px(buf: PixelBuffer, x: number, y: number): [number, number, number, number] {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

/** 左右两色的小图，专门用来抓"宽高互换"类的错误。 */
function twoTone(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      buf.data[i] = left ? 255 : 0;
      buf.data[i + 1] = 0;
      buf.data[i + 2] = left ? 0 : 255;
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

describe('sampling', () => {
  it('双线性在像素中心取到原值', () => {
    const buf = twoTone(2, 1);
    const out = new Float64Array(4);
    sampleBilinear(buf.data, 2, 1, 0.5, 0.5, out);
    expect([out[0], out[1], out[2]]).toEqual([255, 0, 0]);
  });

  it('完全越界返回透明且报告未命中', () => {
    const buf = twoTone(2, 1);
    const out = new Float64Array(4);
    const hit = sampleBilinear(buf.data, 2, 1, 99, 99, out);
    expect(hit).toBe(false);
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, 0, 0]);
  });
});

describe('affine', () => {
  it('逆矩阵与正向矩阵复合为单位矩阵', () => {
    const m = multiply(
      translation(30, -12),
      multiply(rotation(0.7), scaling(2.5, 3.5)),
    );
    const id = multiply(m, invert(m));
    expect(id.a).toBeCloseTo(1, 10);
    expect(id.b).toBeCloseTo(0, 10);
    expect(id.c).toBeCloseTo(0, 10);
    expect(id.d).toBeCloseTo(1, 10);
    expect(id.e).toBeCloseTo(0, 10);
    expect(id.f).toBeCloseTo(0, 10);
  });
});

describe('resize', () => {
  it('同尺寸返回等值副本', () => {
    const src = twoTone(8, 4);
    const out = resizeBuffer(src, 8, 4);
    expect(out.width).toBe(8);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('缩小纯色图仍是同一纯色（面积平均不引入偏差）', () => {
    const src = solid(100, 100, 12, 200, 64);
    const out = resizeBuffer(src, 17, 23);
    expect(out.width).toBe(17);
    expect(out.height).toBe(23);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBeCloseTo(12, 0);
      expect(out.data[i + 1]).toBeCloseTo(200, 0);
      expect(out.data[i + 2]).toBeCloseTo(64, 0);
    }
  });
});

describe('compose', () => {
  it('解析 #rgb 与 #rrggbb', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#ff9a3c')).toEqual([255, 154, 60]);
    expect(parseHexColor('bogus')).toEqual([0, 0, 0]);
  });
});

describe('blur', () => {
  it('常量图模糊后不变（边缘钳制正确）', () => {
    const src = solid(9, 7, 40, 80, 120);
    const blur = boxBlur(src.data, 9, 7, 3);
    for (let i = 0; i < blur.length; i += 3) {
      expect(blur[i]).toBeCloseTo(40, 4);
      expect(blur[i + 1]).toBeCloseTo(80, 4);
      expect(blur[i + 2]).toBeCloseTo(120, 4);
    }
  });
});

describe('effects', () => {
  it('颗粒确定性：同输入两次完全一致', () => {
    const a = solid(64, 48, 128, 128, 128);
    const b = solid(64, 48, 128, 128, 128);
    grain(a, 20);
    grain(b, 20);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('磨皮对常量图无副作用', () => {
    const src = solid(40, 40, 90, 90, 90);
    const before = Array.from(src.data);
    soften(src, 50);
    expect(Array.from(src.data)).toEqual(before);
  });

  it('重负载上限为 3000 万像素', () => {
    expect(MAX_HEAVY_PIXELS).toBe(30_000_000);
  });
});

describe('renderAffine / rasterize（P1-1 结构性回归）', () => {
  it('90° 顺时针：宽变为高、左半变上半', () => {
    const src = twoTone(2, 1); // 左红右蓝
    const content = { w: 1, h: 2 };
    const buf = rasterize(src, {
      rotate: 90,
      flipH: false,
      flipV: false,
      straighten: 0,
      contentSize: content,
      crop: null,
      border: 0,
      borderColor: '#000000',
    });
    expect(buf.width).toBe(1);
    expect(buf.height).toBe(2);
    expect(px(buf, 0, 0)).toEqual([255, 0, 0, 255]); // 上 = 原左
    expect(px(buf, 0, 1)).toEqual([0, 0, 255, 255]); // 下 = 原右
  });

  it('不变量：任意尺寸 × 任意角度，输出恒等于 contentSize 且中心不透明', () => {
    const sizes: readonly (readonly [number, number])[] = [
      [1600, 900],
      [900, 1600],
      [500, 500],
      [1200, 300],
    ];
    const angles: readonly Rotate[] = [0, 90, 180, 270];
    for (const [w, h] of sizes) {
      for (const rot of angles) {
        const src = solid(w, h, 200, 100, 50);
        const content = rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
        const out = rasterize(src, {
          rotate: rot,
          flipH: false,
          flipV: false,
          straighten: 0,
          contentSize: content,
          crop: null,
          border: 0,
          borderColor: '#000000',
        });
        expect(out.width).toBe(content.w);
        expect(out.height).toBe(content.h);
        // 宽高比必须与原图的旋转结果一致（这正是 legacy min/max 破坏的量）
        expect(out.width / out.height).toBeCloseTo(content.w / content.h, 10);
        const mid = px(out, Math.floor(out.width / 2), Math.floor(out.height / 2));
        expect(mid[3]).toBeGreaterThan(200);
      }
    }
  });

  it('1600×900 旋转 90° 后宽高比应为 0.5625（legacy 得到 0.563 的错误来自 min/max）', () => {
    const src = solid(1600, 900, 10, 20, 30);
    const out = rasterize(src, {
      rotate: 90,
      flipH: false,
      flipV: false,
      straighten: 0,
      contentSize: { w: 900, h: 1600 },
      crop: null,
      border: 0,
      borderColor: '#000000',
    });
    expect(out.width / out.height).toBeCloseTo(900 / 1600, 10);
    expect(out.width / out.height).toBeCloseTo(0.5625, 10);
  });

  it('crop：按内容坐标裁出子区域（左右半可区分）', () => {
    const src = twoTone(8, 4); // 左 4 列红、右 4 列蓝
    const out = rasterize(src, {
      rotate: 0,
      flipH: false,
      flipV: false,
      straighten: 0,
      contentSize: { w: 8, h: 4 },
      crop: { x: 4, y: 0, w: 4, h: 4 },
      border: 0,
      borderColor: '#000000',
    });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(px(out, 0, 0)).toEqual([0, 0, 255, 255]); // 裁到右半 → 全蓝
    expect(px(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it('crop + 边框：裁切后四周重新加回边框', () => {
    const src = solid(6, 6, 10, 20, 30);
    const out = rasterize(src, {
      rotate: 0,
      flipH: false,
      flipV: false,
      straighten: 0,
      contentSize: { w: 6, h: 6 },
      crop: { x: 1, y: 1, w: 4, h: 4 },
      border: 1,
      borderColor: '#ffffff',
    });
    expect(out.width).toBe(6); // 4 + 1×2
    expect(out.height).toBe(6);
    expect(px(out, 0, 0)).toEqual([255, 255, 255, 255]); // 边框白
    expect(px(out, 2, 2)).toEqual([10, 20, 30, 255]); // 内容
  });

  it('crop 越界被钳到内容范围内（不崩、不露黑）', () => {
    const src = solid(6, 6, 10, 20, 30);
    const out = rasterize(src, {
      rotate: 0,
      flipH: false,
      flipV: false,
      straighten: 0,
      contentSize: { w: 6, h: 6 },
      crop: { x: 4, y: 4, w: 100, h: 100 },
      border: 0,
      borderColor: '#000000',
    });
    expect(out.width).toBe(2); // 钳到 (4,4)-(6,6)
    expect(out.height).toBe(2);
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('renderAffine 对恒定图输出恒定', () => {
    const src = solid(20, 10, 77, 88, 99);
    const out = renderAffine(src, 5, 5, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBeCloseTo(77, 3);
    }
  });
});
