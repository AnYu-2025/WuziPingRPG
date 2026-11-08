import type { Size } from '../geometry/types.js';
import { boxScratchLength } from '../pixels/blur.js';
import { MAX_HEAVY_PIXELS } from '../pixels/effects.js';
import type { RenderPlan } from './types.js';

/**
 * 内存预算估算（对应 P1-4）。
 *
 * legacy 的毛病是"先分配了才知道大"：`boxBlur` 里直接
 * `new Float32Array(w*h*3)`，6000×4000 时单次 288 MB，而且**没有上限检查**。
 * 现在把峰值拆解成三项，让调用方在**执行之前**就能判断并决策
 * （降长边 / 关磨皮 / 关闭缓存快照）。
 */

export interface MemoryEstimate {
  /** 输出像素数。 */
  readonly outputPixels: number;
  /** 最终像素缓冲字节数。 */
  readonly outputBytes: number;
  /** 卷积类阶段的 scratch 字节数（磨皮 / 去雾）。 */
  readonly scratchBytes: number;
  /** 缓存快照字节数（缓存关闭时为 0）。 */
  readonly snapshotBytes: number;
  /** 峰值字节数（三项之和，保守取各阶段最大值而非累加交错）。 */
  readonly peakBytes: number;
  /** 含卷积的阶段数。 */
  readonly heavyStages: number;
  /** 是否超过重负载上限。 */
  readonly oversize: boolean;
}

export interface MemoryEstimateOptions {
  /** 预计保留多少个阶段快照（0 = 不缓存）。 */
  readonly cacheSnapshots?: number;
}

const BYTES_PER_PIXEL = 4;

/** 估算一次渲染的峰值内存。 */
export function estimateMemory(
  plan: RenderPlan,
  options: MemoryEstimateOptions = {},
): MemoryEstimate {
  const w = plan.outputSize.w;
  const h = plan.outputSize.h;
  const outputPixels = w * h;
  const outputBytes = outputPixels * BYTES_PER_PIXEL;

  const heavyStages = plan.stages.filter(
    (s) => s.kind === 'soften' || s.kind === 'enhance',
  ).length;
  const scratchBytes =
    heavyStages > 0 ? boxScratchLength(w, h) * Float32Array.BYTES_PER_ELEMENT : 0;

  const snapshots = Math.max(0, Math.floor(options.cacheSnapshots ?? 0));
  const snapshotBytes = outputBytes * snapshots;

  return {
    outputPixels,
    outputBytes,
    scratchBytes,
    snapshotBytes,
    peakBytes: outputBytes + scratchBytes + snapshotBytes,
    heavyStages,
    oversize: outputPixels > MAX_HEAVY_PIXELS,
  };
}

/** 字节数 → 人类可读 MB（保留一位小数）。 */
function mb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** 人类可读描述（供 UI 提示）。 */
export function describeMemory(estimate: MemoryEstimate): string {
  return (
    `${estimate.outputPixels} 像素；像素缓冲 ${mb(estimate.outputBytes)}` +
    `，卷积缓冲 ${mb(estimate.scratchBytes)}，快照 ${mb(estimate.snapshotBytes)}` +
    `，峰值约 ${mb(estimate.peakBytes)}`
  );
}

/* ═══════════════════ g1 导出内存门（P6-d 序 1）════════════════════════
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────
 * `oversize` 已经能**告警**，但告警背后没有任何**策略**：24MP 只是"勉强
 * 吃下"（实测峰值 1.28 GB），50MP 中画幅按比例外推到 ≈ 2.7 GB，会越过
 * 3 GB 安全线。装到用户机上就是"点导出 → 卡死 / 进程被杀"。
 *
 * ── 唯一原则：绝不静默 ─────────────────────────────────────────────
 * 超预算时，要么降采样并**明确告知**目标尺寸，要么让用户**知情确认**，
 * 要么**明确拒绝**并说明原因。绝不"悄悄 OOM"，也绝不"悄悄降质"。
 * （与内核 `sanitize` 的"绝不静默碎图"是同一条铁律。）
 *
 * ── 为什么是纯函数、放内核 ─────────────────────────────────────────
 * 准入是**策略**，不是交互。放内核 → CLI 批处理 / web / 移动端复用**同一条
 * 规则**，外壳只负责把 `ExportGate` 翻译成对话框（这也守住了"壳不许有逻辑"）。
 * 预算由**外壳注入**（环境变量 `PHOTO_MEMORY_BUDGET_MB`）—— 内核不读 `process`。
 */

