/**
 * 主线程 ↔ 渲染 Worker 的**消息契约**。
 *
 * ── 为什么单列一个文件 ────────────────────────────────────────────
 * 两端（`worker-port.ts` 与 `worker/render-worker.ts`）必须对同一组消息结构
 * 达成一致。放在一个只有**类型**的模块里，两端 `import type` 各自引用，
 * 改字段时两边同时报错 —— 而不是靠"我记得那边也改了"。
 *
 * 本文件刻意**没有任何运行期值**：它不会把 core 拉进 Worker 的模块图，
 * 也不会把 Worker 拉进单测的模块图。
 *
 * ── 两条设计约束（都是性能决定的）────────────────────────────────
 *
 * 1. **源图只上传一次。** `sources` 消息按 `key` 缓存：拖滑杆时源图没变，
 *    每帧只发 `job`（一个 plan，几 KB），而不是重发 24MP 源像素（96 MB/帧）。
 *    这条不做，Worker 会比主线程还慢 —— 传输开销吃掉全部收益。
 *
 * 2. **结果零拷贝回传。** `result.pixels.data` 的底层 buffer 走 transfer list
 *    （所有权移交，无复制）；Worker 侧交出后即不再引用它。
 */
import type { pipeline } from '@photo/core';

/**
 * 可结构化克隆的像素缓冲 —— 跨线程传的形态。
 *
 * 结构与内核的 `PixelBuffer` 相同，但**独立命名**：跨线程传的是"线格式"，
 * 与内核的内部类型不是同一件东西（例如将来若改成 SharedArrayBuffer 或
 * 分块传输，变的只有这里）。
 */
export interface WireBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** 主线程 → Worker。 */
export type WorkerRequest =
  /**
   * 握手：同时把**内存预算**告诉 Worker 侧（与导出准入同一个数）。
   *
   * 传的是"总共能用多少"而不是"快照能占多少"：后者要按本次计划的规模算，
   * 而那个算法只有内核知道（`pipeline.cacheBudgetFor`）。主线程若自己定一个
   * 固定字节数，就会出现"桌面会话 256 MB、Worker 128 MB"这种各说各话。
   */
  | { readonly t: 'init'; readonly memoryBudgetBytes: number }
  /** 上传（或替换）一组源图，之后 `job.key` 引用它。 */
  | { readonly t: 'sources'; readonly key: string; readonly sources: readonly WireBuffer[] }
  /**
   * 渲染一个计划。
   *
   * 刻意**不传 `ExecuteOptions` 整体**：它含 `textRenderer`（函数）等
   * 不可结构化克隆的成员。这里只传"要不要画字"这个事实，由 Worker 自己在
   * 线程内组装同一个文字栅格化器 —— 于是"字怎么画"在两端仍是**同一份实现**。
   */
  | {
      readonly t: 'job';
      readonly id: number;
      readonly key: string;
      readonly plan: pipeline.RenderPlan;
      readonly withText: boolean;
      /** false = 不使用阶段缓存（一次性大图导出，省内存）。 */
      readonly cache: boolean;
    }
  /** 让 Worker 丢掉阶段快照（源图与会话状态保留）。 */
  | { readonly t: 'reset' }
  /**
   * 解一张 JPEG。
   *
   * 为什么也塞进**渲染** Worker 而不是另开一个：解出来的像素紧接着就要被渲染，
   * 两个任务在同一条队列上排队是**正确**的顺序（导入时本来没有预览要重画）；
   * 而多开一个 Worker 要多付一次握手、一套降级路径、一份模块图。
   *
   * 字节方向走结构化克隆的**复制**（几 MB，且调用方在解完前还得留着原文件字节，
   * 不能 transfer）；反方向的像素才走 transfer。
   */
  | { readonly t: 'decode'; readonly id: number; readonly bytes: Uint8Array }
  /** 主动释放：Worker 随后会被 terminate。 */
  | { readonly t: 'dispose' };

/** Worker → 主线程。 */
export type WorkerResponse =
  /** 模块加载成功且已就绪。加载失败时**不会有这条**（脚本根本没跑起来）。 */
  | { readonly t: 'ready' }
  /** init 阶段失败（例如缓存预算非法）。 */
  | { readonly t: 'init-error'; readonly reason: string }
  | {
      readonly t: 'result';
      readonly id: number;
      readonly pixels: WireBuffer;
      /** 仅 `cache: true` 的任务提供。 */
      readonly stats?: pipeline.CacheStats;
    }
  | { readonly t: 'decoded'; readonly id: number; readonly pixels: WireBuffer }
  /** 该任务失败（错误**按任务隔离**，不拖垮端口）。 */
  | { readonly t: 'error'; readonly id: number; readonly reason: string }
  /**
   * JPEG 解不开。刻意**不与 `error` 共用**：
   *   · `error` 可能意味着线程/通道坏了 ⇒ 端口该永久降级到内联；
   *   · 渐进式 / CMYK / 码流损坏是**这张图**坏了 ⇒ 降级也没用，必须原样抛给用户。
   * 混成一条的后果是：导入一张网页下载的渐进式 JPEG，就把整条渲染链永久
   * 拖回主线程 —— 一个用户的坏文件变成了全局性能事故。
   */
  | { readonly t: 'decode-error'; readonly id: number; readonly reason: string };
