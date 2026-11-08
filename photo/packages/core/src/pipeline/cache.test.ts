import { describe, expect, it } from 'vitest';

import { createDocument } from '../document/defaults.js';
import { pushOp } from '../document/history.js';
import type { PhotoDocument } from '../document/types.js';
import { fill } from '../pixels/compose.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { RenderCache, sourceFingerprint, stageCacheKey } from './cache.js';
import { executePlan } from './execute.js';
import { cacheBudgetFor, describeMemory, estimateMemory } from './memory.js';
import { buildPlan } from './plan.js';
import { SHELL_REQUIREMENTS, describeShellRequirements } from './shell.js';
import type { RenderPlan, RenderTarget } from './types.js';

function docOf(w: number, h: number): PhotoDocument {
  return pushOp(createDocument(), {
    k: 'setSources',
    value: [{ id: 'a', name: 'a', width: w, height: h }],
    current: 0,
  });
}

function img(w: number, h: number, r: number, g: number, b: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, r, g, b, 255);
  return buf;
}

const PREVIEW: RenderTarget = { kind: 'preview', maxEdge: 320, withText: false };

/** 生成一个"几乎什么都开了"的文档，确保阶段序列足够长。 */
function fullDoc(w: number, h: number): PhotoDocument {
  let d = docOf(w, h);
  d = pushOp(d, {
    k: 'setAdjust',
    value: {
      brightness: 110,
      contrast: 120,
      saturate: 115,
      exposure: 5,
      warm: 10,
      vignette: 30,
      grain: 8,
      sharpen: 20,
      dehaze: 15,
      soften: 0,
      rain: 0,
      fog: 0,
    },
  });
  return d;
}

function bytesOf(buf: PixelBuffer): number[] {
  return Array.from(buf.data);
}

describe('stageCacheKey', () => {
  it('相同参数得到相同键，参数变化则键变化', () => {
    const a: RenderPlan = buildPlan(fullDoc(64, 48), PREVIEW);
    const b: RenderPlan = buildPlan(fullDoc(64, 48), PREVIEW);
    expect(a.stages.map(stageCacheKey)).toEqual(b.stages.map(stageCacheKey));

    const changed = buildPlan(
      pushOp(fullDoc(64, 48), {
        k: 'setAdjust',
        value: {
          brightness: 111,
          contrast: 120,
          saturate: 115,
          exposure: 5,
          warm: 10,
          vignette: 30,
          grain: 8,
          sharpen: 20,
          dehaze: 15,
          soften: 0,
          rain: 0,
          fog: 0,
        },
      }),
      PREVIEW,
    );
    expect(changed.stages.map(stageCacheKey)).not.toEqual(a.stages.map(stageCacheKey));
  });

  it('裁切框参与光栅阶段键：只改 crop 也必须换键（#14 曾漏）', () => {
    const plain = buildPlan(fullDoc(64, 48), PREVIEW);
    const cropped = buildPlan(
      pushOp(fullDoc(64, 48), { k: 'setCrop', value: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }),
      PREVIEW,
    );
    const rasterKeys = (p: RenderPlan): string[] =>
      p.stages.filter((s) => s.kind === 'raster').map(stageCacheKey);

    expect(rasterKeys(plain)).toHaveLength(1);
    /* 这条正是缺陷本体：crop 不进键 ⇒ 改裁切后光栅键不变 ⇒ 交互式预览
     * 会复用"未裁切"的旧快照（导出不走缓存，因此掩盖了这个坑）。 */
    expect(rasterKeys(cropped)).not.toEqual(rasterKeys(plain));
  });
});

