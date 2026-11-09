/**
 * 真实 Worker 的**端口适配器** —— 把内核的 `PixelWorkerPort` 契约接到
 * `postMessage` 上（P6-d 序 5 / A1）。
 *
 * ── 分工（这条别搞反）────────────────────────────────────────────
 *   内核 `pipeline/scheduler.ts`  调度逻辑：并发、排队、错误隔离 —— 纯逻辑、可测
 *   本文件                        传输逻辑：源图缓存、消息编解码、降级兜底
 *   `worker/render-worker.ts`     执行体：换个线程调内核
 * 于是"并发策略"与"线程怎么开"各自独立演进，谁都不用知道对方的细节。
 *
 * ── 三条必须讲清的设计 ──────────────────────────────────────────
 *
 * 1. **源图只上传一次。** 按源像素底层 buffer 的**引用身份**算 key，key 不变就
 *    不重传。拖滑杆时源图没变，每帧只发一个 plan（几 KB）—— 24MP 若每帧重传
 *    就是 96 MB/帧，传输开销会把离线程的收益全吃回去还倒亏。用引用身份而不是
 *    采样指纹，是因为身份**不会误判**：采样指纹理论上可能撞（换了图却同指纹），
 *    那会让画面静默停在旧图，属于最坏的一类缺陷。
 *
 * 2. **上传是复制，结果移交是零拷贝。** 源图是会话的**母本**，绝不能 transfer
 *    出去（那会把母本抽空，整条编辑链当场报废）；因此上传走结构化克隆的隐式
 *    复制。反过来结果 buffer 只有 Worker 引用，于是走 transfer list 零拷贝回传。
 *
 * 3. **失败只降级，不失败。** Worker 是优化不是前提：构造失败、脚本加载失败、
 *    握手超时、运行期崩溃 —— 任何一种都退回 `InlinePort`（同一份内核、同一条
 *    计划），只是回到主线程执行。**宁可慢，不可错，更不可白屏。**
 */
import { pipeline, type PixelBuffer } from '@photo/core';
/* 内联兜底用的解码器。这里用**裸说明符**是对的：本文件只在主线程（文档）
 * 的模块图里，Worker 那条图走的是 `render-worker.ts` + 绝对 URL。
 * 两条路最终指向同一个构建产物，所以"换个线程"不改变一个字节。 */
import { decodeJpeg as inlineDecodeJpeg } from '@photo/io';
import type { WorkerRequest, WorkerResponse, WireBuffer } from './worker/protocol.js';

/**
 * "这张图解不开"—— 与"通道坏了"必须可区分。
 *
 * 区分不开的后果：导入一张网页下载的渐进式 JPEG，端口按"运行期失败"处理并
 * **永久降级到主线程**，于是 24MP 的渲染从此都跑在 UI 线程上 ——
 * 一个坏文件造成全局性能事故。
 */
class WorkerDecodeError extends Error {}

/**
 * Worker 的最小结构 —— 只声明本端口真正用到的四个成员。
 * 收窄接口的理由同 `surface.ts`：依赖越窄，"换实现"才越便宜（单测就能换假的）。
 */
