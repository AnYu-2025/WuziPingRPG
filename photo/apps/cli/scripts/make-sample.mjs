#!/usr/bin/env node
/**
 * 端到端冒烟样例生成器：产出「四象限 + 横向渐变」的 BMP。
 *
 * 为什么用 BMP：它由 @photo/io 零依赖实现，任何端都能解，
 * 不掺任何平台能力 —— 正好用来验证「同一份内核换壳」。
 * 四象限色块便于肉眼核对旋转 / 调色 / 边框是否真的生效。
 *
 * 输出到 apps/cli/tmp/sample.bmp（tmp/ 已在 .gitignore 中，不入库）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBmp } from '@photo/io';

const WIDTH = 320;
const HEIGHT = 240;

/** 左上 / 右上 / 左下 / 右下 */
const QUADRANTS = [
  [214, 48, 49],
  [39, 174, 96],
  [41, 98, 213],
  [243, 196, 47],
];

const image = {
  width: WIDTH,
  height: HEIGHT,
  data: new Uint8ClampedArray(WIDTH * HEIGHT * 4),
};

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const i = (y * WIDTH + x) * 4;
    const quad = (y < HEIGHT / 2 ? 0 : 2) + (x < WIDTH / 2 ? 0 : 1);
    const base = QUADRANTS[quad];
    const t = x / (WIDTH - 1);
    image.data[i] = base[0] + (255 - base[0]) * t;
    image.data[i + 1] = base[1] + (255 - base[1]) * t;
    image.data[i + 2] = base[2] + (255 - base[2]) * t;
    image.data[i + 3] = 255;
  }
}

const target = fileURLToPath(new URL('../tmp/sample.bmp', import.meta.url));
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, encodeBmp(image));
console.log(`${target} (${WIDTH}x${HEIGHT})`);
