import { describe, expect, it } from 'vitest';
import { NEUTRAL, mixWithNeutral } from '../presets/params.js';
import { findPreset } from '../presets/builtin.js';
import { defaultCurves, createDocument } from './defaults.js';
import { deriveEdit, deriveEditWith } from './reducer.js';
import { canRedo, canUndo, jumpTo, lastOp, pushOp, redo, squash, undo } from './history.js';
import type { EditState, Op, PhotoDocument, SourceRef } from './types.js';

function src(id: string, w = 1600, h = 900): SourceRef {
  return { id, name: `${id}.jpg`, width: w, height: h };
}

function withBrightness(v: number): Op {
  return { k: 'setAdjust', value: { ...NEUTRAL, brightness: v } };
}

const SAMPLE_OPS: readonly Op[] = [
  { k: 'setSources', value: [src('a'), src('b')], current: 0 },
  withBrightness(120),
  { k: 'applyPreset', key: 'film', intensity: 1 },
  { k: 'setLevels', value: { r: { lo: 8, hi: 240, gain: 1.05 }, g: { lo: 0, hi: 255, gain: 1 }, b: { lo: 20, hi: 210, gain: 0.95 } } },
  { k: 'setGeometry', value: { rotate: 90, flipH: true, flipV: false, straighten: 0 } },
  { k: 'setCurves', value: { ...defaultCurves(), rgb: [[0, 0], [128, 96], [255, 255]] } },
  { k: 'setCrop', value: { x: 10, y: 20, w: 300, h: 200 } },
  { k: 'setCollage', value: { mode: 'grid', gap: 12, bg: 'blur', cutCols: 3, cutRows: 3, borderWidth: 4, borderColor: '#ffffff' } },
  { k: 'setWatermark', value: { text: '2026 雨天', pos: 'br', color: '#ffffff', stroke: true, size: 3, alpha: 85 } },
  { k: 'setSticker', value: { text: '雨后', style: 'gold', pos: 'bottom', size: 6 } },
];

function applyAll(ops: readonly Op[]): PhotoDocument {
  let doc = createDocument();
  for (const op of ops) doc = pushOp(doc, op);
  return doc;
}

describe('文档基线', () => {
  it('空文档的派生状态为中性', () => {
    const state = deriveEdit(createDocument());
    expect(state.params).toEqual(NEUTRAL);
    expect(state.sources).toEqual([]);
    expect(state.presetKey).toBeNull();
    expect(state.geometry.rotate).toBe(0);
  });

  it('setSources 会钳制 current 索引', () => {
    const doc = pushOp(createDocument(), {
      k: 'setSources',
      value: [src('a'), src('b')],
      current: 99,
    });
    expect(deriveEdit(doc).current).toBe(1);
  });

  it('源图清空后 current 归零', () => {
    const doc = pushOp(createDocument(), { k: 'setSources', value: [], current: 3 });
    expect(deriveEdit(doc).current).toBe(0);
  });
});

