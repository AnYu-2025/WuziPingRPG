/**
 * 应用图标（`assets/icon.ico`）的**独立**结构闸门。
 *
 * ── 为什么单独给一个二进制资源写测试 ──────────────────────────────
 * 图标坏了不会报错，只会**悄悄变丑**：目录偏移错一位、CRC 算错一个字节，
 * Windows 就退回默认图标，或者把 256px 入口截断成半张图。
 * 而这类错误在开发机上往往看不出来 —— 资源管理器缓存着旧图标。
 *
 * ── 为什么这里自己写一份解析器和 CRC，而不是 import 生成器 ─────────
 * 生成器（`scripts/make-icon.mjs`）与校验器**共享代码**的话，
 * 两边一起错就永远绿。所以这份 CRC 表、分块遍历、目录解析全是**另起炉灶**，
 * 只依赖 ICO/PNG 规范本身。这才是"字节级一致"在本项目里该有的写法。
 *
 * 校验的是容器，不是审美 —— 图形好不好看得靠人眼（见 P6E-PLAN 的实机待办）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ICON_PATH = fileURLToPath(new URL('../assets/icon.ico', import.meta.url));
const BYTES = new Uint8Array(readFileSync(ICON_PATH));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ── 独立实现的 CRC32（PNG 规范用的多项式 0xEDB88320，逐位反序） ── */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (at: number): number => (BYTES[at] | (BYTES[at + 1] << 8)) >>> 0;
/** 大端 32 位 —— PNG 侧所有整数都是大端。 */
const be32 = (at: number): number =>
  (((BYTES[at] << 24) | (BYTES[at + 1] << 16) | (BYTES[at + 2] << 8) | BYTES[at + 3]) >>> 0);
/** 小端 32 位 —— ICO 目录与 PNG 相反，混用会把偏移读成天文数字。 */
const le32 = (at: number): number =>
  (((BYTES[at + 3] << 24) | (BYTES[at + 2] << 16) | (BYTES[at + 1] << 8) | BYTES[at]) >>> 0);

interface Entry {
  readonly width: number;
  readonly height: number;
  readonly planes: number;
  readonly bitCount: number;
  readonly size: number;
  readonly offset: number;
}

/** 目录项：ICONDIR(6) 之后每项 16 字节。 */
function directory(): Entry[] {
  const count = u16(4);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = 6 + 16 * i;
    entries.push({
      width: BYTES[base] === 0 ? 256 : BYTES[base],
      height: BYTES[base + 1] === 0 ? 256 : BYTES[base + 1],
      planes: u16(base + 4),
      bitCount: u16(base + 6),
      size: le32(base + 8),
      offset: le32(base + 12),
    });
  }
  return entries;
}

/** 走完一个 PNG 的所有分块，逐块重算 CRC；返回 IHDR 声明的宽高。 */
function inspectPng(start: number, length: number): { width: number; height: number } {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    expect(BYTES[start + i], `PNG 签名第 ${i} 字节不符`).toBe(PNG_SIGNATURE[i]);
  }
  const end = start + length;
  let at = start + PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIend = false;

  while (at + 12 <= end) {
    const chunkLength = be32(at);
    const type = String.fromCharCode(BYTES[at + 4], BYTES[at + 5], BYTES[at + 6], BYTES[at + 7]);
    const dataStart = at + 8;
    const dataEnd = dataStart + chunkLength;
    expect(dataEnd + 4 <= end, `分块 ${type} 越过入口边界`).toBe(true);
    expect(crc32(BYTES.subarray(at + 4, dataEnd)), `分块 ${type} 的 CRC 不符`).toBe(be32(dataEnd));

    if (type === 'IHDR') {
      width = be32(dataStart);
      height = be32(dataStart + 4);
      expect(BYTES[dataStart + 8], '位深必须是 8').toBe(8);
      expect(BYTES[dataStart + 9], '颜色类型必须是 6（RGBA）').toBe(6);
      expect(BYTES[dataStart + 12], '必须非隔行').toBe(0);
      sawIhdr = true;
    }
    if (type === 'IEND') sawIend = true;
    at = dataEnd + 4;
  }
  expect(sawIhdr, '缺少 IHDR').toBe(true);
  expect(sawIend, '缺少 IEND').toBe(true);
  return { width, height };
}

describe('assets/icon.ico —— 容器结构', () => {
  it('ICONDIR 头：保留字为 0、类型为 1（图标）', () => {
    expect(u16(0), '前 2 字节必须保留为 0').toBe(0);
    expect(u16(2), '类型 1 = 图标（0 是光标、2 是光标组）').toBe(1);
  });

  it('目录按尺寸升序，且 Windows 要的几档一个不缺', () => {
    const sizes = directory().map((entry) => entry.width);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    for (const needed of [16, 24, 32, 48, 256]) {
      expect(sizes, `缺 ${needed}px —— 任务栏/文件列表/平铺视图各要一档`).toContain(needed);
    }
  });

  it('每个入口：32 位真彩、单平面、方形、宽高字节一致', () => {
    for (const entry of directory()) {
      expect(entry.planes, '平面数恒为 1').toBe(1);
      expect(entry.bitCount, '位深恒为 32').toBe(32);
      expect(entry.height, '必须方形').toBe(entry.width);
      expect([16, 20, 24, 32, 40, 48, 64, 256]).toContain(entry.width);
    }
  });

  it('数据区首尾相接、不越界、不留尾巴', () => {
    const entries = directory();
    const first = 6 + 16 * entries.length;
    expect(entries[0].offset, '第一个入口紧跟目录之后').toBe(first);

    let cursor = first;
    for (const entry of entries) {
      expect(entry.offset, '入口之间不留空洞').toBe(cursor);
      expect(entry.offset + entry.size, '入口不越出文件').toBeLessThanOrEqual(BYTES.length);
      cursor += entry.size;
    }
    expect(cursor, '文件末尾没有多余字节').toBe(BYTES.length);
  });

  it('每个入口都是合法 PNG，且 IHDR 尺寸与目录声明一致', () => {
    for (const entry of directory()) {
      const header = inspectPng(entry.offset, entry.size);
      expect(header.width, 'IHDR 宽与目录不符').toBe(entry.width);
      expect(header.height, 'IHDR 高与目录不符').toBe(entry.height);
    }
  });
});
