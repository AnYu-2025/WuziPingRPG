import type { Rect, Rotate, Size } from '../geometry/types.js';
import { rotatedSize } from '../geometry/transform.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';
import {
  invert,
  mirror,
  multiplyAll,
  rotation,
  scaling,
  translation,
  type Affine,
} from './affine.js';
import { blurBuffer } from './blur.js';
import { blit, fill, parseHexColor } from './compose.js';
import { resizeBuffer } from './resize.js';
import { clamp255, sampleBilinear } from './sampling.js';

/** 光栅化规格：把一块源像素按几何参数投到目标内容区。 */
export interface RasterSpec {
  readonly rotate: Rotate;
  readonly flipH: boolean;
  readonly flipV: boolean;
  /** 水平校正角度（度）。非零时露出的边由模糊底填充。 */
  readonly straighten: number;
  /** 内容区尺寸（不含边框）。 */
  readonly contentSize: Size;
  /**
   * 裁切框（内容坐标系，像素）。null 表示不裁切。
   * 落点：整图渲染完之后，按此框裁出子区域、四周重新加回边框。
   */
  readonly crop: Rect | null;
  /** 边框宽度（像素），四周等宽。 */
  readonly border: number;
  readonly borderColor: string;
}

/**
 * 用逆仿射变换把 src 重采样到 dstW×dstH，未覆盖处保持透明。
 *
 * 这是整个渲染器唯一的"几何"实现：**所有角度、所有镜像组合、
 * 所有缩放比例都走这一条路径**，不存在 0/90/180/270 的特例分支。
 * legacy 里 `if (odd) { min/max }` 那种特判在架构上无处可放 ——
 * 这正是 P1-1 不可能再复现的结构性原因。
 */
export function renderAffine(
  src: PixelBuffer,
  dstW: number,
  dstH: number,
  dstToSrc: Affine,
): PixelBuffer {
  const out = createPixelBuffer(dstW, dstH);
  const od = out.data;
  const sd = src.data;
  const scratch = new Float64Array(4);
  const pt = new Float64Array(2);

  for (let y = 0; y < dstH; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < dstW; x++) {
      const cx = x + 0.5;
      pt[0] = dstToSrc.a * cx + dstToSrc.c * cy + dstToSrc.e;
      pt[1] = dstToSrc.b * cx + dstToSrc.d * cy + dstToSrc.f;
      const inside = sampleBilinear(sd, src.width, src.height, pt[0], pt[1], scratch);
      if (!inside) continue;
      const o = (y * dstW + x) * 4;
      od[o] = scratch[0];
      od[o + 1] = scratch[1];
      od[o + 2] = scratch[2];
      od[o + 3] = scratch[3];
    }
  }
  return out;
}

/** 构建"目标内容区 → 源图"的逆映射（含旋转、镜像、等比缩放）。 */
function inverseForContent(
  contentW: number,
  contentH: number,
  srcSize: Size,
  angleRad: number,
  flipH: boolean,
  flipV: boolean,
  k: number,
): Affine {
  return multiplyAll(
    translation(srcSize.w / 2, srcSize.h / 2),
    mirror(flipH, flipV),
    scaling(1 / k, 1 / k),
    rotation(-angleRad),
    translation(-contentW / 2, -contentH / 2),
  );
}

/** 亮度缩放 + 饱和缩放（用于校正露边时的模糊底，等价 `brightness(62%) saturate(130%)`）。 */
export function darkenSaturate(buf: PixelBuffer, brightnessK: number, satK: number): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * brightnessK;
    let g = d[i + 1] * brightnessK;
    let b = d[i + 2] * brightnessK;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * satK;
    g = lum + (g - lum) * satK;
    b = lum + (b - lum) * satK;
    d[i] = clamp255(r);
    d[i + 1] = clamp255(g);
    d[i + 2] = clamp255(b);
  }
}

/**
 * 几何光栅化：旋转 + 镜像 + 水平校正 + 等比缩放 + 边框 + 露边模糊底，
 * 在**一次重采样**中全部完成。
 */
