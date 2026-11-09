/**
 * 零依赖 ZIP 打包（**仅 store 模式**）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * 批量导出 / 切图分片要把 N 个成品交到用户手里，而"N 个散文件"是最差的
 * 交付形态：要挑目录、会互相覆盖、跨设备搬运时还会丢。ZIP 是唯一一个
 * **被所有平台原生支持**的容器格式（Windows 资源管理器 / macOS 归档工具 /
 * Linux unzip / Android / iOS 文件 App 都能直接打开），因此值得自己写一个。
 *
 * ── 为什么是 store（不压缩） ────────────────────────────────────
 *   1. 成品是 PNG / JPEG，**已经是压缩格式**。再 deflate 一遍通常零收益
 *      甚至负收益（压过的数据熵很高），纯属白烧 CPU；
 *   2. deflate 要么依赖 `node:zlib`（Node-only，违背 io 零平台依赖），
 *      要么自带一份上千行的压缩器（巨大、难验证、易出静默错）。
 * 而 store 模式是 ZIP 规范里最基本的一种，**系统解压器必然支持**。
 *
 * ── 为什么手写 UTF-8 ────────────────────────────────────────────
 * io 的 tsconfig 是 `lib:["ES2022"]` + `types:[]`，`TextEncoder` 属于
 * DOM lib，**在这里根本没有类型**。与其为它加一条环境声明（那等于偷偷
 * 引入平台假设，把"零依赖"这句话变成一句口号），不如照 RFC 3629 手写
 * 二十行 —— 顺便让"文件名怎么变成字节"这件事在这个文件里可读、可测。
 *
 * ── 结构（三段，全部小端） ──────────────────────────────────────
 *   [local file header + 原始数据] × N
 *   [central directory header] × N
 *   [end of central directory]
 * 三者的偏移在写之前就能**精确算出来**（见 `zipStore`），于是整份归档
 * 一次分配、零增长拷贝 —— 100 MB 的归档不会因为扩容多复制一遍。
 */

/** local file header 的定长部分字节数。 */
const LOCAL_HEADER_SIZE = 30;
/** central directory header 的定长部分字节数。 */
const CENTRAL_HEADER_SIZE = 46;
/** end of central directory 的定长部分字节数。 */
const EOCD_SIZE = 22;

/** 通用位标记：bit 11 —— 文件名与注释是 UTF-8。 */
const FLAG_UTF8 = 0x0800;
/** 只用 store（不压缩）。 */
const METHOD_STORE = 0;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** 版本号 2.0 —— store + 目录都是 2.0 就够。 */
const VERSION = 20;

/** 单个条目的名字 / 数据长度上限（store 模式不支持 ZIP64）。 */
const MAX_U16 = 0xffff;

/**
 * CRC-32 查找表（IEEE 802.3 多项式 0xEDB88320，反射式）。
 *
 * 模块级只建一次：256 项的建表成本可以忽略，但每张图重算一遍就说不过去了。
 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32（ZIP 用的那一版）。
 *
 * `seed` 是**上一次的返回值**，用于分段累计 —— 分片打包时不必把整条数据
 * 先拼成一个缓冲再算。
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 把字符串编码成 UTF-8 字节（RFC 3629）。
 *
 * 与 `TextEncoder` 的行为对齐：孤立代理项按 3 字节编出（不抛错）——
 * 反正不会出现在我们生成的文件名里，此处只求"绝不抛"。
 */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