describe('RenderCache —— 裁切键回归（#14）', () => {
  it('改裁切框后不复用旧快照，结果与全量重算逐字节一致', () => {
    const cache = new RenderCache();
    const target: RenderTarget = { kind: 'preview', maxEdge: 0, withText: false };
    const doc = fullDoc(64, 48);
    const src = img(64, 48, 30, 90, 180);

    const full = cache.execute([src], buildPlan(doc, target)).pixels;
    expect(full.width).toBe(64);

    const croppedDoc = pushOp(doc, {
      k: 'setCrop',
      value: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    });
    const cropped = cache.execute([src], buildPlan(croppedDoc, target)).pixels;
    const fresh = executePlan([src], buildPlan(croppedDoc, target));

    /* 复用路径必须真的产出裁切后的尺寸（32×24），而不是上一帧的 64×48。 */
    expect(cropped.width).toBe(32);
    expect(cropped.height).toBe(24);
    expect(cropped.data.length).toBe(fresh.data.length);
    for (let i = 0; i < cropped.data.length; i++) {
      if (cropped.data[i] !== fresh.data[i]) throw new Error(`首个不同字节 @${i}`);
    }
  });
});

describe('sourceFingerprint', () => {
  it('同图同指纹，异图异指纹', () => {
    expect(sourceFingerprint(img(32, 32, 10, 20, 30))).toBe(
      sourceFingerprint(img(32, 32, 10, 20, 30)),
    );
    expect(sourceFingerprint(img(32, 32, 10, 20, 30))).not.toBe(
      sourceFingerprint(img(32, 32, 200, 20, 30)),
    );
    expect(sourceFingerprint(img(32, 32, 10, 20, 30))).not.toBe(
      sourceFingerprint(img(64, 32, 10, 20, 30)),
    );
  });
});

