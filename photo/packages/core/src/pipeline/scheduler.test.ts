import { describe, expect, it } from 'vitest';

import { createDocument } from '../document/defaults.js';
import { pushOp } from '../document/history.js';
import { fill } from '../pixels/compose.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { buildPlan } from './plan.js';
import {
  createSerialPool,
  InlinePort,
  WorkerPool,
  type JobResult,
  type PixelWorkerPort,
  type RenderJob,
} from './scheduler.js';
import type { RenderTarget } from './types.js';

const TARGET: RenderTarget = { kind: 'export', maxEdge: 160, withText: false };

function docOf(w: number, h: number) {
  let d = createDocument();
  d = pushOp(d, {
    k: 'setSources',
    value: [{ id: 'a', name: 'a', width: w, height: h }],
    current: 0,
  });
  d = pushOp(d, {
    k: 'setAdjust',
    value: {
      brightness: 105,
      contrast: 110,
      saturate: 120,
      exposure: 0,
      warm: 5,
      vignette: 20,
      grain: 0,
      sharpen: 0,
      dehaze: 0,
      soften: 0,
      rain: 0,
      fog: 0,
    },
  });
  return d;
}

function img(w: number, h: number, r: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, r, 100, 150, 255);
  return buf;
}

function makeJobs(count: number): RenderJob[] {
  const plan = buildPlan(docOf(120, 90), TARGET);
  const jobs: RenderJob[] = [];
  for (let i = 0; i < count; i++) {
    jobs.push({ id: i, sources: [img(120, 90, 10 + i * 20)], plan });
  }
  return jobs;
}

class FailingPort implements PixelWorkerPort {
  readonly name = 'failing';
  async run(job: RenderJob): Promise<JobResult> {
    throw new Error(`boom ${job.id}`);
  }
  reset(): void {
    /* nothing */
  }
  dispose(): void {
    /* nothing */
  }
}

describe('WorkerPool —— 并发调度（P1-4 的后台执行位）', () => {
  it('内联池按容量并发，结果与输入同序', async () => {
    const pool = WorkerPool.inline(2);
    const jobs = makeJobs(4);
    const results = await pool.map(jobs);

    expect(results.map((r) => r.id)).toEqual([0, 1, 2, 3]);
    for (const r of results) {
      expect(r.error).toBeUndefined();
      expect(r.stats?.computed).toBeGreaterThan(0);
    }
    const stats = pool.stats();
    expect(stats.maxConcurrent).toBe(2);
    expect(stats.completed).toBe(4);
    expect(stats.queued).toBe(0);
    pool.dispose();
  });

  it('串行池并发恒为 1', async () => {
    const pool = createSerialPool();
    const results = await pool.map(makeJobs(3));
    expect(results.length).toBe(3);
    expect(pool.stats().maxConcurrent).toBe(1);
    pool.dispose();
  });

  it('端口拒绝不会让任务永久挂起（错误被隔离成结果）', async () => {
    const pool = new WorkerPool([new InlinePort(), new FailingPort()]);
    const results = await pool.map(makeJobs(2));
    const ok = results.find((r) => r.error === undefined);
    const bad = results.find((r) => r.error !== undefined);
    expect(ok).toBeDefined();
    expect(bad?.error).toContain('boom');
    expect(pool.stats().completed).toBe(2);
    pool.dispose();
  });

  it('单个端口抛错不影响其他任务完成', async () => {
    const pool = new WorkerPool([new FailingPort(), new InlinePort(), new FailingPort()]);
    const results = await pool.map(makeJobs(5));
    expect(results.length).toBe(5);
    expect(results.every((r) => r.id >= 0 && r.id < 5)).toBe(true);
    expect(pool.stats().completed).toBe(5);
    pool.dispose();
  });

  it('dispose 后的任务直接返回错误而不挂起', async () => {
    const pool = WorkerPool.inline(1);
    pool.dispose();
    const r = await pool.run(makeJobs(1)[0]!);
    expect(r.error).toContain('disposed');
  });

  it('空端口列表直接抛错（尽早暴露误用）', () => {
    expect(() => new WorkerPool([])).toThrow();
  });

  it('内联端口之间缓存独立：换任务不串味', async () => {
    const pool = WorkerPool.inline(2);
    const a = makeJobs(1)[0]!;
    const b = makeJobs(1)[0]!;
    const [ra, rb] = await pool.map([a, b]);
    expect(Array.from(ra!.pixels.data)).toEqual(Array.from(rb!.pixels.data));
    pool.dispose();
  });

  it('size 反映端口数', () => {
    const pool = WorkerPool.inline(3);
    expect(pool.size).toBe(3);
    pool.dispose();
  });
});

describe('InlinePort —— cache 开关与 reset（序 5 新增的端口契约）', () => {
  it('cache:false 走无状态执行器：不返回 stats，且**不污染**缓存', async () => {
    const port = new InlinePort();
    const job = makeJobs(1)[0]!;

    const cold = await port.run(job);
    expect(cold.stats?.computed).toBeGreaterThan(0);

    /* 一次"导出式"任务：不落快照。 */
    const uncached = await port.run({ ...job, id: 99, cache: false });
    expect(uncached.stats).toBeUndefined();
    expect(Array.from(uncached.pixels.data)).toEqual(Array.from(cold.pixels.data));

    /* 紧接着的缓存任务**仍然全量复用** —— 说明上面那次没把缓存写脏。
     * 这条是"导出与预览同源"在执行器层面的形态：两条分支输出相同，
     * 差别只在中间快照留不留。 */
    const warm = await port.run({ ...job, id: 100 });
    expect(warm.stats?.computed).toBe(0);
  });

  it('reset 之后同一任务重新计算（不再复用）', async () => {
    const port = new InlinePort();
    const job = makeJobs(1)[0]!;
    await port.run(job);
    expect((await port.run({ ...job, id: 1 })).stats?.computed).toBe(0);

    port.reset();
    expect((await port.run({ ...job, id: 2 })).stats?.reused).toBe(0);
  });

  it('WorkerPool.reset 传到每个端口（池不自己缓存，别假装清了）', async () => {
    const pool = WorkerPool.inline(2);
    const jobs = makeJobs(2);
    await pool.map(jobs);

    const again = await pool.map(jobs.map((j) => ({ ...j, id: j.id + 10 })));
    expect(again.every((r) => r.stats?.computed === 0)).toBe(true);

    pool.reset();
    const afterReset = await pool.map(jobs.map((j) => ({ ...j, id: j.id + 20 })));
    expect(afterReset.every((r) => r.stats?.reused === 0)).toBe(true);
    pool.dispose();
  });
});