describe('撤销 / 重做 不变量', () => {
  it('任意操作序列：逐步撤销等于回到对应历史节点', () => {
    const snapshots: EditState[] = [deriveEdit(createDocument())];
    let doc = createDocument();
    for (const op of SAMPLE_OPS) {
      doc = pushOp(doc, op);
      snapshots.push(deriveEdit(doc));
    }

    // 从末尾一路撤到底，每一步都必须精确等于该历史节点的状态
    for (let i = SAMPLE_OPS.length; i > 0; i--) {
      doc = undo(doc);
      expect(deriveEdit(doc), `撤销到第 ${i - 1} 步`).toEqual(snapshots[i - 1]);
    }
    expect(canUndo(doc)).toBe(false);
  });

  it('逐步重做回到终态', () => {
    let doc = applyAll(SAMPLE_OPS);
    const finalState = deriveEdit(doc);
    for (let i = 0; i < SAMPLE_OPS.length; i++) doc = undo(doc);
    for (let i = 0; i < SAMPLE_OPS.length; i++) doc = redo(doc);
    expect(deriveEdit(doc)).toEqual(finalState);
    expect(canRedo(doc)).toBe(false);
  });

  it('撤销到中点后状态与直接重放到中点一致', () => {
    const doc = applyAll(SAMPLE_OPS);
    const mid = jumpTo(doc, 4);
    expect(deriveEdit(mid)).toEqual(deriveEditWith(doc, 4));
  });

  it('无法撤销时 undo 不抛错且不变', () => {
    const doc = createDocument();
    expect(undo(doc)).toBe(doc);
    expect(canUndo(doc)).toBe(false);
  });

  it('新操作会截断重做分支', () => {
    let doc = applyAll(SAMPLE_OPS);
    doc = undo(doc);
    doc = undo(doc);
    expect(canRedo(doc)).toBe(true);
    doc = pushOp(doc, withBrightness(77));
    expect(canRedo(doc)).toBe(false);
    expect(deriveEdit(doc).params.brightness).toBe(77);
  });

  it('lastOp 只反映生效区间内的栈顶', () => {
    let doc = applyAll([withBrightness(120), withBrightness(130)]);
    expect(lastOp(doc)).toEqual(withBrightness(130));
    doc = undo(doc);
    expect(lastOp(doc)).toEqual(withBrightness(120));
  });
});

describe('回归：legacy 的两条真实缺陷', () => {
  it('P1-2 滑杆调整可以正确撤销（legacy 中该场景撤销无效）', () => {
    let doc = createDocument();
    const before = deriveEdit(doc).params.brightness;
    expect(before).toBe(100);

    doc = pushOp(doc, withBrightness(120));
    expect(deriveEdit(doc).params.brightness).toBe(120);

    doc = undo(doc);
    // legacy 的 snap() 在改值之后才记录，导致撤销后仍是新值
    expect(deriveEdit(doc).params.brightness).toBe(before);
  });

  it('P0-2 历史条目体积恒定，与图片尺寸无关', () => {
    // legacy 把整图 base64 dataURL 压进撤销栈：4000×3000 PNG 约 20–50 MB / 条。
    // 新模型每条操作只存参数，单条约 200 字节。
    let doc = createDocument();
    for (let i = 0; i < 200; i++) {
      doc = pushOp(doc, withBrightness(100 + (i % 50)));
    }
    const json = JSON.stringify(doc);
    expect(doc.ops.length).toBe(200);
    // 200 条操作 < 100 KB；换成 legacy 的模型同规模会是数 GB
    expect(json.length).toBeLessThan(100_000);
  });

  it('P0-2 文档中不出现任何 base64 像素数据', () => {
    const doc = applyAll(SAMPLE_OPS);
    const json = JSON.stringify(doc);
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');
  });
});

describe('pushOp 的合并语义', () => {
  it('merge=true 时连续同类操作只留一条', () => {
    let doc = createDocument();
    for (const v of [101, 105, 110, 118, 125]) {
      doc = pushOp(doc, withBrightness(v), { merge: true });
    }
    expect(doc.ops.length).toBe(1);
    expect(deriveEdit(doc).params.brightness).toBe(125);
  });

  it('一次拖拽只占一步撤销', () => {
    let doc = createDocument();
    for (const v of [105, 110, 115]) doc = pushOp(doc, withBrightness(v), { merge: true });
    doc = pushOp(doc, withBrightness(140)); // 松手后的新一次调整
    doc = undo(doc);
    expect(deriveEdit(doc).params.brightness).toBe(115);
  });

  it('merge=true 但类型不同则不合并', () => {
    let doc = createDocument();
    doc = pushOp(doc, withBrightness(120), { merge: true });
    doc = pushOp(doc, { k: 'setCrop', value: { x: 0, y: 0, w: 10, h: 10 } }, { merge: true });
    expect(doc.ops.length).toBe(2);
  });

  it('默认不合并', () => {
    let doc = createDocument();
    doc = pushOp(doc, withBrightness(101));
    doc = pushOp(doc, withBrightness(102));
    expect(doc.ops.length).toBe(2);
  });
});

