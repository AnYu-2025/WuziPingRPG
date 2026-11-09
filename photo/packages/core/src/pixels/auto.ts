import { identityLevels, type LevelChannel, type LevelsState } from '../color/levels.js';
import type { PixelBuffer } from '../types.js';

/**
 * 自动增强（分析侧）—— 从像素统计推出「色阶」参数。
 *
 * ── 算法来源 ────────────────────────────────────────────────────────
 * 与 legacy `renderer.js#autoEnhance` 同构，分两步：
 *   1. **拉开层次**：逐通道各自取直方图的 1% 分位当 `lo` / `hi`，
 *      于是过曝欠曝、发灰不通透的照片被拉到满动态范围；
 *   2. **校正偏色**：灰世界假设 —— 各通道均值应向三者均值靠拢，
 *      增益 `g = clamp(avgLuma / mean_channel, 0.8, 1.25)`。上限 0.8..1.25
 *      是 legacy 的取值，防止极端色偏图被拉成黑白。
 *
 * ── 与原版的两处刻意差别 ─────────────────────────────────────────────
 *   1. **不降采样**：legacy 先把图缩到长边 900 再统计（那是为了在
 *      `drawImage` 上省时间）。内核这里对**全图**统计 —— 一次 O(w·h) 单遍扫描，
 *      24MP 约几十毫秒，只在按「自动增强」时跑一次。换来的是
 *      **确定性**（不依赖平台重采样滤波器）与更准的 1% 分位。
 *   2. **落在文档里**：结果是 9 个数（3 通道 × lo/hi/gain），以 `setLevels`
 *      进 op 序列 —— 非破坏性、可撤销、可在其上继续调色。
 *      legacy 把结果直接烘进像素（不可逆），这是本内核相对 legacy 的增益。
 *
 * ── 为什么统计原始源图 ───────────────────────────────────────────────
 * 与 legacy 一致（它在 `images[cur].img` 上统计），且"自动增强"的语义是
 * 「救这张源图」，不是「救当前效果」。因此分析只看源像素，与当前其它参数无关 ——
 * 这也让 `setLevels` 成为**幂等**的：同一张源图反复自动增强结果相同。
 */

/** 两端各掐掉的比例（与 legacy 的 `N*0.01` 一致）。 */
const CUT_FRACTION = 0.01;
/** 拉伸后若动态范围仍小于此值，则向外各扩 12 级（legacy 的兜底）。 */
const MIN_SPAN = 24;
const SPAN_PAD = 12;
/** 灰世界增益的合法区间（legacy 取值）。 */
const GAIN_MIN = 0.8;
const GAIN_MAX = 1.25;

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
}

/** 1% 掐头去尾后的 [lo, hi]；`cut` 为绝对像素数阈值。 */
function bounds(hist: Uint32Array, cut: number): readonly [number, number] {
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= cut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= cut) {
      hi = v;
      break;
    }
  }
  if (hi - lo < MIN_SPAN) {
    lo = Math.max(0, lo - SPAN_PAD);
    hi = Math.min(255, hi + SPAN_PAD);
  }
  return [lo, Math.max(lo + 1, hi)];
}

function channel(
  hist: Uint32Array,
  mean: number,
  avgLuma: number,
  cut: number,
): LevelChannel {
  const [lo, hi] = bounds(hist, cut);
  /* `Math.max(1, mean)` 是 legacy 的除零保护：纯黑通道增益退化为上限而非 Infinity。 */
  const gain = clamp(avgLuma / Math.max(1, mean), GAIN_MIN, GAIN_MAX);
  return { lo, hi, gain };
}

/**
 * 由源像素推出色阶参数。纯函数，无副作用，不依赖任何平台能力。
 *
 * 结果是**幂等**的：同一张源图多次调用得到同一组参数（不读当前编辑状态）。
 */
export function analyzeAuto(source: PixelBuffer): LevelsState {
  const { data } = source;
  const hR = new Uint32Array(256);
  const hG = new Uint32Array(256);
  const hB = new Uint32Array(256);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    hR[r]++;
    hG[g]++;
    hB[b]++;
    sumR += r;
    sumG += g;
    sumB += b;
    count++;
  }

  if (count === 0) return identityLevels();

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const avgLuma = (meanR + meanG + meanB) / 3;
  const cut = count * CUT_FRACTION;

  return {
    r: channel(hR, meanR, avgLuma, cut),
    g: channel(hG, meanG, avgLuma, cut),
    b: channel(hB, meanB, avgLuma, cut),
  };
}
