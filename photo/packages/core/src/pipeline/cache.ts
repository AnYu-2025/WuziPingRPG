import type { PixelBuffer } from '../types.js';
import { runCollage } from '../ops/collage.js';
import { needsTextRenderer, runPostStage, runRaster, type PostStage } from '../ops/stages.js';
import { MISSING_TEXT_RENDERER } from '../ops/text.js';
import { executePlan, ensureScratch, type ExecuteOptions } from './execute.js';
/* 快照预算与安全系数都取自 `memory.js` —— 与导出准入**同一套数字**。
 * 缓存在自己这边另立一个 128 MB 常量，就会发生"准入算过的账被缓存偷偷再加一层"，
 * 而那笔超支只在用户机器上以 OOM 的形式揭晓。 */
import { cacheBudgetFor, DEFAULT_EXPORT_MEMORY_BUDGET_BYTES } from './memory.js';
import type { RenderPlan, RenderStage } from './types.js';

/**
 * 阶段级缓存 —— 关闭 P1-5、缓解 P1-4 的核心机制。
 *
 * ── 病根 ──────────────────────────────────────────────────────────
 * legacy 每次调参松手、每次估算文件大小、每次刷缩略图，都调用
 * `paintSingleTo` 把**整条管线**重跑一遍（含 boxBlur / HSV 互转 / 卷积）。
 * 改一个"亮度"，曲线、分色、卷积全部无差别重算 —— 这是 P1-4 / P1-5。
 *
 * ── 治法 ──────────────────────────────────────────────────────────
 * 管线是**有序线性序列**，每个阶段只依赖「前一阶段的输出 + 自己的参数」。
 * 因此只要给每个阶段算出稳定的缓存键，就能做**前缀复用**：
 *
 *     [raster] [color] [grade] [vignette] [grain] [enhance]
 *        ↑        ↑       ↑ 命中命中命中……        ↑ 只有这里变了
 *        └────────┴───────┘ 直接复用上一次的像素    └─ 从这里往下才算
 *
 * 这就是"脏节点传播"在线性管线上的精确形态：**找到第一个键变化的阶段，
 * 之前的全部复用，之后的才重算**。改动越靠近管线末端，省得越多 ——
 * 而交互式调参（滑杆/曲线）恰好全都作用在末端。
 */

/** FNV-1a 32 位哈希（字符串 → 无符号整数）。 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function num(v: number): string {
  // 归一化 -0 与浮点毛刺，避免同一视觉效果产生不同缓存键。
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : 'x';
}

/** 裁切框的缓存键片段：null 用 `none`，否则四元组按归一化数字归一。 */
function cropKey(rect: { x: number; y: number; w: number; h: number } | null): string {
  if (rect === null) return 'none';
  return `${num(rect.x)},${num(rect.y)},${num(rect.w)},${num(rect.h)}`;
}

/**
 * 阶段缓存键：只包含**决定该阶段像素输出**的信息。
 * 参数相同、顺序相同 ⇒ 键相同 ⇒ 可安全复用该阶段输出。
 */
