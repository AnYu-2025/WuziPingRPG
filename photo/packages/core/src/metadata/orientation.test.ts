import { describe, expect, it } from 'vitest';

import { createDocument } from '../document/defaults.js';
import { pushOp } from '../document/history.js';
import type { SourceRef } from '../document/types.js';
import { rotatedSize } from '../geometry/transform.js';
import type { Size } from '../geometry/types.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { buildPlan } from '../pipeline/plan.js';
import { executePlan } from '../pipeline/execute.js';
import { rasterize } from '../pixels/raster.js';
import { applyOrientation } from '../pixels/orientation.js';
import { ORIENTATION_GEOMETRY, orientedSize, type ExifOrientation } from './orientation.js';

/* ───────────────────────── 真值表（手算，独立于实现） ─────────────────────────
 * 源图 3 列 × 2 行，每个像素的 R 通道写「列×10 + 行」，于是任何重排都能肉眼核对：
 *
 *     存储态（EXIF 1）        00 10 20
 *                             01 11 21
 */
const W = 3;
const H = 2;

/** 手算的八种朝向结果（行主序，`01` 表示 1，写作 1）。 */
const EXPECTED: Readonly<Record<ExifOrientation, { readonly size: Size; readonly codes: readonly number[] }>> = {
  1: { size: { w: 3, h: 2 }, codes: [0, 10, 20, 1, 11, 21] },
  2: { size: { w: 3, h: 2 }, codes: [20, 10, 0, 21, 11, 1] },
  3: { size: { w: 3, h: 2 }, codes: [21, 11, 1, 20, 10, 0] },
  4: { size: { w: 3, h: 2 }, codes: [1, 11, 21, 0, 10, 20] },
  // 5 TRANSPOSE：沿左上↔右下镜像，横变竖
  5: { size: { w: 2, h: 3 }, codes: [0, 1, 10, 11, 20, 21] },
  // 6：顺时针 90°，存储态的左下角 (01) 转到左上角
  6: { size: { w: 2, h: 3 }, codes: [1, 0, 11, 10, 21, 20] },
  // 7 TRANSVERSE：沿右上↔左下镜像
  7: { size: { w: 2, h: 3 }, codes: [21, 20, 11, 10, 1, 0] },
  // 8：逆时针 90°，存储态的右上角 (20) 转到左上角
  8: { size: { w: 2, h: 3 }, codes: [20, 21, 10, 11, 0, 1] },
};

