/**
 * 无类型输入的安全网 —— 让「类型为真」在内核里真正成立。
 *
 * ── 为什么需要这个文件 ──────────────────────────────────────────────
 * 内核的 op 语义是**整值设置**：`{ k:'setGeometry', value: GeometryState }`，
 * 而 `GeometryState` 的四个字段在类型上全部必填。于是两条路径命运不同：
 *
 *   TS 调用方（桌面 UI、内核自身）：传稀疏对象是**编译错误**，类型真的挡住了。
 *   JSON / 项目文件：类型管不到。`{ rotate: 90 }` 会被 reducer 原样落库，
 *                    `straighten` 就变成了 `undefined`。
 *
 * 后者真的碎过图，现场记录如下：
 *
 *     stages: ["raster(旋转90° 校正undefined° 4×8)"]
 *     输出：整张图碎成 (0,0,158) / (1,0,158) 两种颜色
 *
 * 追因链：`straighten === undefined` → 恒等快路径判 `=== 0` 为假 →
 * `angle = (90 + undefined) × π/180 = NaN` → 逆仿射矩阵全 NaN → 采样作废。
 * **全程不抛一个字，还给出一张"看起来渲染成功了"的废图。**
 * 「静默碎图」是最伤信任的一类失败，本模块就是为消灭它而存在。
 *
 * ── 契约（刻意窄，别随手扩大） ──────────────────────────────────────
 *   1. 缺失字段 → 用对应默认值补齐（默认值唯一来源：`defaults.ts`）。
 *   2. 类型不符 → 退化为默认值。
 *   3. 数值必须**有限**，否则退化为默认值（`NaN` / `Infinity` 一律拦下）。
 *   4. 联合类型字段只接受**白名单内**的值 —— 让输出严格满足它声明的联合类型。
 *   5. 例外条款：被当作**除数或分配尺寸**使用的量（切图行列数）强制为正整数。
 *      这不是范围校验，是防止 `Infinity` 尺寸与除零。
 *   6. 例外条款：**源图条目**不可用时**整条丢弃**，而不是伪造一条 1×1 幻影。
 *      区别在"实体"与"设置"：切图行列数是**设置**（必须有值，退化为中性 1）；
 *      源图是**实体**（可以不存在）。伪造幻影会改变 `sources.length`，
 *      连带影响拼图布局与 `current` 语义 —— 那不是"退化为中性"，而是
 *      "悄悄改变了用户看到的东西"，同样属于本模块要消灭的一类失败。
 *      缺图是**看得见**的（界面上少一张），1×1 是**看不见**的。
 *
 * **不做**的事：数值**范围**校验（`straighten` 是否 ±15 内、`alpha` 是否
 * 10..100……）。那是**输入边界**的职责 —— `apps/cli` 的 `normalizeOp` 会明确
 * 报错并列出可用字段与取值，用户写错了应当被吵醒，而不是被内核悄悄改掉。
 *
 * 一句话分工：
 *   内核安全网：**绝不静默碎图**（退化为中性效果，且可被断言）
 *   输入边界：  **写错了要吵**（明确报错，指出错在哪）
 * 两者互不替代，缺一不可。
 */
import { HSL_BAND_KEYS, zeroBands } from '../color/hsl.js';
import { identityLevels, type LevelChannel, type LevelsState } from '../color/levels.js';
import type { BandAdjust, BandAdjustMap, CurvePoint, CurvePoints } from '../color/types.js';
import type { Rect, Rotate } from '../geometry/types.js';
import { ADJUST_KEYS, clampParams, NEUTRAL, type AdjustParams } from '../presets/params.js';
import type { CollageMode, ImageFormat } from '../types.js';
import {
  defaultCollage,
  defaultCurves,
  defaultExport,
  defaultGeometry,
  defaultSticker,
  defaultView,
  defaultWatermark,
} from './defaults.js';
import { isExifOrientation } from '../metadata/orientation.js';
import type {
  CollageState,
  CurveSet,
  DocumentSettings,
  EditState,
  ExportState,
  GeometryState,
  SourceRef,
  StickerState,
  ViewState,
  WatermarkState,
} from './types.js';

/* ─────────────────────────── 白名单：与声明的联合类型逐字对齐 ─────────────────────────── */