describe('RenderCache —— P1-5：只重算变化的下游', () => {
  it('首次执行全部重算，第二次执行全部复用', () => {
    const doc = fullDoc(120, 90);
    const plan = buildPlan(doc, PREVIEW);
    const src = img(120, 90, 90, 120, 160);
    const cache = new RenderCache();

    const first = cache.execute([src], plan);
    expect(first.stats.reused).toBe(0);
    expect(first.stats.computed).toBe(plan.stages.length);

    const second = cache.execute([src], plan);
    expect(second.stats.reused).toBe(plan.stages.length);
    expect(second.stats.computed).toBe(0);
    expect(bytesOf(second.pixels)).toEqual(bytesOf(first.pixels));
  });

  it('复用结果与全量重算逐字节一致（缓存正确性命门）', () => {
    const plan = buildPlan(fullDoc(120, 90), PREVIEW);
    const src = img(120, 90, 90, 120, 160);
    const fresh = executePlan([src], plan);

    // 先跑一次别的计划，制造一个"不匹配"的缓存，再跑目标计划两次
    const cache = new RenderCache();
    cache.execute([src], buildPlan(fullDoc(120, 90), { kind: 'preview', maxEdge: 160, withText: false }));
    cache.execute([src], plan);
    const reused = cache.execute([src], plan);

    expect(reused.stats.reused).toBeGreaterThan(0);
    expect(bytesOf(reused.pixels)).toEqual(bytesOf(fresh));
  });

  it('只改末端参数时，前端阶段被复用', () => {
    const cache = new RenderCache();
    const src = img(120, 90, 90, 120, 160);
    const base = fullDoc(120, 90);
    const planA = buildPlan(base, PREVIEW);
    const r1 = cache.execute([src], planA);

    // 只把暗角从 30 改到 70
    const planB = buildPlan(
      pushOp(base, {
        k: 'setAdjust',
        value: {
          brightness: 110,
          contrast: 120,
          saturate: 115,
          exposure: 5,
          warm: 10,
          vignette: 70,
          grain: 8,
          sharpen: 20,
          dehaze: 15,
          soften: 0,
          rain: 0,
          fog: 0,
        },
      }),
      PREVIEW,
    );
    const r2 = cache.execute([src], planB);

    expect(r1.stats.reused).toBe(0);
    expect(r2.stats.reused).toBeGreaterThan(0);
    expect(r2.stats.computed).toBeLessThan(planB.stages.length);
    expect(r2.stats.computed).toBeGreaterThan(0);
  });

  it('换源图导致指纹变化 → 全量重算', () => {
    const cache = new RenderCache();
    const plan = buildPlan(fullDoc(60, 40), PREVIEW);
    cache.execute([img(60, 40, 10, 10, 10)], plan);
    const r = cache.execute([img(60, 40, 200, 200, 200)], plan);
    expect(r.stats.reused).toBe(0);
  });

  it('A→B→A 的往复不污染缓存（快照必须拷贝，不能别名）', () => {
    const src = img(80, 60, 70, 110, 150);
    const base = fullDoc(80, 60);
    const planA = buildPlan(base, PREVIEW);
    const planB = buildPlan(
      pushOp(base, {
        k: 'setAdjust',
        value: {
          brightness: 150,
          contrast: 90,
          saturate: 60,
          exposure: -20,
          warm: -30,
          vignette: 0,
          grain: 0,
          sharpen: 0,
          dehaze: 0,
          soften: 0,
          rain: 0,
          fog: 0,
        },
      }),
      PREVIEW,
    );

    const cache = new RenderCache();
    const freshA = executePlan([src], planA);
    cache.execute([src], planB); // 先把缓存推到 B
    const back = cache.execute([src], planA); // 再回到 A

    expect(bytesOf(back.pixels)).toEqual(bytesOf(freshA));
  });

  it('阶段数变短时仍能复用共同前缀', () => {
    const src = img(60, 40, 80, 80, 80);
    const longDoc = fullDoc(60, 40);
    const shortDoc = docOf(60, 40); // 只有 raster
    const cache = new RenderCache();
    cache.execute([src], buildPlan(longDoc, PREVIEW));
    const r = cache.execute([src], buildPlan(shortDoc, PREVIEW));
    // 共同前缀至少包含 raster
    expect(r.stats.reused).toBeGreaterThanOrEqual(1);
  });

  it('内存预算小于执行峰值：一张快照都不留，结果仍逐字节正确', () => {
    const plan = buildPlan(fullDoc(120, 90), { kind: 'preview', maxEdge: 320, withText: false });
    const src = img(120, 90, 40, 90, 140);
    const fresh = executePlan([src], plan);
    /* 64 KB 连"执行峰值 × 安全系数"这一口都不够 ⇒ 剩余空间为负 ⇒ 快照 0 张。
     * 老的固定预算做不到这件事：它写着"预算 1 KB"也照样塞一张快照进去。 */
    const tiny = new RenderCache({ memoryBudgetBytes: 64 * 1024 });
    tiny.execute([src], plan);
    const again = tiny.execute([src], plan);
    expect(again.stats.reused).toBe(0);
    expect(again.stats.snapshots).toBe(0);
    expect(bytesOf(again.pixels)).toEqual(bytesOf(fresh));
  });

  it('预算 ⇄ 复用：留得住前缀就复用，只够末端就只能重算（结果都不许变）', () => {
    const src = img(640, 480, 90, 120, 150);
    const target: RenderTarget = { kind: 'preview', maxEdge: 0, withText: false };
    const base = fullDoc(640, 480);
    const plan = buildPlan(base, target);
    const adjust = (vignette: number) =>
      buildPlan(
        pushOp(base, {
          k: 'setAdjust',
          value: {
            brightness: 110,
            contrast: 120,
            saturate: 115,
            exposure: 5,
            warm: 10,
            vignette,
            grain: 8,
            sharpen: 20,
            dehaze: 15,
            soften: 0,
            rain: 0,
            fog: 0,
          },
        }),
        target,
      );
    const changed = adjust(70);
    const fresh = executePlan([src], changed);

    /* 默认预算（2 GB）下这份 640×480 的快照全留得住 ⇒ 改暗角只重算它下游。 */
    const rich = new RenderCache();
    rich.execute([src], plan);
    const reused = rich.execute([src], changed);
    expect(reused.stats.reused).toBeGreaterThan(0);
    expect(reused.stats.reused).toBeLessThan(changed.stages.length);
    expect(bytesOf(reused.pixels)).toEqual(bytesOf(fresh));

    /* 同一件事，预算只够 2 张：淘汰保**连续末端**，而暗角之后还有颗粒 / 锐化，
     * 续算点那张快照已经被丢了 ⇒ 只能整体重算。这是策略的已知边界，
     * 不是缺陷（末端快照最有复用价值 = 交互调参的形状），但必须**如实报 0**。 */
    const derived = cacheBudgetFor({ plan });
    const poor = new RenderCache({
      memoryBudgetBytes: derived.reservedBytes + 2 * derived.snapshotBytes,
    });
    expect(poor.execute([src], plan).stats.snapshots).toBe(2);
    const recomputed = poor.execute([src], changed);
    expect(recomputed.stats.reused).toBe(0);
    /* 关键一条：**复用少不等于结果错**。 */
    expect(bytesOf(recomputed.pixels)).toEqual(bytesOf(fresh));
  });

  it('reset 后不再复用', () => {
    const plan = buildPlan(fullDoc(60, 40), PREVIEW);
    const src = img(60, 40, 50, 60, 70);
    const cache = new RenderCache();
    cache.execute([src], plan);
    cache.reset();
    const r = cache.execute([src], plan);
    expect(r.stats.reused).toBe(0);
  });

  it('禁用缓存时永不复用', () => {
    const plan = buildPlan(fullDoc(60, 40), PREVIEW);
    const src = img(60, 40, 50, 60, 70);
    const cache = new RenderCache({ enabled: false });
    cache.execute([src], plan);
    const r = cache.execute([src], plan);
    expect(r.stats.reused).toBe(0);
  });
});

