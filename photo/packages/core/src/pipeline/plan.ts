import { hasAnyBandAdjust } from '../color/hsl.js';
import { isIdentityLevels } from '../color/levels.js';
import { deriveEdit } from '../document/reducer.js';
import type { EditState, PhotoDocument, SourceRef } from '../document/types.js';
import { fitToLongEdge, rotatedSize } from '../geometry/transform.js';
import type { Rect, Size } from '../geometry/types.js';
import { MAX_HEAVY_PIXELS } from '../pixels/effects.js';
import { isCurveSetIdentity } from '../pixels/color.js';
import { rasterize } from '../pixels/raster.js';
import type { PixelBuffer } from '../types.js';
import type { AdjustParams } from '../presets/params.js';
import { NEUTRAL } from '../presets/params.js';
import type {
  CollageStage,
  CollageTile,
  PlanWarning,
  RenderPlan,
  RenderStage,
  RenderTarget,
  RasterStage,
} from './types.js';

/** 是否需要基础调色阶段（亮度/对比/饱和/曝光四者任一偏离中性）。 */
function hasBasicColor(p: AdjustParams): boolean {
  return (
    p.brightness !== NEUTRAL.brightness ||
    p.contrast !== NEUTRAL.contrast ||
    p.saturate !== NEUTRAL.saturate ||
    p.exposure !== NEUTRAL.exposure
  );
}

/**
 * 由编辑状态投影出"底图之后"的阶段序列（不含 raster / collage）。
 *
 * 顺序即语义：色彩 → 色温 → 磨皮 → 曲线/分调 → 暗角 → 颗粒 → 锐化去雾
 *             → 天气 → 文字。
 * 这一顺序是**唯一**的：legacy 的预览把色温放在调色之前、导出放在之后，
 * 于是同一张图两处不同（病根 1）。现在只有这一份定义。
 */
export function buildPostStages(e: EditState, target: RenderTarget): RenderStage[] {
  const p = e.params;
  const stages: RenderStage[] = [];
  /* 色阶排在最前：legacy 的自动增强直接烘在原图上，之后才是 CSS filter 串。
   * 排在调色之前既对齐该语义，也让"自动增强 → 再手动调色"的叠加顺序可预期。 */
  if (!isIdentityLevels(e.levels)) stages.push({ kind: 'levels', levels: e.levels });
  if (hasBasicColor(p)) stages.push({ kind: 'color', params: p });
  if (p.warm !== 0) stages.push({ kind: 'warm', warm: p.warm });
  if (p.soften > 0) stages.push({ kind: 'soften', amount: p.soften });
  if (!isCurveSetIdentity(e.curves) || hasAnyBandAdjust(e.bands)) {
    stages.push({ kind: 'grade', curves: e.curves, bands: e.bands });
  }
  if (p.vignette > 0) stages.push({ kind: 'vignette', amount: p.vignette });
  if (p.grain > 0) stages.push({ kind: 'grain', amount: p.grain });
  if (p.sharpen > 0 || p.dehaze > 0) {
    stages.push({ kind: 'enhance', sharpen: p.sharpen, dehaze: p.dehaze });
  }
  if (p.rain > 0 || p.fog > 0) stages.push({ kind: 'weather', rain: p.rain, fog: p.fog });
  if (target.withText && (e.watermark.text.trim() !== '' || e.sticker.text.trim() !== '')) {
    stages.push({ kind: 'text', watermark: e.watermark, sticker: e.sticker });
  }
  return stages;
}

function oversizeWarning(size: Size): PlanWarning | null {
  const pixels = size.w * size.h;
  if (pixels <= MAX_HEAVY_PIXELS) return null;
  return {
    code: 'oversize',
    pixels,
    limit: MAX_HEAVY_PIXELS,
    message:
      `输出尺寸 ${size.w}×${size.h}（${pixels} 像素）超过重负载上限 ` +
      `${MAX_HEAVY_PIXELS}，磨皮与锐化/去雾阶段将被跳过。请降低导出长边或关闭相关参数。`,
  };
}

/**
 * 把裁切框映射到内容像素并钳到范围内。
 *
 * ── 输入是**归一化坐标**（`EditState.crop` 的契约：各分量 0..1，相对内容区）──
 * 这一点是 WYSIWYG 的关键：内容尺寸随 `maxEdge` 缩放（预览 1400 / 导出原尺寸），
 * 若 crop 存像素值，同一份文档在预览与导出会裁到**不同区域**。
 * 存归一化值则两处按同一比例映射，裁切区域随分辨率等比缩放 ⇒ 同源不变量成立。
 *
 * 兼容**反向框选**（w/h 为负）：先归一化到 [min,max] 再映射，
 * 因此 `{x:0.6,w:-0.3}` 与 `{x:0.3,w:0.3}` 等价。
 *
 * 返回 `null` = 不裁切（传入就是 null，或框覆盖了整个内容区）。
 * plan 与 rasterize 用同一套钳制规则，故计划声明的 outputSize 与执行结果必然一致。
 */
