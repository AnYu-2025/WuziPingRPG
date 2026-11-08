/**
 * 序 9（P7 先行）回归 —— 预设分享格式。
 *
 * 验收点（见 P6D-PLAN.md §2.7）：
 *   S1 预设 JSON schema + 校验：CLI 能读；跨机器导入预设文件成功；
 *   S2 坏文件被 sanitize 接住，不静默碎图。
 *
 * 测试刻意**直接调用内核**的 parseSharedPreset（绕过 CLI 输入边界），
 * 目的只有一个：证明「内核自己」也会接住坏预设 —— 输入边界的"写错了要吵"
 * 是另一条防线，但内核的收敛层必须兜底。
 *
 * 序 2（#4 自定义预设）在本文件末尾追加两组：`sharedPresetFromEditState`
 * 收哪些字段（观感进、构图不进），以及 `presetKeyFromName` / `presetFileName`
 * 为什么必须让展示名失去决定路径的能力。
 */

import { describe, expect, it } from 'vitest';

import { NEUTRAL, clampParams } from '../presets/params.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { fill } from '../pixels/compose.js';
import {
  PRESET_FORMAT,
  parseSharedPreset,
  serializeSharedPreset,
  sharedPresetToOps,
  PresetParseError,
  type SharedPreset,
} from './preset-share.js';
import { createDocument, defaultBands, defaultCurves, defaultLevels } from './defaults.js';
import { pushOp } from './history.js';
import { deriveEdit } from './reducer.js';
import {
  PRESET_FILE_SUFFIX,
  presetFileName,
  presetKeyFromName,
  sharedPresetFromEditState,
} from './preset-share.js';
import type { Op, PhotoDocument, SourceRef } from './types.js';

function srcRef(id: string, w: number, h: number): SourceRef {
  return { id, name: id, width: w, height: h };
}

function docWithSources(list: readonly SourceRef[]): PhotoDocument {
  return pushOp(createDocument(), { k: 'setSources', value: list, current: 0 });
}

function makeImage(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, 120, 60, 30, 255);
  return buf;
}

/** 把任一值伪装成 Op —— 模拟"JSON 从类型系统眼皮底下溜进来"后由预设投影出的 op。 */
function asOp(value: unknown): Op {
  return value as Op;
}

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

describe('序9 · S1 有效预设：schema 解析与往返', () => {
  it('最小合法预设（仅 params）被解析，name 缺省回落到 key', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'my_film',
      params: { brightness: 110, contrast: 105, saturate: 120 },
    });
    expect(preset.key).toBe('my_film');
    expect(preset.name).toBe('my_film');
    expect(preset.params.brightness).toBe(110);
    expect(preset.params.contrast).toBe(105);
    expect(preset.curves).toBeUndefined();
    expect(preset.levels).toBeUndefined();
    expect(preset.bands).toBeUndefined();
  });

  it('name 存在时使用 name', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'k1',
      name: '我的胶片',
      params: { ...NEUTRAL },
    });
    expect(preset.name).toBe('我的胶片');
  });

  it('params 越界被钳制（与 UI 滑杆同表）', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'k2',
      params: { brightness: 9999, saturate: -50, exposure: 1e9 },
    });
    expect(preset.params.brightness).toBe(150);
    expect(preset.params.saturate).toBe(0);
    expect(preset.params.exposure).toBe(100);
  });

  it('可选观感扩展（curves/levels/bands）原样保留', () => {
    const curves = defaultCurves();
    const levels = defaultLevels();
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'k3',
      name: '重口味',
      params: { ...NEUTRAL, contrast: 130 },
      curves,
      levels,
      // 只声明 red 一条色带：sanitizeBands 会把其余 7 条补零（不静默缺省），
      // 所以只校验"声明的那条"原样保留。
      bands: { red: { h: 5, s: 0, l: 0 } } as unknown as SharedPreset['bands'],
    });
    expect(preset.curves).toEqual(curves);
    expect(preset.levels).toEqual(levels);
    expect(preset.bands?.red).toEqual({ h: 5, s: 0, l: 0 });
  });

  it('序列化 → 再解析 往返稳定', () => {
    const original: SharedPreset = {
      format: PRESET_FORMAT,
      key: 'k4',
      name: '往返',
      params: clampParams({ ...NEUTRAL, brightness: 112, contrast: 96, saturate: 108 }),
      curves: defaultCurves(),
    };
    const text = serializeSharedPreset(original);
    const reparsed = parseSharedPreset(text);
    expect(reparsed).toEqual(original);
  });

  it('接受 JSON 文本输入（跨机传输形态）', () => {
    const text = JSON.stringify({
      format: PRESET_FORMAT,
      key: 'k5',
      name: '文本',
      params: { brightness: 105 },
    });
    const preset = parseSharedPreset(text);
    expect(preset.key).toBe('k5');
    expect(preset.params.brightness).toBe(105);
  });

  it('sharedPresetToOps：setAdjust 恒发，可选观感仅声明时发', () => {
    const ops = sharedPresetToOps({
      format: PRESET_FORMAT,
      key: 'k6',
      name: 'n',
      params: clampParams({ ...NEUTRAL, brightness: 120 }),
      levels: defaultLevels(),
    });
    expect(ops.map((o) => o.k)).toEqual(['setAdjust', 'setLevels']);
  });
});

