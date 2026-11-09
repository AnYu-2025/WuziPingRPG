import { orientedSize, type ExifOrientation } from '../metadata/orientation.js';
import { createPixelBuffer, type PixelBuffer } from '../types.js';

/**
 * EXIF 朝向 → 显示态像素 —— **纯索引置换，零插值**（D13）。
 *
 * 与"折进仿射重采样"的差别是这层不做任何数值运算：双线性一个都不跑，
 * 因此输出像素必然**是**输入像素的某个重排，可以逐字节严格相等断言（X2）。
 *
 * 调用时机是**导入那一次**：置换完的缓冲就是后续所有路径（预览 / 导出 /
 * 拼图 / 切图 / 缩略图）唯一认识的源。四条路天然同源，不需要每条路各补一遍
 * 朝向 —— 那正是病根 1 的复发形态。
 *
 * 朝号码的语义见 `metadata/orientation.ts`（与 Pillow `exif_transpose` 对齐）。
 * `1` / `null` / `undefined` 原样返回**同一个引用**，不产生拷贝。
 */
export function applyOrientation(
  src: PixelBuffer,
  orientation: ExifOrientation | null | undefined,
): PixelBuffer {
  if (orientation === null || orientation === undefined || orientation === 1) return src;

  const W = src.width;
  const H = src.height;
  const dst = orientedSize({ w: W, h: H }, orientation);
  const DW = dst.w;
  const DH = dst.h;
  const out = createPixelBuffer(DW, DH);

  // dst(c,r) = src(sc,sr)，而 (sc,sr) 对 (c,r) 是仿射的 ⇒ 用步长走指针，
  // 不写七套几乎一样的循环，也不在像素级 switch。
  let si: number; // (0,0) 处的源字节偏移
  let dc: number; // 列 +1 的源字节增量
  let dr: number; // 行 +1 的源字节增量
  switch (orientation) {
    case 2:
      si = (W - 1) * 4;
      dc = -4;
      dr = W * 4;
      break;
    case 3:
      si = (W * H - 1) * 4;
      dc = -4;
      dr = -W * 4;
      break;
    case 4:
      si = (H - 1) * W * 4;
      dc = 4;
      dr = -W * 4;
      break;
    case 5:
      si = 0;
      dc = W * 4;
      dr = 4;
      break;
    case 6:
      si = (H - 1) * W * 4;
      dc = -W * 4;
      dr = 4;
      break;
    case 7:
      si = (H - 1) * W * 4 + (W - 1) * 4;
      dc = -W * 4;
      dr = -4;
      break;
    case 8:
      si = (W - 1) * 4;
      dc = W * 4;
      dr = -4;
      break;
    default:
      return src;
  }

  const sd = src.data;
  const od = out.data;
  for (let r = 0; r < DH; r++) {
    let s = si + r * dr;
    for (let c = 0; c < DW; c++, s += dc) {
      const o = (r * DW + c) * 4;
      od[o] = sd[s];
      od[o + 1] = sd[s + 1];
      od[o + 2] = sd[s + 2];
      od[o + 3] = sd[s + 3];
    }
  }
  return out;
}
