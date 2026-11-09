/**
 * 配方（Recipe）—— 一份可序列化的操作日志。
 *
 * 这正是文档模型那条设计带来的"免费收益"：桌面端把用户操作记成 `Op[]`，
 * 而 `Op[]` 本身就是 JSON。于是"批处理脚本"不需要另造一套 DSL ——
 * 它就是把同一份操作日志换个地方重放。
 *
 * ── 为什么这里要"归一化 + 强校验"而不是直接透传 ──────────────────
 * 内核的 op 语义是**整值设置**而非增量：
 *   - `setAdjust` 走 `clampParams(op.value)`，缺键会落到范围最小值
 *     （亮度缺失 → 50 → 图直接发黑），所以**稀疏参数是危险的**；
 *   - `applyPreset` 遇到未知名**静默返回原状态**，写错一个字母毫无提示。
 * 这两条在交互式 UI 里没什么问题（UI 永远给全量、预设来自点选），
 * 但在手写 JSON 的批处理场景里就是两个静默陷阱。
 *
 * 因此本模块负责：
 *   1. 把稀疏写法按对应默认值**补全**成完整对象（写得少，语义仍然确定）；
 *   2. 把类型错误、未知字段、未知预设名**变成明确报错**（写错了要吵）。
 * 归一化之后内核收到的永远是结构完整的 op，校验逻辑也就只有这一处。
 */

import {
  color,
  doc as docApi,
  metadata,
  presets,
  type CollageMode,
  type geometry,
} from '@photo/core';

export type Op = docApi.Op;

export interface Recipe {
  readonly name: string;
  /** 归一化后的操作序列，可直接交给 pushOp 重放。 */
  readonly ops: readonly Op[];
}

export type RecipeParseResult =
  | { readonly ok: true; readonly recipe: Recipe }
  | { readonly ok: false; readonly error: string };

/** 空配方：不调色，只做尺寸归一。 */
export function emptyRecipe(name = 'empty'): Recipe {
  return { name, ops: [] };
}

const COLLAGE_MODES: readonly string[] = ['single', 'h', 'v', 'grid', 'cut'];
const WATERMARK_POSITIONS: readonly string[] = ['br', 'bl', 'tr', 'tl', 'c'];
const STICKER_STYLES: readonly string[] = ['white', 'black', 'gold', 'seal'];
const STICKER_POSITIONS: readonly string[] = ['bottom', 'top', 'center'];
const ROTATIONS: readonly number[] = [0, 90, 180, 270];
/** 色阶的三个通道。 */
const LEVEL_CHANNELS: readonly ('r' | 'g' | 'b')[] = ['r', 'g', 'b'];
const BORDER_COLORS: readonly string[] = ['#ffffff', '#000000'];

/** 内部用异常收敛错误路径，避免每层都写一遍联合类型分支。 */
class RecipeIssue extends Error {}

function fail(message: string): never {
  throw new RecipeIssue(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${where} 必须是对象。`);
  return value;
}

function requireNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where}.${key} 必须是有限数值，实际为 ${JSON.stringify(value)}。`);
  }
  return value;
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    fail(`${where}.${key} 必须是字符串，实际为 ${JSON.stringify(value)}。`);
  }
  return value;
}

function requireBoolean(source: Record<string, unknown>, key: string, where: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    fail(`${where}.${key} 必须是 true / false，实际为 ${JSON.stringify(value)}。`);
  }
  return value;
}

function requireEnum(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  where: string,
): string {
  const value = requireString(source, key, where);
  if (!allowed.includes(value)) {
    fail(`${where}.${key} 只能是 ${allowed.join(' / ')}，实际为 "${value}"。`);
  }
  return value;
}

/** 合并成完整对象，并拒绝未知字段（拼错的键必须报错，不能默默无效）。 */
function mergeFields<T extends object>(
  defaults: T,
  provided: Record<string, unknown>,
  known: readonly string[],
  where: string,
): T {
  const unknown = Object.keys(provided).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    fail(
      `${where} 含未知字段：${unknown.join(', ')}。` +
        `可用字段：${known.join(', ')}。`,
    );
  }
  return { ...defaults, ...(provided as Partial<T>) };
}

