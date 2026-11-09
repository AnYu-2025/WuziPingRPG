import type { BandAdjustMap } from '../color/types.js';
import type { LevelsState } from '../color/levels.js';
import type { CurveSet, StickerState, WatermarkState } from '../document/types.js';
import type { Rect, Rotate, Size } from '../geometry/types.js';
import type { AdjustParams } from '../presets/params.js';

/**
 * 渲染计划（RenderPlan）—— 一条管线，多个分辨率。
 *
 * ── 要解决的问题（病根 1 / P1-1 / P1-3）────────────────────────────
 * legacy 把同一句"亮度对比饱和色温暗角"写了四遍（图片预览 / 图片导出 /
 * 视频预览 / 视频导出），四份实现必然漂移。
 *
 * 现在把"要做什么"（RenderPlan，纯数据）与"怎么做"（executePlan，唯一实现）
 * 彻底分开：
 *   - 预览、导出、缩略图、视频封面**共用同一个 buildPlan**，唯一差别是 maxEdge；
 *   - 因此"预览怎么画的，导出就是怎么画的"，只是尺寸不同 ⇒ P1-1 不可能再发生；
 *   - 超尺寸限制在计划层统一裁决并产出**可见的 PlanWarning**，
 *     而不是各处悄悄 return ⇒ P1-3 不可能再发生。
 */

export type RenderKind = 'preview' | 'export' | 'thumbnail' | 'video-frame';

export interface RenderTarget {
  readonly kind: RenderKind;
  /** 长边像素上限；<= 0 表示保持原尺寸。 */
  readonly maxEdge: number;
  /** 是否绘制水印 / 贴纸（缩略图、视频封面通常为 false）。 */
  readonly withText: boolean;
  /**
   * 忽略当前裁切框，渲染完整内容。
   *
   * 仅供"裁剪框编辑"预览使用：让用户在**未裁切的原图**上取景，
   * 避免在已裁图上再裁时坐标系错位（裁切框是归一化到内容区的，
   * 若底图已被裁过，同一组比例会指向错的地方）。
   * 导出**永远**不带此标志 —— 因此它不会污染"预览 == 导出"的语义。
   */
  readonly ignoreCrop?: boolean;
}

/** 几何光栅化：旋转 / 镜像 / 校正 / 缩放 / 边框，一次重采样完成。 */
export interface RasterStage {
  readonly kind: 'raster';
  readonly rotate: Rotate;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly straighten: number;
  /** 内容尺寸（不含边框）。 */
  readonly contentSize: Size;
  /**
   * 裁切框（在内容坐标系内，单位像素）。null 表示不裁切。
   * 落点：先渲染完整内容，再按此框裁出子区域、四周重新加回边框，
   * 因此"裁切只是改了输出取景"—— 预览与导出的裁切结果逐字节一致。
   */
  readonly crop: Rect | null;
  readonly border: number;
  readonly borderColor: string;
}

export interface ColorStage {
  readonly kind: 'color';
  readonly params: AdjustParams;
}

export interface WarmStage {
  readonly kind: 'warm';
  readonly warm: number;
}

/**
 * 色阶阶段（自动增强的落点）。
 *
 * 刻意排在**基础调色之前**：legacy 的自动增强直接把 LUT 烘在原图上，
 * 之后才是 CSS filter 串（亮度/对比/饱和…）。排在前面对齐这一语义，
 * 也让"自动增强 → 再手动调色"的叠加顺序与 legacy 一致。
 */
export interface LevelsStage {
  readonly kind: 'levels';
  readonly levels: LevelsState;
}

export interface SoftenStage {
  readonly kind: 'soften';
  readonly amount: number;
}

export interface GradeStage {
  readonly kind: 'grade';
  readonly curves: CurveSet;
  readonly bands: BandAdjustMap;
}

export interface VignetteStage {
  readonly kind: 'vignette';
  readonly amount: number;
}

export interface GrainStage {
  readonly kind: 'grain';
  readonly amount: number;
}

export interface EnhanceStage {
  readonly kind: 'enhance';
  readonly sharpen: number;
  readonly dehaze: number;
}

export interface WeatherStage {
  readonly kind: 'weather';
  readonly rain: number;
  readonly fog: number;
}

/** 文字阶段：水印与贴纸。绘制依赖注入的 TextRenderer 能力。 */
export interface TextStage {
  readonly kind: 'text';
  readonly watermark: WatermarkState;
  readonly sticker: StickerState;
}

/** 拼图中的一个贴片：把第 source 张图放进 (x,y,w,h) 的框内。 */
export interface CollageTile {
  readonly source: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 是否按 cover 铺满（裁剪多余）还是等比拉伸（可能留白）。 */
  readonly cover: boolean;
}

/**
 * 拼图 / 切图底图阶段。
 *
 * 与单图 raster 并列：两者都产出"底图"，其后的色彩 / 调色 / 叠加 /
 * 文字阶段**完全共用**。这正是"一条管线"的体现 —— 拼图不是另一套渲染，
 * 只是底图来源不同。
 */
export interface CollageStage {
  readonly kind: 'collage';
  readonly tiles: readonly CollageTile[];
  readonly contentSize: Size;
  readonly border: number;
  readonly borderColor: string;
  readonly background: 'color' | 'blur';
  /** 模糊底取自哪张源图。 */
  readonly backgroundSource: number;
}

export type RenderStage =
  | RasterStage
  | CollageStage
  | LevelsStage
  | ColorStage
  | WarmStage
  | SoftenStage
  | GradeStage
  | VignetteStage
  | GrainStage
  | EnhanceStage
  | WeatherStage
  | TextStage;

export type StageKind = RenderStage['kind'];

/** 计划层裁决出的显式告警（替代 legacy 的静默 return）。 */
export interface PlanWarning {
  readonly code: 'oversize';
  readonly message: string;
  /** 触发时的像素总数。 */
  readonly pixels: number;
  readonly limit: number;
}

export interface RenderPlan {
  readonly target: RenderTarget;
  readonly sourceSize: Size;
  /** 最终输出尺寸（含边框）。 */
  readonly outputSize: Size;
  /** 有序阶段序列。预览与导出在同一 maxEdge 下此序列完全一致。 */
  readonly stages: readonly RenderStage[];
  readonly warnings: readonly PlanWarning[];
}
