/**
 * 渲染端口（真 Worker 那一侧）的单元测试。
 *
 * ── 测什么、不测什么 ──────────────────────────────────────────────
 * 这里的"假 Worker"**不是**假渲染器：它在当前线程里跑**真引擎**
 * （`worker/engine.ts`），只把"消息进出 + 异步送达"模拟出来。因此
 * 「Worker 结果与内联端口逐字节一致」这条断言是可信的 —— 它证明的是
 * "换个执行体不改变像素"，而不是"两个假货长得像"。
 *
 * **模拟不掉的是真正的跨线程**：结构化克隆的复制语义、结果 buffer 的
 * transfer 移交、以及 `app://` 下的模块 Worker 能否加载。这三件事由
 * Electron 冒烟覆盖（单测里既没有 Worker 全局，也没有 Chromium 的加载器）。
 *
 * ── 为什么"上传一次"值得单测 ─────────────────────────────────────
 * 源图若每帧重传，24MP 就是 96 MB/帧 —— Worker 会比主线程还慢。这是一条
 * **性能正确性**不变量：写错了不报错，只会悄悄变卡。因此必须有断言锁住
 * "源图没变就不重传"。
 */
import { describe, expect, it } from 'vitest';
import { pipeline, type PixelBuffer, type ops } from '@photo/core';
import { decodeJpeg } from '@photo/io';
import { flatColorJpeg } from '@photo/io/testing';
import { firstByteDiff } from './bytes.js';
import { createFakeImageIo, createRecordingSurfaceFactory, patternBuffer } from './canvas-fakes.js';
import { EditSession } from './session.js';
import { SurfacePool } from './surface.js';
import { createCanvasTextRenderer } from './text-renderer.js';
import { createWorkerEngine } from './worker/engine.js';
import type { WorkerRequest, WorkerResponse } from './worker/protocol.js';
import { WorkerRenderPort, createRenderPort, type WorkerLike } from './worker-port.js';

/** 与外壳同构的文字栅格化器，只是底层换成假画布。 */
function fakeTextRenderer(): ops.TextRenderer {
  return createCanvasTextRenderer(new SurfacePool(createRecordingSurfaceFactory().factory));
}

/**
 * 引擎选项。**解码器用真的那一份**，不是假的。
 *
 * 这条选择是有意的：假 Worker 跑的就是这份引擎，于是"Worker 里解出来的像素"
 * 与"主线程直接解出来的像素"是**同一份实现产出的两份结果** —— 拿它们比对，
 * 测的是"换个线程不改变像素"，而不是"两个假货长得像"。
 */
const engineOptions = { createTextRenderer: fakeTextRenderer, decodeJpeg };

/** 一套"跨阶段"的编辑：几何 + 调色 + 文字，尽量多触发 Worker 里的真实计算。 */
function edit(session: EditSession): void {
  session.applyPreset('rainy_dark', 0.8);
  session.rotateClockwise();
  session.setStraighten(3);
  session.setWatermarkText('琉璃');
}

function sessionWith(port: pipeline.PixelWorkerPort, source: PixelBuffer): EditSession {
  const session = new EditSession({
    imageIo: createFakeImageIo(),
    textRenderer: fakeTextRenderer(),
    port,
  });
  session.importPixels(source, 'source.png');
  edit(session);
  return session;
}