/** 导出峰值安全系数：实测 ≈ 估算 × 2（`bench.mjs` 结论"下界不是全貌"）。 */
export const EXPORT_MEMORY_SAFETY = 2.0;

/** 默认预算 **2 GB**；外壳可用 `PHOTO_MEMORY_BUDGET_MB` 覆盖后经 `budgetBytes` 传入。 */
export const DEFAULT_EXPORT_MEMORY_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

/** 硬天花板 **4 GB**：超过它一律拒绝 —— 降采样/确认都救不回来。 */
export const DEFAULT_EXPORT_MEMORY_HARD_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * 降采样下限（长边像素）。
 *
 * 长边低于此值仍超预算，说明"降采样"已无法给出可用产物（缩到几百像素没意义），
 * 此时宁可走**确认**或**拒绝**，也不交付一张废图。
 */
export const MIN_DOWNSCALE_LONG_EDGE = 640;

export interface ExportGateInput {
  /** 原尺寸导出计划（`maxEdge: 0`）。 */
  readonly plan: RenderPlan;
  /** 预算字节数；缺省用 {@link DEFAULT_EXPORT_MEMORY_BUDGET_BYTES}。 */
  readonly budgetBytes?: number;
  /** 硬天花板字节数；缺省用 {@link DEFAULT_EXPORT_MEMORY_HARD_LIMIT_BYTES}。 */
  readonly hardLimitBytes?: number;
  /** 用户是否**显式**要求原尺寸 —— 打开 confirm 分支的授权位。 */
  readonly explicitFullSize?: boolean;
  /**
   * 按 `maxEdge` 重建计划的能力（通常就是 `(e) => buildPlan(doc, {...target, maxEdge: e})`）。
   * 缺省 → 无法给出降采样方案，超预算时直接落到 confirm / reject。
   */
  readonly planFor?: (maxEdge: number) => RenderPlan;
}

export type ExportGateDecision = 'run' | 'downscale' | 'confirm' | 'reject';

/** 四分支共有的字段：预算与预测，方便壳统一渲染。 */
export interface ExportGateBase {
  readonly decision: ExportGateDecision;
  readonly budgetBytes: number;
  readonly hardLimitBytes: number;
  /** 原尺寸计划的估算（`cacheSnapshots: 0`）。 */
  readonly estimate: MemoryEstimate;
  /** `estimate.peakBytes × SAFETY` —— 对外暴露时的"预计峰值"。 */
  readonly projectedBytes: number;
  /** 面向用户的一句话（壳直接显示，不再自己拼文案）。 */
  readonly message: string;
}

export interface ExportGateRun extends ExportGateBase {
  readonly decision: 'run';
}

export interface ExportGateConfirm extends ExportGateBase {
  readonly decision: 'confirm';
}

export interface ExportGateReject extends ExportGateBase {
  readonly decision: 'reject';
  /** 目前只有一种拒绝原因：超出硬天花板。 */
  readonly reason: 'over-hard-limit';
}

export interface ExportGateDownscale extends ExportGateBase {
  readonly decision: 'downscale';
  /** 建议导出的长边上限（调用方须用**它**重建计划，以保住"预览==导出同源"）。 */
  readonly maxEdge: number;
  /** 降采样后的输出尺寸（含边框）。 */
  readonly outputSize: Size;
  /** 降采样后的预测峰值。 */
  readonly projectedBytesAfter: number;
}

export type ExportGate =
  | ExportGateRun
  | ExportGateDownscale
  | ExportGateConfirm
  | ExportGateReject;

/** 底图（raster / collage）的内容区长边 —— 降采样的搜索上界。 */
function contentLongEdge(plan: RenderPlan): number {
  for (const stage of plan.stages) {
    if (stage.kind === 'raster' || stage.kind === 'collage') {
      return Math.max(stage.contentSize.w, stage.contentSize.h);
    }
  }
  return Math.max(plan.outputSize.w, plan.outputSize.h);
}

interface DownscaleTarget {
  readonly maxEdge: number;
  readonly outputSize: Size;
  readonly projectedBytes: number;
}

/**
 * 求"预算内的最大长边"。
 *
 * `peakBytes(maxEdge)` 随长边单调不减，因此可二分。先测**下限**：
 * 下限都撑不住 → 返回 `null`（降采样救不回来）。
 */