describe('序9 · S2 坏文件：结构错了要吵', () => {
  const bad = (input: unknown): PresetParseError => {
    let thrown: unknown;
    try {
      parseSharedPreset(input);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PresetParseError);
    return thrown as PresetParseError;
  };

  it('非合法 JSON 文本 → 抛 PresetParseError', () => {
    const e = bad('{ not json ');
    expect(e.message).toContain('JSON');
  });

  it('根节点不是对象 → 抛错', () => {
    expect(bad([1, 2, 3]).message).toContain('对象');
    expect(bad(42).message).toContain('对象');
  });

  it('未知顶层字段 → 抛错（拼错的键不能默默无效）', () => {
    expect(
      bad({ format: PRESET_FORMAT, key: 'x', params: {}, oopsie: 1 }).message,
    ).toContain('未知字段');
  });

  it('缺 format → 抛错', () => {
    expect(bad({ key: 'x', params: {} }).message).toContain('format');
  });

  it('format 不符 → 抛错', () => {
    expect(bad({ format: 'photo.preset/v0', key: 'x', params: {} }).message).toContain(
      PRESET_FORMAT,
    );
  });

  it('缺 params → 抛错（params 是预设核心，必填）', () => {
    expect(bad({ format: PRESET_FORMAT, key: 'x' }).message).toContain('params');
  });

  it('key 为空串 → 抛错', () => {
    expect(bad({ format: PRESET_FORMAT, key: '   ', params: {} }).message).toContain('key');
  });
});

