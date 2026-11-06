/* 天工 · 拍后摩尔纹抑制（原创轻量实现，纯前端离线）
 * 摩尔纹是屏幕像素网格与相机传感器网格的差拍：主要表现为彩色周期条纹，
 * 色度(Cb/Cr)高频能量异常高、亮度(Y)变化却不大；PPT 文字边缘恰好相反。
 * 所以这里只把「色度异常块」的 Cb/Cr 向块均值收缩，亮度 Y 原样保留 ——
 * 彩色波纹被抹平，黑白文字仍然锐利。最后再轻微重采样打散残余周期。
 * 不做完整 2D FFT：1024px 图上分块统计足够快，也不会把字一起糊掉。 */

export const DEMOIRE_DEFAULT = { enabled: true, strength: 0.6 };
export const DEMOIRE_BLOCK = 12;

export function demoireSanitize(value) {
  const v = value && typeof value === 'object' ? value : {};
  const n = Number(v.strength);
  return {
    enabled: v.enabled !== false,
    strength: Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEMOIRE_DEFAULT.strength
  };
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;

/** 一个块内水平相邻像素的色度/亮度高频能量。 */
export function moireBlockStats(data, w, h, x0, y0, size) {
  let chroma = 0, bright = 0, n = 0;
  const xe = Math.min(x0 + size, w), ye = Math.min(y0 + size, h);
  for (let y = y0; y < ye; y++) {
    for (let x = x0 + 1; x < xe; x++) {
      const i = (y * w + x) * 4, j = i - 4;
      const y1 = luma(data[i], data[i + 1], data[i + 2]);
      const y2 = luma(data[j], data[j + 1], data[j + 2]);
      const cr1 = data[i] - y1, cr2 = data[j] - y2;
      const cb1 = data[i + 2] - y1, cb2 = data[j + 2] - y2;
      chroma += Math.abs(cr1 - cr2) + Math.abs(cb1 - cb2);
      bright += Math.abs(y1 - y2);
      n++;
    }
  }
  return { chroma: n ? chroma / n : 0, luma: n ? bright / n : 0 };
}

/** 自适应阈值：只有色度能量显著高于全图中位数的块才判为摩尔纹。 */
export function moireBlockFlags(data, w, h, size = DEMOIRE_BLOCK) {
  const cols = Math.max(1, Math.ceil(w / size));
  const stats = [];
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) stats.push(moireBlockStats(data, w, h, x, y, size));
  }
  const sorted = stats.map(s => s.chroma).sort((a, b) => a - b);
  const q25 = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0;
  /* 绝对阈值为主、低分位基线为辅并封顶：整张图都是摩尔纹时也能检出，
     普通彩色照片的局部色度变化则不会误伤。 */
  const threshold = Math.max(3, Math.min(q25 * 1.8 + 1, 14));
  return {
    flags: stats.map(s => s.chroma > threshold && s.chroma > s.luma * 1.1),
    cols, threshold
  };
}

/** 原地处理 ImageData；返回是否改动与命中的块数。strength=0 时完全不动。 */
export function demoireImageData(imageData, strength) {
  const s = demoireSanitize({ strength }).strength;
  const { data, width: w, height: h } = imageData;
  if (s <= 0 || !w || !h) return { changed: false, blocks: 0 };
  const { flags, cols } = moireBlockFlags(data, w, h);
  const blocks = flags.reduce((sum, f) => sum + (f ? 1 : 0), 0);
  if (!blocks) return { changed: false, blocks: 0 };
  const work = new Uint8ClampedArray(data);
  for (let index = 0; index < flags.length; index++) {
    if (!flags[index]) continue;
    const x0 = (index % cols) * DEMOIRE_BLOCK;
    const y0 = Math.floor(index / cols) * DEMOIRE_BLOCK;
    const xe = Math.min(x0 + DEMOIRE_BLOCK, w), ye = Math.min(y0 + DEMOIRE_BLOCK, h);
    let sumCr = 0, sumCb = 0, count = 0;
    for (let y = y0; y < ye; y++) for (let x = x0; x < xe; x++) {
      const i = (y * w + x) * 4;
      const Y = luma(data[i], data[i + 1], data[i + 2]);
      sumCr += data[i] - Y; sumCb += data[i + 2] - Y; count++;
    }
    const meanCr = sumCr / Math.max(1, count), meanCb = sumCb / Math.max(1, count);
    for (let y = y0; y < ye; y++) for (let x = x0; x < xe; x++) {
      const i = (y * w + x) * 4;
      const Y = luma(data[i], data[i + 1], data[i + 2]);
      const cr = (data[i] - Y) + (meanCr - (data[i] - Y)) * s;
      const cb = (data[i + 2] - Y) + (meanCb - (data[i + 2] - Y)) * s;
      const r = Y + cr, b = Y + cb;
      const g = (Y - 0.299 * r - 0.114 * b) / 0.587;
      work[i] = clamp255(r); work[i + 1] = clamp255(g); work[i + 2] = clamp255(b);
    }
  }
  data.set(work);
  return { changed: true, blocks };
}

/** Canvas 包装：色度抑制 + 0.92 倍重采样打散残余周期条纹。 */
export function demoireCanvas(canvas, strength) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { changed: false, blocks: 0 };
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = demoireImageData(image, strength);
  if (!result.changed) return result;
  ctx.putImageData(image, 0, 0);
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(canvas.width * 0.92));
  tmp.height = Math.max(1, Math.round(canvas.height * 0.92));
  tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  return result;
}