/** 曲线控制点必须是 [x, y] 两点数组 —— 形状错了 LUT 会静默填进 NaN。 */
function assertCurvePoints(points: unknown, where: string): void {
  if (!Array.isArray(points)) {
    fail(`${where} 必须是控制点数组，形如 [[0,0],[255,255]]。`);
  }
  points.forEach((point: unknown, index: number) => {
    if (!Array.isArray(point) || point.length !== 2) {
      fail(`${where}[${index}] 必须是 [x, y] 两点数组。`);
    }
    for (const axis of [0, 1]) {
      const value = point[axis];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`${where}[${index}][${axis}] 必须是有限数值，实际为 ${JSON.stringify(value)}。`);
      }
    }
  });
}

/** 把一条原始 op 归一化为结构化 op。 */
function normalizeOp(raw: unknown, index: number): Op {
  const where = `ops[${index}]`;
  const source = requireRecord(raw, where);
  const kind = source['k'];
  if (typeof kind !== 'string') fail(`${where} 缺少字符串字段 "k"。`);
  const value = source['value'];

  switch (kind) {
    case 'setSources': {
      const list = source['value'];
      if (!Array.isArray(list)) fail(`${where}.value 必须是数组。`);
      const refs = list.map((item, i) => {
        const refWhere = `${where}.value[${i}]`;
        const ref = requireRecord(item, refWhere);
        /* `exifOrientation` 必须**原样透传**：这是"这张图已经转过一次"的留痕，
         * 归一化时悄悄丢掉，等于让同一份配方在两端各自转一次。
         * 允许，但只接受 1..8；非法值报错而不是回落成"没有"。 */
        const raw = ref['exifOrientation'];
        if (raw !== undefined && raw !== null && !metadata.isExifOrientation(raw)) {
          fail(
            `${refWhere}.exifOrientation 必须是 1..8 的整数（EXIF 朝向码），实际为 ${JSON.stringify(raw)}。`,
          );
        }
        const orientation = metadata.isExifOrientation(raw) ? raw : null;
        return {
          id: requireString(ref, 'id', refWhere),
          name: requireString(ref, 'name', refWhere),
          width: requireNumber(ref, 'width', refWhere),
          height: requireNumber(ref, 'height', refWhere),
          ...(orientation === null ? {} : { exifOrientation: orientation }),
        };
      });
      const current = source['current'];
      if (typeof current !== 'number' || !Number.isFinite(current)) {
        fail(`${where}.current 必须是数值。`);
      }
      return { k: 'setSources', value: refs, current };
    }

    case 'setAdjust': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        presets.NEUTRAL,
        provided,
        presets.ADJUST_KEYS,
        `${where}.value`,
      );
      // 补全后再逐个确认是有限数值 —— 归一化把"缺键发黑"变成不可能。
      for (const key of presets.ADJUST_KEYS) {
        requireNumber(merged as unknown as Record<string, unknown>, key, `${where}.value`);
      }
      return { k: 'setAdjust', value: presets.clampParams(merged) };
    }

    case 'applyPreset': {
      const key = source['key'];
      if (typeof key !== 'string' || key.trim() === '') {
        fail(`${where} 缺少字符串字段 "key"。`);
      }
      if (presets.findPreset(key) === undefined) {
        const available = presets.BUILTIN_PRESETS.map((p) => p.key).join(', ');
        fail(`${where}.key = "${key}" 不是内置预设。可用预设：${available}`);
      }
      const intensity = source['intensity'];
      if (typeof intensity !== 'number' || !Number.isFinite(intensity)) {
        fail(`${where} 缺少数值字段 "intensity"（0..1）。`);
      }
      if (intensity < 0 || intensity > 1) {
        fail(`${where}.intensity 必须在 0..1 之间，实际为 ${intensity}。`);
      }
      return { k: 'applyPreset', key, intensity };
    }

    case 'setLevels': {
      const provided = requireRecord(value, `${where}.value`);
      const unknown = Object.keys(provided).filter(
        (key) => !(LEVEL_CHANNELS as readonly string[]).includes(key),
      );
      if (unknown.length > 0) {
        fail(
          `${where}.value 含未知通道：${unknown.join(', ')}。可用通道：${LEVEL_CHANNELS.join(', ')}。`,
        );
      }
      const levels: Record<'r' | 'g' | 'b', color.LevelChannel> = { ...docApi.defaultLevels() };
      for (const ch of LEVEL_CHANNELS) {
        const raw = provided[ch];
        if (raw === undefined) continue;
        const at = `${where}.value.${ch}`;
        const merged = mergeFields(
          { lo: 0, hi: 255, gain: 1 },
          requireRecord(raw, at),
          ['lo', 'hi', 'gain'],
          at,
        );
        const asRecord = merged as unknown as Record<string, unknown>;
        const lo = requireNumber(asRecord, 'lo', at);
        const hi = requireNumber(asRecord, 'hi', at);
        const gain = requireNumber(asRecord, 'gain', at);
        if (lo < 0 || lo > 255) {
          fail(`${at}.lo 必须在 0..255 之间，实际为 ${lo}。`);
        }
        /* hi > lo 是硬约束：hi == lo 会让 buildLevelLut 的 span 退化成 1，
         * 整条 LUT 变成"阈值"而不是"色阶"—— 那是静默改变了用户要的东西。 */
        if (hi <= lo || hi > 255) {
          fail(`${at}.hi 必须大于 lo 且不超过 255，实际 lo=${lo}、hi=${hi}。`);
        }
        if (!(gain > 0) || gain > 4) {
          fail(`${at}.gain 必须在 (0, 4] 之间，实际为 ${gain}。`);
        }
        levels[ch] = { lo, hi, gain };
      }
      return { k: 'setLevels', value: levels };
    }

    case 'setCurves': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        docApi.defaultCurves(),
        provided,
        ['rgb', 'r', 'g', 'b'],
        `${where}.value`,
      );
      for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
        assertCurvePoints(merged[channel], `${where}.value.${channel}`);
      }
      return { k: 'setCurves', value: merged };
    }

    case 'setBands': {
      const provided = requireRecord(value, `${where}.value`);
      const known = color.HSL_BAND_KEYS;
      const unknown = Object.keys(provided).filter(
        (key) => !(known as readonly string[]).includes(key),
      );
      if (unknown.length > 0) {
        fail(
          `${where}.value 含未知色带：${unknown.join(', ')}。` +
            `可用色带：${known.join(', ')}。`,
        );
      }

      /* 每条色带是 {h,s,l} 对象而**不是**单个数字。
       * 若把数字透传下去，accumulateBandAdjust 会算出 NaN 且不报错 ——
       * 整张图的颜色会静默烂掉。所以这里逐带逐轴校验。 */
      const bands: Partial<Record<color.HslBand, color.BandAdjust>> = {};
      for (const band of known) {
        const raw = provided[band];
        if (raw === undefined) {
          bands[band] = { h: 0, s: 0, l: 0 };
          continue;
        }
        const bandWhere = `${where}.value.${band}`;
        const merged = mergeFields(
          { h: 0, s: 0, l: 0 },
          requireRecord(raw, bandWhere),
          ['h', 's', 'l'],
          bandWhere,
        );
        for (const axis of ['h', 's', 'l']) {
          requireNumber(merged as unknown as Record<string, unknown>, axis, bandWhere);
        }
        bands[band] = merged;
      }
      return { k: 'setBands', value: bands as color.BandAdjustMap };
    }

    case 'setGeometry': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        docApi.defaultGeometry(),
        provided,
        ['rotate', 'flipH', 'flipV', 'straighten'],
        `${where}.value`,
      );
      const rotate = requireNumber(
        merged as unknown as Record<string, unknown>,
        'rotate',
        `${where}.value`,
      );
      if (!ROTATIONS.includes(rotate)) {
        fail(`${where}.value.rotate 只能是 0 / 90 / 180 / 270，实际为 ${rotate}。`);
      }
      const flipH = requireBoolean(
        merged as unknown as Record<string, unknown>,
        'flipH',
        `${where}.value`,
      );
      const flipV = requireBoolean(
        merged as unknown as Record<string, unknown>,
        'flipV',
        `${where}.value`,
      );
      const straighten = requireNumber(
        merged as unknown as Record<string, unknown>,
        'straighten',
        `${where}.value`,
      );
      return {
        k: 'setGeometry',
        value: { rotate: rotate as geometry.Rotate, flipH, flipV, straighten },
      };
    }

    case 'setCrop': {
      if (value === null) return { k: 'setCrop', value: null };
      const rect = requireRecord(value, `${where}.value`);
      const box = mergeFields({ x: 0, y: 0, w: 0, h: 0 }, rect, ['x', 'y', 'w', 'h'], `${where}.value`);
      for (const key of ['x', 'y', 'w', 'h']) {
        requireNumber(box as unknown as Record<string, unknown>, key, `${where}.value`);
      }
      return { k: 'setCrop', value: box };
    }

    case 'setCollage': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        docApi.defaultCollage(),
        provided,
        ['mode', 'gap', 'bg', 'cutCols', 'cutRows', 'borderWidth', 'borderColor'],
        `${where}.value`,
      );
      const record = merged as unknown as Record<string, unknown>;
      const mode = requireEnum(record, 'mode', COLLAGE_MODES, `${where}.value`);
      const bg = requireEnum(record, 'bg', ['color', 'blur'], `${where}.value`);
      const borderColor = requireEnum(record, 'borderColor', BORDER_COLORS, `${where}.value`);
      const collage = {
        mode: mode as CollageMode,
        gap: requireNumber(record, 'gap', `${where}.value`),
        bg: bg as 'color' | 'blur',
        cutCols: requireNumber(record, 'cutCols', `${where}.value`),
        cutRows: requireNumber(record, 'cutRows', `${where}.value`),
        borderWidth: requireNumber(record, 'borderWidth', `${where}.value`),
        borderColor: borderColor as '#ffffff' | '#000000',
      };
      return { k: 'setCollage', value: collage };
    }

    case 'setWatermark': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        docApi.defaultWatermark(),
        provided,
        ['text', 'pos', 'color', 'stroke', 'size', 'alpha'],
        `${where}.value`,
      );
      const record = merged as unknown as Record<string, unknown>;
      const watermark = {
        text: requireString(record, 'text', `${where}.value`),
        pos: requireEnum(record, 'pos', WATERMARK_POSITIONS, `${where}.value`) as
          | 'br'
          | 'bl'
          | 'tr'
          | 'tl'
          | 'c',
        color: requireString(record, 'color', `${where}.value`),
        stroke: requireBoolean(record, 'stroke', `${where}.value`),
        size: requireNumber(record, 'size', `${where}.value`),
        alpha: requireNumber(record, 'alpha', `${where}.value`),
      };
      return { k: 'setWatermark', value: watermark };
    }

    case 'setSticker': {
      const provided = requireRecord(value, `${where}.value`);
      const merged = mergeFields(
        docApi.defaultSticker(),
        provided,
        ['text', 'style', 'pos', 'size'],
        `${where}.value`,
      );
      const record = merged as unknown as Record<string, unknown>;
      const sticker = {
        text: requireString(record, 'text', `${where}.value`),
        style: requireEnum(record, 'style', STICKER_STYLES, `${where}.value`) as
          | 'white'
          | 'black'
          | 'gold'
          | 'seal',
        pos: requireEnum(record, 'pos', STICKER_POSITIONS, `${where}.value`) as
          | 'bottom'
          | 'top'
          | 'center',
        size: requireNumber(record, 'size', `${where}.value`),
      };
      return { k: 'setSticker', value: sticker };
    }

    default:
      fail(
        `${where}.k = "${kind}" 不是已知操作。` +
          `可用操作：setSources / setAdjust / applyPreset / setCurves / setBands / ` +
          `setGeometry / setCrop / setCollage / setWatermark / setSticker`,
      );
  }
}

/** 校验并归一化一份已解析的 JSON 对象。 */
export function validateRecipe(raw: unknown, fallbackName = 'recipe'): RecipeParseResult {
  try {
    if (!isRecord(raw)) {
      fail('配方根节点必须是对象，形如 {"ops":[...]}。');
    }
    const nameRaw = raw['name'];
    const name =
      typeof nameRaw === 'string' && nameRaw.trim() !== '' ? nameRaw.trim() : fallbackName;

    const opsRaw = raw['ops'];
    if (opsRaw === undefined) fail('配方缺少 "ops" 字段。');
    if (!Array.isArray(opsRaw)) fail('"ops" 必须是数组。');

    const operations: Op[] = [];
    for (let i = 0; i < opsRaw.length; i++) {
      operations.push(normalizeOp(opsRaw[i], i));
    }
    return { ok: true, recipe: { name, ops: operations } };
  } catch (e) {
    if (e instanceof RecipeIssue) return { ok: false, error: e.message };
    throw e;
  }
}

/** 解析配方文本。 */
export function parseRecipe(text: string, fallbackName = 'recipe'): RecipeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `配方不是合法 JSON：${detail}` };
  }
  return validateRecipe(raw, fallbackName);
}
