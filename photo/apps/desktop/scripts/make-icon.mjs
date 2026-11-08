#!/usr/bin/env node
/**
 * 应用图标生成器 —— 「月相」。
 *
 * 为什么是代码而不是一张设计稿：应用图标必须同时供 16 / 24 / 32 / 48 / 256 等
 * 八个尺寸，而 **AI 或手绘的位图缩到 16px 一定糊**。这里把图形写成一份
 * 归一化参数（圆心、半径、圆角、颜色），每个尺寸**各自**按该参数光栅化，
 * 于是不存在"缩小后边缘发毛"这一步 —— 每个尺寸的边缘都是原始分辨率上算出来的。
 *
 * 与手绘的唯一实质差别是 ≤ 24px 的一档做了**手工提示**（hand-hinting）：
 * 星点关掉、月亮放大、缺口收窄 —— 细节在 16px 上不是"变小"，是"变成噪声"。
 *
 * 产物：
 *   assets/icon.ico     Windows 用（PNG 压缩的 ICO 入口，8 个尺寸）
 *   assets/icon.png     256px 母图，供预览与非 Windows 端
 *   tmp/preview-*.png   自检用的分档样张（不进版本库）
 *
 * 零产品依赖：只用 node:zlib 与 node:fs，不参与应用构建，verify 不跑它。
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* 落点刻意**不叫** build/ —— 仓库根的 .gitignore 第 9 行就是 `build/`，
 * 图标是**要进版本库的产物**，放那儿等于悄悄丢掉。 */
const ASSET_DIR = join(DESKTOP_ROOT, 'assets');
/** 分档样张：给人眼看的中间产物，`tmp/` 已被忽略。 */
const PREVIEW_DIR = join(DESKTOP_ROOT, 'tmp');

/* ─────────────────────────── 设计参数 ─────────────────────────── */

/** 底色：深夜蓝紫。上浅下深的渐变在 32px 以下自然消失。 */
const PLATE_TOP = [0x24, 0x27, 0x4f];
const PLATE_BOTTOM = [0x15, 0x16, 0x2e];
/** 月面：暖白。 */
const MOON_LIT = [0xf2, 0xd9, 0xa8];
/** 地光（暗面）：只比底色亮一点，256px 上读得出"这是一枚有相位的球体"。 */
const MOON_DARK = [0x33, 0x37, 0x62];

/** 归一化坐标：(0,0) 左上、(1,1) 右下，半径均为画幅边长的分数。 */
const LAYOUT = {
  plateRadius: 0.22,
  moon: { cx: 0.545, cy: 0.478, r: 0.298 },
  /** 缺口 = 一个等半径圆往左上偏移，留下右下的凸月。 */
  bite: { dx: -0.163, dy: -0.076 },
  /** 点在月亮之外的左下空白里 —— 放在缺口内会被暗面吃掉，等于没画。 */
  star: { cx: 0.205, cy: 0.775, r: 0.040, alpha: 0.85 },
};

/**
 * ≤ 24px 一档的手工提示（hand-hinting）：
 * 星点在 16px 上只有 0.8px，那不是"小星星"而是"脏点"，关掉；
 * 同时月亮放大 6%、缺口收窄 22% —— 否则亮部在 16px 上瘦成一弯几乎断开的弧。
 */
function layoutFor(size) {
  if (size <= 24) {
    return {
      ...LAYOUT,
      moon: { ...LAYOUT.moon, r: LAYOUT.moon.r * 1.06 },
      bite: { dx: LAYOUT.bite.dx * 0.78, dy: LAYOUT.bite.dy * 0.78 },
      star: null,
    };
  }
  return LAYOUT;
}

/* ─────────────────────────── 光栅化 ─────────────────────────── */

const SUPERSAMPLE = 5; // 每轴 5 次采样 = 25 抽/像素

/* 覆盖度一律用**像素**做单位：归一化距离乘 size 换成像素，
 * 抗锯齿带固定为半像素。早先误把带宽写成 1/SUPERSAMPLE，
 * 于是 256px 上糊出 25px 的边 —— 单位错一位，图就废了。 */

function discCoverage(px, py, cx, cy, r, size) {
  const d = Math.hypot(px - cx, py - cy) * size;
  const radius = r * size;
  if (d <= radius - 0.5) return 1;
  if (d >= radius + 0.5) return 0;
  return radius + 0.5 - d;
}