const ROTATIONS = [0, 90, 180, 270] as const satisfies readonly Rotate[];
const COLLAGE_MODES = ['single', 'h', 'v', 'grid', 'cut'] as const satisfies readonly CollageMode[];
const COLLAGE_BACKGROUNDS = ['color', 'blur'] as const satisfies readonly CollageState['bg'][];
const BORDER_COLORS = ['#ffffff', '#000000'] as const satisfies readonly CollageState['borderColor'][];
const WATERMARK_POSITIONS = ['br', 'bl', 'tr', 'tl', 'c'] as const satisfies readonly WatermarkState['pos'][];
const STICKER_STYLES = ['white', 'black', 'gold', 'seal'] as const satisfies readonly StickerState['style'][];
const STICKER_POSITIONS = ['bottom', 'top', 'center'] as const satisfies readonly StickerState['pos'][];
const IMAGE_FORMATS = ['jpeg', 'webp', 'png'] as const satisfies readonly ImageFormat[];
const VIEW_TABS = ['img', 'vid'] as const satisfies readonly ViewState['tab'][];

/* ───────────────────────────────── 取值原语 ───────────────────────────────── */

/** 只要"对象"，不要数组、不要 null。不合法时返回空对象，让逐字段回落到默认。 */
function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function maybeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 有限数，否则用默认值。 */
function num(value: unknown, fallback: number): number {
  return maybeNumber(value) ?? fallback;
}

/** 有限数且不小于 min（用于不能为负的量）。 */
function atLeast(value: unknown, min: number, fallback: number): number {
  const n = maybeNumber(value);
  return n === null ? fallback : Math.max(min, n);
}

