import { describe, expect, it } from 'vitest';

import { createDocument } from '../document/defaults.js';
import { pushOp } from '../document/history.js';
import type { PhotoDocument } from '../document/types.js';
import { fill } from '../pixels/compose.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { executePlan } from './execute.js';
import {
  DEFAULT_EXPORT_MEMORY_BUDGET_BYTES,
  EXPORT_MEMORY_SAFETY,
  MIN_DOWNSCALE_LONG_EDGE,
  cacheBudgetFor,
  estimateMemory,
  gateExport,
} from './memory.js';
import { buildPlan } from './plan.js';
import type { RenderTarget } from './types.js';

/* ───────────────────────────── 脚手架 ───────────────────────────── */

function docOf(w: number, h: number): PhotoDocument {
  return pushOp(createDocument(), {
    k: 'setSources',
    value: [{ id: 'a', name: 'a', width: w, height: h }],
    current: 0,
  });
}

/** "几乎什么都开了"的文档：含 enhance（锐化/去雾）⇒ 计入卷积 scratch。 */
function fullDoc(w: number, h: number): PhotoDocument {
  return pushOp(docOf(w, h), {
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
}

function img(w: number, h: number): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, 120, 140, 160, 255);
  return buf;
}

/** 早退式逐字节比较（大缓冲别用 toEqual，vitest 会构建 diff）。 */
function firstDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

const EXPORT: RenderTarget = { kind: 'export', maxEdge: 0, withText: false };
/** 50MP 中画幅（8688×5784 ≈ 5025 万像素）。 */
const MF_W = 8688;
const MF_H = 5784;

/* ─────────────────────── 四分支 · 单元全覆盖 ─────────────────────── */

describe('gateExport —— 四分支（P6-d 序 1 · 验收 J）', () => {
  it('run：预计峰值 ≤ 预算直接执行（24MP 在 2 GB 预算下走这条）', () => {
    const plan = buildPlan(fullDoc(6000, 4000), EXPORT);
    const gate = gateExport({ plan });

    expect(gate.decision).toBe('run');
    expect(gate.budgetBytes).toBe(DEFAULT_EXPORT_MEMORY_BUDGET_BYTES);
    expect(gate.projectedBytes).toBeLessThanOrEqual(gate.budgetBytes);
    // 24MP 实测 1.28 GB，2 GB 预算下必须放行
    expect(gate.projectedBytes / 1024 / 1024).toBeLessThan(1500);
    expect(gate.message).toContain('可直接导出');
  });

  it('边界：projected === budget 判为 run，少 1 字节即不再 run', () => {
    const plan = buildPlan(fullDoc(2000, 1500), EXPORT);
    const projected = estimateMemory(plan, { cacheSnapshots: 0 }).peakBytes * EXPORT_MEMORY_SAFETY;

    expect(gateExport({ plan, budgetBytes: projected }).decision).toBe('run');
    expect(gateExport({ plan, budgetBytes: projected - 1 }).decision).not.toBe('run');
  });

  it('downscale：超预算且降采样可行 → 默认降采样到"预算内最大长边"', () => {
    const doc = fullDoc(MF_W, MF_H);
    const plan = buildPlan(doc, EXPORT);
    const planFor = (e: number): ReturnType<typeof buildPlan> =>
      buildPlan(doc, { ...EXPORT, maxEdge: e });

    const gate = gateExport({ plan, planFor });
    expect(gate.decision).toBe('downscale');
    if (gate.decision !== 'downscale') throw new Error('unreachable');

    // 长边确实降了，且没降到"废图"级别
    expect(gate.maxEdge).toBeLessThan(MF_W);
    expect(gate.maxEdge).toBeGreaterThanOrEqual(MIN_DOWNSCALE_LONG_EDGE);
    expect(gate.outputSize.w).toBeLessThan(MF_W);
    // 降采样后必须落回预算内
    expect(gate.projectedBytesAfter).toBeLessThanOrEqual(gate.budgetBytes);
    // 报告的尺寸 / 预测必须与"真去重建的那个计划"逐字段一致（防止门里算术漂移）
    expect(gate.outputSize).toEqual(planFor(gate.maxEdge).outputSize);
    expect(gate.projectedBytesAfter).toBe(
      estimateMemory(planFor(gate.maxEdge), { cacheSnapshots: 0 }).peakBytes * EXPORT_MEMORY_SAFETY,
    );
    expect(gate.message).toContain(String(gate.maxEdge));
  });

  it('confirm：超预算但用户显式要原尺寸 → 二次确认', () => {
    const plan = buildPlan(fullDoc(MF_W, MF_H), EXPORT);
    const gate = gateExport({ plan, explicitFullSize: true });

    expect(gate.decision).toBe('confirm');
    expect(gate.projectedBytes).toBeGreaterThan(gate.budgetBytes);
    expect(gate.projectedBytes).toBeLessThanOrEqual(gate.hardLimitBytes);
    expect(gate.message).toContain('需你确认');
  });

  it('reject：超硬天花板 → 明确拒绝并说明原因', () => {
    const plan = buildPlan(fullDoc(MF_W, MF_H), EXPORT);
    const gate = gateExport({ plan, explicitFullSize: true, hardLimitBytes: 1024 * 1024 * 1024 });

    expect(gate.decision).toBe('reject');
    if (gate.decision !== 'reject') throw new Error('unreachable');
    expect(gate.reason).toBe('over-hard-limit');
    expect(gate.projectedBytes).toBeGreaterThan(gate.hardLimitBytes);
    expect(gate.message).toContain('硬上限');
  });
});

