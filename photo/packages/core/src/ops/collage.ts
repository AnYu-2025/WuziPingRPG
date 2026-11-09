import type { CollageStage } from '../pipeline/types.js';
import { blurBuffer } from '../pixels/blur.js';
import { blit, fill, parseHexColor } from '../pixels/compose.js';
import { darkenSaturate, drawRect } from '../pixels/raster.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';

/**
 * 拼图 / 切图底图合成。
 *
 * 只负责"把若干张图按计划摆到一张底图上"；色彩、调色、暗角、颗粒、天气、
 * 水印贴纸这些**整幅阶段由 pipeline 在其后统一施加**（见 ops/stages.runStage）。
 * 因此拼图与单图共享同一套后期管线 —— 不再像 legacy 那样拼图走另一条
 * finishCanvas 分支。
 */
export function runCollage(sources: readonly PixelBuffer[], stage: CollageStage): PixelBuffer {
  const cw = Math.max(1, Math.round(stage.contentSize.w));
  const ch = Math.max(1, Math.round(stage.contentSize.h));
  const b = Math.max(0, Math.round(stage.border));

  const out = createPixelBuffer(cw + b * 2, ch + b * 2);
  const [br, bg, bb] = parseHexColor(stage.borderColor);
  fill(out, br, bg, bb, 255);

  const content = createPixelBuffer(cw, ch);
  if (stage.background === 'blur' && sources[stage.backgroundSource] !== undefined) {
    const base = createPixelBuffer(cw, ch);
    drawRect(base, sources[stage.backgroundSource], 0, 0, cw, ch, 'cover');
    darkenSaturate(base, 0.62, 1.4);
    blit(content, blurBuffer(base, Math.max(6, Math.round(Math.max(cw, ch) * 0.02))), 0, 0, 1);
  } else {
    fill(content, br, bg, bb, 255);
  }

  for (const tile of stage.tiles) {
    const src = sources[tile.source];
    if (src === undefined) continue;
    drawRect(content, src, tile.x, tile.y, tile.w, tile.h, tile.cover ? 'cover' : 'stretch');
  }

  blit(out, content, b, b, 1);
  return out;
}