describe('预设投影', () => {
  it('applyPreset 幂等：与当前状态无关', () => {
    const dirty = applyAll([withBrightness(60), { k: 'setGeometry', value: { rotate: 90, flipH: false, flipV: false, straighten: 0 } }]);
    const a = deriveEdit(pushOp(dirty, { k: 'applyPreset', key: 'film', intensity: 1 }));
    const b = deriveEdit(pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 1 }));
    expect(a.params).toEqual(b.params);
    expect(a.presetKey).toBe('film');
  });

  it('强度 0 等价于中性，强度 1 等于完整预设', () => {
    const zero = deriveEdit(pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 0 }));
    expect(zero.params).toEqual(NEUTRAL);

    const full = deriveEdit(pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 1 }));
    expect(full.params.warm).toBe(22);
  });

  it('手改参数会清除 presetKey（强度基准失效）', () => {
    let doc = pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 1 });
    expect(deriveEdit(doc).presetKey).toBe('film');
    doc = pushOp(doc, withBrightness(120));
    expect(deriveEdit(doc).presetKey).toBeNull();
  });

  it('presetIntensity 是投影的一部分：参数与强度同源，且随历史前后一致', () => {
    const film = findPreset('film');
    expect(film).toBeDefined();
    let doc = pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 0.55 });
    const st = deriveEdit(doc);
    /* 强度不是"另一个数字"，它就是参数的生成系数 —— 两者必须同源。 */
    expect(st.presetIntensity).toBe(0.55);
    expect(st.params).toEqual(mixWithNeutral(film!.params, 0.55));

    doc = pushOp(doc, { k: 'applyPreset', key: 'film', intensity: 0.9 });
    expect(deriveEdit(doc).presetIntensity).toBe(0.9);

    /* 撤销后退回旧强度、重做后回到新强度 —— 壳读 EditState 就能让滑杆跟着历史走。 */
    doc = undo(doc);
    expect(deriveEdit(doc).presetIntensity).toBe(0.55);
    doc = redo(doc);
    expect(deriveEdit(doc).presetIntensity).toBe(0.9);
  });

  it('手改参数后 presetIntensity 归 1（无预设则强度无意义）', () => {
    let doc = pushOp(createDocument(), { k: 'applyPreset', key: 'film', intensity: 0.55 });
    expect(deriveEdit(doc).presetIntensity).toBe(0.55);
    doc = pushOp(doc, withBrightness(120));
    expect(deriveEdit(doc).presetIntensity).toBe(1);
  });

  it('未知预设被安全忽略', () => {
    const doc = pushOp(createDocument(), { k: 'applyPreset', key: 'nope', intensity: 1 });
    expect(doc.ops.length).toBe(1);
    expect(deriveEdit(doc).params).toEqual(NEUTRAL);
  });
});

describe('序列化', () => {
  it('JSON 往返后行为完全一致', () => {
    const doc = applyAll(SAMPLE_OPS);
    const round = JSON.parse(JSON.stringify(doc)) as PhotoDocument;
    expect(deriveEdit(round)).toEqual(deriveEdit(doc));
    expect(round.ops.length).toBe(doc.ops.length);
  });

  it('squash 后状态不变但历史清空', () => {
    const doc = applyAll(SAMPLE_OPS);
    const before = deriveEdit(doc);
    const flat = squash(doc);
    expect(deriveEdit(flat)).toEqual(before);
    expect(flat.ops.length).toBe(0);
    expect(flat.cursor).toBe(0);
    expect(canUndo(flat)).toBe(false);
  });
});
