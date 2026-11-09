/**
 * 预设分享格式 —— 序 9（P7 先行）的可序列化预设契约。
 *
 * ── 为什么放在 document 而不是 presets ──────────────────────────────
 * 校验**无类型输入**是 `document/sanitize.ts` 已经担起的职责（项目文件、配方
 * 都是走它收敛的）。本模块同样要处理"外来的、不可信的 JSON"，直接复用那里
 * 的 `sanitize*` 原语最自然；而 `presets` 已被 `document/sanitize` 反向依赖，
 * 再让 `presets` 回依赖 `document` 会成环。于是归属 `document/` 的语义也最准：
 * 它描述的是"一份可跨机迁移的编辑观感快照"。
 *
 * ── 与 sanitize / normalizeOp 同一条铁律 ────────────────────────────
 *   结构性问题（不是对象、缺 format、format 不符、缺 params、key 非法、未知字段）
 *   → 抛 `PresetParseError`，**写错了要吵**；
 *   数值问题（params / curves / levels / bands 内部字段类型不符、NaN、越界）
 *   → 经 `sanitize*` 收敛到中性，**绝不静默碎图**（序 9 验收 S2）。
 *
 * 一句话分工：
 *   内核安全网：**绝不静默碎图**（退化为中性效果，可被断言）
 *   本模块：    **结构错了要吵**（明确报错，指出错在哪）
 * 两者互不替代，缺一不可。
 */

import type { AdjustParams } from '../presets/params.js';
import { clampParams } from '../presets/params.js';
import type { BandAdjustMap } from '../color/types.js';
import type { LevelsState } from '../color/levels.js';
import type { CurveSet, EditState, Op } from './types.js';
import { createEditState } from './defaults.js';
import { sanitizeBands, sanitizeCurves, sanitizeLevels, sanitizeParams } from './sanitize.js';

/** 预设分享格式标识（含版本号，未来演进用）。 */
export const PRESET_FORMAT = 'photo.preset/v1' as const;

/**
 * 一个可分享的自定义预设。
 *
 * 核心是 `params`（调色 12 参数，构成"观感"）；`curves` / `levels` / `bands`
 * 是可选的观感扩展 —— 让预设能表达比 12 参数更细的调色（曲线、自动增强色阶、
 * HSL 分色带）。缺省表示沿用中性，对应 op 也就不发。
 */
export interface SharedPreset {
  readonly format: typeof PRESET_FORMAT;
  /** 稳定标识；跨机导入时用来去重 / 覆盖。 */
  readonly key: string;
  /** 展示名；缺省回落到 key。 */
  readonly name: string;
  /** 调色 12 参数（必填，构成预设核心观感）。 */
  readonly params: AdjustParams;
  /** 可选：曲线（RGB / R / G / B 四通道）。 */
  readonly curves?: CurveSet;
  /** 可选：色阶（自动增强的产物）。 */
  readonly levels?: LevelsState;
  /** 可选：HSL 八色分调。 */
  readonly bands?: BandAdjustMap;
}

/**
 * 展示名 → 稳定 key（同名即同一个预设，重存即覆盖）。
 *
 * key 同时是预设库里的文件名主干，所以这里用**白名单**而不是黑名单：只保留
 * 字母与数字（中文按 `\p{L}` 原样留下，这是中文产品），其余一律折成 '-'。
 * 黑名单列不全 —— 控制字符、emoji、零宽空格都是"不该出现在文件名里的东西"，
 * 而用户输入不该决定文件写到哪个目录。大小写统一成小写，与内置预设 key 同一口径。
 */
export function presetKeyFromName(name: string): string {
  const cleaned = name
    /* 一个 `+` 就把"一串不合法字符"折成一个连字符，因此不需要再去重连字符。 */
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return cleaned === '' ? 'preset' : cleaned;
}

/** 预设库里的文件名。主进程按同一形状校验（它读不到内核，见 D11）。 */
export const PRESET_FILE_SUFFIX = '.photo.preset.json';

export function presetFileName(key: string): string {
  return `${presetKeyFromName(key)}${PRESET_FILE_SUFFIX}`;
}

/**
 * 当前观感 → 一个可保存的自定义预设。
 *
 * 只取"观感"那四样（参数 / 曲线 / 色阶 / 分色带），几何、裁切、水印、拼图
 * **不进预设** —— 它们是构图不是调色，套到另一张图上多半不是用户想要的。
 * 三项可选项只在**偏离中性**时才写，否则文件里全是噪声，
 * `sharedPresetToOps` 也会因此多推两条什么也不改的 op。
 */
