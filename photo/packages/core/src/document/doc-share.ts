/**
 * 工程文件格式 —— `photo.doc/v1`（序 2 · 决策 D14）。
 *
 * 与 `preset-share.ts`（`photo.preset/v1`）**同构的双防线**，因为两者面对的是
 * 同一类敌人：外来的、不可信的、可能被人手改过的 JSON。
 *
 *   结构性问题（根不是对象 / format 不符 / version 不认识 / 缺 baseline|ops|cursor /
 *   未知 op kind / op 缺 value / 该是对象却给了字符串）
 *     → 抛 `DocumentParseError`，**写错了要吵**。
 *   数值问题（value 对象内部字段缺失、类型不符、NaN、越界、枚举值不在白名单）
 *     → 复用 `sanitize*` 收敛，**绝不静默碎图**。
 *
 * 分界线要说清楚，否则两边都会以为自己该管：
 *   **op 自身的骨架**（k / value 在不在、是什么种类）是结构 —— 猜不出这条 op
 *   想干什么，就没有"退化"可言，只能吵；
 *   **value 对象内部的字段**是数值 —— `{rotate: 90}` 少了 `straighten`，
 *   意图明确（就是那份几何状态），只是数字不全，回落默认值就是正确答案。
 *
 * ── 只存引用，不存像素 ──────────────────────────────────────────────
 * 源图以 `SourceRef`（id / 名 / 显示态宽高 / handle / 字节数 / 指纹 / 朝向）记录，
 * 像素由宿主持有。于是工程文件是几十 KB 的纯文本，可以进版本控制、可以互传；
 * 代价是"文件会漂"，那一半交给 `document/identity.ts`（D4）。
 *
 * ── 为什么不内嵌 base64 ─────────────────────────────────────────────
 * legacy 存的就是 base64 快照：一份工程几十 MB、丢掉了整条撤销栈（快照是结果
 * 不是过程）、而且**再也改不动参数**。工程文件的价值恰恰在于它是可编辑的描述。
 */

import type { AdjustParams } from '../presets/params.js';
import type {
  CollageState,
  CurveSet,
  DocumentSettings,
  DocumentVersion,
  EditState,
  GeometryState,
  Op,
  PhotoDocument,
  SourceRef,
  StickerState,
  ViewState,
  WatermarkState,
} from './types.js';
import {
  sanitizeBands,
  sanitizeCollage,
  sanitizeCrop,
  sanitizeCurves,
  sanitizeEditState,
  sanitizeGeometry,
  sanitizeLevels,
  sanitizeParams,
  sanitizeSettings,
  sanitizeSources,
  sanitizeSticker,
  sanitizeView,
  sanitizeWatermark,
} from './sanitize.js';
import { createDocument } from './defaults.js';
import type { BandAdjustMap } from '../color/types.js';
import type { LevelsState } from '../color/levels.js';

/** 工程文件格式标识（含版本号，未来演进用）。 */
export const DOC_FORMAT = 'photo.doc/v1' as const;

/** 本模块认得的文档版本。`version` 是结构而非数值：不认识的版本没法"退化处理"。 */
const DOC_VERSIONS: readonly number[] = [1];

/** 工程文件解析失败：结构错了要吵，不静默。 */
export class DocumentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentParseError';
  }
}

function fail(message: string): never {
  throw new DocumentParseError(message);
}

/** 只要"对象"，不要数组、不要 null。 */
function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const KNOWN_TOP = ['format', 'version', 'baseline', 'ops', 'cursor', 'settings', 'view'] as const;

/** 全部 op kind，顺序与 `types.ts` 的 `Op` 联合一致。 */
const OP_KINDS = [
  'setSources',
  'setAdjust',
  'applyPreset',
  'setLevels',
  'setCurves',
  'setBands',
  'setGeometry',
  'setCrop',
  'setCollage',
  'setWatermark',
  'setSticker',
] as const satisfies readonly (Op['k'])[];

/* ─────────────────────────────── 序列化 ─────────────────────────────── */

/**
 * 编辑状态 → JSON 片段。
 *
 * 显式列字段而不是 `{...state}`：文档对象上若被挂了别的键（第三方包装、
 * 将来的迁移垫片），不该顺着写进文件再被下游当成"文件格式的一部分"。
 */
function editStateToJson(state: EditState): Record<string, unknown> {
  const clean = sanitizeEditState(state);
  return {
    sources: clean.sources.map((s) => sourceToJson(s)),
    current: clean.current,
    params: clean.params,
    levels: clean.levels,
    curves: clean.curves,
    bands: clean.bands,
    geometry: clean.geometry,
    crop: clean.crop,
    collage: clean.collage,
    watermark: clean.watermark,
    sticker: clean.sticker,
    presetKey: clean.presetKey,
    presetIntensity: clean.presetIntensity,
  };
}

