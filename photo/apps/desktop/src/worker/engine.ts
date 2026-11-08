/**
 * Worker 侧的**任务引擎** —— 与线程、与 `self`、与 `postMessage` 全部无关。
 *
 * ── 为什么要从 `render-worker.ts` 里抽出来 ────────────────────────
 * `render-worker.ts` 依赖 `self`（Worker 全局），而 Node 里没有 `self` ——
 * 于是"Worker 到底怎么算这条计划"这件事就只能靠 Electron 冒烟验证，
 * 单测碰不到。把消息处理抽成 `handle(request): response` 之后：
 *
 *   - **单测**直接喂请求、断言响应（含"与 InlinePort 逐字节一致"）；
 *   - **冒烟**只需要证明"这套引擎真的在 Chromium 的 Worker 里跑起来了"。
 *
 * 也就是把"逻辑对"与"平台能跑"重新分成两段，各自用最便宜的手段验证。
 *
 * ── 它持有的三样东西，各有理由 ───────────────────────────────────
 * 1. `RenderCache`：阶段缓存**必须与执行线程同生共死**。若把缓存留在主线程、
 *    每帧把快照搬过来，传输开销会把缓存省下的全部吃掉。缓存跟着 Worker 走，
 *    才能做到"拖滑杆只重算变化的那一段"。
 * 2. `sources`：源图按 `key` 收下后常驻，后续任务只收 plan（见 protocol.ts）。
 * 3. `textRenderer`：懒建，因为一块 24MP 的离屏画布不该被"不画字"的图付钱。
 */
import { pipeline, type PixelBuffer } from 'app://core/index.js';
import type { ops } from 'app://core/index.js';
import type { WorkerRequest, WorkerResponse, WireBuffer } from './protocol.js';

/** 文字栅格化器的供给函数 —— 由外壳注入（Worker 里是 OffscreenCanvas 版）。 */
export type TextRendererFactory = () => ops.TextRenderer;

/**
 * JPEG 解码函数 —— 同样**注入**，不在这里 `import`。
 *
 * 注入的理由与 `createTextRenderer` 一致：让本文件保持"只依赖内核"，
 * 于是 Node 单测能直接驱动它，而"桌面与 CLI 解出同一份像素"这件事
 * 落在**接线处**（`render-worker.ts` 交出的就是 io 的那一份 `decodeJpeg`），
 * 一眼可查，不必读两个模块才知道跑的是哪个实现。
 */
export type JpegDecoder = (bytes: Uint8Array) => PixelBuffer;

export interface WorkerEngineOptions {
  /**
   * 内存预算（字节），缺省 = 内核的导出准入默认值（2 GB）。
   * 留几张阶段快照由内核按本次计划规模推导，这里**不**定快照的数。
   */
  readonly memoryBudgetBytes?: number;
  readonly createTextRenderer: TextRendererFactory;
  readonly decodeJpeg: JpegDecoder;
}

export interface WorkerEngine {
  /**
   * 处理一条主线程消息。
   * @returns 需要回传的响应；`sources` / `reset` / `dispose` 这类单向消息返回 `null`。
   */
  handle(request: WorkerRequest): WorkerResponse | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkerEngine(options: WorkerEngineOptions): WorkerEngine {
  /* 默认值**不在这里**：内核的 `RenderCache` 缺省就用准入那个数（2 GB）。
   * 这里再写一个 128 MB，就是"缓存与准入各说各话"的下一次事故现场。 */
  let memoryBudgetBytes = options.memoryBudgetBytes;
  let cache: pipeline.RenderCache | null = null;
  let sources: readonly WireBuffer[] = [];
  let sourceKey = '';
  let textRenderer: ops.TextRenderer | undefined;
  let textTried = false;

  function ensureCache(): pipeline.RenderCache {
    if (cache === null) {
      cache =
        memoryBudgetBytes === undefined
          ? new pipeline.RenderCache()
          : new pipeline.RenderCache({ memoryBudgetBytes });
    }
    return cache;
  }

  /**
   * 取文字栅格化器。
   *
   * 建不出来时返回 `undefined`，调用方据此**报错**而不是照常渲染 ——
   * 静默丢水印属于"看着成功、结果不对"，比失败更难发现。
   */
  function text(): ops.TextRenderer | undefined {
    if (!textTried) {
      textTried = true;
      try {
        textRenderer = options.createTextRenderer();
      } catch {
        textRenderer = undefined;
      }
    }
    return textRenderer;
  }

  function runJob(request: Extract<WorkerRequest, { t: 'job' }>): WorkerResponse {
    if (request.key !== sourceKey) {
      /* 主线程以为已上传、引擎却没有 —— 明确报错，绝不用空源图渲出一张
       * 1×1 的图冒充成功。 */
      return { t: 'error', id: request.id, reason: 'Worker 未持有该组源图（未上传，或已被重置）' };
    }

    /* `ExecuteOptions` 的成员是 `readonly` —— 因此这里是**构造**选项对象，
     * 而不是逐项给字段赋值（后者编译期就过不去，这正是 readonly 的价值）。 */
    let execOptions: pipeline.ExecuteOptions = {};
    if (request.withText) {
      const renderer = text();
      if (renderer === undefined) {
        return { t: 'error', id: request.id, reason: 'Worker 内无法建立文字栅格化器' };
      }
      execOptions = { textRenderer: renderer };
    }

    try {
      let pixels: PixelBuffer;
      let stats: pipeline.CacheStats | undefined;
      if (request.cache) {
        const ran = ensureCache().execute(sources, request.plan, execOptions);
        pixels = ran.pixels;
        stats = ran.stats;
      } else {
        /* 一次性大图导出：不落快照（24MP × 8 阶段 ≈ 768 MB）。 */
        pixels = pipeline.executePlan(sources, request.plan, execOptions);
      }
      const wire: WireBuffer = { width: pixels.width, height: pixels.height, data: pixels.data };
      return stats === undefined
        ? { t: 'result', id: request.id, pixels: wire }
        : { t: 'result', id: request.id, pixels: wire, stats };
    } catch (error) {
      return { t: 'error', id: request.id, reason: describe(error) };
    }
  }

  return {
    handle(request: WorkerRequest): WorkerResponse | null {
      switch (request.t) {
        case 'init': {
          memoryBudgetBytes = Math.max(0, Math.floor(request.memoryBudgetBytes));
          cache = null;
          return { t: 'ready' };
        }
        case 'sources': {
          sources = request.sources;
          sourceKey = request.key;
          /* 源图换了 ⇒ 旧快照的指纹必然不再匹配，留着只是白占内存。 */
          cache?.reset();
          return null;
        }
        case 'job': {
          return runJob(request);
        }
        case 'decode': {
          try {
            const pixels = options.decodeJpeg(request.bytes);
            return {
              t: 'decoded',
              id: request.id,
              pixels: { width: pixels.width, height: pixels.height, data: pixels.data },
            };
          } catch (error) {
            /* 走 `decode-error` 而不是 `error`：这是**这张图**的问题，
             * 不是这条通道的问题 —— 不许它把端口拖去降级。 */
            return { t: 'decode-error', id: request.id, reason: describe(error) };
          }
        }
        case 'reset': {
          cache?.reset();
          return null;
        }
        case 'dispose': {
          cache = null;
          sources = [];
          sourceKey = '';
          textRenderer = undefined;
          textTried = false;
          return null;
        }
        default: {
          const exhaustive: never = request;
          throw new Error(`未知消息：${String(exhaustive)}`);
        }
      }
    },
  };
}