export interface WorkerLike {
  onmessage: ((event: { readonly data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface RenderPortOptions {
  /**
   * 内存预算（字节），与导出准入 `gateExport` 同一个数；缺省用内核默认（2 GB）。
   *
   * 这里给的是"总共能用多少"，不是"快照能占多少" —— 后者随计划规模变，
   * 只有内核的 `cacheBudgetFor` 知道怎么算。Worker 侧与降级后的内联侧必须拿
   * **同一个数**，否则"运行期退回主线程"会顺手改掉缓存策略，把复用差异
   * 伪装成线程差异。
   */
  readonly memoryBudgetBytes?: number;
  /** 握手超时（毫秒）。脚本加载不出来时靠它兜底，而不是无限等待。 */
  readonly handshakeTimeoutMs?: number;
  /** 覆盖 Worker 模块 URL；默认取与本文件同目录的 `worker/render-worker.js`。 */
  readonly url?: string | URL;
  /**
   * 注入 Worker 构造。单测传假实现即可在 Node 里跑通整条端口逻辑；
   * 不传则用真实 `Worker`。
   */
  readonly spawn?: (url: string) => WorkerLike;
}

/** 端口最终由谁执行。 */
export type RenderPortKind = 'worker' | 'inline';

export interface RenderPortSetup {
  readonly port: pipeline.PixelWorkerPort;
  readonly kind: RenderPortKind;
  /** `kind === 'inline'` 时，退回内联的**人话原因**。 */
  readonly reason?: string;
  /**
   * JPEG 解码入口 —— 与 `port` **同一个决策点**：Worker 活着交给它，
   * 降级或本来就是内联则就地解。
   *
   * 为什么放在这里而不是让 `image-io.ts` 自己判断：那样"Worker 起没起来"
   * 会同时存在于两处（端口降级 + 导入路径），运行期降级时两边会不一致。
   * 收敛成一个函数之后，调用方连"有 Worker 这回事"都不必知道。
   */
  readonly decodeJpeg: (bytes: Uint8Array) => Promise<PixelBuffer>;
  /**
   * 运行期是否已降级到内联执行。
   *
   * 握手成功**不代表**永不降级 —— 线程或通道可能在运行中坏掉，届时端口会
   * **永久**退回主线程（慢但不崩）。这个查询给 UI 与冒烟一个诚实的观察点：
   * 否则"Worker 悄悄没了"会让性能回退不留任何痕迹，而这正是最难发现的一类
   * 退化（功能全对，只是变慢）。
   */
  degraded(): boolean;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4000;

/** 默认 Worker 模块 URL：与本文件产物同目录的 `worker/render-worker.js`。 */
function defaultWorkerUrl(): string {
  return new URL('./worker/render-worker.js', import.meta.url).href;
}

function emptyResult(id: number, error: string): pipeline.JobResult {
  return { id, pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, error };
}

function wireOf(pixels: PixelBuffer): WireBuffer {
  return { width: pixels.width, height: pixels.height, data: pixels.data };
}

function toPixel(wire: WireBuffer): PixelBuffer {
  return { width: wire.width, height: wire.height, data: wire.data };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Worker 的失败原因。
 *
 * `onerror` 给的是 **Event**，不是 Error —— 直接 `String(event)` 只会得到
 * `[object Event]`，把"哪条脚本、第几行"全丢掉，用户看到的就是一个没用的红条。
 * 这里挑 ErrorEvent 上真实存在的字段；什么都没有时也要说清"没详情、去看控制台"，
 * 而不是假装报出了原因。
 */
function describeWorkerError(event: unknown): string {
  const e = event as Partial<{
    readonly type: string;
    readonly message: string;
    readonly filename: string;
    readonly lineno: number;
    readonly colno: number;
  }>;
  if (typeof e?.message === 'string' && e.message !== '') {
    const where =
      typeof e.filename === 'string' && e.filename !== ''
        ? ` @${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}`
        : '';
    return `${e.message}${where}`;
  }
  return `${e?.type ?? 'error'} 事件无详情 —— 脚本没起来，具体原因看 DevTools 控制台`;
}

/** 真实 Worker 的构造（DOM 事件类型比本端口消费的字段宽，这里断言对齐同一个对象）。 */
function spawnRealWorker(url: string): WorkerLike {
  return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
}

/**
 * 源图组的**身份 key**：尺寸 + 底层 buffer 的对象身份。
 *
 * 刻意不用内容哈希：那本身就是 O(w·h)，24MP 一张就白烧几十毫秒，把缓存省的
 * 又赔回去。buffer 引用相同即像素必然相同（内核的编辑**从不原地改源图**，
 * 每次编辑都产出新文档、新计划，源像素只有导入与切换当前图会换对象）。
 */
class SourceKeyer {
  private readonly ids = new WeakMap<ArrayBufferLike, number>();
  private next = 1;

  keyOf(sources: readonly PixelBuffer[]): string {
    const parts: string[] = [];
    for (const source of sources) {
      parts.push(`${source.width}x${source.height}#${this.idFor(source.data.buffer)}`);
    }
    return parts.join('|');
  }

  private idFor(buffer: ArrayBufferLike): number {
    const known = this.ids.get(buffer);
    if (known !== undefined) return known;
    const id = this.next;
    this.next += 1;
    this.ids.set(buffer, id);
    return id;
  }
}

/** 真实 Worker 的端口实现。 */
export class WorkerRenderPort implements pipeline.PixelWorkerPort {
  readonly name = 'worker';

  private readonly worker: WorkerLike;
  private readonly keyer = new SourceKeyer();
  private readonly memoryBudgetBytes: number | undefined;
  private readonly pending = new Map<
    number,
    { resolve: (result: pipeline.JobResult) => void; reject: (error: Error) => void }
  >();
  /** 解码任务**单独一张表**：它的失败不降级，语义与渲染任务不同。 */
  private readonly pendingDecode = new Map<
    number,
    { resolve: (pixels: PixelBuffer) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  /** 已告知 Worker 的源图 key；`null` 表示还没上传过。 */
  private uploadedKey: string | null = null;
  /** 降级后的执行体（内核内联端口，自带阶段缓存）。 */
  private fallback: pipeline.InlinePort | null = null;
  private fallbackReason: string | null = null;
  private disposed = false;
  /** 握手的两条出路由 `handshake()` 装上；之后再来的 ready/error 视为噪声。 */
  private onReady: (() => void) | null = null;
  private onReadyFailed: ((reason: string) => void) | null = null;

  constructor(worker: WorkerLike, options: RenderPortOptions = {}) {
    this.worker = worker;
    this.memoryBudgetBytes = options.memoryBudgetBytes;
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => {
      /* 模块加载失败（例如 MIME 不对、`app://` 取不到文件）走这里 ——
       * 此时**不会**有 ready 消息，所以握手与运行期都要认它。 */
      this.fatal(`Worker 报错：${describeWorkerError(event)}`);
    };
  }

  /** 是否已降级到内联执行（供冒烟断言）。 */
  get degraded(): boolean {
    return this.fallback !== null;
  }

  get degradeReason(): string | null {
    return this.fallbackReason;
  }

  /**
   * 握手：发 `init` 并等 `ready`。
   * @returns `null` 表示就绪；否则是**人话原因**（调用方据此退回内联端口）。
   */
  handshake(timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const finish = (reason: string | null): void => {
        this.onReady = null;
        this.onReadyFailed = null;
        clearTimeout(timer);
        resolve(reason);
      };
      const timer = setTimeout(() => {
        finish(`Worker 握手超时（${timeoutMs}ms）—— 脚本可能未加载成功`);
      }, timeoutMs);
      this.onReady = () => finish(null);
      this.onReadyFailed = (reason) => finish(reason);
      /* 未注入时显式发出内核默认值（而不是"不给"）：Worker 侧与降级后的内联侧
       * 必须看到同一个数，缓存策略才不会被线程选择带偏。 */
      this.post({
        t: 'init',
        memoryBudgetBytes: this.memoryBudgetBytes ?? pipeline.DEFAULT_EXPORT_MEMORY_BUDGET_BYTES,
      });
    });
  }

  async run(job: pipeline.RenderJob): Promise<pipeline.JobResult> {
    if (this.disposed) return emptyResult(job.id, '端口已销毁');
    if (this.fallback !== null) return this.fallback.run(job);
    try {
      this.uploadSources(job.sources);
      return await this.dispatch(job);
    } catch (error) {
      /* 端口一旦不可用就**永久**降级：渲染结果不因此改变（同一份内核、
       * 同一条计划、同样的选项），只是回到主线程执行。
       *
       * `fatal` **返回**降级后的执行体，而不是让这里再读一次字段：编译器
       * 只看得到"方法被调用"，看不到它改了 `this.fallback`，于是把该字段
       * 一直窄化成 `null`（那一支会变成 `never` 而报错）。返回值的写法顺带让
       * "降级一定拿得到兜底执行体"在类型上成立。 */
      return this.fatal(describe(error)).run(job);
    }
  }

  /**
   * 解一张 JPEG：**Worker 活着就交给它，否则就地解**。
   *
   * 这一片要解决的是序3 认下的代价 —— "同步 JS 解码占住线程"，本机量级
   * 24MP ≈ 2.9 s。两条路跑的是同一个 `decodeJpeg`，所以搬线程**不改变一个字节**，
   * X1「桌面与 CLI 逐字节一致」这条断言不受影响。
   */
  async decodeJpeg(bytes: Uint8Array): Promise<PixelBuffer> {
    if (this.disposed || this.fallback !== null) return inlineDecodeJpeg(bytes);
    try {
      return await this.dispatchDecode(bytes);
    } catch (error) {
      if (error instanceof WorkerDecodeError) throw error;
      /* 走到这里说明是**通道**坏了（postMessage 抛、端口中途被销毁）：
       * 降级 + 就地重解。用户拿到的仍是正确答案，只是慢。 */
      if (!this.disposed) this.fatal(describe(error));
      return inlineDecodeJpeg(bytes);
    }
  }

  reset(): void {
    if (this.disposed) return;
    if (this.fallback !== null) {
      this.fallback.reset();
      return;
    }
    /* 只丢快照，**不丢源图**：源图留在 Worker 里，下一帧就不必重传 96 MB。
     * 若源图确实换了，key 会变，`uploadSources` 自会重传。 */
    this.post({ t: 'reset' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fallback?.dispose();
    this.rejectPending(new Error('端口已销毁'));
    this.post({ t: 'dispose' });
    this.worker.terminate();
  }

  /* ───────────────────────── 内部 ───────────────────────── */

  private post(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }

  private uploadSources(sources: readonly PixelBuffer[]): void {
    const key = this.keyer.keyOf(sources);
    if (key === this.uploadedKey) return;
    /* 结构化克隆隐式复制：绝不能用 transfer —— 那是会话的母本像素。 */
    this.post({ t: 'sources', key, sources: sources.map(wireOf) });
    this.uploadedKey = key;
  }

  private dispatch(job: pipeline.RenderJob): Promise<pipeline.JobResult> {
    const id = this.nextId;
    this.nextId += 1;
    const key = this.uploadedKey ?? '';
    return new Promise<pipeline.JobResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({
        t: 'job',
        id,
        key,
        plan: job.plan,
        /* `ExecuteOptions` 含函数成员、不可结构化克隆；这里只传"要不要画字"，
         * Worker 侧自会组出同一个栅格化器。 */
        withText: job.options?.textRenderer !== undefined,
        cache: job.cache ?? true,
      });
    });
  }

  private dispatchDecode(bytes: Uint8Array): Promise<PixelBuffer> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<PixelBuffer>((resolve, reject) => {
      this.pendingDecode.set(id, { resolve, reject });
      /* 字节方向是**复制**（结构化克隆隐式完成）：调用方在解完之前还要留着
       * 这份文件字节，transfer 会把人家的 buffer 抽空。 */
      this.post({ t: 'decode', id, bytes });
    });
  }

  private receive(message: WorkerResponse): void {
    if (message.t === 'ready') {
      this.onReady?.();
      return;
    }
    if (message.t === 'init-error') {
      if (this.onReadyFailed !== null) this.onReadyFailed(message.reason);
      else this.fatal(message.reason);
      return;
    }

    if (message.t === 'decoded' || message.t === 'decode-error') {
      const slot = this.pendingDecode.get(message.id);
      if (slot === undefined) return;
      this.pendingDecode.delete(message.id);
      /* 解不开 ⇒ WorkerDecodeError，**不**走 fatal：坏图片不该把端口拖去降级。 */
      if (message.t === 'decoded') slot.resolve(toPixel(message.pixels));
      else slot.reject(new WorkerDecodeError(message.reason));
      return;
    }

    const slot = this.pending.get(message.id);
    if (slot === undefined) return; // 已因降级/销毁被清掉 —— 丢弃即可
    this.pending.delete(message.id);

    if (message.t === 'error') {
      slot.reject(new Error(message.reason));
      return;
    }
    slot.resolve(
      message.stats === undefined
        ? { id: message.id, pixels: toPixel(message.pixels) }
        : { id: message.id, pixels: toPixel(message.pixels), stats: message.stats },
    );
  }

  /** 永久降级到内联执行，并**返回**该执行体（理由见 `run` 的注释）。 */
  private fatal(reason: string): pipeline.InlinePort {
    if (this.fallbackReason === null) this.fallbackReason = reason;
    if (this.fallback === null) {
      this.fallback = new pipeline.InlinePort(
        { memoryBudgetBytes: this.memoryBudgetBytes },
        'inline-fallback',
      );
    }
    /* 握手中的失败要交给握手去回报，而不是让调用方一直等到超时。 */
    this.onReadyFailed?.(reason);
    this.rejectPending(new Error(reason));
    try {
      this.worker.terminate();
    } catch {
      /* 已经死掉的 Worker 再 terminate 会抛 —— 无意义，忽略。 */
    }
    return this.fallback;
  }

  private rejectPending(error: Error): void {
    for (const slot of this.pending.values()) slot.reject(error);
    this.pending.clear();
    /* 解码任务也要醒 —— 否则导入的 `await` 永远挂着，界面停在"正在读取"。 */
    for (const slot of this.pendingDecode.values()) slot.reject(error);
    this.pendingDecode.clear();
  }
}

/**
 * 组装渲染端口：优先真 Worker，任何一步不成立就内联。
 *
 * **为什么要做成 async 的工厂而不是一个类**：Worker 能不能用要到**加载之后**
 * 才知道（脚本解析、模块解析、MIME 都可能出问题）。把"判定"放在这里，
 * 会话（`EditSession`）拿到的永远是一个**已确认可用**的端口，
 * 于是会话里一行 `if (worker 可用)` 都不需要。
 */
export async function createRenderPort(options: RenderPortOptions = {}): Promise<RenderPortSetup> {
  const inline = (reason: string): RenderPortSetup => ({
    port: new pipeline.InlinePort({ memoryBudgetBytes: options.memoryBudgetBytes }, 'inline'),
    kind: 'inline',
    reason,
    decodeJpeg: async (bytes) => inlineDecodeJpeg(bytes),
    /* 本来就是内联 —— "降级"对它不成立，恒为 false。 */
    degraded: () => false,
  });

  const url = options.url === undefined ? defaultWorkerUrl() : String(options.url);
  const spawn = options.spawn ?? spawnRealWorker;

  let worker: WorkerLike;
  try {
    worker = spawn(url);
  } catch (error) {
    return inline(`无法创建 Worker：${describe(error)}`);
  }

  const port = new WorkerRenderPort(worker, options);
  const failure = await port.handshake(options.handshakeTimeoutMs);
  /* 握手失败后也走 `inline(...)`，于是解码入口同样落到内联 —— 不会留下
   * "渲染降级了但导入还去敲死掉的 Worker"这种半降级状态。 */
  if (failure === null) {
    return { port, kind: 'worker', decodeJpeg: (bytes) => port.decodeJpeg(bytes), degraded: () => port.degraded };
  }
  port.dispose();
  return inline(failure);
}