function sourceToJson(s: SourceRef): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    width: s.width,
    height: s.height,
    ...(s.handle === undefined ? {} : { handle: s.handle }),
    ...(s.exifOrientation === undefined ? {} : { exifOrientation: s.exifOrientation }),
    ...(s.bytes === undefined ? {} : { bytes: s.bytes }),
    ...(s.fingerprint === undefined ? {} : { fingerprint: s.fingerprint }),
  };
}

function opToJson(op: Op): Record<string, unknown> {
  switch (op.k) {
    /* setSources 的 value 是**列表**，且 op 自身带 current：单独一型。 */
    case 'setSources':
      return { k: op.k, value: op.value.map((s) => sourceToJson(s)), current: op.current };
    case 'applyPreset':
      return { k: op.k, key: op.key, intensity: op.intensity };
    case 'setCrop':
      /* crop 的合法值包含 null（"取消裁切"），不能一律塞进 value 对象。 */
      return { k: op.k, value: op.value };
    case 'setAdjust':
      return { k: op.k, value: sanitizeParams(op.value as AdjustParams) };
    case 'setLevels':
      return { k: op.k, value: sanitizeLevels(op.value as LevelsState) };
    case 'setCurves':
      return { k: op.k, value: sanitizeCurves(op.value as CurveSet) };
    case 'setBands':
      return { k: op.k, value: sanitizeBands(op.value as BandAdjustMap) };
    case 'setGeometry':
      return { k: op.k, value: sanitizeGeometry(op.value as GeometryState) };
    case 'setCollage':
      return { k: op.k, value: sanitizeCollage(op.value as CollageState) };
    case 'setWatermark':
      return { k: op.k, value: sanitizeWatermark(op.value as WatermarkState) };
    case 'setSticker':
      return { k: op.k, value: sanitizeSticker(op.value as StickerState) };
    default: {
      const exhaustive: never = op;
      return exhaustive as never;
    }
  }
}

/**
 * 文档 → 工程文件文本（2 空格缩进，便于人读与 diff）。
 *
 * 写出去之前先过一遍收敛：于是"文件里有的，一定是解析器也认的"，
 * 往返（serialize → parse → serialize）逐字节稳定，而不是每次都掉点东西。
 */
export function serializeDocument(doc: PhotoDocument): string {
  const cursor = clampCursor(doc.cursor, doc.ops.length);
  const view: ViewState = sanitizeView(doc.view);
  const settings: DocumentSettings = sanitizeSettings(doc.settings);
  return JSON.stringify(
    {
      format: DOC_FORMAT,
      version: 1 satisfies DocumentVersion,
      baseline: editStateToJson(doc.baseline),
      ops: doc.ops.map((op) => opToJson(op)),
      cursor,
      settings,
      view,
    },
    null,
    2,
  );
}

function clampCursor(value: number, opsLength: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.round(value)), opsLength);
}

/* ─────────────────────────────── 解析 ─────────────────────────────── */

/**
 * 解析工程文件（接受 JSON 文本或已解析对象）。
 *
 * 返回的 `PhotoDocument` 里，`baseline` 与每条 op 的 value 都已过收敛，
 * 因此调用方可以直接交给 `deriveEdit` / `buildPlan` —— 中间没有"再校验一次"
 * 的义务，也就没有"忘了再校验一次"的口子。
 */