/**
 * 假 Worker：跑真引擎，异步送达响应。
 *
 * `queueMicrotask` 不是凑数 —— 真 Worker 的结果**不可能**在 `postMessage`
 * 返回之前到达。若这里同步送达，端口里"按 id 把结果对上任务"的逻辑就永远
 * 走不到，测出来的东西也就没意义了。
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { readonly data: WorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly requests: WorkerRequest[] = [];
  private readonly engine = createWorkerEngine(engineOptions);
  private closed = false;

  postMessage(message: WorkerRequest): void {
    if (this.closed) throw new Error('假 Worker 已被终止');
    this.requests.push(message);
    const response = this.engine.handle(message);
    if (response === null) return;
    queueMicrotask(() => {
      if (this.closed) return;
      this.onmessage?.({ data: response });
    });
  }

  terminate(): void {
    this.closed = true;
  }

  countOf(type: WorkerRequest['t']): number {
    return this.requests.filter((request) => request.t === type).length;
  }
}

/** 永不响应的 Worker：用来测握手超时。 */
class SilentWorker implements WorkerLike {
  onmessage: ((event: { readonly data: WorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(): void {
    /* 故意什么都不做。 */
  }
  terminate(): void {
    /* 故意什么都不做。 */
  }
}

describe('Worker 引擎 · 消息语义', () => {
  it('init 回 ready；sources / reset / dispose 不回响应', () => {
    const engine = createWorkerEngine(engineOptions);
    expect(engine.handle({ t: 'init', memoryBudgetBytes: 8 * 1024 * 1024 })).toEqual({
      t: 'ready',
    });
    expect(engine.handle({ t: 'sources', key: 'k', sources: [] })).toBeNull();
    expect(engine.handle({ t: 'reset' })).toBeNull();
    expect(engine.handle({ t: 'dispose' })).toBeNull();
  });

  it('未持有该组源图时明确报错，而不是用空源图渲出一张 1×1 冒成功', () => {
    const engine = createWorkerEngine(engineOptions);
    /* 这条分支在**读计划之前**就返回，所以这里的计划只有占位作用 ——
     * 宁可留一个不会被读到的占位，也不为了让类型过得去而伪造一份
     * "看起来像计划"的数据（伪造出来的东西下次会被当真）。 */
    const placeholderPlan = {} as pipeline.RenderPlan;
    const response = engine.handle({
      t: 'job',
      id: 7,
      key: '未上传过的 key',
      plan: placeholderPlan,
      withText: false,
      cache: true,
    });
    expect(response).toMatchObject({ t: 'error', id: 7 });
    expect(response !== null && response.t === 'error' ? response.reason : '').toMatch(/源图/);
  });
});

describe('WorkerRenderPort · 与内联端口逐字节同源', () => {
  it('同一份编辑经真 Worker 引擎与内联端口渲染，结果完全一致', async () => {
    const source = patternBuffer(160, 120);
    const fromWorker = await sessionWith(new WorkerRenderPort(new FakeWorker()), source).renderPreview();
    const fromInline = await sessionWith(new pipeline.InlinePort(), source).renderPreview();

    expect(fromWorker.pixels.width).toBe(fromInline.pixels.width);
    expect(firstByteDiff(fromWorker.pixels.data, fromInline.pixels.data)).toBe(-1);
    /* 两边都真的跑过阶段（否则"都输出空图"也会让上一条通过）。 */
    expect(fromWorker.stats.computed).toBeGreaterThan(0);
    expect(fromInline.stats.computed).toBeGreaterThan(0);
  });

  it('水印（文字阶段在 Worker 内栅格化）也逐字节一致', async () => {
    const source = patternBuffer(96, 72);
    const fromWorker = await sessionWith(new WorkerRenderPort(new FakeWorker()), source).renderExport();
    const fromInline = await sessionWith(new pipeline.InlinePort(), source).renderExport();

    /* `sessionWith` 已写入水印 —— 这条同时覆盖"Worker 内自带文字栅格化器"
     * 与主线程注入的是同一份实现。 */
    expect(firstByteDiff(fromWorker.data, fromInline.data)).toBe(-1);
  });
});

describe('WorkerRenderPort · 源图只上传一次', () => {
  it('连续任务共用同一组源图时不重复上传', async () => {
    const worker = new FakeWorker();
    const session = sessionWith(new WorkerRenderPort(worker), patternBuffer(80, 60));
    await session.renderPreview();
    await session.renderPreview();
    await session.renderPreview();

    expect(worker.countOf('sources')).toBe(1);
    expect(worker.countOf('job')).toBe(3);
  });

  it('换源图（新的 buffer 对象）会重新上传', async () => {
    const worker = new FakeWorker();
    const session = sessionWith(new WorkerRenderPort(worker), patternBuffer(80, 60));
    await session.renderPreview();
    session.addPixels(patternBuffer(70, 50), 'second.png');
    await session.renderPreview();

    expect(worker.countOf('sources')).toBe(2);
  });

  it('reset 只丢快照、不丢源图 —— 下一帧不必重传源像素', async () => {
    const worker = new FakeWorker();
    const port = new WorkerRenderPort(worker);
    const session = sessionWith(port, patternBuffer(80, 60));
    await session.renderPreview();

    /* 注意 `importPixels` 自己也会 reset 一次（换了源图，旧快照必然失效）——
     * 所以这里断言的是**增量**，而不是绝对次数，免得把正确行为当成噪声忽略掉。 */
    const resetsBefore = worker.countOf('reset');
    const sourcesBefore = worker.countOf('sources');
    port.reset();
    await session.renderPreview();

    expect(worker.countOf('reset')).toBe(resetsBefore + 1);
    /* 真正的意图：清快照**不该**顺带把源图也清掉，否则下一帧就要重传源像素。 */
    expect(worker.countOf('sources')).toBe(sourcesBefore);
    expect(worker.countOf('sources')).toBe(1);
  });
});

describe('WorkerRenderPort · 缓存语义', () => {
  it('冷启动重算、重渲染复用；端口 reset 之后重新回到重算', async () => {
    const port = new WorkerRenderPort(new FakeWorker());
    const session = sessionWith(port, patternBuffer(120, 90));

    const cold = await session.renderPreview();
    expect(cold.stats.computed).toBeGreaterThan(0);

    const warm = await session.renderPreview();
    expect(warm.stats.reused).toBe(cold.stats.computed);
    expect(warm.stats.computed).toBe(0);

    port.reset();
    const afterReset = await session.renderPreview();
    expect(afterReset.stats.reused).toBe(0);
    expect(afterReset.stats.computed).toBeGreaterThan(0);
  });

  it('导出走 cache:false 分支，且**不污染**后续预览的缓存', async () => {
    const session = sessionWith(new WorkerRenderPort(new FakeWorker()), patternBuffer(120, 90));

    const cached = await session.renderPreview();
    const uncached = await session.renderPreviewUncached();
    /* 同一尺寸、同一条计划：走缓存与不走缓存的输出必须逐字节相同。
     * 这是"导出与预览同源"在执行器层面的形态。 */
    expect(firstByteDiff(cached.pixels.data, uncached.data)).toBe(-1);

    await session.renderExport();
    const afterExport = await session.renderPreview();
    expect(firstByteDiff(afterExport.pixels.data, cached.pixels.data)).toBe(-1);
    /* 导出若把快照写脏了，这一条会失败。 */
    expect(afterExport.stats.computed).toBe(0);
  });
});

/* ─────────────────── 序 4：内存预算一根线走到底 ───────────────────
 *
 * 内核现在只认一个数（`cacheBudgetFor` 由准入线推导快照预算），于是外壳能不能
 * 把这个数**送到该去的地方**就成了新的风险点：Worker 一份缓存、运行期降级后的
 * 内联一份缓存，两处必须是同一个预算 —— 否则"退回主线程"会顺手改掉缓存策略，
 * 把复用差异伪装成线程差异。
 *
 * 可观察的量只有 `stats.reused`：预算小到留不住快照时它归零，而像素一个字节
 * 都不许变。64 KB 是有意选的 —— 它连"执行峰值 × 安全系数"那一口都不够，
 * 内核必然推导出 0 张快照（这条推导在 `cacheBudgetFor` 的单测里已锁，
 * 本片只验数字有没有传到底）。
 */
describe('内存预算接线（序4：缓存预算与导出准入同源）', () => {
  const TINY = 64 * 1024;

  function initOf(worker: FakeWorker): WorkerRequest | undefined {
    return worker.requests.find((request) => request.t === 'init');
  }

  /** 一发 'job' 就断的通道：强制端口降级到内联执行。 */
  class JoblessWorker extends FakeWorker {
    override postMessage(message: WorkerRequest): void {
      if (message.t === 'job') throw new Error('通道断了');
      super.postMessage(message);
    }
  }

  it('端口拿到的预算原样写进 init；未注入时显式发出内核默认', async () => {
    const worker = new FakeWorker();
    await new WorkerRenderPort(worker, { memoryBudgetBytes: 64 * 1024 * 1024 }).handshake(500);
    expect(initOf(worker)).toEqual({ t: 'init', memoryBudgetBytes: 64 * 1024 * 1024 });

    /* "缺省"必须是**说出来的默认值**，不是"什么都不发"：Worker 侧若各自留一份
     * 本地常量，两侧迟早会漂移成两个数。 */
    const defaults = new FakeWorker();
    await new WorkerRenderPort(defaults).handshake(500);
    expect(initOf(defaults)).toEqual({
      t: 'init',
      memoryBudgetBytes: pipeline.DEFAULT_EXPORT_MEMORY_BUDGET_BYTES,
    });
  });

  it('预算经 init 落到 Worker 缓存：小预算零复用，默认预算有复用', async () => {
    const source = patternBuffer(120, 90);

    const tight = new FakeWorker();
    const tightPort = new WorkerRenderPort(tight, { memoryBudgetBytes: TINY });
    await tightPort.handshake(500);
    const tightSession = sessionWith(tightPort, source);
    await tightSession.renderPreview();
    const tightAgain = await tightSession.renderPreview();
    expect(tightAgain.stats.reused).toBe(0);

    const roomy = new FakeWorker();
    const roomyPort = new WorkerRenderPort(roomy);
    await roomyPort.handshake(500);
    const roomySession = sessionWith(roomyPort, source);
    await roomySession.renderPreview();
    const roomyAgain = await roomySession.renderPreview();
    /* 同一份编辑、同一条计划，只是预算不同 ⇒ 这一条证明"归零"来自预算，
     * 而不是端口根本没缓存。 */
    expect(roomyAgain.stats.reused).toBeGreaterThan(0);

    expect(firstByteDiff(tightAgain.pixels.data, roomyAgain.pixels.data)).toBe(-1);
  });

  it('运行期降级到内联时预算跟着过去 —— 小预算机器不会一降级就恢复缓存', async () => {
    async function reusedAfterDegrade(memoryBudgetBytes?: number): Promise<number> {
      const port = new WorkerRenderPort(new JoblessWorker(), { memoryBudgetBytes });
      const session = sessionWith(port, patternBuffer(120, 90));
      await session.renderPreview();
      const again = await session.renderPreview();
      expect(port.degraded).toBe(true);
      return again.stats.reused;
    }

    expect(await reusedAfterDegrade()).toBeGreaterThan(0);
    expect(await reusedAfterDegrade(TINY)).toBe(0);
  });
});

describe('WorkerRenderPort · 失败只降级，不失败', () => {
  it('无法创建 Worker → 退回内联端口并给出人话原因', async () => {
    const setup = await createRenderPort({
      spawn: () => {
        throw new Error('这台机器禁用了 Worker');
      },
    });
    expect(setup.kind).toBe('inline');
    expect(setup.reason).toContain('这台机器禁用了 Worker');
  });

  it('握手超时 → 退回内联端口（脚本没加载出来时不能无限等）', async () => {
    const setup = await createRenderPort({ spawn: () => new SilentWorker(), handshakeTimeoutMs: 20 });
    expect(setup.kind).toBe('inline');
    expect(setup.reason).toMatch(/握手超时/);
  });

  it('握手成功 → 报告为 worker 端口', async () => {
    const setup = await createRenderPort({ spawn: () => new FakeWorker() });
    expect(setup.kind).toBe('worker');
    expect(setup.reason).toBeUndefined();
  });

  it('运行期通道断掉 → 永久降级，但结果依然正确（同一份内核）', async () => {
    /** 一发 'job' 就抛的 Worker：模拟线程/通道在运行中坏掉。 */
    class ExplodingWorker extends FakeWorker {
      override postMessage(message: WorkerRequest): void {
        if (message.t === 'job') throw new Error('通道断了');
        super.postMessage(message);
      }
    }

    const source = patternBuffer(64, 48);
    const port = new WorkerRenderPort(new ExplodingWorker());
    const fromWorker = await sessionWith(port, source).renderPreview();

    expect(port.degraded).toBe(true);
    expect(port.degradeReason).toContain('通道断了');

    /* 关键：**结果不变**。降级只换执行线程，不换渲染结果。 */
    const fromInline = await sessionWith(new pipeline.InlinePort(), source).renderPreview();
    expect(firstByteDiff(fromWorker.pixels.data, fromInline.pixels.data)).toBe(-1);
  });

  it('dispose 之后的 run 返回错误而不是永久挂起', async () => {
    const port = new WorkerRenderPort(new FakeWorker());
    port.dispose();
    const result = await port.run({
      id: 1,
      sources: [patternBuffer(4, 4)],
      plan: {} as pipeline.RenderPlan,
    });
    expect(result.error).toBeTruthy();
  });

  it('被 terminate 的 Worker 再收消息会抛 —— 假实现也不许静默吞掉', async () => {
    const worker = new FakeWorker();
    const port = new WorkerRenderPort(worker);
    port.dispose();
    expect(() => worker.postMessage({ t: 'reset' })).toThrow(/终止/);
  });
});

/* ───────────────────────── 序 3.5：JPEG 解码离线程 ─────────────────────────
 *
 * 这一片锁的是三条**语义**，不是速度（速度只有真机测得出来）：
 *   1. 换线程不换像素 —— 与 X1「桌面与 CLI 逐字节一致」同一条地基；
 *   2. "图坏了"与"通道坏了"必须走两条不同的响应，否则会互相误伤；
 *   3. 任何一条路最终都要给出正确答案，宁可慢不可错。
 */
describe('JPEG 解码搬进 Worker（序3.5：24MP ≈ 2.9 s 不再占住界面线程）', () => {
  /** 一张必然解不开的 JPEG：真码流，截断到只剩头部。 */
  const truncated = (): Uint8Array => flatColorJpeg(24, 24).subarray(0, 24);

  type Decoded = Extract<WorkerResponse, { t: 'decoded' }>;
  type DecodeFailed = Extract<WorkerResponse, { t: 'decode-error' }>;

  it('引擎解出的像素与主线程直接 decodeJpeg 逐字节一致', () => {
    const bytes = flatColorJpeg(32, 24);
    const response = createWorkerEngine(engineOptions).handle({ t: 'decode', id: 3, bytes });
    expect(response !== null && response.t === 'decoded').toBe(true);
    expect((response as Decoded).pixels.width).toBe(32);
    expect(firstByteDiff((response as Decoded).pixels.data, decodeJpeg(bytes).data)).toBe(-1);
  });

  it('解不开时报 decode-error，**不是** error', () => {
    const response = createWorkerEngine(engineOptions).handle({
      t: 'decode',
      id: 9,
      bytes: truncated(),
    });
    /* 若与渲染任务共用 `error`，端口会把它当成"通道坏了"而永久降级 ——
     * 一张坏文件就把全局渲染拖回主线程，这是本片最坏的一类缺陷。 */
    expect(response).toMatchObject({ t: 'decode-error', id: 9 });
    expect((response as DecodeFailed).reason).toMatch(/JPEG/);
  });

  it('端口的解码走 Worker，结果与内联逐字节一致，且不动端口状态', async () => {
    const worker = new FakeWorker();
    const port = new WorkerRenderPort(worker);
    const bytes = flatColorJpeg(32, 24);

    const viaWorker = await port.decodeJpeg(bytes);
    expect(worker.countOf('decode')).toBe(1);
    expect(firstByteDiff(viaWorker.data, decodeJpeg(bytes).data)).toBe(-1);
    expect(port.degraded).toBe(false);
  });

  it('坏 JPEG 抛人话原因；端口不降级，后续解码仍走 Worker', async () => {
    const worker = new FakeWorker();
    const port = new WorkerRenderPort(worker);

    await expect(port.decodeJpeg(truncated())).rejects.toThrow(/JPEG/);
    expect(port.degraded).toBe(false);

    await port.decodeJpeg(flatColorJpeg(24, 24));
    expect(worker.countOf('decode')).toBe(2);
  });

  it('解码通道的传输坏了 → 降级并就地重解，用户仍拿到正确像素', async () => {
    /** 专门在 'decode' 上断掉的通道。 */
    class ExplodingDecodeWorker extends FakeWorker {
      override postMessage(message: WorkerRequest): void {
        if (message.t === 'decode') throw new Error('解码通道断了');
        super.postMessage(message);
      }
    }

    const port = new WorkerRenderPort(new ExplodingDecodeWorker());
    const bytes = flatColorJpeg(24, 24);
    const pixels = await port.decodeJpeg(bytes);

    expect(firstByteDiff(pixels.data, decodeJpeg(bytes).data)).toBe(-1);
    expect(port.degraded).toBe(true);
    expect(port.degradeReason).toContain('解码通道断了');
  });

  it('解码途中端口被销毁 → 就地重解，而不是让 await 永远挂着', async () => {
    const port = new WorkerRenderPort(new SilentWorker());
    const bytes = flatColorJpeg(24, 24);
    const pending = port.decodeJpeg(bytes);
    port.dispose();

    /* 导入卡住不动比报错更难接受：dispose 必须叫醒挂着的解码请求，
     * 而叫醒来之后它要自己把活干完。 */
    expect(firstByteDiff((await pending).data, decodeJpeg(bytes).data)).toBe(-1);
  });

  it('内联 setup 同样提供解码入口（否则接线处要分两种情况）', async () => {
    const setup = await createRenderPort({ spawn: () => new SilentWorker(), handshakeTimeoutMs: 20 });
    expect(setup.kind).toBe('inline');
    const bytes = flatColorJpeg(24, 24);
    expect(firstByteDiff((await setup.decodeJpeg(bytes)).data, decodeJpeg(bytes).data)).toBe(-1);
  });
});
