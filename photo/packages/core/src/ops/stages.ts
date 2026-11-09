import type { PixelBuffer } from '../types.js';
import { applyColorParams, applyGrade, applyLevels, applyWarm } from '../pixels/color.js';
import { enhance, grain, soften, vignette, weather } from '../pixels/effects.js';
import { rasterize, type RasterSpec } from '../pixels/raster.js';
import type { RasterStage, RenderStage } from '../pipeline/types.js';
import { layoutSticker, layoutWatermark, MISSING_TEXT_RENDERER, type TextRenderer } from './text.js';

/**
 * ops —— 每个渲染阶段一个纯函数执行器。
 *
 * 约定：后期阶段的执行器**原地**修改传入缓冲并返回它（避免大图二次拷贝），
 * 语义是"把这一阶段的视觉变换叠加到当前像素上"。
 * 阶段顺序由 pipeline 决定，这里只回答"这一步要做什么"。
 */

/** 底图之后的阶段（作用于单块缓冲）。 */
export type PostStage = Exclude<RenderStage, { kind: 'raster' } | { kind: 'collage' }>;

/**
 * 这一阶段是否需要文字能力。
 *
 * 判据与下面的排版函数**同一条**（`text.trim()` 非空才有绘制项），因此执行前的
 * 预检和实际执行不会各说各话 —— 预检放行、跑到一半才抛错，是最难复现的失败形态。
 */
export function needsTextRenderer(stage: RenderStage): boolean {
  return (
    stage.kind === 'text' &&
    (stage.watermark.text.trim() !== '' || stage.sticker.text.trim() !== '')
  );
}

/** 几何光栅化（会改变尺寸，返回新缓冲）。 */
export function runRaster(src: PixelBuffer, stage: RasterStage): PixelBuffer {
  const spec: RasterSpec = {
    rotate: stage.rotate,
    flipH: stage.flipH,
    flipV: stage.flipV,
    straighten: stage.straighten,
    contentSize: stage.contentSize,
    crop: stage.crop,
    border: stage.border,
    borderColor: stage.borderColor,
  };
  return rasterize(src, spec);
}

/**
 * 执行一个后期阶段。
 *
 * `textRenderer` **刻意没有兜底实现**：这一阶段要不要画字由排版决定，
 * 需要画却没能力 → 抛错（文案见 `MISSING_TEXT_RENDERER`）。
 * 过去这里默认挂一个"什么都不画"的渲染器，于是无头端的水印是**静默消失**的：
 * 报告一切正常，产物少个水印 —— 那是最难查的一类错。
 */
export function runPostStage(
  buf: PixelBuffer,
  stage: PostStage,
  textRenderer?: TextRenderer,
  scratch?: Float32Array,
): PixelBuffer {
  switch (stage.kind) {
    case 'levels':
      applyLevels(buf, stage.levels);
      return buf;
    case 'color':
      applyColorParams(buf, stage.params);
      return buf;
    case 'warm':
      applyWarm(buf, stage.warm);
      return buf;
    case 'soften':
      soften(buf, stage.amount, scratch);
      return buf;
    case 'grade':
      applyGrade(buf, stage.curves, stage.bands);
      return buf;
    case 'vignette':
      vignette(buf, stage.amount);
      return buf;
    case 'grain':
      grain(buf, stage.amount);
      return buf;
    case 'enhance':
      enhance(buf, stage.sharpen, stage.dehaze, scratch);
      return buf;
    case 'weather':
      weather(buf, stage.rain, stage.fog);
      return buf;
    case 'text': {
      const wm = layoutWatermark(buf.width, buf.height, stage.watermark);
      const st = layoutSticker(buf.width, buf.height, stage.sticker);
      if (wm === null && st === null) return buf;
      if (textRenderer === undefined) throw new Error(MISSING_TEXT_RENDERER);
      if (wm !== null) textRenderer.draw(buf, wm);
      if (st !== null) textRenderer.draw(buf, st);
      return buf;
    }
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}
