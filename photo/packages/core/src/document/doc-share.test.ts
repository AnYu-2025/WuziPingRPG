/**
 * 序 2 回归 —— 工程文件格式 `photo.doc/v1`。
 *
 * 验收条件（见 P6E-PLAN.md §3.3）：
 *   D1 往返保真：序列化 → 解析 → 观感逐字节相同，撤销栈与 cursor 一起回来；
 *   D2 坏文件被接住：结构错抛错、数值错收敛，渲染结果恒为有限像素；
 *   D3 不存像素：文件大小与像素量无关，全文无 base64 痕迹。
 *
 * 测试**直接调用内核**的 serializeDocument/parseDocument（不经任何壳），
 * 与序 9 的预设测试同一个理由：要证明的是"内核自己"接得住坏文件。
 * D4（源图漂移）在 `identity.test.ts`。
 */

import { describe, expect, it } from 'vitest';

import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { fill } from '../pixels/compose.js';
import { zeroBands } from '../color/hsl.js';
import { NEUTRAL } from '../presets/params.js';
import { buildPlan } from '../pipeline/plan.js';
import { executePlan } from '../pipeline/execute.js';
import { createDocument, defaultCollage, defaultGeometry, defaultWatermark } from './defaults.js';
import { pushOp, undo, redo } from './history.js';
import { deriveEdit } from './reducer.js';
import { DOC_FORMAT, DocumentParseError, parseDocument, serializeDocument } from './doc-share.js';
import { sourceFingerprint } from './identity.js';
import type { Op, PhotoDocument, SourceRef } from './types.js';

const TARGET = { kind: 'preview', maxEdge: 0, withText: false } as const;

/** 带全套溯源字段的源图引用：工程文件要写的就是这些。 */
function srcRef(name: string, w: number, h: number): SourceRef {
  return {
    id: `src-${name}`,
    name,
    width: w,
    height: h,
    handle: `/photos/${name}`,
    exifOrientation: 6,
    bytes: 4096,
    fingerprint: sourceFingerprint(new Uint8Array([1, 2, 3])),
  };
}

function makeImage(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, 120, 60, 30, 255);
  return buf;
}

function docWithSources(n: number, w = 48, h = 64): PhotoDocument {
  const list: SourceRef[] = [];
  for (let i = 0; i < n; i++) list.push(srcRef(`photo-${String(i).padStart(3, '0')}.jpg`, w, h));
  return pushOp(createDocument(), { k: 'setSources', value: list, current: 0 });
}

/** 一条"编辑到一半又撤销了一步"的真实文档：多种 op + 未生效的重做分支。 */
function editedDoc(): PhotoDocument {
  let doc = pushOp(createDocument(), {
    k: 'setSources',
    value: [srcRef('a.jpg', 48, 64), srcRef('b.jpg', 48, 64)],
    current: 1,
  });
  doc = pushOp(doc, { k: 'setAdjust', value: { ...NEUTRAL, brightness: 62, saturate: 118 } });
  doc = pushOp(doc, { k: 'setGeometry', value: { ...defaultGeometry(), rotate: 90 } });
  doc = pushOp(doc, { k: 'setWatermark', value: { ...defaultWatermark(), text: '样片', size: 4 } });
  doc = pushOp(doc, { k: 'setCrop', value: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } });
  doc = pushOp(doc, { k: 'setCollage', value: { ...defaultCollage(), gap: 12 } });
  return undo(doc); // 停在倒数第二步：ops 里留着重做分支
}

/** 找到的第一个非有限数路径；null 表示整棵子树干净。 */
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