/** 圆角矩形的符号距离覆盖（半径 r 为边长分数）。 */
function plateCoverage(px, py, r, size) {
  const half = 0.5 - r;
  const qx = (Math.abs(px - 0.5) - half) * size;
  const qy = (Math.abs(py - 0.5) - half) * size;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const distance = outside + inside - r * size;
  if (distance <= -0.5) return 1;
  if (distance >= 0.5) return 0;
  return 0.5 - distance;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * 源到目标的标准 over 合成，**内部一律用预乘**累加。
 * 最后再除回直通 alpha —— ICO/PNG 的位图都存直通值。
 */
function draw(size) {
  const layout = layoutFor(size);
  const rgba = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const [r, g, b, a] = sample(layout, u, v, size);
          pr += r * a;
          pg += g * a;
          pb += b * a;
          pa += a;
        }
      }

      const total = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = pa / total;
      const at = y * size * 4 + x * 4;
      // 预乘 → 直通；alpha 为 0 时不做除法（结果反正被丢掉）。
      if (alpha > 0) {
        rgba[at] = pr / pa;
        rgba[at + 1] = pg / pa;
        rgba[at + 2] = pb / pa;
      }
      rgba[at + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

/** 单个采样点：返回 [r,g,b,a]，颜色为直通值。 */
function sample(layout, u, v, size) {
  const plate = plateCoverage(u, v, layout.plateRadius, size);
  if (plate === 0) return [0, 0, 0, 0];

  const moon = layout.moon;
  const onDisc = discCoverage(u, v, moon.cx, moon.cy, moon.r, size);
  const bite = discCoverage(
    u,
    v,
    moon.cx + layout.bite.dx,
    moon.cy + layout.bite.dy,
    moon.r,
    size,
  );

  let color = mix(PLATE_TOP, PLATE_BOTTOM, v);
  if (onDisc > 0) {
    const lit = Math.min(1, Math.max(0, onDisc * (1 - bite)));
    color = mix(mix(color, MOON_DARK, onDisc), MOON_LIT, lit);
  }
  if (layout.star !== null) {
    const star = discCoverage(u, v, layout.star.cx, layout.star.cy, layout.star.r, size);
    if (star > 0) color = mix(color, MOON_LIT, star * layout.star.alpha);
  }
  return [color[0], color[1], color[2], plate];
}

/* ─────────────────────── PNG / ICO 容器 ─────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i);
  body.set(data, 4);

  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body), false);
  return out;
}

/** 8 位 RGBA、非隔行、一律滤波器 0 —— 图标是平色块，逐行挑滤波器不值得。 */
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size, false);
  view.setUint32(4, size, false);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * ICO 容器：ICONDIR + 目录项 + 各入口数据。
 * 入口用 **PNG 压缩**（Vista 起支持，且平色图标压完只有几 KB），
 * 因此不需要 BMP 那套"高度翻倍 + AND 掩码"的历史包袱。
 */
function encodeIco(entries) {
  const HEADER = 6;
  const DIRECTORY = 16;
  const out = new Uint8Array(
    HEADER + DIRECTORY * entries.length + entries.reduce((n, e) => n + e.png.length, 0),
  );
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);

  let at = HEADER + DIRECTORY * entries.length;
  entries.forEach((entry, index) => {
    const base = HEADER + DIRECTORY * index;
    out[base] = entry.size >= 256 ? 0 : entry.size;
    out[base + 1] = entry.size >= 256 ? 0 : entry.size;
    out[base + 2] = 0; // 调色板色数：0 = 真彩
    out[base + 3] = 0; // 保留，必须为 0
    view.setUint16(base + 4, 1, true); // 平面数：ICO 里恒为 1
    view.setUint16(base + 6, 32, true); // 位深
    view.setUint32(base + 8, entry.png.length, true);
    view.setUint32(base + 12, at, true);
    out.set(entry.png, at);
    at += entry.png.length;
  });
  return out;
}

/* ───────────────────────────── 主流程 ───────────────────────────── */

const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

mkdirSync(ASSET_DIR, { recursive: true });
mkdirSync(PREVIEW_DIR, { recursive: true });

const rendered = SIZES.map((size) => ({ size, png: encodePng(size, draw(size)) }));

const ico = encodeIco(rendered);
const master = rendered.find((entry) => entry.size === 256);
writeFileSync(join(ASSET_DIR, 'icon.ico'), ico);
writeFileSync(join(ASSET_DIR, 'icon.png'), master.png);

for (const entry of rendered) {
  if (entry.size === 16 || entry.size === 32 || entry.size === 48 || entry.size === 256) {
    writeFileSync(join(PREVIEW_DIR, `preview-${entry.size}.png`), entry.png);
  }
}

const bytes = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`icon.ico ${bytes(ico.length)} · ${SIZES.length} 个入口`);
for (const entry of rendered) console.log(`  ${String(entry.size).padStart(3)}px  ${bytes(entry.png.length)}`);
