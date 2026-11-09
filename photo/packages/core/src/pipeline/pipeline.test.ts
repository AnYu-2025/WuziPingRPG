import { describe, expect, it } from 'vitest';

import { createDocument, defaultWatermark } from '../document/defaults.js';
import { pushOp } from '../document/history.js';
import type { CollageState, PhotoDocument, SourceRef } from '../document/types.js';
import { fill } from '../pixels/compose.js';
import { applyLevels } from '../pixels/color.js';
import { NEUTRAL } from '../presets/params.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import { needsTextRenderer, runPostStage } from '../ops/stages.js';
import { MISSING_TEXT_RENDERER, type TextDrawItem, type TextRenderer } from '../ops/text.js';
import { buildPlan, PREVIEW_TARGET } from './plan.js';
import { executePlan } from './execute.js';
import { RenderCache } from './cache.js';
import type { PlanWarning, RenderTarget } from './types.js';

function srcRef(id: string, w: number, h: number): SourceRef {
  return { id, name: id, width: w, height: h };
}

function docWithSources(list: readonly SourceRef[]): PhotoDocument {
  return pushOp(createDocument(), { k: 'setSources', value: list, current: 0 });
}

function makeImage(w: number, h: number, r = 120, g = 60, b = 30): PixelBuffer {
  const buf = createPixelBuffer(w, h);
  fill(buf, r, g, b, 255);
  // 放一个亮角，确保几何变换后有可区分的特征
  for (let y = 0; y < Math.max(1, Math.floor(h / 4)); y++) {
    for (let x = 0; x < Math.max(1, Math.floor(w / 4)); x++) {
      const i = (y * w + x) * 4;
      buf.data[i] = 255;
      buf.data[i + 1] = 255;
      buf.data[i + 2] = 255;
    }
  }
  return buf;
}

/** 确定性文字渲染器：在 (x,y) 画一个 3×3 白块，无字体依赖。 */
function fakeTextRenderer(): TextRenderer {
  return {
    measure() {
      return { width: 3, height: 3 };
    },
    draw(dst: PixelBuffer, item: TextDrawItem): void {
      const cx = Math.round(item.x);
      const cy = Math.round(item.y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
          const i = (y * dst.width + x) * 4;
          dst.data[i] = 255;
          dst.data[i + 1] = 255;
          dst.data[i + 2] = 255;
          dst.data[i + 3] = 255;
        }
      }
    },
  };
}

function richDoc(): PhotoDocument {
  let d = docWithSources([srcRef('a', 640, 360)]);
  d = pushOp(d, { k: 'applyPreset', key: 'rainy_dark', intensity: 1 });
  d = pushOp(d, { k: 'setGeometry', value: { rotate: 90, flipH: false, flipV: false, straighten: 0 } });
  d = pushOp(d, {
    k: 'setWatermark',
    value: { text: '© 琉璃', pos: 'br', color: '#ffffff', stroke: true, size: 3, alpha: 85 },
  });
  d = pushOp(d, {
    k: 'setSticker',
    value: { text: '雨天', style: 'white', pos: 'bottom', size: 6 },
  });
  return d;
}

