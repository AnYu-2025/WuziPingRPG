import type { Rotate, Size } from '../geometry/types.js';
import { rotatedSize } from '../geometry/transform.js';

/**
 * EXIF 朝向码 1..8 —— 描述"存储态像素要怎样变换才是显示态"。
 *
 * 语义取自 EXIF 2.32 对 `Orientation` 的定义，并且与 Pillow
 * `ImageOps.exif_transpose` 的实现一致（1 正常 / 2 水平镜像 / … / 6 顺时针转 90°）。
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 朝向码对应的直角变换（与 `RasterSpec` 同一套词汇：rotate 顺时针、flip 作用于源坐标）。 */
export interface OrientationGeometry {
  readonly rotate: Rotate;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

/**
 * 朝向码 → (旋转, 镜像) 表。
 *
 * 推导约定：`RasterSpec` 的正向映射是 **先镜像、后旋转**
 * （`content = R(θ) · M(flip) · src`），而 EXIF 的 5/7 天然写成"先旋转、后镜像"。
 * 利用 `M(a,b) · R(90) = R(90) · M(b,a)`（把镜像挪到旋转之后要交换两个分量）改写：
 *   - 5 TRANSPOSE = rot90CW 后 flipH  = flipV 后 rot90CW
 *   - 7 TRANSVERSE = rot90CW 后 flipV = flipH 后 rot90CW
 * 本表**不参与像素变换**（变换走 `pixels/applyOrientation` 的索引置换），它的作用是：
 *   ① 让 `orientedSize` 经 `rotatedSize` 这唯一入口决定宽高互换；
 *   ② 让"置换 == 渲染器自己的几何"这条 parity 断言（X2）有对照物；
 *   ③ 信息条按同一套词汇复述朝向。
 */
export const ORIENTATION_GEOMETRY: Readonly<Record<ExifOrientation, OrientationGeometry>> = {
  1: { rotate: 0, flipH: false, flipV: false },
  2: { rotate: 0, flipH: true, flipV: false },
  3: { rotate: 180, flipH: false, flipV: false },
  4: { rotate: 0, flipH: false, flipV: true },
  5: { rotate: 90, flipH: false, flipV: true },
  6: { rotate: 90, flipH: false, flipV: false },
  7: { rotate: 90, flipH: true, flipV: false },
  8: { rotate: 270, flipH: false, flipV: false },
};

/** 八种朝向的人话名字（信息条与 CLI 报告共用一份，避免两端各写一遍）。 */
const ORIENTATION_LABEL: Readonly<Record<ExifOrientation, string>> = {
  1: '正常',
  2: '水平镜像',
  3: '倒置180°',
  4: '上下翻转',
  5: '顺时针90°+水平镜像',
  6: '顺时针90°',
  7: '逆时针90°+水平镜像',
  8: '逆时针90°',
};

/** 值是否是合法的朝向码（1..8 的整数）。 */
export function isExifOrientation(value: unknown): value is ExifOrientation {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 8
  );
}

/** 朝向码 → 渲染器词汇。null / undefined（无朝向信息）按"正常"处理。 */
export function orientationGeometry(
  orientation: ExifOrientation | null | undefined,
): OrientationGeometry {
  return ORIENTATION_GEOMETRY[orientation ?? 1];
}

/**
 * 显示态尺寸 = 存储态尺寸经朝向变换后的尺寸。
 *
 * 宽高互换**只**发生在 90/270 那几种码上，且只经 `rotatedSize` 这一处决定 ——
 * 本函数不提供第二种猜测宽高的路径（`rotatedSize` 的文件注释是这么要求的）。
 */
export function orientedSize(
  src: Size,
  orientation: ExifOrientation | null | undefined,
): Size {
  return rotatedSize(src, orientationGeometry(orientation).rotate);
}

/** `6 · 顺时针90°` —— 展示用短串。null 表示"无朝向信息"。 */
export function describeOrientation(orientation: ExifOrientation | null): string {
  if (orientation === null) return '无朝向';
  return `${orientation} · ${ORIENTATION_LABEL[orientation]}`;
}
