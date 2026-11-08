import type { ExifOrientation } from './orientation.js';
import { isExifOrientation } from './orientation.js';

/**
 * EXIF 读取 —— 纯 TS、零依赖、无 DOM（D12）。
 *
 * ── 为什么在内核 ──────────────────────────────────────────────────
 * 朝向决定像素，拍摄参数决定"这台相机、这次曝光"怎么呈现。放壳里就是三端各解
 * 一遍，各解一遍就会各解错一遍 —— 那正是病根 1 的复发形态。
 *
 * ── 只读白名单 ────────────────────────────────────────────────────
 * 未知 tag、厂商私有段（MakerNote）、GPS、缩略图**一律不读**。
 * 忽略 ≠ 谎报：`ExifRead` 把"没有 EXIF"与"有但读不动"分成两种结果，
 * 界面必须按其中一种显示，不许拿 null 当"没有"糊过去。
 *
 * ── 绝不抛、绝不越界 ───────────────────────────────────────────────
 * 输入是任意外部字节。TIFF 块先被裁成一份独立子区，块内所有偏移都以该子区起点
 * 计算并逐个过边界检查；任何越界都收敛成"该字段为 null"或 `valid:false`。
 */

/** 白名单 tag 号。 */
const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  focalLength: 0x920a,
  /** Exif SubIFD 的指针 tag（在 IFD0 里）。 */
  exifIfd: 0x8769,
} as const;

const MAX_ENTRIES = 512;

/** 白名单字段的值。`null` = 这份 EXIF 里没有该字段（与"整份 EXIF 不存在"是两件事）。 */
export interface PhotoExif {
  readonly orientation: ExifOrientation | null;
  readonly make: string | null;
  readonly model: string | null;
  /** 原始 EXIF 时间串 `YYYY:MM:DD HH:MM:SS`。不做本地化 —— 格式化只裁字段，归本模块。 */
  readonly dateTimeOriginal: string | null;
  /** 曝光时间，单位秒。 */
  readonly exposureTime: number | null;
  readonly fNumber: number | null;
  readonly iso: number | null;
  readonly focalLength: number | null;
}

/**
 * 三态结果：
 *   - `found: false` —— 容器里没有 EXIF 段（这台设备就没写元数据）
 *   - `found: true, valid: false` —— 有段但读不动（截断 / 字节序不认 / 结构越界）
 *   - `found: true, valid: true` —— 读到了，字段各自可能为 null
 */
export type ExifRead =
  | { readonly found: false }
  | { readonly found: true; readonly valid: false; readonly reason: string }
  | { readonly found: true; readonly valid: true; readonly exif: PhotoExif };

const NOT_FOUND: ExifRead = { found: false };

function unreadable(reason: string): ExifRead {
  return { found: true, valid: false, reason };
}

/* ─────────────────────────── 容器定位 ─────────────────────────── */

interface Span {
  readonly from: number;
  readonly length: number;
}

function hasText(bytes: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** JPEG：从 SOI 往后走段表，取第一个带头 `Exif\0\0` 的 APP1。 */
function jpegApp1(bytes: Uint8Array): Span | null {
  const n = bytes.length;
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xdf)) {
      i += 2;
      continue;
    }
    const size = (bytes[i + 2] << 8) | bytes[i + 3];
    const from = i + 4;
    const to = i + 2 + size;
    if (size < 2 || to > n) return null;
    if (marker === 0xe1 && to - from >= 6 && hasText(bytes, from, 'Exif\0\0')) {
      return { from: from + 6, length: to - from - 6 };
    }
    i = to;
  }
  return null;
}

/** PNG：走 chunk 链取 `eXIf`（结构上就是同一份 TIFF）。 */
function pngExif(bytes: Uint8Array): Span | null {
  const n = bytes.length;
  let i = 8;
  while (i + 8 <= n) {
    const size = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const dataAt = i + 8;
    if (size > n - dataAt - 4) return null;
    if (hasText(bytes, i + 4, 'eXIf')) return { from: dataAt, length: size };
    i = dataAt + size + 4; // 跳过数据 + CRC（CRC 是否合法归 PNG 解码器管）
  }
  return null;
}

function locateTiff(bytes: Uint8Array): Span | null {
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegApp1(bytes);
  if (hasText(bytes, 0, '\x89PNG\r\n\x1a\n')) return pngExif(bytes);
  if (hasText(bytes, 0, 'II') || hasText(bytes, 0, 'MM')) {
    return { from: 0, length: bytes.length };
  }
  return null;
}

