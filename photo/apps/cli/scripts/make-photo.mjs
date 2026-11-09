#!/usr/bin/env node
/**
 * 生成一张「照片感」的大图，供真实性能实测使用。
 *
 * ── 为什么必须"照片感"而不是纯色块 ──────────────────────────────
 * 纯色图的香农熵极低，deflate 几乎不花任何时间，量出来的编码耗时是**假的**。
 * 一份"24MP 导出 0.3 秒"的自测如果基于纯色图，那它只是在骗自己。
 * 这里刻意掺入逐像素噪声与高频纹理，让压缩器真的干活。
 *
 * 内容：天空/地面渐变 + 太阳光晕 + 细密纹理 + 逐像素噪声。
 * 输出 P6 PPM（零依赖，@photo/io 实现）。
 *
 * 用法：
 *   node scripts/make-photo.mjs [宽=6000] [高=4000] [输出路径]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePpm } from '@photo/io';

const args = process.argv.slice(2);
const WIDTH = Number(args[0] ?? 6000);
const HEIGHT = Number(args[1] ?? 4000);
const target = args[2] ?? fileURLToPath(new URL('../tmp/photo.ppm', import.meta.url));

const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

/** xorshift32：确定性、够快、分布够散。 */
let seed = 0x9e3779b9;
function rnd() {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0xffffffff;
}

const cx = WIDTH * 0.28;
const cy = HEIGHT * 0.22;
const sunR = Math.min(WIDTH, HEIGHT) * 0.55;

for (let y = 0; y < HEIGHT; y += 1) {
  const v = y / (HEIGHT - 1);
  const ground = v > 0.62;
  for (let x = 0; x < WIDTH; x += 1) {
    const i = (y * WIDTH + x) * 4;
    const u = x / (WIDTH - 1);
    let r;
    let g;
    let b;
    if (!ground) {
      r = 60 + 120 * v + 40 * u;
      g = 110 + 110 * v;
      b = 180 + 70 * (1 - v);
    } else {
      const t = (v - 0.62) / 0.38;
      r = 70 + 80 * t + 30 * u;
      g = 80 + 90 * t;
      b = 50 + 40 * t;
    }
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.max(0, 1 - d / sunR) ** 3;
    r += 255 * glow * 0.9;
    g += 240 * glow * 0.9;
    b += 190 * glow * 0.9;
    /* 高频纹理：压缩器最怕的东西之一，也是"真实照片"的常态 */
    const tex = Math.sin(x * 0.7) * Math.cos(y * 0.53) * 6;
    const n = (rnd() - 0.5) * 26;
    data[i] = r + tex + n;
    data[i + 1] = g + tex + n;
    data[i + 2] = b + tex + n;
    data[i + 3] = 255;
  }
}

mkdirSync(dirname(target), { recursive: true });
const bytes = encodePpm({ width: WIDTH, height: HEIGHT, data });
writeFileSync(target, bytes);
const mp = ((WIDTH * HEIGHT) / 1e6).toFixed(1);
console.log(`${target}`);
console.log(`${WIDTH}×${HEIGHT}  ${mp} MP  ${(bytes.length / 1048576).toFixed(1)} MB`);
