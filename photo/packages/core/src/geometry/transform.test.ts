import { describe, expect, it } from 'vitest';
import { normalizeRotate, size, type Rotate, type Size } from './types.js';
import {
  clampRect,
  drawSizeFor,
  fitContain,
  fitCover,
  fitToLongEdge,
  isQuarterTurn,
  mapDisplayRectToImage,
  normalizeRect,
  rotatedSize,
} from './transform.js';

/**
 * 按 canvas 的真实 rotate 语义，计算「局部绘制矩形」在屏幕上占据的包围盒。
 * θ ∈ {0,180} → (dw, dh)；θ ∈ {90,270} → (dh, dw)。
 * 这个辅助函数独立于被测实现，用于交叉验证。
 */
function screenBox(local: Size, rotate: Rotate): Size {
  return isQuarterTurn(rotate) ? { w: local.h, h: local.w } : { w: local.w, h: local.h };
}

const ALL_ROTATES: readonly Rotate[] = [0, 90, 180, 270];

describe('rotatedSize', () => {
  it('直角旋转交换宽高', () => {
    expect(rotatedSize(size(1600, 900), 90)).toEqual({ w: 900, h: 1600 });
    expect(rotatedSize(size(1600, 900), 270)).toEqual({ w: 900, h: 1600 });
  });

  it('非直角旋转保持不变', () => {
    expect(rotatedSize(size(1600, 900), 0)).toEqual({ w: 1600, h: 900 });
    expect(rotatedSize(size(1600, 900), 180)).toEqual({ w: 1600, h: 900 });
  });

  it('旋转两次直角等于旋转 180°', () => {
    const src = size(1600, 900);
    expect(rotatedSize(rotatedSize(src, 90), 90)).toEqual({ w: 1600, h: 900 });
  });
});

describe('drawSizeFor —— P1-1 回归防线', () => {
  it('显式对照：legacy 的 min/max 启发式在「横图 90°」时必定出错', () => {
    const src = size(1600, 900);
    const preview = fitToLongEdge(src, 1400); // 1400 × 788
    const canvasSize = rotatedSize(preview, 90); // 788 × 1400

    // legacy render(): drawOne(img, border, border, h, w) → dw = 预览高, dh = 预览宽
    const dw = preview.h;
    const dh = preview.w;
    const legacyLocal = { w: Math.min(dw, dh), h: Math.max(dw, dh) }; // 788 × 1400

    // 1) legacy 绘制出的包围盒 1400×788 与画布 788×1400 不符 → 横向溢出 + 上下留黑
    expect(screenBox(legacyLocal, 90)).toEqual({ w: 1400, h: 788 });
    expect(screenBox(legacyLocal, 90).w).not.toBe(canvasSize.w);

    // 2) legacy 的局部宽高比 0.563 远偏离原图比例 1.777 → 画面被压扁
    expect(legacyLocal.w / legacyLocal.h).not.toBeCloseTo(preview.w / preview.h, 2);

    // 3) 新实现：包围盒与画布严格一致，且比例等于原图比例
    const fixed = drawSizeFor(canvasSize, 90);
    expect(screenBox(fixed, 90)).toEqual({ w: canvasSize.w, h: canvasSize.h });
    expect(fixed.w / fixed.h).toBeCloseTo(preview.w / preview.h, 5);
  });

  it('不变量：任意尺寸 × 任意角度，绘制尺寸都恰好铺满画布且保持宽高比', () => {
    const rawSizes: ReadonlyArray<readonly [number, number]> = [
      [1600, 900],
      [900, 1600],
      [1024, 1024],
      [3840, 2160],
      [2160, 3840],
      [300, 2000],
      [2000, 300],
      [4000, 3000],
      [1, 5000],
    ];

    for (const [w, h] of rawSizes) {
      for (const rotate of ALL_ROTATES) {
        const label = `${w}x${h} @ ${rotate}°`;
        const preview = fitToLongEdge(size(w, h), 1400);
        const canvasSize = rotatedSize(preview, rotate);
        const draw = drawSizeFor(canvasSize, rotate);
        const box = screenBox(draw, rotate);

        expect(box.w, `${label} 包围盒宽应等于画布宽`).toBe(canvasSize.w);
        expect(box.h, `${label} 包围盒高应等于画布高`).toBe(canvasSize.h);
        expect(draw.w / draw.h, `${label} 不得改变宽高比`).toBeCloseTo(
          preview.w / preview.h,
          5,
        );
      }
    }
  });

  it('铺满画布时，绘制尺寸恒等于预览尺寸（与角度无关）', () => {
    const preview = fitToLongEdge(size(1600, 900), 1400);
    for (const rotate of ALL_ROTATES) {
      const canvasSize = rotatedSize(preview, rotate);
      expect(drawSizeFor(canvasSize, rotate)).toEqual({ w: preview.w, h: preview.h });
    }
  });
});