export function sharedPresetFromEditState(key: string, name: string, edit: EditState): SharedPreset {
  const neutral = createEditState(edit.sources, edit.current);
  return {
    format: PRESET_FORMAT,
    key,
    name,
    params: edit.params,
    ...(sameAs(edit.curves, neutral.curves) ? {} : { curves: edit.curves }),
    ...(sameAs(edit.levels, neutral.levels) ? {} : { levels: edit.levels }),
    ...(sameAs(edit.bands, neutral.bands) ? {} : { bands: edit.bands }),
  };
}

/** 结构对比：这三样的字段都是数字与固定键，JSON 形态稳定，不值得为此写一套比较器。 */
function sameAs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 预设文件解析失败：结构错了要吵，不静默。 */
export class PresetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetParseError';
  }
}

/** 只要"对象"，不要数组、不要 null。 */
function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const KNOWN_TOP = ['format', 'key', 'name', 'params', 'curves', 'levels', 'bands'] as const;

/**
 * 解析并校验一个预设文件（接受 JSON 文本或已解析对象）。
 *
 * 返回已被 `sanitize*` 收敛过的 `SharedPreset`；任何结构性问题抛 `PresetParseError`。
 */
export function parseSharedPreset(input: string | unknown): SharedPreset {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as unknown;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new PresetParseError(`预设文件不是合法 JSON：${detail}`);
    }
  }

  const root = rec(raw);
  if (root === null) {
    throw new PresetParseError('预设根节点必须是对象，形如 {"format":"photo.preset/v1", ...}。');
  }

  /* 未知顶层字段：拼错的键必须报错，不能默默无效（与 recipe.normalizOp 同一条纪律）。 */
  const unknown = Object.keys(root).filter((k) => !(KNOWN_TOP as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new PresetParseError(
      `预设含未知字段：${unknown.join(', ')}。` +
        `可用字段：${KNOWN_TOP.join(', ')}。`,
    );
  }

  const format = root['format'];
  if (format !== PRESET_FORMAT) {
    throw new PresetParseError(
      `预设 format 必须是 "${PRESET_FORMAT}"，实际为 ${JSON.stringify(format)}。`,
    );
  }

  const key = root['key'];
  if (typeof key !== 'string' || key.trim() === '') {
    throw new PresetParseError('预设缺少合法字段 "key"（非空字符串）。');
  }

  /* params 是预设的**核心**，缺失属于结构性问题 → 吵；
   * 内部字段类型不符 / NaN 属于数值问题 → 交给 sanitizeParams 收敛到中性。 */
  const paramsRaw = root['params'];
  if (!rec(paramsRaw)) {
    throw new PresetParseError('预设缺少 "params" 对象（调色 12 参数，必填）。');
  }
  const params = sanitizeParams(paramsRaw);

  const nameRaw = root['name'];
  const name = typeof nameRaw === 'string' && nameRaw.trim() !== '' ? nameRaw.trim() : key;

  /* 可选观感扩展：文件里写了就收敛（坏值→中性），没写就不发对应 op。
   * 二者语义一致：解析产物只携带"文件真正声明的那部分"。 */
  const curves = root['curves'] !== undefined ? sanitizeCurves(root['curves']) : undefined;
  const levels = root['levels'] !== undefined ? sanitizeLevels(root['levels']) : undefined;
  const bands = root['bands'] !== undefined ? sanitizeBands(root['bands']) : undefined;

  return {
    format: PRESET_FORMAT,
    key,
    name,
    params,
    ...(curves !== undefined ? { curves } : {}),
    ...(levels !== undefined ? { levels } : {}),
    ...(bands !== undefined ? { bands } : {}),
  };
}

/** 序列化回分享格式（2 空格缩进，便于人读 / diff）。 */
export function serializeSharedPreset(preset: SharedPreset): string {
  return JSON.stringify(
    {
      format: preset.format,
      key: preset.key,
      name: preset.name,
      params: clampParams(preset.params),
      ...(preset.curves !== undefined ? { curves: preset.curves } : {}),
      ...(preset.levels !== undefined ? { levels: preset.levels } : {}),
      ...(preset.bands !== undefined ? { bands: preset.bands } : {}),
    },
    null,
    2,
  );
}

/**
 * 把预设投影成操作序列，供文档重放 / CLI 套用。
 *
 * `setAdjust` 恒发（params 必填）；三个可选观感仅当预设声明了才发对应 op。
 * 这样"预览 == 导出同源"这条架构保证对自定义预设同样成立 —— 它们走的仍是
 * 同一个 `buildPlan`，只是参数来源从内置预设变成分享文件。
 */
export function sharedPresetToOps(preset: SharedPreset): readonly Op[] {
  const ops: Op[] = [{ k: 'setAdjust', value: preset.params }];
  if (preset.curves !== undefined) ops.push({ k: 'setCurves', value: preset.curves });
  if (preset.levels !== undefined) ops.push({ k: 'setLevels', value: preset.levels });
  if (preset.bands !== undefined) ops.push({ k: 'setBands', value: preset.bands });
  return ops;
}