/* ─────────────────────────── TIFF 读取 ─────────────────────────── */

/** TIFF 字段类型 → 单值字节数。表里没有的类型一律不读。 */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

class Tiff {
  private readonly dv: DataView;
  private readonly le: boolean;
  private readonly len: number;

  constructor(block: Uint8Array, littleEndian: boolean) {
    // 传进来的必是 `subarray` 出来的独立视图： DataView 只覆盖这一段，
    // 于是块内偏移天然不会读到父缓冲里去。
    this.dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    this.le = littleEndian;
    this.len = block.byteLength;
  }

  private ok(at: number, size: number): boolean {
    return at >= 0 && size >= 0 && at + size <= this.len;
  }

  /** 只用于"必须存在"的头部字段；越界给 0，由调用方判不合法。 */
  force16(at: number): number {
    return this.ok(at, 2) ? this.dv.getUint16(at, this.le) : 0;
  }

  num32(at: number): number | null {
    return this.ok(at, 4) ? this.dv.getUint32(at, this.le) : null;
  }

  /** 第 `index` 个 `type` 型值。 */
  value(at: number, type: number, index: number): number | null {
    const size = TYPE_SIZE[type];
    if (size === undefined) return null;
    const p = at + index * size;
    if (!this.ok(p, size)) return null;
    switch (type) {
      case 1:
      case 7:
        return this.dv.getUint8(p);
      case 3:
        return this.dv.getUint16(p, this.le);
      case 4:
        return this.dv.getUint32(p, this.le);
      case 9:
        return this.dv.getInt32(p, this.le);
      case 5:
      case 10: {
        const num = type === 5 ? this.dv.getUint32(p, this.le) : this.dv.getInt32(p, this.le);
        const den = type === 5 ? this.dv.getUint32(p + 4, this.le) : this.dv.getInt32(p + 4, this.le);
        return den === 0 ? null : num / den;
      }
      case 11:
        return this.dv.getFloat32(p, this.le);
      case 12:
        return this.dv.getFloat64(p, this.le);
      default:
        return null;
    }
  }

  /** ASCII 值：截到第一个 `\0`，丢掉不可打印字节。 */
  text(at: number, count: number): string | null {
    if (!this.ok(at, count)) return null;
    let out = '';
    for (let i = 0; i < count; i++) {
      const c = this.dv.getUint8(at + i);
      if (c === 0) break;
      if (c >= 0x20 && c <= 0x7e) out += String.fromCharCode(c);
    }
    const trimmed = out.trim();
    return trimmed === '' ? null : trimmed;
  }

  /**
   * 走一个 IFD，把白名单 tag 收集起来。
   * 返回 false = 这个 IFD 的头就不合法（越界 / 条目数离谱），调用方据此报"读不动"。
   */
  readIfd(at: number, nums: Map<number, number>, strs: Map<number, string>): boolean {
    const count = this.value(at, 3, 0);
    if (count === null || count < 0 || count > MAX_ENTRIES) return false;
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      // IFD 声明了 N 条却在第 i 条越界 —— 这是结构坏了，不是"没有元数据"。
      // 单条字段的**值指针**越界另算：那条字段作废，其余照常（见下面 continue）。
      if (!this.ok(entry, 12)) return false;
      const tag = this.dv.getUint16(entry, this.le);
      const type = this.dv.getUint16(entry + 2, this.le);
      const cnt = this.num32(entry + 4);
      const size = TYPE_SIZE[type];
      if (cnt === null || size === undefined) continue;
      const total = cnt * size;
      const valueAt = total <= 4 ? entry + 8 : this.num32(entry + 8);
      if (valueAt === null || !this.ok(valueAt, total)) continue;
      if (type === 2) {
        const s = this.text(valueAt, total);
        if (s !== null) strs.set(tag, s);
      } else {
        const v = this.value(valueAt, type, 0);
        if (v !== null) nums.set(tag, v);
      }
    }
    return true;
  }
}

/** 头三查：字节序、42、IFD0 偏移。 */
function openTiff(block: Uint8Array): Tiff | null {
  const le = block[0] === 0x49 && block[1] === 0x49;
  const be = block[0] === 0x4d && block[1] === 0x4d;
  if (!le && !be) return null;
  const t = new Tiff(block, le);
  if (t.force16(2) !== 42) return null;
  return t;
}