export interface ZipEntry {
  /** 归档内的名字（用 `/` 分隔目录；UTF-8 编码）。 */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface ZipOptions {
  /**
   * 归档内统一使用的修改时间。
   *
   * 缺省是**固定的 1980-01-01 00:00:00**（ZIP 时间戳的零点）而不是"现在"：
   * 于是同样的输入必然产出逐字节相同的归档 —— 可以进测试做金标准比对，
   * 用户也能直接 diff 两次导出。要用真实时间就显式传 `new Date()`。
   */
  readonly now?: Date;
}

/**
 * 把若干条目打成一份 ZIP（store 模式）。
 *
 * **重名会抛错**，不会静默覆盖：同名条目在 ZIP 规范里是合法的，但解压时
 * 后一个会盖掉前一个 —— 用户平白丢一张图却毫无提示。调用方应当先用
 * `pushUniqueName` 去重（本包的契约是"你给我唯一的名字，我忠实写进去"）。
 */
export function zipStore(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  if (entries.length > MAX_U16) {
    throw new Error(`ZIP 条目数 ${entries.length} 超出 ${MAX_U16} —— store 模式不支持 ZIP64。`);
  }

  const stamp = dosStamp(options.now);
  const prepared = entries.map((entry) => {
    if (entry.name.includes('\\')) {
      throw new Error(`归档内名字必须用正斜杠分隔目录：${entry.name}`);
    }
    const name = utf8Bytes(entry.name);
    if (name.length > MAX_U16) {
      throw new Error(`归档内名字过长（${name.length} 字节，上限 ${MAX_U16}）：${entry.name}`);
    }
    if (entry.bytes.length > 0xffffffff) {
      throw new Error(`条目过大（${entry.bytes.length} 字节）—— store 模式不支持 ZIP64。`);
    }
    return { raw: entry.name, name, bytes: entry.bytes, crc: crc32(entry.bytes) };
  });

  const seen = new Set<string>();
  for (const entry of prepared) {
    const key = entry.name.join(',');
    if (seen.has(key)) {
      throw new Error(`归档内出现重名条目：${entry.raw} —— 解压时会互相覆盖。`);
    }
    seen.add(key);
  }

  let total = EOCD_SIZE;
  for (const entry of prepared) {
    total += LOCAL_HEADER_SIZE + entry.name.length + entry.bytes.length;
    total += CENTRAL_HEADER_SIZE + entry.name.length;
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const offsets: number[] = [];
  let at = 0;

  for (const entry of prepared) {
    offsets.push(at);
    view.setUint32(at, SIG_LOCAL, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, METHOD_STORE, true);
    view.setUint16(at + 10, stamp.time, true);
    view.setUint16(at + 12, stamp.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.bytes.length, true);
    view.setUint32(at + 22, entry.bytes.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true); // extra field 长度
    at += LOCAL_HEADER_SIZE;
    out.set(entry.name, at);
    at += entry.name.length;
    out.set(entry.bytes, at);
    at += entry.bytes.length;
  }

  const centralStart = at;
  prepared.forEach((entry, index) => {
    view.setUint32(at, SIG_CENTRAL, true);
    view.setUint16(at + 4, VERSION, true); // version made by
    view.setUint16(at + 6, VERSION, true); // version needed
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, METHOD_STORE, true);
    view.setUint16(at + 12, stamp.time, true);
    view.setUint16(at + 14, stamp.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.bytes.length, true);
    view.setUint32(at + 24, entry.bytes.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // 起始磁盘号
    view.setUint16(at + 36, 0, true); // 内部属性
    view.setUint32(at + 38, 0, true); // 外部属性
    view.setUint32(at + 42, offsets[index], true);
    at += CENTRAL_HEADER_SIZE;
    out.set(entry.name, at);
    at += entry.name.length;
  });

  const centralSize = at - centralStart;
  view.setUint32(at, SIG_EOCD, true);
  view.setUint16(at + 4, 0, true); // 本磁盘号
  view.setUint16(at + 6, 0, true); // central directory 所在磁盘号
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true); // 注释长度

  return out;
}

/**
 * 让 `candidate` 在一组已用名字里唯一。
 *
 * 重名条目在 ZIP 里合法、解压时互相覆盖 —— 这正是"批量导出"最容易踩的坑
 * （两张同名 `IMG_0001.png` 只活下来一张）。命中重名时按 `a.png` →
 * `a-2.png` → `a-3.png` 递增，扩展名保持在最后。
 *
 * 命中后把最终名字写回 `used`，因此调用方只需一路 `pushUniqueName(used, name)`。
 */
export function pushUniqueName(used: Set<string>, candidate: string): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot > 0 ? candidate.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const next = `${stem}-${n}${ext}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
}

/** 把 `Date` 转成 MS-DOS 日期 / 时间（ZIP 用的老格式）。 */
function dosStamp(date: Date | undefined): { time: number; date: number } {
  /* 1980-01-01 00:00:00 是 ZIP 时间戳的零点（年份从 1980 起算）。 */
  if (date === undefined) return { time: 0, date: (1 << 5) | 1 };
  const year = date.getFullYear();
  const years = year < 1980 ? 0 : Math.min(year - 1980, 127);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: (years << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