describe('buildPlan —— 一条管线，多个分辨率', () => {
  it('中性文档只产生 raster 阶段', () => {
    const plan = buildPlan(docWithSources([srcRef('a', 100, 50)]), {
      kind: 'preview',
      maxEdge: 0,
      withText: true,
    });
    expect(plan.stages.map((s) => s.kind)).toEqual(['raster']);
  });

  it('预览与导出在同一 maxEdge 下阶段序列完全一致，且像素输出逐字节相同', () => {
    const doc = richDoc();
    const a: RenderTarget = { kind: 'preview', maxEdge: 800, withText: true };
    const b: RenderTarget = { kind: 'export', maxEdge: 800, withText: true };
    const planA = buildPlan(doc, a);
    const planB = buildPlan(doc, b);

    expect(planA.stages).toEqual(planB.stages);

    const img = makeImage(640, 360);
    const renderer = fakeTextRenderer();
    const outA = executePlan([img], planA, { textRenderer: renderer });
    const outB = executePlan([img], planB, { textRenderer: renderer });
    expect(Array.from(outA.data)).toEqual(Array.from(outB.data));
  });

  it('maxEdge 不同时，阶段序列的"种类"仍完全一致（证明只有尺寸不同）', () => {
    const doc = richDoc();
    const p1 = buildPlan(doc, { kind: 'preview', maxEdge: 400, withText: true });
    const p2 = buildPlan(doc, { kind: 'export', maxEdge: 1600, withText: true });
    expect(p1.stages.map((s) => s.kind)).toEqual(p2.stages.map((s) => s.kind));
  });

  it('两次执行同一计划结果完全一致（确定性）', () => {
    const doc = richDoc();
    const plan = buildPlan(doc, PREVIEW_TARGET);
    const img = makeImage(320, 180);
    const renderer = fakeTextRenderer();
    const a = executePlan([img], plan, { textRenderer: renderer });
    const b = executePlan([img], plan, { textRenderer: renderer });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe('色阶阶段（自动增强的落点）', () => {
  const levels = {
    r: { lo: 10, hi: 240, gain: 1.05 },
    g: { lo: 0, hi: 255, gain: 1 },
    b: { lo: 20, hi: 200, gain: 0.9 },
  } as const;

  it('恒等时不出现 levels 阶段（未自动增强就不白付一次查表）', () => {
    const d = docWithSources([srcRef('a', 80, 40)]);
    expect(
      buildPlan(d, { kind: 'preview', maxEdge: 0, withText: false }).stages.map((s) => s.kind),
    ).toEqual(['raster']);
  });

  it('非恒等时插入 levels，且排在基础调色之前（对齐 legacy 先烘 LUT 再走 filter）', () => {
    let d = docWithSources([srcRef('a', 80, 40)]);
    d = pushOp(d, { k: 'setLevels', value: levels });
    d = pushOp(d, { k: 'setAdjust', value: { ...NEUTRAL, brightness: 120 } });
    expect(
      buildPlan(d, { kind: 'preview', maxEdge: 0, withText: false }).stages.map((s) => s.kind),
    ).toEqual(['raster', 'levels', 'color']);
  });

  it('levels 阶段的产物 == 对前一阶段输出直接 applyLevels（同源，不引入第二条实现）', () => {
    const base = docWithSources([srcRef('a', 16, 8)]);
    const withLevels = pushOp(base, { k: 'setLevels', value: levels });
    const target: RenderTarget = { kind: 'preview', maxEdge: 0, withText: false };
    const img = makeImage(16, 8, 200, 30, 90);

    const withoutOut = executePlan([img], buildPlan(base, target));
    const withOut = executePlan([img], buildPlan(withLevels, target));
    /* 把"没有 levels 的产物"手工过一遍色阶，应与"有 levels 的产物"逐字节相同。 */
    applyLevels(withoutOut, levels);
    let diff = -1;
    for (let i = 0; i < withOut.data.length; i++) {
      if (withOut.data[i] !== withoutOut.data[i]) {
        diff = i;
        break;
      }
    }
    expect(diff).toBe(-1);
  });
});

describe('buildPlan —— 文字阶段投影', () => {
  it('withText 且文案非空才出现 text 阶段', () => {
    let d = docWithSources([srcRef('a', 80, 40)]);
    expect(
      buildPlan(d, { kind: 'preview', maxEdge: 0, withText: true }).stages.map((s) => s.kind),
    ).toEqual(['raster']);

    d = pushOp(d, {
      k: 'setWatermark',
      value: { text: 'hi', pos: 'br', color: '#fff', stroke: false, size: 3, alpha: 90 },
    });
    expect(
      buildPlan(d, { kind: 'thumbnail', maxEdge: 0, withText: false }).stages.map((s) => s.kind),
    ).toEqual(['raster']);
    expect(
      buildPlan(d, { kind: 'preview', maxEdge: 0, withText: true }).stages.map((s) => s.kind),
    ).toEqual(['raster', 'text']);
  });
});

describe('P1-1 端到端回归：旋转不改变内容宽高比', () => {
  it('1600×900 旋转 90° 后输出为 900×1600', () => {
    let d = docWithSources([srcRef('a', 1600, 900)]);
    d = pushOp(d, { k: 'setGeometry', value: { rotate: 90, flipH: false, flipV: false, straighten: 0 } });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 1600, withText: false });
    expect(plan.outputSize).toEqual({ w: 900, h: 1600 });
  });

  it('同图缩放后仍保持 0.5625 的宽高比', () => {
    let d = docWithSources([srcRef('a', 1600, 900)]);
    d = pushOp(d, { k: 'setGeometry', value: { rotate: 90, flipH: false, flipV: false, straighten: 0 } });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 400, withText: false });
    expect(plan.outputSize.w / plan.outputSize.h).toBeCloseTo(0.5625, 10);
    expect(plan.outputSize.h).toBe(400);
  });

  it('实际像素输出中，宽高比与原图一致（内容未被压扁）', () => {
    let d = docWithSources([srcRef('a', 1600, 900)]);
    d = pushOp(d, { k: 'setGeometry', value: { rotate: 90, flipH: false, flipV: false, straighten: 0 } });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 400, withText: false });
    const out = executePlan([makeImage(1600, 900)], plan);
    expect(out.width / out.height).toBeCloseTo(0.5625, 10);
  });
});