describe('序9 · S2 坏文件：数值问题被 sanitize 接住，不静默碎图', () => {
  it('params 内部 NaN / 非有限 → 收敛为 NEUTRAL（不抛、不产生 NaN）', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'bad',
      params: {
        brightness: 'oops' as unknown as number,
        contrast: Number.NaN,
        exposure: Number.POSITIVE_INFINITY,
      },
    });
    // 缺键与坏值都落到 NEUTRAL，整图不会发黑也不会出现 NaN。
    expect(preset.params).toEqual(NEUTRAL);
    expect(findNonFinite(preset.params)).toBeNull();
  });

  it('曲线点含非有限 → 该通道回落默认恒等曲线（不静默填 NaN）', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'badcurve',
      params: { ...NEUTRAL },
      curves: { rgb: [[0, 0], ['x', 128] as unknown as number[], [255, Number.NaN]] },
    });
    expect(preset.curves?.rgb).toEqual(defaultCurves().rgb);
  });

  it('levels 含 NaN → 非有限通道退化为中性，有限通道保留（不静默碎图）', () => {
    const preset = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'badlevels',
      params: { ...NEUTRAL },
      // lo/hi 非有限 → 退化为中性 0/255；gain 是有限数 → 保留 1.1（不是 NaN，不该被改）。
      levels: { r: { lo: Number.NaN, hi: Number.POSITIVE_INFINITY, gain: 1.1 } },
    });
    expect(preset.levels?.r).toEqual({ lo: 0, hi: 255, gain: 1.1 });
    // 整份 levels 不得含任何非有限值 —— 否则 buildLevelLut 会静默填进 NaN。
    expect(findNonFinite(preset.levels)).toBeNull();
  });

  it('套用坏预设渲染整图不碎：输出有限且与中性参数渲染逐字节一致', async () => {
    const { buildPlan } = await import('../pipeline/plan.js');
    const { executePlan } = await import('../pipeline/execute.js');

    const target = { kind: 'preview', maxEdge: 0, withText: false } as const;
    const img = makeImage(64, 48);

    // 一份全是 NaN 的坏预设：结构合法，但每个数值都是垃圾。收敛后应回落 NEUTRAL。
    const broken = parseSharedPreset({
      format: PRESET_FORMAT,
      key: 'broken',
      params: {
        brightness: Number.NaN,
        contrast: Number.POSITIVE_INFINITY,
        exposure: Number.NEGATIVE_INFINITY,
        saturate: Number.NaN,
      },
    });
    expect(broken.params).toEqual(NEUTRAL);
    // 核心就是套用收敛后的 params（应当已回落 NEUTRAL，不再含 NaN）。
    const doc = pushOp(docWithSources([srcRef('a', 64, 48)]), asOp({
      k: 'setAdjust',
      value: broken.params,
    }));

    const out = executePlan([img], buildPlan(doc, target));
    // 不静默碎图：输出有限、尺寸正确、且与中性参数渲染逐字节一致。
    expect(findNonFinite(Array.from(out.data))).toBeNull();
    expect({ w: out.width, h: out.height }).toEqual({ w: 64, h: 48 });

    const neutralDoc = pushOp(docWithSources([srcRef('a', 64, 48)]), asOp({
      k: 'setAdjust',
      value: NEUTRAL,
    }));
    const neutralOut = executePlan([img], buildPlan(neutralDoc, target));
    expect(Array.from(out.data)).toEqual(Array.from(neutralOut.data));
  });
});

/* ────────────── 序 2 · #4：从会话观感造预设 + 库文件名 ────────────── */