describe('gateExport —— 降级路径与契约（P6-d 序 1）', () => {
  it('缺 planFor 时不给降采样方案 → 超预算一律 confirm（绝不静默）', () => {
    const plan = buildPlan(fullDoc(MF_W, MF_H), EXPORT);
    const gate = gateExport({ plan }); // 无 planFor
    expect(gate.decision).toBe('confirm');
  });

  it('降采样下限都撑不住、且超硬上限 → reject（而非给一张废图）', () => {
    const doc = fullDoc(MF_W, MF_H);
    const plan = buildPlan(doc, EXPORT);
    const gate = gateExport({
      plan,
      planFor: (e) => buildPlan(doc, { ...EXPORT, maxEdge: e }),
      budgetBytes: 1024 * 1024, // 1 MB：连 640 长边都塞不下
      hardLimitBytes: 1024 * 1024,
    });
    expect(gate.decision).toBe('reject');
    expect(gate.message).toContain(String(MIN_DOWNSCALE_LONG_EDGE));
  });

  it('内容长边 ≤ 下限时不存在降采样空间 → confirm', () => {
    const doc = fullDoc(600, 400); // 长边 600 < 640
    const plan = buildPlan(doc, EXPORT);
    const gate = gateExport({
      plan,
      planFor: (e) => buildPlan(doc, { ...EXPORT, maxEdge: e }),
      budgetBytes: 1, // 逼出"超预算"分支
    });
    expect(gate.decision).toBe('confirm');
  });

  it('降采样产物 === 同 maxEdge 直渲产物（守住"预览==导出同源"）', () => {
    // 小图 + 小预算：便宜地触发 downscale，再逐字节校验身份
    const doc = fullDoc(1000, 800);
    const plan = buildPlan(doc, EXPORT);
    const planFor = (e: number): ReturnType<typeof buildPlan> =>
      buildPlan(doc, { ...EXPORT, maxEdge: e });

    const gate = gateExport({ plan, planFor, budgetBytes: 20 * 1024 * 1024 });
    expect(gate.decision).toBe('downscale');
    if (gate.decision !== 'downscale') throw new Error('unreachable');

    const src = img(1000, 800);
    // 经由门给的 maxEdge 重建 → 渲染
    const viaGate = executePlan([src], planFor(gate.maxEdge));
    // 直接用一个独立的同 maxEdge 目标渲染
    const direct = executePlan([src], buildPlan(doc, { kind: 'export', maxEdge: gate.maxEdge, withText: false }));

    expect(viaGate.width).toBe(direct.width);
    expect(viaGate.height).toBe(direct.height);
    expect(firstDiff(viaGate.data, direct.data)).toBe(-1);
    // 且确实比原尺寸小
    expect(viaGate.width).toBeLessThan(1000);
  });

  it('纯几何小图 + 默认预算 → run（不误伤常规导出）', () => {
    const plan = buildPlan(docOf(1600, 1200), EXPORT);
    expect(gateExport({ plan }).decision).toBe('run');
  });
});