function findDownscaleTarget(
  plan: RenderPlan,
  planFor: (maxEdge: number) => RenderPlan,
  budgetBytes: number,
  safety: number,
): DownscaleTarget | null {
  const full = contentLongEdge(plan);
  if (full <= MIN_DOWNSCALE_LONG_EDGE) return null;

  const measure = (maxEdge: number): DownscaleTarget => {
    const p = planFor(maxEdge);
    return {
      maxEdge,
      outputSize: p.outputSize,
      projectedBytes: estimateMemory(p, { cacheSnapshots: 0 }).peakBytes * safety,
    };
  };

  const atFloor = measure(MIN_DOWNSCALE_LONG_EDGE);
  if (atFloor.projectedBytes > budgetBytes) return null;

  let lo = MIN_DOWNSCALE_LONG_EDGE;
  let hi = full - 1;
  let best = atFloor;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = measure(mid);
    if (cand.projectedBytes <= budgetBytes) {
      best = cand;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 导出准入判定 —— **纯函数**，四分支：`run` / `downscale` / `confirm` / `reject`。
 *
 * 判定顺序（按"对用户最有价值"排，而不是按分支枚举）：
 *   1. `projected ≤ budget` → **run**（正常导出，24MP 在 2 GB 预算下走这条）；
 *   2. 超预算且用户未锁原尺寸 → 试 **downscale**（给预算内最大的长边）；
 *   3. 降不下来 / 用户锁了原尺寸：
 *        - `projected > hardLimit` → **reject**（不让它崩）；
 *        - 否则 → **confirm**（把风险摆到台面上，用户知情后自负）。
 *
 * 注意：`planFor` 缺省时第 2 步被跳过 → 超预算一律 confirm/reject。这是
 * **刻意**的：没有"按 maxEdge 重建计划"的能力，就**不能**擅自给降采样方案。
 */
export function gateExport(input: ExportGateInput): ExportGate {
  const budgetBytes = input.budgetBytes ?? DEFAULT_EXPORT_MEMORY_BUDGET_BYTES;
  const hardLimitBytes = input.hardLimitBytes ?? DEFAULT_EXPORT_MEMORY_HARD_LIMIT_BYTES;
  const estimate = estimateMemory(input.plan, { cacheSnapshots: 0 });
  const projectedBytes = estimate.peakBytes * EXPORT_MEMORY_SAFETY;
  const base = { budgetBytes, hardLimitBytes, estimate, projectedBytes };
  const size = `${input.plan.outputSize.w}×${input.plan.outputSize.h}`;

  if (projectedBytes <= budgetBytes) {
    return {
      ...base,
      decision: 'run',
      message: `预计峰值 ${mb(projectedBytes)}（预算 ${mb(budgetBytes)}），可直接导出 ${size}。`,
    };
  }

  const explicit = input.explicitFullSize === true;
  if (!explicit && input.planFor !== undefined) {
    const ds = findDownscaleTarget(input.plan, input.planFor, budgetBytes, EXPORT_MEMORY_SAFETY);
    if (ds !== null) {
      return {
        ...base,
        decision: 'downscale',
        maxEdge: ds.maxEdge,
        outputSize: ds.outputSize,
        projectedBytesAfter: ds.projectedBytes,
        message:
          `原尺寸 ${size} 预计峰值 ${mb(projectedBytes)}，超出预算 ${mb(budgetBytes)}；` +
          `将长边降到 ${ds.maxEdge}（输出 ${ds.outputSize.w}×${ds.outputSize.h}，` +
          `预计峰值 ${mb(ds.projectedBytes)}）后导出。`,
      };
    }
  }

  if (projectedBytes > hardLimitBytes) {
    const why = explicit
      ? '已按你的要求锁定原尺寸'
      : `降采样下限 ${MIN_DOWNSCALE_LONG_EDGE} 仍不达标`;
    return {
      ...base,
      decision: 'reject',
      reason: 'over-hard-limit',
      message:
        `预计峰值 ${mb(projectedBytes)} 超过硬上限 ${mb(hardLimitBytes)}，` +
        `${size} 无法安全导出（${why}）。请降低导出长边或减少处理阶段。`,
    };
  }

  return {
    ...base,
    decision: 'confirm',
    message:
      `原尺寸 ${size} 预计峰值 ${mb(projectedBytes)}，超出预算 ${mb(budgetBytes)}；` +
      `存在内存风险，需你确认后再执行。`,
  };
}

/* ═══════════════════ p1 快照预算自适应（P6-e 序 4）════════════════════
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────
 * 快照预算原来是**外壳里写死的三个数**（桌面会话 256 MB、Worker 引擎 128 MB、
 * 降级端口 128 MB）。写死在两头都是错的：
 *   - 大图：24 MP 一张快照就是 98 MB（4048×6048×4），128 MB 只装得下**一张**，而它多半不是
 *     下次要续算的那个位置 ⇒ 复用直接归零，缓存白搭（M1 的现场）；
 *   - 小图：几 MB 的预览也照给 128 MB，看着"够用"，但没人回答过"到底该留几张"。
 *
 * ── 为什么与 `gateExport` 同处一文件 ───────────────────────────────
 * 这是**同一个问题的两半**：准入问"这张图会不会撑爆"，预算问"那还剩多少能给快照"。
 * 两边必须共用同一份 `estimateMemory` 与同一个 `EXPORT_MEMORY_SAFETY` —— 一个说
 * "峰值 768 MB"、另一个按别的数分配，账就永远对不上，而错的那一笔是用户机器上的 OOM。
 * 策略照旧放内核（外壳只注入预算数字，内核不读 `process`）。
 *
 * ── 一条硬不变式（M2）──────────────────────────────────────────────
 * `无缓存峰值 × SAFETY + maxBytes ≤ memoryBudgetBytes`
 * 快照只能吃"准入判定剩下的那一口"：缓存**永不**把一张本来允许的导出顶成崩溃。
 * 复用起点要克隆一份缓冲当续算底稿，这一口**不**另外向预算要 —— 它落在
 * `SAFETY = 2.0` 的余量里（实测峰值 ≈ 估算 × 2，见 `bench.mjs` 的结论）。
 */

export interface CacheBudgetInput {
  /** 本次要执行的计划（预览或导出皆可；导出通常 `cache:false`，不走这条）。 */
  readonly plan: RenderPlan;
  /** 内存预算，与 `gateExport` 的 `budgetBytes` 同一个数；缺省 2 GB。 */
  readonly memoryBudgetBytes?: number;
}

export interface CacheBudget {
  /** 允许保留几张末端阶段快照（0 = 本次相当于不缓存）。 */
  readonly snapshots: number;
  /** 交给 `RenderCache` 的淘汰阈值 = `snapshots × snapshotBytes`。 */
  readonly maxBytes: number;
  /** 单张快照字节数（快照就是输出缓冲的一份克隆）。 */
  readonly snapshotBytes: number;
  /** 先扣掉的那一口：无缓存执行峰值 × 安全系数。 */
  readonly reservedBytes: number;
  /** 面向用户的一句话：为什么是这个数，包括"为什么是 0"。 */
  readonly reason: string;
}

/** 由计划规模与内存预算推导快照预算 —— 纯函数，与准入判定同源。 */
export function cacheBudgetFor(input: CacheBudgetInput): CacheBudget {
  const memoryBudgetBytes = input.memoryBudgetBytes ?? DEFAULT_EXPORT_MEMORY_BUDGET_BYTES;
  const stageCount = input.plan.stages.length;
  const base = estimateMemory(input.plan, { cacheSnapshots: 0 });
  const reservedBytes = base.peakBytes * EXPORT_MEMORY_SAFETY;
  const snapshotBytes = base.outputBytes;
  const headroom = memoryBudgetBytes - reservedBytes;
  const snapshots = headroom <= 0 ? 0 : Math.min(stageCount, Math.floor(headroom / snapshotBytes));
  const maxBytes = snapshots * snapshotBytes;

  let reason: string;
  if (stageCount === 0) {
    reason = '计划里没有阶段，快照无从谈起。';
  } else if (snapshots === 0 && headroom <= 0) {
    reason =
      `执行峰值 ${mb(reservedBytes)}（已含 ${EXPORT_MEMORY_SAFETY}× 安全系数）` +
      `超出内存预算 ${mb(memoryBudgetBytes)}：本次一张快照都不留，` +
      `每次都全量重算 —— 慢，但不越预算。`;
  } else if (snapshots === 0) {
    reason =
      `剩余空间只有 ${mb(headroom)}，装不下最小一张快照 ${mb(snapshotBytes)}：` +
      `本次不缓存。`;
  } else if (snapshots < stageCount) {
    reason =
      `${stageCount} 个阶段留最后 ${snapshots} 张快照（${mb(maxBytes)}）：` +
      `预算 ${mb(memoryBudgetBytes)} 扣掉执行峰值 ${mb(reservedBytes)} 后只剩 ${mb(headroom)}。`;
  } else {
    reason =
      `${stageCount} 个阶段的快照全部留得住（${mb(maxBytes)}）：` +
      `预算 ${mb(memoryBudgetBytes)}，执行峰值占 ${mb(reservedBytes)}。`;
  }

  return { snapshots, maxBytes, snapshotBytes, reservedBytes, reason };
}