describe('estimateMemory —— P1-4：执行前预判峰值', () => {
  it('含卷积阶段时计入 scratch 缓冲', () => {
    const withSharpen = buildPlan(fullDoc(1000, 800), { kind: 'export', maxEdge: 0, withText: false });
    const est = estimateMemory(withSharpen);
    expect(est.heavyStages).toBeGreaterThan(0);
    expect(est.scratchBytes).toBeGreaterThan(0);
    expect(est.outputBytes).toBe(1000 * 800 * 4);
    expect(est.peakBytes).toBeGreaterThan(est.outputBytes);
    expect(describeMemory(est)).toContain('峰值');
  });

  it('纯几何计划没有 scratch 开销，也不超限', () => {
    const plan = buildPlan(docOf(500, 500), { kind: 'preview', maxEdge: 0, withText: false });
    const est = estimateMemory(plan);
    expect(est.heavyStages).toBe(0);
    expect(est.scratchBytes).toBe(0);
    expect(est.oversize).toBe(false);
    expect(est.peakBytes).toBe(est.outputBytes);
  });

  it('超尺寸计划被标记 oversize', () => {
    const plan = buildPlan(docOf(8000, 5000), { kind: 'export', maxEdge: 0, withText: false });
    expect(estimateMemory(plan).oversize).toBe(true);
  });

  it('快照数计入峰值', () => {
    const plan = buildPlan(docOf(500, 500), { kind: 'preview', maxEdge: 0, withText: false });
    const withSnaps = estimateMemory(plan, { cacheSnapshots: 3 });
    expect(withSnaps.snapshotBytes).toBe(withSnaps.outputBytes * 3);
    expect(withSnaps.peakBytes).toBeGreaterThan(estimateMemory(plan).peakBytes);
  });
});

describe('shell 契约 —— P1-6', () => {
  it('必须包含关闭后台节流的要求', () => {
    const req = SHELL_REQUIREMENTS.find((r) => r.key === 'webPreferences.backgroundThrottling');
    expect(req).toBeDefined();
    expect(req?.value).toBe(false);
    expect(req?.reason).toContain('P1-6');
  });

  it('安全基线三项齐备', () => {
    const keys = SHELL_REQUIREMENTS.map((r) => r.key);
    expect(keys).toContain('webPreferences.contextIsolation');
    expect(keys).toContain('webPreferences.nodeIntegration');
    expect(keys).toContain('webPreferences.sandbox');
  });

  it('可生成可读清单', () => {
    expect(describeShellRequirements()).toContain('backgroundThrottling');
  });
});