describe('P1-3 端到端回归：超尺寸产生显式告警而非静默', () => {
  it('4000 万像素的原尺寸导出产生 oversize 警告', () => {
    const d = docWithSources([srcRef('a', 8000, 5000)]);
    const plan = buildPlan(d, { kind: 'export', maxEdge: 0, withText: false });
    expect(plan.outputSize).toEqual({ w: 8000, h: 5000 });
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0].code).toBe('oversize');
    expect(plan.warnings[0].pixels).toBe(40_000_000);
  });

  it('降到预览尺寸后不再告警', () => {
    const d = docWithSources([srcRef('a', 8000, 5000)]);
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 1400, withText: false });
    expect(plan.warnings).toEqual([]);
  });

  it('执行时通过 onWarning 回调把告警交给上层（不再悄悄 return）', () => {
    const d = docWithSources([srcRef('a', 8000, 5000)]);
    const plan = buildPlan(d, { kind: 'export', maxEdge: 0, withText: false });
    const seen: PlanWarning[] = [];
    // 告警在任何阶段执行**之前**发出，因此这里不传源像素 —— 否则单测要
    // 真的跑完 4000 万像素的光栅化（数秒）。本用例验证的是"告警被交给上层"
    // 这一契约，与像素结果无关。
    executePlan([], plan, { onWarning: (w) => seen.push(w) });
    expect(seen.length).toBe(1);
    expect(seen[0].code).toBe('oversize');
  });
});

describe('拼图与空文档', () => {
  it('横拼模式产生 collage 阶段，贴片数等于源图数', () => {
    let d = docWithSources([srcRef('a', 200, 100), srcRef('b', 100, 200), srcRef('c', 300, 300)]);
    const collage: CollageState = {
      mode: 'h',
      gap: 8,
      bg: 'color',
      cutCols: 3,
      cutRows: 3,
      borderWidth: 0,
      borderColor: '#ffffff',
    };
    d = pushOp(d, { k: 'setCollage', value: collage });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 0, withText: false });
    const first = plan.stages[0];
    expect(first.kind).toBe('collage');
    if (first.kind === 'collage') {
      expect(first.tiles.length).toBe(3);
    }
  });

  it('拼图可以实际执行并得到计划尺寸', () => {
    let d = docWithSources([srcRef('a', 200, 100), srcRef('b', 100, 200)]);
    const collage: CollageState = {
      mode: 'h',
      gap: 8,
      bg: 'color',
      cutCols: 3,
      cutRows: 3,
      borderWidth: 0,
      borderColor: '#ffffff',
    };
    d = pushOp(d, { k: 'setCollage', value: collage });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 0, withText: false });
    const out = executePlan([makeImage(200, 100, 200, 0, 0), makeImage(100, 200, 0, 0, 200)], plan);
    expect(out.width).toBe(plan.outputSize.w);
    expect(out.height).toBe(plan.outputSize.h);
  });

  it('空文档给出 1×1 的最小计划且可安全执行', () => {
    const plan = buildPlan(createDocument(), { kind: 'preview', maxEdge: 0, withText: true });
    const out = executePlan([], plan);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });

  it('borderWidth 计入输出尺寸', () => {
    let d = docWithSources([srcRef('a', 100, 100)]);
    const collage: CollageState = {
      mode: 'single',
      gap: 8,
      bg: 'color',
      cutCols: 3,
      cutRows: 3,
      borderWidth: 20,
      borderColor: '#000000',
    };
    d = pushOp(d, { k: 'setCollage', value: collage });
    const plan = buildPlan(d, { kind: 'preview', maxEdge: 0, withText: false });
    expect(plan.outputSize).toEqual({ w: 140, h: 140 });
  });
});