/* ─────────────────────────── 对外入口 ─────────────────────────── */

/**
 * 从图片字节里读 EXIF。
 *
 * 不做任何猜测：容器里没有 EXIF 段 → `found:false`；有段但结构读不动 →
 * `valid:false` 并给出人话原因。两种状态在界面上是两句不同的话（X4）。
 */
export function readExif(bytes: Uint8Array): ExifRead {
  const span = locateTiff(bytes);
  if (span === null) return NOT_FOUND;
  const from = Math.max(0, span.from);
  const to = Math.min(bytes.length, from + Math.max(0, span.length));
  if (to - from < 8) return unreadable('EXIF 段过短，无法解析');
  const block = bytes.subarray(from, to);
  const t = openTiff(block);
  if (t === null) return unreadable('TIFF 头不完整或字节序无法识别');

  const ifd0 = t.num32(4);
  if (ifd0 === null) return unreadable('TIFF 头缺少 IFD0 偏移');

  const nums = new Map<number, number>();
  const strs = new Map<number, string>();
  if (!t.readIfd(ifd0, nums, strs)) return unreadable('IFD0 条目越界');

  const sub = nums.get(TAG.exifIfd);
  // Exif SubIFD 只跟进一层，不递归 —— 环形指针吊不死解析器。
  if (sub !== undefined && !t.readIfd(sub, nums, strs)) return unreadable('Exif 子目录越界');

  const raw = nums.get(TAG.orientation);
  const exif: PhotoExif = {
    orientation: raw !== undefined && isExifOrientation(raw) ? raw : null,
    make: strs.get(TAG.make) ?? null,
    model: strs.get(TAG.model) ?? null,
    dateTimeOriginal: strs.get(TAG.dateTimeOriginal) ?? null,
    exposureTime: nums.get(TAG.exposureTime) ?? null,
    fNumber: nums.get(TAG.fNumber) ?? null,
    iso: nums.get(TAG.iso) ?? null,
    focalLength: nums.get(TAG.focalLength) ?? null,
  };
  return { found: true, valid: true, exif };
}

/** 从三态结果里取朝向；没有 EXIF / 读不动 / 值非法都归为 `null`（= 不做置换）。 */
export function exifOrientationOf(read: ExifRead): ExifOrientation | null {
  return read.found && read.valid ? read.exif.orientation : null;
}

/* ─────────────────────────── 展示用格式化 ─────────────────────────── */

/** `1/125s`；≥1 秒的长曝光直接写秒数（与 legacy 的显示口径一致）。 */
function exposureText(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

/** EXIF 的 `2024:05:01 12:33:20` → `2024-05-01`；不像日期就返回 null。 */
function dateText(raw: string): string | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(raw);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * 把拍摄参数压成一行（桌面信息条与 CLI `info` 报告共用，避免两端各排一遍版）。
 *
 * 三态都_covered_：`无 EXIF` / `EXIF 无法解析（原因）` / 具体参数。
 * 参数全缺但 EXIF 头在，也照样说清楚"有 EXIF，只是没有拍摄参数"。
 */
export function formatExif(read: ExifRead): string {
  if (!read.found) return '无 EXIF';
  if (!read.valid) return `EXIF 无法解析（${read.reason}）`;
  const e = read.exif;
  const parts: string[] = [];
  const cam = [e.make, e.model].filter((s): s is string => s !== null).join(' ').trim();
  if (cam !== '') parts.push(cam);
  if (e.fNumber !== null && e.fNumber > 0) parts.push(`f/${Math.round(e.fNumber * 10) / 10}`);
  const ex = e.exposureTime === null ? null : exposureText(e.exposureTime);
  if (ex !== null) parts.push(ex);
  if (e.iso !== null && e.iso > 0) parts.push(`ISO${e.iso}`);
  if (e.focalLength !== null && e.focalLength > 0) {
    parts.push(`${Math.round(e.focalLength * 10) / 10}mm`);
  }
  const d = e.dateTimeOriginal === null ? null : dateText(e.dateTimeOriginal);
  if (d !== null) parts.push(d);
  return parts.length === 0 ? '有 EXIF，无拍摄参数' : parts.join(' · ');
}