describe('序2 · #4 sharedPresetFromEditState：只收观感', () => {
  /** 一份"调过参数 + 拉过曲线 + 点过自动增强 + 又转了方向、加了水印"的编辑态。 */
  function styledEdit() {
    let doc = docWithSources([srcRef('a', 64, 48)]);
    doc = pushOp(
      doc,
      asOp({ k: 'setAdjust', value: clampParams({ ...NEUTRAL, brightness: 70, warm: 25 }) }),
    );
    doc = pushOp(
      doc,
      asOp({
        k: 'setLevels',
        value: {
          r: { lo: 8, hi: 240, gain: 1.1 },
          g: { lo: 0, hi: 255, gain: 1 },
          b: { lo: 0, hi: 255, gain: 1 },
        },
      }),
    );
    doc = pushOp(
      doc,
      asOp({
        k: 'setCurves',
        /* 控制点是 `[x, y]` 数对（不是对象），且少于两点不成曲线 —— 写成
         * `[{x,y}]` 会被 sanitizePoints 整体判废、回落恒等，于是这条测试
         * 会悄悄测不到曲线。 */
        value: {
          rgb: [
            [0, 0],
            [128, 170],
            [255, 255],
          ],
          r: [
            [0, 0],
            [255, 255],
          ],
          g: [
            [0, 0],
            [255, 255],
          ],
          b: [
            [0, 0],
            [255, 255],
          ],
        },
      }),
    );
    doc = pushOp(doc, asOp({ k: 'setGeometry', value: { rotate: 90 } }));
    doc = pushOp(doc, asOp({ k: 'setWatermark', value: { text: '样片' } }));
    return deriveEdit(doc);
  }

  it('参数 / 色阶 / 曲线进文件；几何、水印、拼图**不进**', () => {
    const preset = sharedPresetFromEditState('k', 'K', styledEdit());
    expect(preset.params).toEqual(styledEdit().params);
    expect(preset.levels).toBeDefined();
    expect(preset.curves).toBeDefined();
    expect(preset.bands).toBeUndefined(); // 没碰分色带 → 不写中性副本
    /* 预设是"风格"，不是"我这幅图的版式"。把旋转与水印收进来，套到下一张图上
     * 就是莫名其妙的横过来 + 别人的字。这两类字段由类型系统挡在外面：
     * SharedPreset 里根本没有它们。 */
    expect(JSON.stringify(preset)).not.toMatch(/watermark|rotate|collage/i);
  });

  it('中性观感只产出一条 setAdjust（文件里不留一堆"什么也没改"的副本）', () => {
    const neutral = deriveEdit(docWithSources([srcRef('a', 64, 48)]));
    const preset = sharedPresetFromEditState('k', 'K', neutral);
    expect(preset.curves).toBeUndefined();
    expect(preset.levels).toBeUndefined();
    expect(preset.bands).toBeUndefined();
    expect(sharedPresetToOps(preset).map((op) => op.k)).toEqual(['setAdjust']);
    /* 中性预设套上去必须真的什么也不改 —— 它是可选字段的反面用例。 */
    expect(preset.params).toEqual(NEUTRAL);
    expect(defaultLevels()).toBeDefined();
    expect(defaultCurves()).toBeDefined();
    expect(defaultBands()).toBeDefined();
  });

  it('key 与 name 各归各位：展示名原样，key 是稳定标识', () => {
    const edit = deriveEdit(docWithSources([srcRef('a', 64, 48)]));
    const preset = sharedPresetFromEditState('my-film', '我的 胶片 感', edit);
    expect(preset.key).toBe('my-film');
    expect(preset.name).toBe('我的 胶片 感'); // 空格是展示名的一部分，不该在这里被吃掉
    expect(preset.format).toBe(PRESET_FORMAT);
  });
});

describe('序2 · #4 presetKeyFromName：展示名不能决定文件写到哪', () => {
  it('路径分隔符与通配符全部变成连字符（中文名原样保留）', () => {
    expect(presetKeyFromName('../../etc/passwd')).toBe('etc-passwd');
    expect(presetKeyFromName('a:b*c?"d"e')).toBe('a-b-c-d-e');
    expect(presetKeyFromName('  我的\\胶片  感  ')).toBe('我的-胶片-感');
    expect(presetKeyFromName('Film Look')).toBe('film-look');
    expect(presetKeyFromName('CON')).toBe('con'); // 大小写统一，与内置 key 同一口径
  });

  it('退化输入不会给出空 key 或超长 key', () => {
    for (const name of ['', '   ', '...', '///', '   ', '\u0000\u001f']) {
      const key = presetKeyFromName(name);
      expect(key.length).toBeGreaterThan(0);
      expect(key).toBe(presetKeyFromName(key)); // 幂等：已经是合法形态
    }
    expect(presetKeyFromName('x'.repeat(500)).length).toBe(60);
  });

  it('文件名 = 合法 key + 固定后缀，主进程据此二次把关', () => {
    const file = presetFileName('../../evil');
    expect(file).toBe(`evil${PRESET_FILE_SUFFIX}`);
    expect(file).toBe(presetFileName(presetKeyFromName('../../evil'))); // 同一形状的产物
    expect(presetFileName('x'.repeat(500)).length).toBeLessThanOrEqual(160);
  });
});
