/**
 * 文字栅格化的测试。
 *
 * 断言的是"**用什么样式、画在哪个坐标、有没有降级画漏**"。
 * 字形本身是否正确由 Electron 冒烟里的真实 Canvas 覆盖 —— 见 canvas-fakes.ts
 * 顶部的诚实边界说明。这里能守住的是最容易出错、也最不容易被肉眼发现的部分：
 * 对齐/基线/透明度没生效，或老实现缺 roundRect 时干脆什么都不画。
 */
import { describe, expect, it } from 'vitest';
import type { ops } from '@photo/core';
import {
  createRecordingSurfaceFactory,
  patternBuffer,
  type FakeSurface,
  type FillPathCall,
  type FillTextCall,
} from './canvas-fakes.js';
import { SurfacePool } from './surface.js';
import { createCanvasTextRenderer } from './text-renderer.js';

type TextStyle = ops.TextStyle;

function style(fontSize: number, patch: Partial<TextStyle> = {}): TextStyle {
  return {
    fontSize,
    fontFamily: 'sans-serif',
    weight: '400',
    letterSpacing: 0,
    align: 'left',
    baseline: 'alphabetic',
    color: '#000000',
    alpha: 1,
    ...patch,
  };
}

function setup(options: { roundRect?: boolean } = {}): {
  renderer: ops.TextRenderer;
  created: FakeSurface[];
} {
  const { factory, created } = createRecordingSurfaceFactory(options);
  return { renderer: createCanvasTextRenderer(new SurfacePool(factory)), created };
}

function surfaceOf(created: FakeSurface[], w: number, h: number): FakeSurface {
  const found = created.find((s) => s.width === w && s.height === h);
  if (found === undefined) throw new Error(`没有造出 ${w}×${h} 的画布。`);
  return found;
}

describe('measure', () => {
  it('宽度为正，且随字号线性增长', () => {
    const { renderer } = setup();
    const small = renderer.measure('琉璃', style(20));
    const big = renderer.measure('琉璃', style(40));

    expect(small.width).toBeGreaterThan(0);
    expect(big.width).toBeCloseTo(small.width * 2, 5);
  });

  it('高度由字号推导（内核只需要一个稳定的框高）', () => {
    const { renderer } = setup();
    expect(renderer.measure('字', style(20)).height).toBeCloseTo(24, 5);
  });

  it('字距计入测量宽度', () => {
    const { renderer } = setup();
    const tight = renderer.measure('琉璃琉璃', style(20, { letterSpacing: 0 }));
    const loose = renderer.measure('琉璃琉璃', style(20, { letterSpacing: 4 }));
    /* 4 个字 → 3 个间隙 × 4px = 12px。 */
    expect(loose.width - tight.width).toBeCloseTo(12, 5);
  });
});

