/**
 * D7 回归 —— 「静默碎图」在**内核**层被消灭。
 *
 * 现场的失败长这样（记录在 sanitize.ts 顶部）：
 *   配方 JSON 里写下稀疏的 `{ k:'setGeometry', value:{ rotate:90 } }`，
 *   TS 类型管不到 JSON，`straighten` 落库成 `undefined`，
 *   仿射角算成 `NaN`，整张图碎成两种颜色，**且不抛任何错**。
 *
 * 这里的用例刻意**绕过 apps/cli 的输入边界**（直接 pushOp），
 * 目的只有一个：证明**内核自己**也不再碎图 —— 即使没人替它把关。
 * 输入边界的"写错了要吵"是另一条防线，见 apps/cli 的 recipe 测试。
 */
import { describe, expect, it } from 'vitest';

import { fill } from '../pixels/compose.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { NEUTRAL, type AdjustParams } from '../presets/params.js';
import type { BandAdjustMap } from '../color/types.js';
import { createDocument, defaultCurves } from './defaults.js';
import { pushOp } from './history.js';
import { deriveEdit, deriveEditWith } from './reducer.js';
import { sanitizeEditState } from './sanitize.js';
import type {
  CollageState,
  EditState,
  GeometryState,
  Op,
  PhotoDocument,
  SourceRef,
  WatermarkState,
} from './types.js';

function srcRef(id: string, w: number, h: number): SourceRef {
  return { id, name: id, width: w, height: h };
}

function docWithSources(list: readonly SourceRef[]): PhotoDocument {
  return pushOp(createDocument(), { k: 'setSources', value: list, current: 0 });
}

function makeImage(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, 120, 60, 30, 255);
  for (let y = 0; y < Math.floor(h / 4); y++) {
    for (let x = 0; x < Math.floor(w / 4); x++) {
      const i = (y * w + x) * 4;
      buf.data[i] = 255;
      buf.data[i + 1] = 255;
      buf.data[i + 2] = 255;
    }
  }
  return buf;
}

/** 把任意值伪装成 Op —— 精确模拟"JSON 从类型系统眼皮底下溜进来"。 */
function asOp(value: unknown): Op {
  return value as Op;
}

/** 递归检查值图里是否存在非有限数。 */
function findNonFinite(value: unknown, path = '$'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNonFinite(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      const hit = findNonFinite(v, `${path}.${k}`);
      if (hit !== null) return hit;
    }
  }
  return null;
}

describe('D7 现场复现：稀疏 op 经内核直接落库也不再碎图', () => {
  it('稀疏 setGeometry 被补齐为完整四字段（rotate 保留，其余中性）', () => {
    const doc = pushOp(docWithSources([srcRef('a', 160, 120)]), asOp({
      k: 'setGeometry',
      value: { rotate: 90 },
    }));
    expect(deriveEdit(doc).geometry).toEqual({
      rotate: 90,
      flipH: false,
      flipV: false,
      straighten: 0,
    });
  });

  it('稀疏 setGeometry 与显式完整 setGeometry 的渲染结果逐字节相同', async () => {
    const { buildPlan } = await import('../pipeline/plan.js');
    const { executePlan } = await import('../pipeline/execute.js');

    const target = { kind: 'preview', maxEdge: 0, withText: false } as const;
    const img = makeImage(160, 120);

    const sparse = pushOp(docWithSources([srcRef('a', 160, 120)]), asOp({
      k: 'setGeometry',
      value: { rotate: 90 },
    }));
    const explicit = pushOp(docWithSources([srcRef('a', 160, 120)]), asOp({
      k: 'setGeometry',
      value: { rotate: 90, flipH: false, flipV: false, straighten: 0 },
    }));

    const a = executePlan([img], buildPlan(sparse, target));
    const b = executePlan([img], buildPlan(explicit, target));

    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    // 旋转 90° 应真的换宽高，而不是碎成 1×1 或原尺寸 —— 碎图时这里会失败。
    expect({ w: a.width, h: a.height }).toEqual({ w: 120, h: 160 });
  });

  it('稀疏 setGeometry 时 raster 阶段的 straighten 为 0（恒等快路径可命中）', async () => {
    const { buildPlan } = await import('../pipeline/plan.js');
    const doc = pushOp(docWithSources([srcRef('a', 160, 120)]), asOp({
      k: 'setGeometry',
      value: { rotate: 90 },
    }));
    const plan = buildPlan(doc, { kind: 'preview', maxEdge: 0, withText: false });
    const raster = plan.stages.find((s) => s.kind === 'raster');
    expect(raster).toBeDefined();
    if (raster !== undefined && raster.kind === 'raster') {
      expect(raster.straighten).toBe(0);
      expect(Number.isFinite(raster.straighten)).toBe(true);
    }
  });
});