const ALL: readonly ExifOrientation[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** 生成"每像素自带坐标"的测试图。 */
function labeled(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = (r * w + c) * 4;
      buf.data[i] = c * 10 + r;
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

function codesOf(buf: PixelBuffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.data.length; i += 4) out.push(buf.data[i]);
  return out;
}

/* ─────────────────────────────── X2：八种朝向 ─────────────────────────────── */

describe('applyOrientation 的八种朝向（X2）', () => {
  for (const o of ALL) {
    it(`朝向 ${o}：尺寸与像素都等于手算真值`, () => {
      const got = applyOrientation(labeled(W, H), o);
      expect([got.width, got.height]).toEqual([EXPECTED[o].size.w, EXPECTED[o].size.h]);
      expect(codesOf(got)).toEqual([...EXPECTED[o].codes]);
    });
  }

  it('三种源图尺寸 × 八种朝向：像素多重集守恒（置换不产生新值）', () => {
    for (const size of [
      { w: 5, h: 3 },
      { w: 3, h: 7 },
      { w: 4, h: 4 },
    ]) {
      const src = labeled(size.w, size.h);
      const before = codesOf(src).slice().sort((a, b) => a - b);
      for (const o of ALL) {
        const got = applyOrientation(src, o);
        const after = codesOf(got).slice().sort((a, b) => a - b);
        expect(after, `${size.w}×${size.h} 朝向${o} 改变了像素值`).toEqual(before);
        expect(got.width * got.height).toBe(size.w * size.h);
      }
    }
  });

  it('朝向 1 / 缺失 / null 原样返回同一个引用（不产生拷贝）', () => {
    const src = labeled(W, H);
    expect(applyOrientation(src, 1)).toBe(src);
    expect(applyOrientation(src, null)).toBe(src);
    expect(applyOrientation(src, undefined)).toBe(src);
  });

  it('置换可逆：1/2/3/4/5/7 自逆，6 与 8 互逆', () => {
    const src = labeled(W, H);
    const origin = codesOf(src);
    for (const o of [1, 2, 3, 4, 5, 7] as const) {
      const twice = applyOrientation(applyOrientation(src, o), o);
      expect(codesOf(twice), `朝向${o} 两次应回到原图`).toEqual([...origin]);
    }
    expect(codesOf(applyOrientation(applyOrientation(src, 6), 8))).toEqual([...origin]);
    expect(codesOf(applyOrientation(applyOrientation(src, 8), 6))).toEqual([...origin]);
  });
});

/* ─────────────────── 朝向表 ↔ 宽高互换唯一入口 ↔ 渲染器几何 ─────────────────── */

describe('朝向表与既有几何同源', () => {
  it('orientedSize 的宽高互换与 rotatedSize 完全一致', () => {
    for (const o of ALL) {
      const size = orientedSize({ w: W, h: H }, o);
      expect(size).toEqual(rotatedSize({ w: W, h: H }, ORIENTATION_GEOMETRY[o].rotate));
      expect(size).toEqual(EXPECTED[o].size);
    }
    expect(orientedSize({ w: W, h: H }, null)).toEqual({ w: W, h: H });
  });

  it('置换结果 == 渲染器按同一套几何词汇跑出来的结果（表没写错）', () => {
    /* 取**两边都是奇数**的尺寸：1:1 重采样时像素中心才精确对齐，
     * 双线性退化为取单点，于是可以和置换做严格相等比较。
     * 这条断言的意义在于：朝向表与渲染器的几何是同一件事的两种写法，
     * 任一边写反（比如 5/7 的镜像分量）都会在这里露出来。 */
    const src = labeled(5, 3);
    for (const o of ALL) {
      const g = ORIENTATION_GEOMETRY[o];
      const content = orientedSize({ w: src.width, h: src.height }, o);
      const viaAffine = rasterize(src, {
        rotate: g.rotate,
        flipH: g.flipH,
        flipV: g.flipV,
        straighten: 0,
        contentSize: content,
        crop: null,
        border: 0,
        borderColor: '#000000',
      });
      const viaPermute = applyOrientation(src, o);
      expect([viaAffine.width, viaAffine.height], `朝向${o} 尺寸不一致`).toEqual([
        viaPermute.width,
        viaPermute.height,
      ]);
      expect([...viaAffine.data], `朝向${o} 置换与仿射结果不一致`).toEqual([
        ...viaPermute.data,
      ]);
    }
  });
});

/* ─────────────── X3③ + X5：渲染路径**不读** exifOrientation ─────────────── */

describe('exifOrientation 只是来源记录，不进像素', () => {
  function docWith(ref: SourceRef) {
    return pushOp(createDocument(), { k: 'setSources', value: [ref], current: 0 });
  }
  const target = { kind: 'preview' as const, maxEdge: 0, withText: false };

  for (const o of [2, 3, 5, 6, 7, 8] as const) {
    it(`记录朝向 ${o} 与不记录：计划与像素逐字节相同`, () => {
      const base: SourceRef = { id: 's', name: 's.png', width: 6, height: 4 };
      const marked: SourceRef = { ...base, exifOrientation: o };
      const planA = buildPlan(docWith(base), target);
      const planB = buildPlan(docWith(marked), target);
      expect(JSON.parse(JSON.stringify(planB))).toEqual(
        JSON.parse(JSON.stringify(planA)),
      );
      const pixels = labeled(6, 4);
      const a = executePlan([pixels], planA);
      const b = executePlan([pixels], planB);
      expect([...b.data]).toEqual([...a.data]);
    });
  }

  it('拍摄参数（机型 / 光圈 / ISO）在内核类型上就进不了渲染', () => {
    // SourceRef 只多一个朝向码，没有承载拍摄参数的字段 ——
    // 参数只能走 `metadata.readExif` 的返回值给壳显示，渲染拿不到。
    const ref: SourceRef = { id: 's', name: 's', width: 2, height: 2, exifOrientation: 6 };
    expect(Object.keys(ref).sort()).toEqual(['exifOrientation', 'height', 'id', 'name', 'width']);
  });
});
