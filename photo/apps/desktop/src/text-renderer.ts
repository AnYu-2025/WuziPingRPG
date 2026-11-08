/**
 * 文字光栅化 —— 内核排好版，外壳负责把字画成像素。
 *
 * 分工是内核定的（见 core/src/ops/text.ts）：**位置 / 字号 / 对齐 / 描边 / 盖章框
 * 全部由 core 计算**，外壳只回答"用哪个字体光栅器"。于是"字画在哪、多大"
 * 永远跨端一致，随端而异的只有字形 —— 与商业软件「排版与光栅化分离」同构。
 *
 * 本实现走 Canvas：灌入现有像素 → 画字 → 取回像素，全程在**离屏画布**上完成。
 */
/* 刻意写成**类型导入**：本文件只用到 `ops` 的名字空间**类型**，运行期不需要 core。
 *
 * 这不是洁癖 —— 本文件会进**模块 Worker** 的运行时图，而 Worker 里没有
 * import map（import map 只作用于文档），`@photo/core` 这类裸说明符必然解析失败。
 * 类型导入在 emit 后即消失，于是同一份源码既能被 vitest（别名吃内核源码）加载，
 * 也能被 Worker 加载，不需要为 Worker 维护一份平行实现。 */
import type { ops } from '@photo/core';
import { SurfacePool, type Canvas2DContextLike, type DrawableSurface } from './surface.js';

type TextStyle = ops.TextStyle;
type TextRenderer = ops.TextRenderer;

/** 组装 CSS font 简写。weight 与 family 由 core 给定。 */
function toFont(style: TextStyle): string {
  return `${style.weight} ${style.fontSize}px ${style.fontFamily}`;
}

/** 每处绘制前统一设定的状态（font / 对齐 / 透明度）。 */
function applyStyle(ctx: Canvas2DContextLike, style: TextStyle): void {
  ctx.font = toFont(style);
  ctx.letterSpacing = `${style.letterSpacing}px`;
  ctx.textAlign = style.align;
  ctx.textBaseline = style.baseline;
  ctx.globalAlpha = style.alpha;
}

/**
 * 建一个基于画布的文字栅格化器。
 *
 * `measure` 与 `draw` 共用同一个 SurfacePool：测量时申请一块 8×8 的小画布
 * （只关心 measureText 的返回值），这样不会把 pool 里那块大画布顶掉 ——
 * 而 draw 是"一图一次"的，重建大画布的开销远大于收益。
 */
export function createCanvasTextRenderer<S extends DrawableSurface>(
  pool: SurfacePool<S>,
): TextRenderer {
  return {
    measure(text, style) {
      const ctx = pool.acquire(8, 8).ctx();
      ctx.save();
      applyStyle(ctx, style);
      const width = ctx.measureText(text).width;
      ctx.restore();
      /* 高度由字号推导：Canvas 不直接给行高，而内核只需要一个稳定的框高
       * （盖章底框与居中排版用）。1.2 是行业惯用的行高系数。 */
      return { width, height: style.fontSize * 1.2 };
    },

    draw(dst, item) {
      const surface: DrawableSurface = pool.acquire(dst.width, dst.height);
      const ctx = surface.ctx();

      /* 把当前像素灌进画布。真实适配层会用 `new ImageData(data, w, h)` 做
       * **零拷贝**包装（ImageData 直接引用同一段 Buffer），因此这一步不含像素拷贝；
       * 真正的拷贝发生在下面取回时的 readPixels —— 那一步躲不掉。 */
      surface.putPixels({ width: dst.width, height: dst.height, data: dst.data }, 0, 0);

      ctx.save();
      applyStyle(ctx, item.style);

      const { box, shadow, strokeColor, strokeWidth } = item.style;

      if (box !== undefined) {
        const m = ctx.measureText(item.text);
        const w = m.width + box.padX * 2;
        const h = item.style.fontSize + box.padY * 2;
        const x = item.x - w / 2;
        const y = item.y - h / 2;
        ctx.fillStyle = box.fill;
        ctx.beginPath();
        /* roundRect 是较新的 API。降级到直角矩形是可接受的：形状略有差异，
         * 但"底框存在且尺寸正确"这条不变量保住 —— 静默不画才是不可接受的。 */
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, box.radius);
        else ctx.rect(x, y, w, h);
        ctx.fill();
      }

      if (shadow !== undefined) {
        ctx.shadowColor = shadow.color;
        ctx.shadowBlur = shadow.blur;
        ctx.shadowOffsetY = shadow.offsetY;
      }

      if (strokeColor !== undefined && strokeWidth !== undefined && strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(item.text, item.x, item.y);
      }

      ctx.fillStyle = item.style.color;
      ctx.fillText(item.text, item.x, item.y);
      ctx.restore();

      const out = surface.readPixels(0, 0, dst.width, dst.height);
      dst.data.set(out.data);
    },
  };
}
