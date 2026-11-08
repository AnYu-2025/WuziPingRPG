import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { RenderCache, type CacheStats, type RenderCacheOptions } from './cache.js';
import { executePlan, type ExecuteOptions } from './execute.js';
import type { RenderPlan } from './types.js';

/**
 * 执行层 —— Worker 池（对应 P1-4 / P1-6）。
 *
 * ── 为什么用"端口 + 适配器"而不是直接 new Worker ─────────────────────
 * core 是零平台依赖的：它不能出现 `Worker`、`postMessage`、`OffscreenCanvas`。
 * 因此把"执行一个渲染任务"抽象成 `PixelWorkerPort`：
 *   - **外壳**用真实 Web Worker 实现该端口（P6-d 序 5 已交付：
 *     `apps/desktop/src/worker-port.ts` + `worker/render-worker.ts`）；
 *   - **测试 / 无 Worker 环境 / 单任务兜底**用 `InlinePort`（当前线程执行）。
 * 于是调度逻辑（并发、排队、顺序、错误隔离）保持**纯逻辑、可测**，
 * 平台差异被挡在一层薄适配器之后。
 *
 * ── 为什么"池"有价值 ────────────────────────────────────────────────
 * 单张图内部是线性阶段序列，难以并行；真正的并行来源是**多任务**：
 * 批量导出、缩略图墙、多图封面。把它们派发给 N 个端口并行执行，
 * 正是池的用武之地 —— 且这些任务在旧架构里会把 UI 线程堵死（P1-4）。
 */

/** 一个渲染任务：把某组源像素按某计划渲染出来。 */
export interface RenderJob {
  readonly id: number;
  readonly sources: readonly PixelBuffer[];
  readonly plan: RenderPlan;
  readonly options?: ExecuteOptions;
  /**
   * 是否允许端口使用阶段缓存。默认 `true`。
   *
   * 一次性大图导出传 `false`：24MP 一次全尺寸渲染的中间快照是 96 MB × 阶段数
   * ≈ 数百 MB，而导出是"一次性"的、缓存命中率几乎是零 —— 拿内存换不到东西
   * （理由详见 `RenderCache` 与 P6D-PLAN §2.3 的内存门）。
   */
  readonly cache?: boolean;
}

export interface JobResult {
  readonly id: number;
  readonly pixels: PixelBuffer;
  /** 仅在端口带缓存（`InlinePort` / Worker 引擎）时提供。 */
  readonly stats?: CacheStats;
  /** 出错信息；正常为 undefined。 */
  readonly error?: string;
}

export interface PixelWorkerPort {
  readonly name: string;
  run(job: RenderJob): Promise<JobResult>;
  /**
   * 让端口丢掉它持有的阶段缓存（**源图与会话状态保留**）。
   *
   * 为什么这条必须在**端口契约**上，而不是让调用方去够端口内部的缓存：
   * 端口可能是远程的（真 Worker），缓存根本不在本线程 —— "清缓存"因此是一个
   * 必须**跨线程传达的意图**，而不是一次本地函数调用。同一通道内消息有序，
   * 于是"先 reset 后 job"的顺序天然成立。
   *
   * `InlinePort` 把它实现为一次同步调用；Worker 端口实现为发一条消息。
   * 两者语义一致：在这条之后发出的任务，不得复用此前的快照。
   */
  reset(): void;
  dispose(): void;
}

function emptyResult(id: number, error: string): JobResult {
  return { id, pixels: createPixelBuffer(1, 1), error };
}

/**
 * 内联端口：在当前线程执行。
 * 用于测试、无 Worker 环境，以及"池只有一个端口"时的兜底。
 * 内部持有 RenderCache，因此连续任务之间能复用未变化的阶段。
 */
export class InlinePort implements PixelWorkerPort {
  readonly name: string;
  private readonly cache: RenderCache;

  constructor(options: RenderCacheOptions = {}, name = 'inline') {
    this.cache = new RenderCache(options);
    this.name = name;
  }