/* ═════════════════ p1 快照预算自适应（P6-e 序 4 · M1/M2）═════════════════
 *
 * 这一组断言要钉的不是"某个数对不对"，而是**两本账必须是同一本**：
 * 导出准入说"这张图峰值 768 MB"，缓存就得按同一个 768 MB 去算"还剩多少"。
 * 老写法是外壳里三个写死的 128/256 MB —— 它们既不知道图有多大，
 * 也不知道准入已经占掉了多少。 */

const MB = 1024 * 1024;

describe('cacheBudgetFor —— 快照预算与准入同源（M2）', () => {
  /** 24 MP "几乎全开"：一份输出 96 MB，含 enhance ⇒ 还有卷积 scratch。 */
  const big = buildPlan(fullDoc(6000, 4000), EXPORT);

  it('一张快照 == 一份输出缓冲，且张数不超过阶段数', () => {
    const budget = cacheBudgetFor({ plan: big });
    expect(budget.snapshotBytes).toBe(estimateMemory(big).outputBytes);
    expect(budget.snapshots).toBeLessThanOrEqual(big.stages.length);
    expect(budget.maxBytes).toBe(budget.snapshots * budget.snapshotBytes);
  });

  it('硬不变式：预留的执行峰值 + 快照预算 不越过内存预算', () => {
    for (const total of [4096, 2048, 1024, 512, 128, 32, 8]) {
      const budgetBytes = total * MB;
      const b = cacheBudgetFor({ plan: big, memoryBudgetBytes: budgetBytes });
      /* 装得下时才谈"不越线"；装不下时缓存必须**主动让位到 0 张**，
       * 而不是"好歹留一张" —— 那一张就是把一张本来允许的导出顶成 OOM 的东西。 */
      if (b.reservedBytes <= budgetBytes) {
        expect(b.reservedBytes + b.maxBytes).toBeLessThanOrEqual(budgetBytes);
      } else {
        expect(b.snapshots).toBe(0);
      }
    }
  });

  it('与 gateExport 用同一份预估：门放行 ⇒ 门预测 + 快照 ≤ 预算', () => {
    const budgetBytes = DEFAULT_EXPORT_MEMORY_BUDGET_BYTES;
    const gate = gateExport({ plan: big, budgetBytes });
    const b = cacheBudgetFor({ plan: big, memoryBudgetBytes: budgetBytes });
    expect(gate.decision).toBe('run');
    expect(gate.projectedBytes).toBe(b.reservedBytes);
    expect(gate.projectedBytes + b.maxBytes).toBeLessThanOrEqual(budgetBytes);
  });

  it('预算吃不下执行峰值时：0 张快照 + 说清为什么（绝不静默）', () => {
    const b = cacheBudgetFor({ plan: big, memoryBudgetBytes: 256 * MB });
    expect(b.snapshots).toBe(0);
    expect(b.maxBytes).toBe(0);
    expect(b.reason).toContain('一张快照都不留');
    expect(b.reason).toContain('MB');
  });

  it('为什么自适应要命：同一张 24 MP，固定 128 MB 只留得下 1 张', () => {
    const b = cacheBudgetFor({ plan: big });
    const per = b.snapshotBytes;
    /* 老的默认预算是外壳里写死的 128 MB —— 对着它算，只装得下一张快照，
     * 而"下一张要续算的位置"多半不是它 ⇒ 复用归零（M1 的现场）。 */
    expect(Math.floor((128 * MB) / per)).toBe(1);
    expect(b.snapshots).toBeGreaterThan(1);
    expect(b.snapshots).toBe(big.stages.length);
  });

  it('小图不必穷举：预算充足时阶段全留得住', () => {
    const small = buildPlan(fullDoc(320, 240), { kind: 'preview', maxEdge: 320, withText: false });
    const b = cacheBudgetFor({ plan: small, memoryBudgetBytes: 64 * MB });
    expect(b.snapshots).toBe(small.stages.length);
    expect(b.reason).toContain('全部留得住');
  });
});
