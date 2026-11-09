/** 色彩基础类型。 */

/** 8 位 RGB，各分量取值 0..255（浮点中间量允许超出，由使用方钳制）。 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** HSV：h ∈ [0,360)，s ∈ [0,1]，v ∈ [0,1]。 */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/** 曲线通道。rgb 为主通道，r/g/b 为分量通道。 */
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

/** 曲线控制点 [x, y]，两轴取值均为 0..255。 */
export type CurvePoint = readonly [number, number];

/** 一条曲线的控制点集合（至少两个点，按 x 升序由使用者保证或由内核排序）。 */
export type CurvePoints = readonly CurvePoint[];

/** 曲线查找表：256 项，输入 0..255 映射到输出 0..255。 */
export type CurveLut = Uint8ClampedArray;

/** HSL 八色分调的色彩带。 */
export type HslBand =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'magenta';

/** 单个色彩带的定义。 */
export interface BandSpec {
  readonly key: HslBand;
  /** 该带中心色相（度）。 */
  readonly hue: number;
  /** 中文名，用于 UI 与口语解析。 */
  readonly label: string;
  /** 展示用色值。 */
  readonly css: string;
}

/** 单个色彩带的调整量。h 单位度，s/l 为百分比（-100..100）。 */
export interface BandAdjust {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/** 八个带的调整量集合。 */
export type BandAdjustMap = Readonly<Record<HslBand, BandAdjust>>;

/** 固定 64 桶的直方图。 */
export interface Histogram {
  readonly r: Uint32Array;
  readonly g: Uint32Array;
  readonly b: Uint32Array;
  readonly luma: Uint32Array;
  /** 参与统计的像素数。 */
  readonly count: number;
}