describe('D7 同族：非有限 / 缺失数值退化为中性，而不是区间最小值', () => {
  it('params 缺 key → 按 NEUTRAL 补齐（亮度不会掉到区间下限 50 而整图发黑）', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setAdjust',
      value: { brightness: 150 },
    }));
    const state = deriveEdit(doc);
    expect(state.params).toEqual({ ...NEUTRAL, brightness: 150 });
    // 逐一确认每个键都有限且非 NaN —— 发黑的前置条件就是这里出现非有限值
    for (const key of Object.keys(NEUTRAL) as (keyof AdjustParams)[]) {
      expect(Number.isFinite(state.params[key])).toBe(true);
    }
  });

  it('NaN 注入 params → 该键退化为 NEUTRAL', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setAdjust',
      value: { ...NEUTRAL, contrast: Number.NaN, exposure: Number.POSITIVE_INFINITY },
    }));
    expect(deriveEdit(doc).params).toEqual(NEUTRAL);
  });

  it('NaN 注入 geometry.straighten → 0；NaN 曲线点被剔除后回落默认曲线', () => {
    let doc = docWithSources([srcRef('a', 10, 10)]);
    doc = pushOp(doc, asOp({ k: 'setGeometry', value: { rotate: 0, straighten: Number.NaN } }));
    doc = pushOp(doc, asOp({
      k: 'setCurves',
      value: { ...defaultCurves(), rgb: [[0, 0], ['x', 128], [255, Number.NaN]] },
    }));
    const state = deriveEdit(doc);
    expect(state.geometry.straighten).toBe(0);
    expect(state.curves.rgb).toEqual(defaultCurves().rgb);
  });

  it('NaN / 缺失注入 levels → 退化为中性色阶（不产生 Infinity 刷白）', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setLevels',
      value: {
        r: { lo: Number.NaN, hi: Number.POSITIVE_INFINITY, gain: 1.1 },
        b: {},
      },
    }));
    const levels = deriveEdit(doc).levels;
    expect(levels.r).toEqual({ lo: 0, hi: 255, gain: 1.1 });
    /* 整条缺失的通道按中性补齐，而不是 undefined（后者会让 LUT 变成 NaN）。 */
    expect(levels.b).toEqual({ lo: 0, hi: 255, gain: 1 });
    expect(levels.g).toEqual({ lo: 0, hi: 255, gain: 1 });
  });

  it('bands 被写成数字（而非 {h,s,l}）→ 归零，不产生 NaN', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setBands',
      value: { red: 5, blue: { h: Number.NaN, s: 10 } },
    }));
    const state = deriveEdit(doc);
    const red = (state.bands as BandAdjustMap).red;
    expect(red).toEqual({ h: 0, s: 0, l: 0 });
    expect(state.bands.blue).toEqual({ h: 0, s: 10, l: 0 });
    expect(findNonFinite(state.bands)).toBeNull();
  });
});

describe('联合类型白名单：非法枚举值一律回落默认', () => {
  it('非直角 rotate（45°）被拒，回落到 0', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setGeometry',
      value: { rotate: 45, flipH: 'yes', flipV: null },
    }));
    expect(deriveEdit(doc).geometry).toEqual({
      rotate: 0,
      flipH: false,
      flipV: false,
      straighten: 0,
    });
  });

  it('非法 collage.mode / watermark.pos / sticker.style 回落默认', () => {
    let doc = docWithSources([srcRef('a', 10, 10)]);
    doc = pushOp(doc, asOp({ k: 'setCollage', value: { mode: 'diagonal' } }));
    doc = pushOp(doc, asOp({ k: 'setWatermark', value: { pos: 'middle', size: 3 } }));
    doc = pushOp(doc, asOp({ k: 'setSticker', value: { style: 'rainbow', pos: 'bottom' } }));
    const state = deriveEdit(doc);
    expect(state.collage.mode).toBe('single');
    expect(state.watermark.pos).toBe('br');
    expect(state.sticker.style).toBe('white');
    expect(state.sticker.pos).toBe('bottom');
  });
});