/** 有限数且取整、不小于 min（用于除数与分配尺寸）。 */
function atLeastInt(value: unknown, min: number, fallback: number): number {
  const n = maybeNumber(value);
  return n === null ? fallback : Math.max(min, Math.round(n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/* ───────────────────────────────── 逐字段收敛 ───────────────────────────────── */

/**
 * 源图引用。宽高是除数与分配依据，必须为正整数 —— 不可用的条目**整条丢弃**，
 * 不伪造 1×1 幻影（理由见文件头契约第 6 条）。
 */
export function sanitizeSources(raw: unknown): readonly SourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceRef[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const width = maybeNumber(v['width']);
    const height = maybeNumber(v['height']);
    /* 尺寸非有限或非正 → 该源图不可用。此时若按 1×1 落库，全尺寸导出会静默
     * 产出 1×1 的图 —— 看得见的"少一张"远胜看不见的"尺寸错了"。
     * 正常路径（工程文件载入 / 导入）里宽高由外壳实测后写入，这里不会误伤。 */
    if (width === null || height === null || width < 1 || height < 1) continue;
    const handle = v['handle'];
    /* 朝向是**来源记录**（渲染不读，见 `SourceRef.exifOrientation`），但非法值
     * 一样要拦：项目文件里写 `orientation: 17` 不能原样落进文档去显示。
     * 不合法就整个键丢掉（而不是回落 1）—— "没有这条信息"才是真话。 */
    const orientation = isExifOrientation(v['exifOrientation']) ? v['exifOrientation'] : null;
    /* 字节数与指纹同理：它们是工程文件用来核对"这张文件还是当初那张吗"的依据
     * （D4）。丢掉非法值而不是补个像样的值——伪造的指纹会让一次本该报警的
     * 源图漂移看起来"核过了"，那比没核更糟。 */
    const bytes = maybeNumber(v['bytes']);
    const given = v['fingerprint'];
    /* 形状就是 `identity.sourceFingerprint` 的产物（两个 32 bit 十六进制串）。
     * 别的写法一律当作"没有这条信息"，不参与核对。 */
    const fingerprint =
      typeof given === 'string' && /^[0-9a-f]{16}$/.test(given.toLowerCase())
        ? given.toLowerCase()
        : null;
    out.push({
      id: text(v['id'], `src-${out.length}`),
      name: text(v['name'], ''),
      width: Math.round(width),
      height: Math.round(height),
      ...(typeof handle === 'string' ? { handle } : {}),
      ...(orientation !== null ? { exifOrientation: orientation } : {}),
      ...(bytes !== null && bytes >= 0 ? { bytes: Math.round(bytes) } : {}),
      ...(fingerprint !== null ? { fingerprint } : {}),
    });
  }
  return out;
}

/**
 * 调色参数。
 *
 * 注意与 `clampParams` 的分工：`clampParams` 对**非有限值**取区间最小值
 * （`brightness` 缺失 → 50 → 整图发黑），所以必须先按 `NEUTRAL` 补齐再来钳制。
 * 顺序反过来就是一个"静默变黑"的陷阱 —— 这正是 D7 的同族问题。
 */
export function sanitizeParams(raw: unknown): AdjustParams {
  const v = rec(raw);
  const merged = {} as Record<string, number>;
  for (const key of ADJUST_KEYS) {
    merged[key] = num(v[key], NEUTRAL[key]);
  }
  return clampParams(merged as unknown as AdjustParams);
}

function sanitizePoints(raw: unknown, fallback: CurvePoints): CurvePoints {
  if (!Array.isArray(raw)) return fallback;
  const points: CurvePoint[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const x = maybeNumber(item[0]);
    const y = maybeNumber(item[1]);
    if (x === null || y === null) continue;
    points.push([x, y]);
  }
  /* 少于两点构不成曲线。buildCurveLut 自己也有兜底，但这里给出确定值更省心。 */
  return points.length >= 2 ? points : fallback;
}

export function sanitizeCurves(raw: unknown): CurveSet {
  const d = defaultCurves();
  const v = rec(raw);
  return {
    rgb: sanitizePoints(v['rgb'], d.rgb),
    r: sanitizePoints(v['r'], d.r),
    g: sanitizePoints(v['g'], d.g),
    b: sanitizePoints(v['b'], d.b),
  };
}

/** HSL 八色分调。每条色带是 `{h,s,l}`；写成数字会让累加算出 NaN。 */
export function sanitizeBands(raw: unknown): BandAdjustMap {
  const zero = zeroBands();
  const v = rec(raw);
  const out = {} as Record<(typeof HSL_BAND_KEYS)[number], BandAdjust>;
  for (const band of HSL_BAND_KEYS) {
    const given = rec(v[band]);
    const d = zero[band];
    out[band] = {
      h: num(given['h'], d.h),
      s: num(given['s'], d.s),
      l: num(given['l'], d.l),
    };
  }
  return out;
}

/**
 * 单通道色阶。
 *
 * 只保证**有限**（契约第 3 条），不做范围校验 —— `lo/hi/gain` 的合法区间
 * 是**输入边界**（CLI `normalizeOp`）的职责，用户写错了应当被吵醒。
 * `hi <= lo` 这个"被当除数"的退化情形由 `buildLevelLut` 兜底（按 span=1 处理），
 * 不会产生 `Infinity` 静默刷白 —— 与"绝不静默碎图"同一条铁律。
 */
function sanitizeLevelChannel(raw: unknown, fallback: LevelChannel): LevelChannel {
  const v = rec(raw);
  return {
    lo: num(v['lo'], fallback.lo),
    hi: num(v['hi'], fallback.hi),
    gain: num(v['gain'], fallback.gain),
  };
}

export function sanitizeLevels(raw: unknown): LevelsState {
  const d = identityLevels();
  const v = rec(raw);
  return {
    r: sanitizeLevelChannel(v['r'], d.r),
    g: sanitizeLevelChannel(v['g'], d.g),
    b: sanitizeLevelChannel(v['b'], d.b),
  };
}

export function sanitizeGeometry(raw: unknown): GeometryState {
  const d = defaultGeometry();
  const v = rec(raw);
  return {
    /* 唯一需要白名单的数值字段：非直角旋转角会静默互换宽高，
     * 属于"结构错了但看不出来"的那类，必须挡在门外。 */
    rotate: oneOf(v['rotate'], ROTATIONS, d.rotate) as Rotate,
    flipH: bool(v['flipH'], d.flipH),
    flipV: bool(v['flipV'], d.flipV),
    straighten: num(v['straighten'], d.straighten),
  };
}

/**
 * 裁剪矩形。`null` 表示未裁剪，必须原样保留。
 * 宽高**允许为负**（反向框选），由 `normalizeRect` 在下游归一 —— 这里只保证有限。
 */
export function sanitizeCrop(raw: unknown): Rect | null {
  if (raw === null || raw === undefined) return null;
  const v = rec(raw);
  return {
    x: num(v['x'], 0),
    y: num(v['y'], 0),
    w: num(v['w'], 0),
    h: num(v['h'], 0),
  };
}

export function sanitizeCollage(raw: unknown): CollageState {
  const d = defaultCollage();
  const v = rec(raw);
  return {
    mode: oneOf(v['mode'], COLLAGE_MODES, d.mode),
    gap: atLeast(v['gap'], 0, d.gap),
    bg: oneOf(v['bg'], COLLAGE_BACKGROUNDS, d.bg),
    cutCols: atLeastInt(v['cutCols'], 1, d.cutCols),
    cutRows: atLeastInt(v['cutRows'], 1, d.cutRows),
    borderWidth: atLeast(v['borderWidth'], 0, d.borderWidth),
    borderColor: oneOf(v['borderColor'], BORDER_COLORS, d.borderColor),
  };
}

export function sanitizeWatermark(raw: unknown): WatermarkState {
  const d = defaultWatermark();
  const v = rec(raw);
  return {
    text: text(v['text'], d.text),
    pos: oneOf(v['pos'], WATERMARK_POSITIONS, d.pos),
    color: text(v['color'], d.color),
    stroke: bool(v['stroke'], d.stroke),
    size: num(v['size'], d.size),
    alpha: num(v['alpha'], d.alpha),
  };
}

export function sanitizeSticker(raw: unknown): StickerState {
  const d = defaultSticker();
  const v = rec(raw);
  return {
    text: text(v['text'], d.text),
    style: oneOf(v['style'], STICKER_STYLES, d.style),
    pos: oneOf(v['pos'], STICKER_POSITIONS, d.pos),
    size: num(v['size'], d.size),
  };
}

/**
 * 收敛整份编辑状态。
 *
 * 幂等：对已经干净的状态调用它，结果与原状态逐字段相同。
 * 这一性质很重要 —— 它保证本层不会在正常路径上偷偷改变用户的效果。
 */
export function sanitizeEditState(state: EditState): EditState {
  const sources = sanitizeSources(state.sources);
  const current = sources.length === 0
    ? 0
    : Math.min(Math.max(0, Math.round(num(state.current, 0))), sources.length - 1);

  return {
    sources,
    current,
    params: sanitizeParams(state.params),
    levels: sanitizeLevels(state.levels),
    curves: sanitizeCurves(state.curves),
    bands: sanitizeBands(state.bands),
    geometry: sanitizeGeometry(state.geometry),
    crop: sanitizeCrop(state.crop),
    collage: sanitizeCollage(state.collage),
    watermark: sanitizeWatermark(state.watermark),
    sticker: sanitizeSticker(state.sticker),
    presetKey: typeof state.presetKey === 'string' ? state.presetKey : null,
    /* 不做范围校验（契约第 4 条：范围是输入边界的活）；`mixWithNeutral` 会把 k 钳到
     * 0..1，所以这里只需保证**有限**，坏输入退化为 1（完整预设）。 */
    presetIntensity: num(state.presetIntensity, 1),
  };
}

/* ─────────────────── 设置与视图：工程文件里的"非语义"部分 ─────────────────── */

/**
 * 导出偏好。
 *
 * `longEdge` 是**分配尺寸**（0 = 原尺寸，否则长边上限），必须取整且非负，
 * 否则 `Infinity` 会一路流进 RenderTarget 变成天文数字的画布。
 * `quality` 同理取非负整数；它的上限由编码器自己解释，不在这里做范围校验。
 */
export function sanitizeExport(raw: unknown): ExportState {
  const d = defaultExport();
  const v = rec(raw);
  return {
    longEdge: atLeastInt(v['longEdge'], 0, d.longEdge),
    format: oneOf(v['format'], IMAGE_FORMATS, d.format),
    quality: atLeastInt(v['quality'], 0, d.quality),
  };
}

export function sanitizeSettings(raw: unknown): DocumentSettings {
  return { export: sanitizeExport(rec(raw)['export']) };
}

/**
 * 视图状态。语义上"不影响出图"，所以它**丢了就丢了**——缺字段回落默认值即可，
 * 但工程文件仍会写它：重开工程后停在原来那个标签页与缩放，是用户会察觉的连续性。
 *
 * 唯一要当真处理的是 `pendingCrop`：它是 Rect 或 null，脏值会让裁切框画到画布外，
 * 所以复用 `sanitizeCrop` 收敛（含"非有限 → null"）。
 */
export function sanitizeView(raw: unknown): ViewState {
  const d = defaultView();
  const v = rec(raw);
  return {
    tab: oneOf(v['tab'], VIEW_TABS, d.tab),
    zoom: num(v['zoom'], d.zoom),
    pendingCrop: sanitizeCrop(v['pendingCrop']),
  };
}