export function stageCacheKey(stage: RenderStage): string {
  switch (stage.kind) {
    case 'raster':
      return [
        'raster',
        stage.rotate,
        stage.flipH ? 1 : 0,
        stage.flipV ? 1 : 0,
        num(stage.straighten),
        stage.contentSize.w,
        stage.contentSize.h,
        stage.border,
        stage.borderColor,
        /* 裁切框**必须**参与键：否则改裁切后 raster 键不变，
         * 交互式预览会错误复用"未裁切"的旧快照（导出不走缓存，掩盖了这个坑）。 */
        cropKey(stage.crop),
      ].join(':');
    case 'collage':
      return [
        'collage',
        stage.contentSize.w,
        stage.contentSize.h,
        stage.border,
        stage.borderColor,
        stage.background,
        stage.backgroundSource,
        stage.tiles
          .map((t) => `${t.source},${t.x},${t.y},${t.w},${t.h},${t.cover ? 1 : 0}`)
          .join(';'),
      ].join(':');
    case 'color': {
      const p = stage.params;
      return [
        'color',
        num(p.brightness),
        num(p.contrast),
        num(p.saturate),
        num(p.exposure),
      ].join(':');
    }
    case 'warm':
      return `warm:${num(stage.warm)}`;
    case 'levels': {
      const l = stage.levels;
      const ch = (c: { lo: number; hi: number; gain: number }): string =>
        `${num(c.lo)},${num(c.hi)},${num(c.gain)}`;
      return `levels:${ch(l.r)};${ch(l.g)};${ch(l.b)}`;
    }
    case 'soften':
      return `soften:${num(stage.amount)}`;
    case 'grade':
      return [
        'grade',
        stage.curves.rgb.map((pt) => pt.join(',')).join(';'),
        stage.curves.r.map((pt) => pt.join(',')).join(';'),
        stage.curves.g.map((pt) => pt.join(',')).join(';'),
        stage.curves.b.map((pt) => pt.join(',')).join(';'),
        Object.keys(stage.bands)
          .sort()
          .map((k) => {
            const a = stage.bands[k as keyof typeof stage.bands];
            return `${k}=${num(a.h)},${num(a.s)},${num(a.l)}`;
          })
          .join(';'),
      ].join(':');
    case 'vignette':
      return `vignette:${num(stage.amount)}`;
    case 'grain':
      return `grain:${num(stage.amount)}`;
    case 'enhance':
      return `enhance:${num(stage.sharpen)}:${num(stage.dehaze)}`;
    case 'weather':
      return `weather:${num(stage.rain)}:${num(stage.fog)}`;
    case 'text': {
      const wm = stage.watermark;
      const st = stage.sticker;
      return [
        'text',
        wm.text,
        wm.pos,
        wm.color,
        wm.stroke ? 1 : 0,
        num(wm.size),
        num(wm.alpha),
        st.text,
        st.style,
        st.pos,
        num(st.size),
      ].join(':');
    }
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

/**
 * 源图指纹：尺寸 + 稀疏抽样像素。
 *
 * 刻意**不做整图哈希** —— 那本身就是 O(w·h) 的开销，会把缓存省的又赔回去。
 * 采样 32 个位置的 RGB 已足以区分"换了张图"与"同一张图"。
 */
export function sourceFingerprint(buf: PixelBuffer): string {
  const { width: w, height: h, data } = buf;
  const samples = 32;
  const parts: string[] = [String(w), String(h)];
  for (let i = 0; i < samples; i++) {
    const total = w * h;
    const p = Math.floor((total * (i + 0.5)) / samples);
    const j = p * 4;
    parts.push(`${data[j]},${data[j + 1]},${data[j + 2]}`);
  }
  return `${fnv1a(parts.join('|'))}`;
}

export interface CacheStats {
  /** 本次执行复用的阶段数。 */
  readonly reused: number;
  /** 本次执行重算的阶段数。 */
  readonly computed: number;
  /** 本次执行是否命中过缓存。 */
  readonly hit: boolean;
  /** 缓存当前保存的快照数。 */
  readonly snapshots: number;
}

export interface RenderCacheOptions {
  /** 是否启用缓存。默认 true。导出这类一次性大图可关闭以省内存。 */
  readonly enabled?: boolean;
  /**
   * 内存预算（字节），默认与导出准入**同一个数**（2 GB）。
   *
   * 这里刻意不接受"快照预算"而是"内存预算"：留几张快照由 `cacheBudgetFor`
   * 按本次计划的规模推导，与 `gateExport` 共用同一份预估与安全系数。
   * 固定一个字节数的老写法在两头都是错的 —— 大图装不下第二张（复用归零），
   * 小图又白占一大块，而谁都没回答过"到底该留几张"。
   */
  readonly memoryBudgetBytes?: number;
}

interface CachedRun {
  readonly fingerprint: string;
  readonly keys: readonly string[];
  /**
   * snapshots[i] = 第 i 阶段之后的像素快照。
   * 允许出现空洞（undefined）—— 内存预算可能淘汰掉中间某些阶段的快照。
   */
  readonly snapshots: readonly (PixelBuffer | undefined)[];
}

function cloneBuffer(buf: PixelBuffer): PixelBuffer {
  return { width: buf.width, height: buf.height, data: new Uint8ClampedArray(buf.data) };
}

/**
 * 记忆上一次渲染的阶段快照，并在下一次渲染时复用未变化的前缀。
 *
 * 用法：
 * ```ts
 * const cache = new RenderCache();
 * const { pixels, stats } = cache.execute([source], plan);
 * // 用户只拖了"暗角" →
 * const next = cache.execute([source], plan2);
 * // next.stats.reused > 0，即几何/色彩/调色阶段未被重算
 * ```
 */
export class RenderCache {
  private readonly enabled: boolean;
  private readonly memoryBudgetBytes: number;
  private last: CachedRun | null = null;

  constructor(options: RenderCacheOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.memoryBudgetBytes = options.memoryBudgetBytes ?? DEFAULT_EXPORT_MEMORY_BUDGET_BYTES;
  }

  /** 清空缓存（例如切换了源图集合或销毁文档）。 */
  reset(): void {
    this.last = null;
  }

  /**
   * 执行计划，尽可能复用上一次的阶段快照。
   * @returns 最终像素与本次的缓存统计。
   */
  execute(
    sources: readonly PixelBuffer[],
    plan: RenderPlan,
    opts: ExecuteOptions = {},
  ): { pixels: PixelBuffer; stats: CacheStats } {
    const stages = plan.stages;
    const keys = stages.map(stageCacheKey);
    /* 与 `executePlan` 同一条预检：要看**整条计划**而不是"本次要算的那几段" ——
     * 复用前缀里可能正好含着上一次的带水印快照，跳过了文字阶段并不意味着
     * 这一次调用有画字能力。口径不一致会让"缓存命中"变成能力检测的漏洞。 */
    if (stages.some(needsTextRenderer) && opts.textRenderer === undefined) {
      throw new Error(MISSING_TEXT_RENDERER);
    }
    const fingerprint =
      sources.length === 0 ? 'none' : sources.map(sourceFingerprint).join('|');

    // 1) 求最长可复用前缀
    let reuse = 0;
    const prev = this.last;
    if (this.enabled && prev !== null && prev.fingerprint === fingerprint) {
      const limit = Math.min(keys.length, prev.keys.length);
      while (reuse < limit && keys[reuse] === prev.keys[reuse]) reuse++;
    }

    // 2) 从复用点开始执行
    const skipHeavy =
      (opts.skipHeavyWhenOversize ?? true) && plan.warnings.some((w) => w.code === 'oversize');
    for (const w of plan.warnings) opts.onWarning?.(w);

    /* 快照预算在**执行之前**推导，因为它还决定"要不要按阶段克隆"。
     * 先克隆满 8 张（24 MP 一张 98 MB）再按预算整批丢掉，等于为"内存吃紧"这个
     * 决定付一遍全尺寸拷贝的代价 —— 实测小预算那两档的进程高水位因此少了 182 MB。
     * 留末端 N 张与 `applyBudget` 的淘汰方向一致。 */
    const budget = cacheBudgetFor({ plan, memoryBudgetBytes: this.memoryBudgetBytes });
    const snapshotFrom = stages.length - budget.snapshots;

    let buf: PixelBuffer | null = null;
    let computed = 0;
    let scratch: Float32Array | undefined = opts.scratch;
    const wantsScratch = opts.scratch !== undefined;
    const snapshots: (PixelBuffer | undefined)[] = [];

    // 复用前缀：把上一次的末端快照拷一份当作续算起点
    // （必须拷 —— 后续阶段的执行器是原地修改的，直接引用会污染缓存）
    if (reuse > 0) {
      const base = prev === null ? undefined : prev.snapshots[reuse - 1];
      if (base !== undefined) {
        buf = cloneBuffer(base);
        for (let i = 0; i < reuse; i++) {
          const s = prev?.snapshots[i];
          if (s !== undefined) snapshots[i] = s;
        }
      } else {
        reuse = 0; // 快照已被预算淘汰，退化为全量重算
      }
    }

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      if (i < reuse) continue; // 命中缓存，跳过
      switch (stage.kind) {
        case 'raster': {
          const src = sources[0];
          buf = src === undefined ? null : runRaster(src, stage);
          break;
        }
        case 'collage': {
          buf = runCollage(sources, stage);
          break;
        }
        default: {
          if (buf === null) continue;
          if (skipHeavy && (stage.kind === 'soften' || stage.kind === 'enhance')) {
            if (i >= snapshotFrom) snapshots[i] = cloneBuffer(buf);
            continue;
          }
          if (wantsScratch) scratch = ensureScratch(scratch, buf.width, buf.height);
          buf = runPostStage(buf, stage as PostStage, opts.textRenderer, scratch);
          break;
        }
      }
      computed++;
      if (buf !== null && i >= snapshotFrom) snapshots[i] = cloneBuffer(buf);
    }

    const pixels = buf ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) };

    // 3) 按预算裁剪快照。上面已经只造末端 N 张，这里剩的是兜底：复用前缀里
    //    可能带着**上一次计划**留下的快照，而两次计划的规模不必相同。
    const trimmed = this.applyBudget(snapshots, budget.maxBytes);
    this.last = { fingerprint, keys, snapshots: trimmed };
    const keptCount = trimmed.reduce((n, s) => (s === undefined ? n : n + 1), 0);

    return {
      pixels,
      stats: {
        reused: reuse,
        computed,
        hit: reuse > 0,
        snapshots: keptCount,
      },
    };
  }

  /** 依据本次推导出的快照预算，从头部淘汰快照。 */
  private applyBudget(
    snapshots: readonly (PixelBuffer | undefined)[],
    maxBytes: number,
  ): (PixelBuffer | undefined)[] {
    const bytesOf = (b: PixelBuffer): number => b.data.length;
    let total = 0;
    for (const s of snapshots) if (s !== undefined) total += bytesOf(s);
    if (total <= maxBytes) return snapshots.slice();

    const kept: (PixelBuffer | undefined)[] = new Array(snapshots.length);
    let used = 0;
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const s = snapshots[i];
      if (s === undefined) continue;
      /* 装不下就到此为止（保留的是**连续的末端** —— 复用需要"到 reuse-1 为止
       * 整段都在"，中间挖洞会让下一次退化成全量重算）。
       *
       * 老写法在这里有一条 `&& used > 0`：一张都装不下时**还是留了一张**，
       * 等于"预算 0 也要越预算"。自适应预算会真给出 0（小内存机器），
       * 那条豁免就从无害变成了破口，故删。 */
      if (used + bytesOf(s) > maxBytes) break;
      kept[i] = s;
      used += bytesOf(s);
    }
    return kept;
  }
}

/** 便利：一次性渲染（不缓存）。等价于 executePlan，保留给无状态调用方。 */
export function renderOnce(
  sources: readonly PixelBuffer[],
  plan: RenderPlan,
  opts: ExecuteOptions = {},
): PixelBuffer {
  return executePlan(sources, plan, opts);
}