  async run(job: RenderJob): Promise<JobResult> {
    try {
      /* `cache: false` 走无状态执行器 `executePlan` —— 一次大图导出不落快照。
       * 与 `cache: true` 分支的输出必须**逐字节相同**（同一份 `executePlan`），
       * 差别只在中间快照留不留；这正是导出与预览同源的前提。 */
      if (job.cache === false) {
        return { id: job.id, pixels: executePlan(job.sources, job.plan, job.options ?? {}) };
      }
      const { pixels, stats } = this.cache.execute(job.sources, job.plan, job.options ?? {});
      return { id: job.id, pixels, stats };
    } catch (e) {
      return emptyResult(job.id, e instanceof Error ? e.message : String(e));
    }
  }

  reset(): void {
    this.cache.reset();
  }

  dispose(): void {
    this.cache.reset();
  }
}

export interface PoolOptions {
  /** 池大小；省略时用 ports.length。 */
  readonly concurrency?: number;
  /** 默认缓存选项（仅对 InlinePort 类端口生效）。 */
  readonly cache?: RenderCacheOptions;
}

export interface PoolStats {
  readonly ports: number;
  readonly queued: number;
  readonly busy: number;
  /** 观测到的最大并发数（测试用）。 */
  readonly maxConcurrent: number;
  readonly completed: number;
}

/**
 * 端口池：把任务派发给空闲端口，超出容量则排队。
 *
 * 保证：任一时刻一个端口至多执行一个任务；完成顺序不保证，但
 * `run` 返回的是**对应任务自己**的结果（以 id 关联）。
 */
export class WorkerPool {
  private readonly ports: readonly PixelWorkerPort[];
  private readonly pending: { job: RenderJob; resolve: (r: JobResult) => void }[] = [];
  private readonly busy = new Set<PixelWorkerPort>();
  private maxConcurrent = 0;
  private completed = 0;
  private disposed = false;

  constructor(ports: readonly PixelWorkerPort[]) {
    if (ports.length === 0) throw new Error('WorkerPool 至少需要一个端口');
    this.ports = ports;
  }

  /** 用 N 个内联端口构造一个池（测试 / 无 Worker 环境）。 */
  static inline(size: number, options: PoolOptions = {}): WorkerPool {
    const n = Math.max(1, Math.floor(size));
    const ports: PixelWorkerPort[] = [];
    for (let i = 0; i < n; i++) ports.push(new InlinePort(options.cache, `inline-${i}`));
    return new WorkerPool(ports);
  }

  get size(): number {
    return this.ports.length;
  }

  run(job: RenderJob): Promise<JobResult> {
    if (this.disposed) return Promise.resolve(emptyResult(job.id, 'pool disposed'));
    return new Promise<JobResult>((resolve) => {
      this.pending.push({ job, resolve });
      this.pump();
    });
  }

  /** 批量派发，返回顺序与输入一致。 */
  map(jobs: readonly RenderJob[]): Promise<JobResult[]> {
    return Promise.all(jobs.map((j) => this.run(j)));
  }

  stats(): PoolStats {
    return {
      ports: this.ports.length,
      queued: this.pending.length,
      busy: this.busy.size,
      maxConcurrent: this.maxConcurrent,
      completed: this.completed,
    };
  }

  /** 清空所有端口的阶段缓存（池本身的排队状态不动）。 */
  reset(): void {
    for (const p of this.ports) p.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
    for (const p of this.ports) p.dispose();
    this.busy.clear();
  }

  private pump(): void {
    while (this.pending.length > 0) {
      const port = this.ports.find((p) => !this.busy.has(p));
      if (port === undefined) return;
      const item = this.pending.shift();
      if (item === undefined) return;
      this.busy.add(port);
      if (this.busy.size > this.maxConcurrent) this.maxConcurrent = this.busy.size;
      const finish = (result: JobResult): void => {
        this.busy.delete(port);
        this.completed++;
        item.resolve(result);
        this.pump();
      };
      // 同时处理"端口拒绝"的情况：否则该任务会永久挂起。
      void port.run(item.job).then(
        (result) => finish(result),
        (err: unknown) =>
          finish(emptyResult(item.job.id, err instanceof Error ? err.message : String(err))),
      );
    }
  }
}

/** 构造一个"单端口池"（等价于串行执行，但走池的统一接口）。 */
export function createSerialPool(options: PoolOptions = {}): WorkerPool {
  return new WorkerPool([new InlinePort(options.cache)]);
}