function firstDiff(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function render(doc: PhotoDocument, pixels: readonly PixelBuffer[]): PixelBuffer {
  return executePlan(pixels, buildPlan(doc, TARGET));
}

describe('photo.doc/v1 · D1 往返保真', () => {
  it('文档经"写出→读入"逐字段复原，含 ops 全表与重做分支', () => {
    const doc = editedDoc();
    const back = parseDocument(serializeDocument(doc));

    expect(back).toEqual(doc);
    /* 单独钉一遍历史：`toEqual` 能过但 cursor 掉了，是这类回归最隐蔽的形态 ——
     * 观感没错、撤销键却再也按不动。 */
    expect(back.ops.length).toBe(doc.ops.length);
    expect(back.cursor).toBe(doc.cursor);
    expect(redo(back).ops[back.cursor]?.k).toBe('setCollage');
  });

  it('载入后的渲染与原图逐字节一致，撤销与重做仍落在同一批观感上', () => {
    const doc = editedDoc();
    const back = parseDocument(serializeDocument(doc));
    const pixels = [makeImage(48, 64), makeImage(48, 64)];

    expect(firstDiff(render(doc, pixels).data, render(back, pixels).data)).toBe(-1);
    /* 撤销栈"回来"的判据不是数组相等，而是每一步的观感都还在原位。 */
    expect(firstDiff(render(undo(doc), pixels).data, render(undo(back), pixels).data)).toBe(-1);
    expect(firstDiff(render(redo(doc), pixels).data, render(redo(back), pixels).data)).toBe(-1);
    expect(render(undo(doc), pixels).data).not.toHaveLength(0);
  });

  it('serialize→parse→serialize 文本稳定（自己写的文件自己认得）', () => {
    const once = serializeDocument(editedDoc());
    expect(serializeDocument(parseDocument(once))).toBe(once);
    expect(once.startsWith(`{\n  "format": "${DOC_FORMAT}"`)).toBe(true);
  });

  it('11 种 op 逐类往返：写出去的 kind，解析器全都认', () => {
    const cases: readonly Op[] = [
      { k: 'setSources', value: [srcRef('a.jpg', 8, 8)], current: 0 },
      { k: 'setAdjust', value: { ...NEUTRAL, contrast: 55 } },
      { k: 'applyPreset', key: 'warm', intensity: 0.55 },
      {
        k: 'setLevels',
        value: {
          r: { lo: 3, hi: 250, gain: 1.1 },
          g: { lo: 0, hi: 255, gain: 1 },
          b: { lo: 0, hi: 255, gain: 1 },
        },
      },
      {
        k: 'setCurves',
        value: {
          rgb: [[0, 0], [255, 255]],
          r: [[0, 0], [255, 255]],
          g: [[0, 0], [255, 255]],
          b: [[0, 0], [255, 255]],
        },
      },
      { k: 'setBands', value: { ...zeroBands(), red: { h: 2, s: 0, l: 0 } } },
      { k: 'setGeometry', value: { ...defaultGeometry(), flipH: true, straighten: 3 } },
      { k: 'setCrop', value: null },
      { k: 'setCrop', value: { x: 1, y: 2, w: -3, h: 4 } },
      { k: 'setCollage', value: { ...defaultCollage(), mode: 'grid' } },
      { k: 'setWatermark', value: { ...defaultWatermark(), text: '甲' } },
      { k: 'setSticker', value: { text: '标题', style: 'gold', pos: 'top', size: 7 } },
    ];
    let doc = pushOp(createDocument(), { k: 'setSources', value: [srcRef('a.jpg', 8, 8)], current: 0 });
    for (const op of cases) doc = pushOp(doc, op);

    const back = parseDocument(serializeDocument(doc));
    expect(back.ops).toEqual(doc.ops);
    expect(deriveEdit(back)).toEqual(deriveEdit(doc));
  });
});

describe('photo.doc/v1 · D2 坏文件被接住', () => {
  const base = (): Record<string, unknown> =>
    JSON.parse(serializeDocument(editedDoc())) as Record<string, unknown>;

  it('结构错一律抛 DocumentParseError', () => {
    const broken: readonly [string, unknown][] = [
      ['不是 JSON', '{'],
      ['根不是对象', '[]'],
      ['format 不符', { ...base(), format: 'photo.doc/v2' }],
      ['version 不认识', { ...base(), version: 7 }],
      ['缺 baseline', { format: DOC_FORMAT, version: 1, ops: [], cursor: 0 }],
      ['ops 不是数组', { ...base(), ops: 'nope' }],
      ['cursor 缺失', { ...base(), cursor: undefined }],
      ['含未知顶层字段', { ...base(), hacked: 1 }],
      ['op 不是对象', { ...base(), ops: ['setAdjust'] }],
      ['op kind 不认识', { ...base(), ops: [{ k: 'setColorBalance', value: {} }] }],
      ['op 缺 value', { ...base(), ops: [{ k: 'setGeometry' }] }],
      ['value 类型完全不对', { ...base(), ops: [{ k: 'setGeometry', value: 42 }] }],
      ['setCrop 没有 value 键', { ...base(), ops: [{ k: 'setCrop' }] }],
      ['setSources 的 value 不是数组', { ...base(), ops: [{ k: 'setSources', value: {}, current: 0 }] }],
    ];
    for (const [label, input] of broken) {
      expect(() => parseDocument(input), label).toThrow(DocumentParseError);
    }
  });

  it('报错文案指得出错在哪、可用 kind 有哪些，不是"解析失败"三个字', () => {
    expect(() => parseDocument({ ...base(), ops: [{ k: 'rotateImage', value: {} }] })).toThrow(
      /rotateImage[\s\S]*setSources[\s\S]*setSticker/,
    );
    expect(() => parseDocument({ format: 'photo.preset/v1' })).toThrow(/photo\.doc\/v1/);
  });

  it('数值错收敛不吵：稀疏 op、NaN、越界枚举、非法朝向与指纹各回各位', () => {
    const doc = parseDocument({
      format: DOC_FORMAT,
      version: 1,
      baseline: { sources: [], current: 0 },
      cursor: 99, // 越界：夹到 ops.length
      ops: [
        { k: 'setGeometry', value: { rotate: 90 } }, // 缺 straighten / flip*
        { k: 'setAdjust', value: { brightness: Number.NaN, contrast: 'x' } },
        { k: 'applyPreset', key: 'warm', intensity: Number.POSITIVE_INFINITY },
        { k: 'setCollage', value: { mode: 'diagonal', cutRows: 0, gap: -5 } },
        { k: 'setCrop', value: { x: Number.NaN, y: 0, w: 1, h: 1 } },
        {
          k: 'setSources',
          value: [
            { id: 'a', name: 'a.jpg', width: 8, height: 8, exifOrientation: 17, fingerprint: 'zz' },
            { id: 'b', name: 'b.jpg', width: 0, height: 8 }, // 尺寸不可用 → 整条丢弃
          ],
          current: 'nope',
        },
      ],
    });

    expect(doc.cursor).toBe(doc.ops.length);
    expect(findNonFinite(doc.ops)).toBeNull();

    const e = deriveEdit(doc);
    expect(findNonFinite(e)).toBeNull();
    /* rotate:90 在白名单内，保留；缺的三个字段回落默认 —— 少一个 straighten
     * 就变 NaN 把整张图碎掉，正是 sanitize.ts 文件头记的那次现场。 */
    expect(e.geometry).toEqual({ rotate: 90, flipH: false, flipV: false, straighten: 0 });
    expect(e.params).toEqual(NEUTRAL);
    /* 拼图三项各有自己的收敛口径：mode 不在白名单 → 回落默认；gap / cutRows 是
     * "被当除数或分配尺寸用的量"，越界不是回默认而是**夹到边界**（gap -5 → 0，
     * cutRows 0 → 1）。回落成 3 反而会把用户写的"1 行"悄悄变成 3 行。 */
    expect(e.collage).toEqual({ ...defaultCollage(), gap: 0, cutRows: 1 });
    expect(e.crop?.x).toBe(0);
    expect(e.presetIntensity).toBe(1);
    expect(e.sources).toHaveLength(1);
    /* 非法值不是"回落成合法值"，而是**整键消失** —— "没这条信息"才是真话。 */
    expect('exifOrientation' in (e.sources[0] ?? {})).toBe(false);
    expect('fingerprint' in (e.sources[0] ?? {})).toBe(false);
    expect(e.current).toBe(0);
  });

  it('全是垃圾的数值渲染不碎：输出有限、尺寸正确', () => {
    const doc = parseDocument({
      format: DOC_FORMAT,
      version: 1,
      baseline: {
        sources: [{ id: 'a', name: 'a.png', width: 16, height: 16 }],
        current: 0,
        params: { brightness: 'nope', temperature: Number.NaN },
        geometry: { rotate: 33, straighten: Number.POSITIVE_INFINITY },
        curves: { rgb: [[0, 'x'], ['y', 255], [1, 1, 1]] },
        bands: { red: 5 },
        levels: { r: { lo: Number.NaN, hi: 255, gain: 'g' } },
        collage: { mode: 'cut', cutCols: Number.POSITIVE_INFINITY, cutRows: -3 },
      },
      ops: [],
      cursor: 0,
    });
    const out = render(doc, [makeImage(16, 16)]);
    expect(out.data.length).toBe(16 * 16 * 4);
    expect(findNonFinite(Array.from(out.data))).toBeNull();
    expect([out.width, out.height]).toEqual([16, 16]);
  });

  it('settings / view 是可缺省的非语义部分，脏值只收敛不吵', () => {
    const doc = parseDocument({
      format: DOC_FORMAT,
      version: 1,
      baseline: { sources: [], current: 0 },
      ops: [],
      cursor: 0,
      settings: { export: { longEdge: 'full', format: 'tiff', quality: Infinity } },
      view: { tab: 'clip', zoom: Number.NaN, pendingCrop: { x: 1 } },
    });
    expect(doc.settings.export.format).toBe('jpeg');
    expect(doc.settings.export.longEdge).toBe(1920);
    expect(doc.view.tab).toBe('img');
    expect(doc.view.zoom).toBe(1);
    expect(doc.view.pendingCrop).toEqual({ x: 1, y: 0, w: 0, h: 0 });
  });
});

describe('photo.doc/v1 · D3 只存引用不存像素', () => {
  it('文件大小只随引用条数增长，与像素量无关', () => {
    const one = serializeDocument(docWithSources(1));
    const many = serializeDocument(docWithSources(30));
    /* 每张图的引用是一条固定形状的记录（id / 名 / 宽高 / handle / 指纹 / 字节数）。
     * 400 B 是"引用"的上限；真存了像素的话这里是 KB~MB 量级。 */
    expect((many.length - one.length) / 29).toBeLessThan(400);

    const huge = serializeDocument(docWithSources(1, 6000, 4000));
    expect(Math.abs(huge.length - one.length)).toBeLessThan(40);
  });

  it('全文没有 base64 痕迹：无长串、无 data: 前缀、无像素数组', () => {
    const text = serializeDocument(editedDoc());
    expect(text).not.toMatch(/[A-Za-z0-9+/]{64,}/);
    expect(text).not.toMatch(/"data\s*:/);
    expect(text).not.toMatch(/"pixels"/);
    expect(text.length).toBeLessThan(8_000);
  });
});