function clampCrop(rect: Rect | null, content: Size): Rect | null {
  if (rect === null) return null;
  const n01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  const ax = n01(rect.x);
  const ay = n01(rect.y);
  const bx = n01(rect.x + rect.w);
  const by = n01(rect.y + rect.h);
  let x = Math.round(Math.min(ax, bx) * content.w);
  let y = Math.round(Math.min(ay, by) * content.h);
  let x2 = Math.round(Math.max(ax, bx) * content.w);
  let y2 = Math.round(Math.max(ay, by) * content.h);
  x = Math.max(0, Math.min(x, content.w - 1));
  y = Math.max(0, Math.min(y, content.h - 1));
  x2 = Math.max(x + 1, Math.min(x2, content.w));
  y2 = Math.max(y + 1, Math.min(y2, content.h));
  const w = x2 - x;
  const h = y2 - y;
  if (w >= content.w && h >= content.h) return null;
  return { x, y, w, h };
}

function singlePlan(e: EditState, target: RenderTarget): RenderPlan {
  const cur = e.sources.length === 0 ? 0 : Math.min(Math.max(0, e.current), e.sources.length - 1);
  const src: SourceRef | undefined = e.sources[cur];
  const srcSize: Size = src === undefined ? { w: 1, h: 1 } : { w: src.width, h: src.height };

  // 切图模式：忽略旋转/镜像/校正（与 legacy 一致），且无边框。
  const isCut = e.collage.mode === 'cut';
  const rotate = isCut ? 0 : e.geometry.rotate;
  const flipH = isCut ? false : e.geometry.flipH;
  const flipV = isCut ? false : e.geometry.flipV;
  const straighten = isCut ? 0 : e.geometry.straighten;
  const border = e.collage.mode === 'single' ? Math.max(0, e.collage.borderWidth) : 0;

  const base = rotatedSize(srcSize, rotate);
  const fitted = fitToLongEdge(base, target.maxEdge);
  const contentSize: Size = { w: Math.max(1, Math.round(fitted.w)), h: Math.max(1, Math.round(fitted.h)) };

  /* 裁切只作用于单图（非切图）模式；裁剪框编辑预览（ignoreCrop）时也一律不裁。
   * 框是归一化坐标，由 clampCrop 映射到内容像素并钳到范围内；
   * outputSize 由"裁切后的有效内容"决定，与 rasterize 内部的裁切结果同源。 */
  const crop = isCut || target.ignoreCrop === true ? null : clampCrop(e.crop, contentSize);
  const effW = crop === null ? contentSize.w : crop.w;
  const effH = crop === null ? contentSize.h : crop.h;
  const outputSize: Size = { w: effW + border * 2, h: effH + border * 2 };

  const raster: RasterStage = {
    kind: 'raster',
    rotate,
    flipH,
    flipV,
    straighten,
    contentSize,
    crop,
    border,
    borderColor: e.collage.borderColor,
  };

  /* 切图模式下水印 / 贴纸**不进底图** —— 与 legacy 一致（"切图：色调+质感全吃，
   * 水印贴纸不进分片，旋转翻转在切图里忽略"）。这条与上面忽略几何同源：
   * 底图要干净，分片才有意义；否则每片都带着半截水印。 */
  const postTarget = isCut ? { ...target, withText: false } : target;

  const warning = oversizeWarning(contentSize);
  return {
    target,
    sourceSize: srcSize,
    outputSize,
    stages: [raster, ...buildPostStages(e, postTarget)],
    warnings: warning === null ? [] : [warning],
  };
}

/** 计算拼图布局（在"基准尺寸"坐标系内），返回基准内容尺寸与贴片。 */
function collageLayout(e: EditState): { base: Size; tiles: CollageTile[]; cols: number } {
  const mode = e.collage.mode;
  const gap = Math.max(0, e.collage.gap);
  const list = e.sources.slice(0, mode === 'grid' ? 9 : 9);
  let baseW = 0;
  let baseH = 0;
  let cols = 1;
  const tiles: CollageTile[] = [];

  if (mode === 'h') {
    baseH = 800;
    let x = 0;
    list.forEach((s, i) => {
      const w = (s.width / s.height) * baseH;
      tiles.push({ source: i, x, y: 0, w, h: baseH, cover: false });
      x += w + gap;
    });
    baseW = Math.max(1, x - gap);
  } else if (mode === 'v') {
    baseW = 800;
    let y = 0;
    list.forEach((s, i) => {
      const h = (s.height / s.width) * baseW;
      tiles.push({ source: i, x: 0, y, w: baseW, h, cover: false });
      y += h + gap;
    });
    baseH = Math.max(1, y - gap);
  } else {
    const n = Math.max(1, list.length);
    cols = n <= 2 ? n : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    baseW = 1000;
    baseH = Math.round((1000 * rows) / cols);
    const cw = (baseW - gap * (cols - 1)) / cols;
    const ch = (baseH - gap * (rows - 1)) / rows;
    list.forEach((_, i) => {
      tiles.push({
        source: i,
        x: (i % cols) * (cw + gap),
        y: Math.floor(i / cols) * (ch + gap),
        w: cw,
        h: ch,
        cover: true,
      });
    });
    baseW = Math.round(cw * cols + gap * (cols - 1));
    baseH = Math.round(ch * rows + gap * (rows - 1));
  }

  return { base: { w: baseW, h: baseH }, tiles, cols };
}