describe('fitToLongEdge', () => {
  it('长边超过上限时按比例缩小', () => {
    expect(fitToLongEdge(size(1600, 900), 1400)).toEqual({ w: 1400, h: 788 });
    expect(fitToLongEdge(size(900, 1600), 1400)).toEqual({ w: 788, h: 1400 });
  });

  it('长边未超过上限时保持原尺寸', () => {
    expect(fitToLongEdge(size(800, 600), 1400)).toEqual({ w: 800, h: 600 });
  });

  it('maxEdge <= 0 表示不缩放', () => {
    expect(fitToLongEdge(size(6000, 4000), 0)).toEqual({ w: 6000, h: 4000 });
    expect(fitToLongEdge(size(6000, 4000), -1)).toEqual({ w: 6000, h: 4000 });
  });
});

describe('fitContain / fitCover', () => {
  it('contain 完整放入且不裁切', () => {
    const r = fitContain(size(1600, 900), size(800, 800));
    expect(r.size).toEqual({ w: 800, h: 450 });
    expect(r.scale).toBeCloseTo(0.5, 5);
  });

  it('cover 铺满容器并给出居中偏移', () => {
    const r = fitCover(size(1600, 900), size(800, 800));
    expect(r.size).toEqual({ w: 1422, h: 800 });
    expect(r.offset.x).toBe(Math.round((800 - r.size.w) / 2));
    expect(r.offset.y).toBe(0);
  });
});

describe('矩形工具', () => {
  it('clampRect 把越界矩形收回边界内', () => {
    // 矩形原范围 x ∈ [-10, 90]、y ∈ [-10, 90]，钳到 [0,50]² 后剩满格
    expect(clampRect({ x: -10, y: -10, w: 100, h: 100 }, size(50, 50))).toEqual({
      x: 0,
      y: 0,
      w: 50,
      h: 50,
    });
  });

  it('clampRect 只裁掉越界的那一部分', () => {
    // x ∈ [30, 130] → 钳到 [0,50] 后 x=30, w=20；y ∈ [0,20] 完全在内
    expect(clampRect({ x: 30, y: 0, w: 100, h: 20 }, size(50, 50))).toEqual({
      x: 30,
      y: 0,
      w: 20,
      h: 20,
    });
  });

  it('normalizeRect 支持反向框选', () => {
    expect(normalizeRect({ x: 100, y: 100, w: -40, h: -60 })).toEqual({
      x: 60,
      y: 40,
      w: 40,
      h: 60,
    });
  });

  it('完全越界的矩形归零', () => {
    expect(clampRect({ x: 500, y: 500, w: 10, h: 10 }, size(100, 100))).toEqual({
      x: 100,
      y: 100,
      w: 0,
      h: 0,
    });
  });
});

describe('mapDisplayRectToImage', () => {
  it('无 CSS 缩放时，把屏幕框选换算为原图像素坐标', () => {
    // 原图 4000×3000，预览内容区 1000×750（预览已按 0.25 缩小）
    const imageSize = size(4000, 3000);
    const contentSize = size(1000, 750);

    // 框选内容区左上一半：500×375 内容像素 → 原图 2000×1500
    const r = mapDisplayRectToImage(
      { x: 0, y: 0, w: 500, h: 375 },
      1,
      contentSize,
      imageSize,
    );

    expect(r).toEqual({ x: 0, y: 0, w: 2000, h: 1500 });
  });

  it('画布被 CSS 缩放时，显示像素先还原为内容像素', () => {
    const imageSize = size(4000, 3000);
    const contentSize = size(1000, 750);

    // 画布被缩到 0.5，用户看到的是 500×375，此时框选全部显示区 = 全部原图
    const r = mapDisplayRectToImage(
      { x: 0, y: 0, w: 500, h: 375 },
      0.5,
      contentSize,
      imageSize,
    );

    expect(r).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });

  it('越界框选被钳制到图像范围内', () => {
    const r = mapDisplayRectToImage(
      { x: -100, y: -100, w: 10000, h: 10000 },
      1,
      size(1000, 1000),
      size(1000, 1000),
    );
    expect(r).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });

  it('displayScale 为 0 时不产生 NaN / Infinity', () => {
    const r = mapDisplayRectToImage(
      { x: 0, y: 0, w: 10, h: 10 },
      0,
      size(100, 100),
      size(100, 100),
    );
    expect(Number.isFinite(r.w)).toBe(true);
    expect(Number.isFinite(r.h)).toBe(true);
  });
});

describe('normalizeRotate', () => {
  it('把任意数值归一到合法角度', () => {
    expect(normalizeRotate(90)).toBe(90);
    expect(normalizeRotate(450)).toBe(90);
    expect(normalizeRotate(-90)).toBe(270);
    expect(normalizeRotate(360)).toBe(0);
    expect(normalizeRotate(37)).toBe(0);
  });
});