describe('draw', () => {
  it('把完整样式交给画布：字体、对齐、基线、透明度、描边', () => {
    const { renderer, created } = setup();
    const dst = patternBuffer(200, 100);

    renderer.draw(dst, {
      text: '琉璃',
      x: 100,
      y: 50,
      style: style(20, {
        align: 'center',
        baseline: 'middle',
        color: '#ff0000',
        alpha: 0.5,
        strokeColor: '#000000',
        strokeWidth: 2,
      }),
    });

    const surface = surfaceOf(created, 200, 100);
    const call = surface.drawLog.find((c): c is FillTextCall => c.kind === 'fillText');
    expect(call).toBeDefined();
    if (call === undefined) return;

    expect(call.text).toBe('琉璃');
    expect(call.fontSize).toBe(20);
    expect(call.textAlign).toBe('center');
    expect(call.textBaseline).toBe('middle');
    expect(call.fillStyle).toBe('#ff0000');
    expect(call.globalAlpha).toBeCloseTo(0.5);
    expect(call.strokeStyle).toBe('#000000');
    expect(call.strokeWidth).toBe(2);

    /* 居中 + 基线居中：落点包围盒中心应当就在 (x, y)。 */
    expect(call.box.x + call.box.w / 2).toBeCloseTo(100, 5);
    expect(call.box.y + call.box.h / 2).toBeCloseTo(50, 5);

    /* 描边必须在填充之前 —— 反了就变成"描边盖住字"。 */
    const strokeIndex = surface.drawLog.findIndex((c) => c.kind === 'strokeText');
    const fillIndex = surface.drawLog.findIndex((c) => c.kind === 'fillText');
    expect(strokeIndex).toBeGreaterThanOrEqual(0);
    expect(strokeIndex).toBeLessThan(fillIndex);
  });

  it('真的改动了目标像素（不是"配置了但没画"）', () => {
    const { renderer } = setup();
    const dst = patternBuffer(200, 100);
    const before = new Uint8ClampedArray(dst.data);

    renderer.draw(dst, { text: '琉璃', x: 20, y: 60, style: style(24, { color: '#ffffff' }) });

    expect(dst.data).not.toEqual(before);
  });

  it('绘制结束后画布状态被还原（save/restore 成对，不泄漏到下一次绘制）', () => {
    const { renderer, created } = setup();
    renderer.draw(patternBuffer(120, 80), {
      text: 'x',
      x: 10,
      y: 40,
      style: style(20, { color: '#ffffff', alpha: 0.25 }),
    });

    const surface = surfaceOf(created, 120, 80);
    expect(surface.ctx().globalAlpha).toBe(1);
  });
});

describe('盖章底框', () => {
  it('先画底框再画字，且底框尺寸含内边距', () => {
    const { renderer, created } = setup();
    const dst = patternBuffer(200, 200);

    renderer.draw(dst, {
      text: '样',
      x: 100,
      y: 100,
      style: style(20, {
        align: 'center',
        baseline: 'middle',
        color: '#ffffff',
        box: { fill: '#b8322a', padX: 9, padY: 14, radius: 4 },
      }),
    });

    const surface = surfaceOf(created, 200, 200);
    const fill = surface.drawLog.find((c): c is FillPathCall => c.kind === 'fill');
    expect(fill).toBeDefined();
    if (fill === undefined) return;

    expect(fill.fillStyle).toBe('#b8322a');
    expect(fill.rounded).toBe(true);
    expect(fill.radius).toBeCloseTo(4, 5);
    /* measure('样') = 1 × 20 × 0.5 = 10；宽 = 10 + 9×2 = 28，高 = 20 + 14×2 = 48。 */
    expect(fill.w).toBeCloseTo(28, 5);
    expect(fill.h).toBeCloseTo(48, 5);
    expect(fill.x + fill.w / 2).toBeCloseTo(100, 5);
    expect(fill.y + fill.h / 2).toBeCloseTo(100, 5);

    expect(surface.drawLog.indexOf(fill)).toBeLessThan(
      surface.drawLog.findIndex((c) => c.kind === 'fillText'),
    );
  });

  it('老实现没有 roundRect 时降级为直角矩形 —— 但**必须仍画出底框**', () => {
    const { renderer, created } = setup({ roundRect: false });
    const dst = patternBuffer(200, 200);

    renderer.draw(dst, {
      text: '样',
      x: 100,
      y: 100,
      style: style(20, {
        align: 'center',
        baseline: 'middle',
        color: '#ffffff',
        box: { fill: '#b8322a', padX: 9, padY: 14, radius: 4 },
      }),
    });

    const surface = surfaceOf(created, 200, 200);
    const fill = surface.drawLog.find((c): c is FillPathCall => c.kind === 'fill');
    expect(fill).toBeDefined();
    if (fill === undefined) return;

    expect(fill.rounded).toBe(false);
    /* 关键：形状退化了，但"底框存在且尺寸正确"这条不变量保住。
     * 静默不画才是不可接受的 —— 所以这里断言尺寸而不是只断言"没崩"。 */
    expect(fill.w).toBeCloseTo(28, 5);
    expect(fill.h).toBeCloseTo(48, 5);
  });
});