function collagePlan(e: EditState, target: RenderTarget): RenderPlan {
  const { base, tiles } = collageLayout(e);
  const fitted = fitToLongEdge(base, target.maxEdge);
  const k = fitted.w / base.w;
  const contentSize: Size = { w: Math.max(1, Math.round(fitted.w)), h: Math.max(1, Math.round(fitted.h)) };
  const border = Math.max(0, e.collage.borderWidth);

  const scaledTiles: CollageTile[] = tiles.map((t) => ({
    source: t.source,
    x: Math.round(t.x * k),
    y: Math.round(t.y * k),
    w: Math.round(t.w * k),
    h: Math.round(t.h * k),
    cover: t.cover,
  }));

  const stage: CollageStage = {
    kind: 'collage',
    tiles: scaledTiles,
    contentSize,
    border,
    borderColor: e.collage.borderColor,
    background: e.collage.bg,
    backgroundSource: 0,
  };

  const outputSize: Size = { w: contentSize.w + border * 2, h: contentSize.h + border * 2 };
  const src0 = e.sources[0];
  const warning = oversizeWarning(contentSize);
  return {
    target,
    sourceSize: src0 === undefined ? contentSize : { w: src0.width, h: src0.height },
    outputSize,
    stages: [stage, ...buildPostStages(e, target)],
    warnings: warning === null ? [] : [warning],
  };
}

/**
 * 构建渲染计划。
 *
 * 预览、导出、缩略图、视频封面**都调用本函数**，唯一差别是 target.maxEdge
 * 与 withText。因此"预览怎么画的，导出就是怎么画的"是架构保证，而非纪律要求。
 */
export function buildPlan(doc: PhotoDocument, target: RenderTarget): RenderPlan {
  const e = deriveEdit(doc);
  if (e.sources.length === 0) {
    const contentSize: Size = { w: 1, h: 1 };
    return {
      target,
      sourceSize: contentSize,
      outputSize: contentSize,
      stages: [
        {
          kind: 'raster',
          rotate: 0,
          flipH: false,
          flipV: false,
          straighten: 0,
          contentSize,
          crop: null,
          border: 0,
          borderColor: '#000000',
        },
      ],
      warnings: [],
    };
  }
  const mode = e.collage.mode;
  if (mode === 'h' || mode === 'v' || mode === 'grid') return collagePlan(e, target);
  return singlePlan(e, target);
}

/** 常用目标预设，减少调用方手写 maxEdge 的出错面。 */
export const PREVIEW_TARGET: RenderTarget = { kind: 'preview', maxEdge: 1400, withText: true };
export const THUMBNAIL_TARGET: RenderTarget = { kind: 'thumbnail', maxEdge: 256, withText: false };

/**
 * 源图缩略图 —— **只做重采样**，不含任何编辑阶段。
 *
 * 缩略图条展示的是"导入了哪几张图"，与当前编辑参数无关：刻意不走
 * `buildPlan`，否则每拖一次滑杆都要重画全部缩略图，而且缩略图会带上
 * 当前调色/水印（把"图片列表"变成"效果缩略图"，语义错位）。
 *
 * 仍由**内核**做重采样，而不是让壳 `drawImage` 缩放 —— 缩放是像素运算，
 * 归内核（P6-c §3.4 红线）。
 */
export function makeThumbnail(source: PixelBuffer, maxEdge: number): PixelBuffer {
  const fitted = fitToLongEdge({ w: source.width, h: source.height }, maxEdge);
  const contentSize: Size = {
    w: Math.max(1, Math.round(fitted.w)),
    h: Math.max(1, Math.round(fitted.h)),
  };
  return rasterize(source, {
    rotate: 0,
    flipH: false,
    flipV: false,
    straighten: 0,
    contentSize,
    crop: null,
    border: 0,
    borderColor: '#000000',
  });
}