describe('D7 例外条款：除数与分配尺寸强制为正整数', () => {
  it('源图尺寸不可用 → 整条丢弃，不留 1×1 幻影', () => {
    const doc = pushOp(createDocument(), asOp({
      k: 'setSources',
      value: [{ id: 'a', width: 640, height: 480 }, { id: 'b' }, 'garbage', 42, { id: 'c', width: 0, height: 10 }],
      current: 0,
    }));
    const state = deriveEdit(doc);
    expect(state.sources.map((s) => s.id)).toEqual(['a']);
    expect(state.sources[0]).toMatchObject({ width: 640, height: 480 });
    expect(findNonFinite(state.sources)).toBeNull();
  });

  it('exifOrientation 只认 1..8：合法值留下，非法值整键消失', () => {
    const doc = pushOp(createDocument(), asOp({
      k: 'setSources',
      value: [
        { id: 'a', name: 'a', width: 10, height: 10, exifOrientation: 6 },
        { id: 'b', name: 'b', width: 10, height: 10, exifOrientation: 9 },
        { id: 'c', name: 'c', width: 10, height: 10, exifOrientation: '6' },
      ],
      current: 0,
    }));
    const [a, b, c] = deriveEdit(doc).sources;
    /* 合法值必须原样留着（它是"这张图已经转过一次"的唯一留痕）；
     * 非法值把**整个键**去掉，而不是留一个 undefined —— 否则工程文件里
     * 会出现"有该字段但值不合法"的第三种状态，读的人无从判断。 */
    expect(a?.exifOrientation).toBe(6);
    expect('exifOrientation' in (b ?? {})).toBe(false);
    expect('exifOrientation' in (c ?? {})).toBe(false);
  });

  it('源图宽高为 NaN / 0 → 该源图消失（而非变成 1×1 静默产出小图）', () => {
    const doc = pushOp(createDocument(), asOp({
      k: 'setSources',
      value: [{ id: 'a', name: 'a', width: Number.NaN, height: 0 }],
      current: 0,
    }));
    const state = deriveEdit(doc);
    expect(state.sources).toEqual([]);
    expect(state.current).toBe(0);
  });

  it('cutCols / cutRows 为 0 → 至少 1（否则切图除零）', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setCollage',
      value: { mode: 'cut', cutCols: 0, cutRows: -3 },
    }));
    expect(deriveEdit(doc).collage.cutCols).toBe(1);
    expect(deriveEdit(doc).collage.cutRows).toBe(1);
  });

  it('裁剪 w/h 允许为负（反向框选），但必须有限', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setCrop',
      value: { x: 0, y: 0, w: -20, h: Number.POSITIVE_INFINITY },
    }));
    expect(deriveEdit(doc).crop).toEqual({ x: 0, y: 0, w: -20, h: 0 });
  });
});

describe('不变量：幂等 + 输出恒为「类型为真且数值有限」', () => {
  it('sanitizeEditState 幂等：再收敛一次逐字段不变', () => {
    const doc = pushOp(docWithSources([srcRef('a', 10, 10)]), asOp({
      k: 'setGeometry',
      value: { rotate: 90 },
    }));
    const once = deriveEdit(doc);
    expect(sanitizeEditState(once)).toEqual(once);
  });

  it('对一份处处是垃圾的文档，派生状态树里不含任何 NaN / Infinity', () => {
    let doc = pushOp(createDocument(), asOp({
      k: 'setSources',
      value: [{ id: 'a', width: Number.NaN, height: -1 }, 'not-an-object', 42],
      current: 99,
    }));
    doc = pushOp(doc, asOp({ k: 'setAdjust', value: { brightness: Number.NaN, grain: 'lots' } }));
    doc = pushOp(doc, asOp({ k: 'setGeometry', value: { rotate: 33, straighten: Number.NaN } }));
    doc = pushOp(doc, asOp({ k: 'setCurves', value: { rgb: [[Number.NaN, Number.NaN]] } }));
    doc = pushOp(doc, asOp({ k: 'setBands', value: null }));
    doc = pushOp(doc, asOp({
      k: 'setLevels',
      value: { r: { lo: Number.NaN, hi: Number.POSITIVE_INFINITY, gain: 'bright' } },
    }));
    doc = pushOp(doc, asOp({ k: 'setCollage', value: { gap: Number.NEGATIVE_INFINITY } }));
    doc = pushOp(doc, asOp({ k: 'setWatermark', value: { size: Number.NaN } }));
    doc = pushOp(doc, asOp({ k: 'setSticker', value: 7 }));

    const state = deriveEdit(doc);
    expect(findNonFinite(state)).toBeNull();
    expect(state.current).toBe(0);
  });

  it('cursor=0 的脏基线（模拟"加载工程文件"）也会被读干净', () => {
    const clean = createDocument();
    const dirty: PhotoDocument = {
      ...clean,
      baseline: {
        ...clean.baseline,
        geometry: { rotate: 90 } as unknown as GeometryState,
        params: { brightness: 150 } as unknown as AdjustParams,
        watermark: { text: 42 } as unknown as WatermarkState,
        collage: { mode: 'nope' } as unknown as CollageState,
      } as EditState,
    };
    const state = deriveEditWith(dirty, 0);
    expect(state.geometry).toEqual({ rotate: 90, flipH: false, flipV: false, straighten: 0 });
    expect(state.params).toEqual({ ...NEUTRAL, brightness: 150 });
    expect(state.watermark.text).toBe('');
    expect(state.collage.mode).toBe('single');
    expect(findNonFinite(state)).toBeNull();
  });
});
