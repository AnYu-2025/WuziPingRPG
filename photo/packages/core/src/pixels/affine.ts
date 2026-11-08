/**
 * 二维仿射变换。
 *
 * 约定（与 Canvas2D 一致，便于与外壳层对照）：
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * 即矩阵形式：
 *
 *     [x']   [a c e] [x]
 *     [y'] = [b d f]·[y]
 *     [1 ]   [0 0 1] [1]
 *
 * 旋转、镜像、缩放、平移全部可表达为仿射矩阵，因此**几何阶段只需一次
 * 逆映射重采样**即可同时完成这三种变换。这从结构上保证了
 * "旋转 90°"与"旋转 91°"走的是同一条代码路径 —— legacy 那种
 * `if (odd) { min/max }` 的特例分支在架构上无处安放（对应病根 1、P1-1）。
 */

export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** 单位矩阵。 */
export function identity(): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function affine(a: number, b: number, c: number, d: number, e: number, f: number): Affine {
  return { a, b, c, d, e, f };
}

/** 平移矩阵。 */
export function translation(tx: number, ty: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** 缩放矩阵。 */
export function scaling(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** 旋转矩阵（弧度，顺时针为正，与 Canvas2D 的 rotate 一致）。 */
export function rotation(rad: number): Affine {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** 镜像矩阵。flipH 沿竖直轴翻转 x，flipV 沿水平轴翻转 y。 */
export function mirror(flipH: boolean, flipV: boolean): Affine {
  return { a: flipH ? -1 : 1, b: 0, c: 0, d: flipV ? -1 : 1, e: 0, f: 0 };
}

/**
 * 复合变换：返回 `m ∘ n`，即**先施加 n，再施加 m**。
 * （与线性代数中列向量右乘的直觉一致：m·n·p = m(n(p))。）
 */
export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** 依次施加多个变换：multiplyAll(m1, m2, m3) = m1·m2·m3（最先施加最右侧）。 */
export function multiplyAll(...mats: readonly Affine[]): Affine {
  let acc = identity();
  for (const m of mats) acc = multiply(acc, m);
  return acc;
}

/** 求逆。行列式为 0（退化）时回退为单位矩阵。 */
export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return identity();
  const inv = 1 / det;
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    e: (m.c * m.f - m.d * m.e) * inv,
    f: (m.b * m.e - m.a * m.f) * inv,
  };
}

/** 对点施加变换，结果写入 out = [x', y']。 */
export function transformPoint(m: Affine, x: number, y: number, out: Float64Array): Float64Array {
  out[0] = m.a * x + m.c * y + m.e;
  out[1] = m.b * x + m.d * y + m.f;
  return out;
}