/* ─────────────────── G5（P6-e 序 3 · C4）：缺文字能力必须失败 ───────────────────
 * 以前这里挂着一个"什么都不画"的兜底渲染器，于是无头端（CLI / Node）的水印是
 * **静默消失**的：报告一切正常，产物少个水印。下面五条把新契约钉住 ——
 * 包括"什么算需要能力"这条判据本身。 */

describe('G5 文字能力：缺 TextRenderer 时必须失败，不许静默掉水印', () => {
  const target: RenderTarget = { kind: 'preview', maxEdge: 0, withText: true };

  function wmDoc(text: string): PhotoDocument {
    return pushOp(docWithSources([srcRef('a', 40, 20)]), {
      k: 'setWatermark',
      value: { ...defaultWatermark(), text },
    });
  }

  it('非空文案 + 未注入能力 → 抛错，不产出像素', () => {
    const plan = buildPlan(wmDoc('© 琉璃'), target);
    expect(plan.stages.some(needsTextRenderer)).toBe(true);
    expect(() => executePlan([makeImage(40, 20)], plan)).toThrow(MISSING_TEXT_RENDERER);
  });

  it('文案全空白 → 计划里本就没有 text 阶段（同一判据在两处生效）', () => {
    const plan = buildPlan(wmDoc('   '), target);
    expect(plan.stages.map((s) => s.kind)).not.toContain('text');
    expect(plan.stages.some(needsTextRenderer)).toBe(false);
    expect(executePlan([makeImage(40, 20)], plan).width).toBe(40);
  });

  it('withText=false 的计划本就不带文字阶段 → 无能力也照常出图', () => {
    const plan = buildPlan(wmDoc('© 琉璃'), { ...target, withText: false });
    expect(plan.stages.some(needsTextRenderer)).toBe(false);
    expect(executePlan([makeImage(40, 20)], plan).width).toBe(40);
  });

  it('RenderCache 看整条计划：文字阶段落在复用前缀里也拦得住', () => {
    const plan = buildPlan(wmDoc('© 琉璃'), target);
    const img = makeImage(40, 20);
    const cache = new RenderCache();
    cache.execute([img], plan, { textRenderer: fakeTextRenderer() });
    /* 第二次摘掉能力：像素本可以从缓存快照直接复用、根本不跑文字阶段，
     * 但"这一次调用有没有画字能力"与"这一次要不要算"是两件事 —— 只看后者
     * 会让缓存命中变成能力检测的漏洞。 */
    expect(() => cache.execute([img], plan)).toThrow(MISSING_TEXT_RENDERER);
  });

  it('直接调 runPostStage 同样拦得住（兜底不只在计划层）', () => {
    const stage = buildPlan(wmDoc('© 琉璃'), target).stages.find((s) => s.kind === 'text');
    if (stage === undefined || stage.kind !== 'text') throw new Error('计划里没有 text 阶段');
    const buf = makeImage(8, 8);
    expect(() => runPostStage(buf, stage)).toThrow(MISSING_TEXT_RENDERER);
    const blank = {
      ...stage,
      watermark: { ...stage.watermark, text: '' },
      sticker: { ...stage.sticker, text: '' },
    };
    expect(runPostStage(buf, blank)).toBe(buf);
  });
});
