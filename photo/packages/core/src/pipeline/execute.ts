import { runCollage } from '../ops/collage.js';
import { needsTextRenderer, runPostStage, runRaster, type PostStage } from '../ops/stages.js';
import { MISSING_TEXT_RENDERER, type TextRenderer } from '../ops/text.js';
import { boxScratchLength } from '../pixels/blur.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import type { PlanWarning, RenderPlan } from './types.js';

export interface ExecuteOptions {
  /**
   * 文字渲染能力（浏览器注入 Canvas 实现）。
   * **没有"什么都不画"的兜底**：计划里有非空文案而这里省略 → 执行前就抛
   * `MISSING_TEXT_RENDERER`（无头端要水印就得给能力，别指望静默出一张没水印的图）。
   */
  readonly textRenderer?: TextRenderer;
  /** 计划告警回调 —— 供 UI 展示"为什么没效果"（对应 P1-3）。 */
  readonly onWarning?: (warning: PlanWarning) => void;
  /**
   * 超大图时是否跳过重负载阶段（磨皮 / 锐化去雾）。
   * 默认 true。跳过是**确定性的**：只取决于计划尺寸，因此预览与导出
   * 在相同尺寸下行为一致，不会出现"预览有效果、导出没有"的漂移。
   */
  readonly skipHeavyWhenOversize?: boolean;
  /**
   * 可复用的重负载 scratch 缓冲（对应 P1-4）。
   *
   * 传入后，磨皮 / 去雾的卷积中间缓冲在整次渲染内复用，把
   * "每个阶段分配一份 w·h·3 的 Float32Array"降为"整次渲染一份"。
   * 不传则每次临时分配，保持纯函数语义（测试友好）。
   */
  readonly scratch?: Float32Array;
}

/** 按需把 scratch 增长到当前缓冲所需的最小长度。 */
export function ensureScratch(
  current: Float32Array | undefined,
  w: number,
  h: number,
): Float32Array {
  const need = boxScratchLength(w, h);
  if (current !== undefined && current.length >= need) return current;
  return new Float32Array(need);
}

/**
 * 唯一的渲染执行引擎（无状态版本）。
 *
 * 输入：源像素（单图 1 个 / 拼图 N 个）+ 计划。
 * 输出：最终像素缓冲。
 *
 * 预览与导出调用同一个函数，因此不存在"两套绘制实现"——这是病根 1
 * 被根治的最终落点。
 *
 * 需要跨多次调用复用未变化阶段时，请改用 `RenderCache.execute`（P5）。
 */
export function executePlan(
  sources: readonly PixelBuffer[],
  plan: RenderPlan,
  opts: ExecuteOptions = {},
): PixelBuffer {
  /* 开跑前先问"这一趟要不要画字"（判据与 `runPostStage` 里的排版同一条：
   * 排版只在 `text.trim()` 非空时给出绘制项）。放在这里而不是等阶段跑到 ——
   * 24MP 的图白算一遍才发现本端没有文字能力，是不可接受的浪费。
   * 兜底的那句抛错仍在 `runPostStage`：直接调它的调用方也得拦住。 */
  const wantsText = plan.stages.some(needsTextRenderer);
  if (wantsText && opts.textRenderer === undefined) throw new Error(MISSING_TEXT_RENDERER);
  for (const w of plan.warnings) opts.onWarning?.(w);
  const skipHeavy =
    (opts.skipHeavyWhenOversize ?? true) && plan.warnings.some((w) => w.code === 'oversize');
  const wantsScratch = opts.scratch !== undefined;
  let scratch: Float32Array | undefined = opts.scratch;

  let buf: PixelBuffer | null = null;
  for (const stage of plan.stages) {
    switch (stage.kind) {
      case 'raster': {
        const src = sources[0];
        buf = src === undefined ? createPixelBuffer(1, 1) : runRaster(src, stage);
        break;
      }
      case 'collage': {
        buf = runCollage(sources, stage);
        break;
      }
      default: {
        if (buf === null) continue;
        if (skipHeavy && (stage.kind === 'soften' || stage.kind === 'enhance')) continue;
        if (wantsScratch) scratch = ensureScratch(scratch, buf.width, buf.height);
        buf = runPostStage(buf, stage as PostStage, opts.textRenderer, scratch);
        break;
      }
    }
  }
  return buf ?? createPixelBuffer(1, 1);
}

/** 便利：单图渲染。 */
export function renderSingle(
  source: PixelBuffer,
  plan: RenderPlan,
  opts: ExecuteOptions = {},
): PixelBuffer {
  return executePlan([source], plan, opts);
}