export function rasterize(src: PixelBuffer, spec: RasterSpec): PixelBuffer {
  const contentW = Math.max(1, Math.round(spec.contentSize.w));
  const contentH = Math.max(1, Math.round(spec.contentSize.h));
  const border = Math.max(0, Math.round(spec.border));
  const outW = contentW + border * 2;
  const outH = contentH + border * 2;
  const out = createPixelBuffer(outW, outH);

  const [br, bg, bb] = parseHexColor(spec.borderColor);
  fill(out, br, bg, bb, 255);

  // 恒等几何快路径：既无旋转/镜像/校正，内容尺寸又与源图相同 ——
  // 此时重采样是纯粹的浪费（8000×5000 上要跑 4000 万次双线性采样，秒级）。
  // 直接拷贝。这既是性能优化，也让"原尺寸导出"不引入任何额外的插值损失。
  if (
    spec.rotate === 0 &&
    spec.straighten === 0 &&
    !spec.flipH &&
    !spec.flipV &&
    contentW === src.width &&
    contentH === src.height
  ) {
    blit(out, src, border, border, 1);
    return applyCrop(out, spec, contentW, contentH, border);
  }

  const srcSize: Size = { w: src.width, h: src.height };
  const angle = ((spec.rotate + spec.straighten) * Math.PI) / 180;

  // 水平校正露出的边：先用放大模糊的"封面"铺底，再叠正片。
  if (spec.straighten !== 0) {
    const margin = Math.max(2, Math.round(Math.max(contentW, contentH) * 0.04));
    const bigW = contentW + margin * 2;
    const bigH = contentH + margin * 2;
    const coverK = Math.max(bigW / srcSize.w, bigH / srcSize.h);
    const coverInv = inverseForContent(bigW, bigH, srcSize, 0, false, false, coverK);
    const cover = renderAffine(src, bigW, bigH, coverInv);
    darkenSaturate(cover, 0.62, 1.3);
    const blurred = blurBuffer(cover, Math.max(4, Math.round(Math.max(contentW, contentH) * 0.02)));

    // 裁出中心 contentW×contentH 并贴到内容区。
    const crop = createPixelBuffer(contentW, contentH);
    for (let y = 0; y < contentH; y++) {
      for (let x = 0; x < contentW; x++) {
        const si = ((y + margin) * bigW + (x + margin)) * 4;
        const di = (y * contentW + x) * 4;
        crop.data[di] = blurred.data[si];
        crop.data[di + 1] = blurred.data[si + 1];
        crop.data[di + 2] = blurred.data[si + 2];
        crop.data[di + 3] = blurred.data[si + 3];
      }
    }
    blit(out, crop, border, border, 1);
  }

  // 正片：等比缩放到恰好铺满内容区（取 cover 比例，避免舍入缝隙）。
  const baseSize = rotatedSize(srcSize, spec.rotate);
  const k = Math.max(contentW / baseSize.w, contentH / baseSize.h);
  const mainInv = inverseForContent(
    contentW,
    contentH,
    srcSize,
    angle,
    spec.flipH,
    spec.flipV,
    k,
  );
  const img = renderAffine(src, contentW, contentH, mainInv);
  blit(out, img, border, border, 1);

  return applyCrop(out, spec, contentW, contentH, border);
}

/**
 * 裁切：整图已渲染进 `out`（内容在 (border,border) 起、尺寸 contentW×contentH）。
 * 按 `spec.crop`（内容坐标系）裁出子区域，四周重新加回边框后返回。
 * 裁切框会被钳制到内容范围内，因此越界框不会崩、不会露黑边。
 *
 * 这一层放在 `rasterize` 末尾、对"完整内容→裁切"统一处理，
 * 与旋转/镜像/校正/缩放路径正交 —— 预览与导出走同一条 `rasterize`，
 * 裁切结果必然逐字节一致。
 */
function applyCrop(
  out: PixelBuffer,
  spec: RasterSpec,
  contentW: number,
  contentH: number,
  border: number,
): PixelBuffer {
  const c = spec.crop;
  if (c === null) return out;
  const x = Math.max(0, Math.min(Math.round(c.x), contentW));
  const y = Math.max(0, Math.min(Math.round(c.y), contentH));
  const x2 = Math.max(x, Math.min(Math.round(c.x + c.w), contentW));
  const y2 = Math.max(y, Math.min(Math.round(c.y + c.h), contentH));
  const cw = Math.max(1, x2 - x);
  const ch = Math.max(1, y2 - y);

  const region = createPixelBuffer(cw, ch);
  for (let yy = 0; yy < ch; yy++) {
    const rowSrc = (border + y + yy) * out.width + (border + x);
    const rowDst = yy * cw;
    for (let xx = 0; xx < cw; xx++) {
      const si = (rowSrc + xx) * 4;
      const di = (rowDst + xx) * 4;
      region.data[di] = out.data[si];
      region.data[di + 1] = out.data[si + 1];
      region.data[di + 2] = out.data[si + 2];
      region.data[di + 3] = out.data[si + 3];
    }
  }

  const out2 = createPixelBuffer(cw + border * 2, ch + border * 2);
  const [br, bg, bb] = parseHexColor(spec.borderColor);
  fill(out2, br, bg, bb, 255);
  blit(out2, region, border, border, 1);
  return out2;
}

/** 反转仿射（供测试与调试）。 */
export { invert as invertAffine };

/**
 * 把一个源缓冲画进目标缓冲的 (dx, dy, dw, dh) 矩形。
 *
 * @param mode stretch 直接拉伸（调用方已保证宽高比时等价于 contain）
 *             cover   铺满并裁剪多余（居中）
 *             contain 完整放入并可能留白（居中）
 */
export function drawRect(
  dst: PixelBuffer,
  src: PixelBuffer,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mode: 'stretch' | 'cover' | 'contain' = 'stretch',
): void {
  const W = Math.max(1, Math.round(dw));
  const H = Math.max(1, Math.round(dh));
  const srcSize: Size = { w: src.width, h: src.height };
  let tmp: PixelBuffer;
  if (mode === 'stretch') {
    tmp = resizeBuffer(src, W, H);
  } else {
    const k = mode === 'cover' ? Math.max(W / srcSize.w, H / srcSize.h) : Math.min(W / srcSize.w, H / srcSize.h);
    const inv = inverseForContent(W, H, srcSize, 0, false, false, k);
    tmp = renderAffine(src, W, H, inv);
  }
  blit(dst, tmp, dx, dy, 1);
}