export function parseDocument(input: string | unknown): PhotoDocument {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as unknown;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      fail(`工程文件不是合法 JSON：${detail}`);
    }
  }

  const root = rec(raw);
  if (root === null) {
    fail('工程文件根节点必须是对象，形如 {"format":"photo.doc/v1", ...}。');
  }

  const unknown = Object.keys(root).filter((k) => !(KNOWN_TOP as readonly string[]).includes(k));
  if (unknown.length > 0) {
    fail(`工程文件含未知字段：${unknown.join(', ')}。可用字段：${KNOWN_TOP.join(', ')}。`);
  }

  if (root['format'] !== DOC_FORMAT) {
    fail(`工程文件 format 必须是 "${DOC_FORMAT}"，实际为 ${JSON.stringify(root['format'])}。`);
  }

  const version = root['version'];
  if (typeof version !== 'number' || !DOC_VERSIONS.includes(version)) {
    fail(`工程文件 version 不认识（期望 ${DOC_VERSIONS.join('/')}，实际 ${JSON.stringify(version)}）。`);
  }

  /* 这三样是文档的骨架，缺任何一样都没法"退化成中性"：没有 baseline 就不知道
   * 起点，没有 ops 就不知道过程，没有 cursor 就不知道现在在哪。 */
  const baselineRaw = root['baseline'];
  if (rec(baselineRaw) === null) fail('工程文件缺少合法的 "baseline" 对象。');
  const opsRaw = root['ops'];
  if (!Array.isArray(opsRaw)) fail('工程文件缺少 "ops" 数组（无历史时写 []）。');
  const cursorRaw = root['cursor'];
  if (typeof cursorRaw !== 'number' || !Number.isFinite(cursorRaw)) {
    fail(`工程文件的 "cursor" 必须是有限数，实际为 ${JSON.stringify(cursorRaw)}。`);
  }

  const ops = opsRaw.map((item, i) => parseOp(item, i));
  /* 结构已经认过（是对象），字段内部交给 sanitize —— 这条 cast 正是
   * "骨架要吵、数值要收敛"那条分界线的落点。 */
  const baseline = sanitizeEditState(baselineRaw as EditState);
  const empty = createDocument();

  return {
    version: 1,
    baseline,
    ops,
    /* 越界的 cursor 是数值问题不是结构问题：ops 长度就是事实边界，夹到端点。 */
    cursor: clampCursor(cursorRaw, ops.length),
    /* settings / view 是"非语义"部分：没写就用默认值，不该为它们吵用户。 */
    settings: root['settings'] === undefined ? empty.settings : sanitizeSettings(root['settings']),
    view: root['view'] === undefined ? empty.view : sanitizeView(root['view']),
  };
}

/** 需要 `value` 为对象的 kind → 它对应的收敛函数。 */
const VALUE_SANITIZERS: Partial<Record<Op['k'], (raw: unknown) => unknown>> = {
  setAdjust: sanitizeParams,
  setLevels: sanitizeLevels,
  setCurves: sanitizeCurves,
  setBands: sanitizeBands,
  setGeometry: sanitizeGeometry,
  setCollage: sanitizeCollage,
  setWatermark: sanitizeWatermark,
  setSticker: sanitizeSticker,
};

function parseOp(item: unknown, index: number): Op {
  const at = `第 ${index + 1} 条操作`;
  const v = rec(item);
  if (v === null) fail(`${at}不是对象：${JSON.stringify(item)}。`);

  const kind = v['k'];
  if (typeof kind !== 'string' || !(OP_KINDS as readonly string[]).includes(kind)) {
    fail(
      `${at}的 kind 不认识：${JSON.stringify(kind)}。可用 kind：${OP_KINDS.join(', ')}。` +
        `（若是旧版工程文件里改过名的操作，请对照内核 types.ts 的 Op 联合。）`,
    );
  }
  const k = kind as Op['k'];

  if (k === 'setSources') {
    const value = v['value'];
    if (!Array.isArray(value)) fail(`${at}（setSources）缺少 "value" 数组。`);
    const sources = sanitizeSources(value);
    const currentRaw = v['current'];
    /* current 是索引：越界与类型不符都是数值问题，夹进 [0, n-1]（空列表恒 0）。 */
    const current =
      typeof currentRaw === 'number' && Number.isFinite(currentRaw)
        ? Math.min(Math.max(0, Math.round(currentRaw)), Math.max(0, sources.length - 1))
        : 0;
    return { k: 'setSources', value: sources, current };
  }

  if (k === 'applyPreset') {
    const key = v['key'];
    if (typeof key !== 'string' || key.trim() === '') {
      fail(`${at}（applyPreset）缺少合法 "key"（非空字符串）。`);
    }
    const intensity =
      typeof v['intensity'] === 'number' && Number.isFinite(v['intensity']) ? v['intensity'] : 1;
    return { k: 'applyPreset', key, intensity };
  }

  if (k === 'setCrop') {
    /* null 是合法值（"取消裁切"），所以不能要求 value 是对象。 */
    if (!('value' in v)) fail(`${at}（setCrop）缺少 "value"（裁剪矩形或 null）。`);
    return { k: 'setCrop', value: sanitizeCrop(v['value']) };
  }

  const sanitize = VALUE_SANITIZERS[k];
  const value = v['value'];
  if (sanitize === undefined) fail(`${at} 的 kind "${k}" 没有登记校验器（内核漏项）。`);
  if (rec(value) === null) fail(`${at}（${k}）缺少合法的 "value" 对象。`);
  return { k, value: sanitize(value) } as Op;
}
