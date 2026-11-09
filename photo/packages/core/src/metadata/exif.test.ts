import { describe, expect, it } from 'vitest';

import { formatExif, readExif, exifOrientationOf, type ExifRead } from './exif.js';

/* ─────────────────────────── TIFF 字节构造器（只服务测试） ─────────────────────────── */

type IfdName = '0' | 'exif';

interface Entry {
  readonly tag: number;
  /** 2=ASCII 3=SHORT 4=LONG 5=RATIONAL。 */
  readonly type: number;
  /** 按类型单位排列；ASCII 传字符串。 */
  readonly value: number[] | string;
  readonly ifd: IfdName;
}

/** 值区字节（按文件字节序编码）与单位数。 */
function encode(e: Entry, le: boolean): { bytes: number[]; count: number } {
  const bytes: number[] = [];
  const push16 = (v: number) =>
    bytes.push(...(le ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]));
  const push32 = (v: number) =>
    bytes.push(
      ...(le
        ? [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
        : [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]),
    );
  if (typeof e.value === 'string') {
    for (const ch of [...e.value, '\0']) bytes.push(ch.charCodeAt(0));
    return { bytes, count: bytes.length };
  }
  if (e.type === 5) {
    // RATIONAL：每两个数一份（分子/分母），**单位数是份数**（解析器按份数 ×8 算长度）
    for (let i = 0; i < e.value.length; i += 2) {
      push32(e.value[i]);
      push32(e.value[i + 1] ?? 1);
    }
    return { bytes, count: e.value.length / 2 };
  }
  for (const v of e.value) {
    if (e.type === 3) push16(v);
    else if (e.type === 4) push32(v);
    else bytes.push(v & 0xff);
  }
  return { bytes, count: e.value.length };
}

/**
 * 造一份最小 TIFF：头 + IFD0 + （可选）Exif SubIFD + 值堆。
 * `exifIfd`(0x8769) 指针由本函数自动补写，测试不必手算偏移。
 */
function buildTiff(entries: readonly Entry[], littleEndian = true): Uint8Array {
  const le = littleEndian;
  const sub = entries.filter((e) => e.ifd === 'exif');
  const root: Entry[] = entries.filter((e) => e.ifd === '0');
  if (sub.length > 0) root.push({ tag: 0x8769, type: 4, value: [0], ifd: '0' });

  const ifd0At = 8;
  const ifd0Len = 2 + 12 * root.length + 4;
  const subAt = ifd0At + ifd0Len;
  const subLen = sub.length === 0 ? 0 : 2 + 12 * sub.length + 4;
  const heapAt = subAt + subLen;

  const coded = new Map<Entry, { bytes: number[]; count: number }>();
  for (const e of [...root, ...sub]) coded.set(e, encode(e, le));
  if (sub.length > 0) {
    const ptr = coded.get(root[root.length - 1]);
    if (ptr) {
      ptr.bytes.length = 0;
      ptr.bytes.push(
        le ? subAt & 0xff : (subAt >> 24) & 0xff,
        le ? (subAt >> 8) & 0xff : (subAt >> 16) & 0xff,
        le ? (subAt >> 16) & 0xff : (subAt >> 8) & 0xff,
        le ? (subAt >> 24) & 0xff : subAt & 0xff,
      );
    }
  }

  const heap: number[] = [];
  const valueAt = new Map<Entry, number>();
  for (const e of [...root, ...sub]) {
    const c = coded.get(e);
    if (c === undefined) continue;
    if (c.bytes.length <= 4) valueAt.set(e, -1);
    else {
      valueAt.set(e, heapAt + heap.length);
      heap.push(...c.bytes);
    }
  }

  const out = new Uint8Array(heapAt + heap.length);
  const u16 = (at: number, v: number) => {
    out[at] = le ? v & 0xff : (v >> 8) & 0xff;
    out[at + 1] = le ? (v >> 8) & 0xff : v & 0xff;
  };
  const u32 = (at: number, v: number) => {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (let k = 0; k < 4; k++) out[at + k] = le ? b[k] : b[3 - k];
  };
  out[0] = le ? 0x49 : 0x4d;
  out[1] = le ? 0x49 : 0x4d;
  u16(2, 42);
  u32(4, ifd0At);

  const writeIfd = (at: number, list: readonly Entry[], next: number): void => {
    u16(at, list.length);
    list.forEach((e, i) => {
      const entry = at + 2 + i * 12;
      u16(entry, e.tag);
      u16(entry + 2, e.type);
      u32(entry + 4, coded.get(e)?.count ?? 0);
      const where = valueAt.get(e);
      const c = coded.get(e);
      if (c === undefined) return;
      if (where === -1) for (let k = 0; k < 4; k++) out[entry + 8 + k] = c.bytes[k] ?? 0;
      else if (where !== undefined) u32(entry + 8, where);
    });
    u32(at + 2 + list.length * 12, next);
  };

  writeIfd(ifd0At, root, 0);
  if (sub.length > 0) writeIfd(subAt, sub, 0);
  heap.forEach((b, i) => {
    out[heapAt + i] = b;
  });
  return out;
}

/** 把 TIFF 块包进 JPEG 的 APP1。 */
function jpegOf(tiff: Uint8Array): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe1, ((tiff.length + 8) >> 8) & 0xff, (tiff.length + 8) & 0xff];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  return Uint8Array.from([...head, ...exif, ...tiff, 0xff, 0xd9]);
}

/** 把 TIFF 块包进 PNG 的 `eXIf` chunk（CRC 留空 —— 校验和归 PNG 解码器管）。 */
function pngOf(tiff: Uint8Array, where: 'before' | 'after' = 'before'): Uint8Array {
  const chunk = (type: string, data: number[]): number[] => {
    const len = data.length;
    return [
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...[...type].map((c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ];
  };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const idat = chunk('IDAT', [1, 2, 3, 4]);
  const iend = chunk('IEND', []);
  const exif = chunk('eXIf', [...tiff]);
  return Uint8Array.from(
    where === 'before'
      ? [...sig, ...ihdr, ...exif, ...idat, ...iend]
      : [...sig, ...ihdr, ...idat, ...exif, ...iend],
  );
}

/** 一份"典型相机输出"：IFD0 放机型与朝向，拍摄参数在 Exif SubIFD。 */
function cameraEntries(): Entry[] {
  return [
    { tag: 0x0112, type: 3, value: [6], ifd: '0' },
    { tag: 0x010f, type: 2, value: 'SONY', ifd: '0' },
    { tag: 0x0110, type: 2, value: 'ILCE-7M4', ifd: '0' },
    { tag: 0x9003, type: 2, value: '2024:05:01 12:33:20', ifd: 'exif' },
    { tag: 0x829a, type: 5, value: [1, 125], ifd: 'exif' },
    { tag: 0x829d, type: 5, value: [18, 10], ifd: 'exif' },
    { tag: 0x8827, type: 3, value: [100], ifd: 'exif' },
    { tag: 0x920a, type: 5, value: [55, 1], ifd: 'exif' },
  ];
}

const FULL: ExifRead = {
  found: true,
  valid: true,
  exif: {
    orientation: 6,
    make: 'SONY',
    model: 'ILCE-7M4',
    dateTimeOriginal: '2024:05:01 12:33:20',
    exposureTime: 1 / 125,
    fNumber: 1.8,
    iso: 100,
    focalLength: 55,
  },
};

/* ─────────────────────────────── 三态与容器 ─────────────────────────────── */

describe('readExif 的三态（X4 的显示前提）', () => {
  it('没有 EXIF 段 → found:false（"这台设备没写元数据"）', () => {
    expect(readExif(pngOf(new Uint8Array(0), 'before').slice(0, 0))).toEqual({ found: false });
    expect(readExif(pngExifLess())).toEqual({ found: false });
    expect(readExif(Uint8Array.from([1, 2, 3, 4, 5]))).toEqual({ found: false });
  });

  it('有段但读不动 → valid:false 并给出原因（不静默当成"没有"）', () => {
    const tiff = buildTiff(cameraEntries());
    const cut = jpegOf(tiff.slice(0, 12));
    const got = readExif(cut);
    expect(got).toEqual({
      found: true,
      valid: false,
      reason: 'IFD0 条目越界',
    });
  });

  it('段在但 TIFF 头不认识 → valid:false（区别于"没有 EXIF"）', () => {
    // 只有**容器说了"这里有 EXIF"**之后，字节序不认才是"读不动"；
    // 裸字节流里没有这层证据，只能报 found:false —— 不猜它是 TIFF。
    const tiff = Uint8Array.from(buildTiff(cameraEntries()));
    tiff[0] = 0x58;
    tiff[1] = 0x58;
    expect(readExif(jpegOf(tiff))).toEqual({
      found: true,
      valid: false,
      reason: 'TIFF 头不完整或字节序无法识别',
    });
    expect(readExif(tiff)).toEqual({ found: false });
  });
});

function pngExifLess(): Uint8Array {
  const chunk = (type: string, data: number[]): number[] => [
    0,
    0,
    0,
    data.length,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

describe('同一份 TIFF 在三种容器里读出来必须一模一样', () => {
  const tiff = buildTiff(cameraEntries());
  const cases: readonly [string, Uint8Array][] = [
    ['裸 TIFF（小端）', tiff],
    ['裸 TIFF（大端）', buildTiff(cameraEntries(), false)],
    ['JPEG APP1', jpegOf(tiff)],
    ['PNG eXIf（IDAT 之前）', pngOf(tiff, 'before')],
    ['PNG eXIf（IDAT 之后）', pngOf(tiff, 'after')],
    ['JPEG APP1（大端 TIFF）', jpegOf(buildTiff(cameraEntries(), false))],
  ];
  for (const [name, bytes] of cases) {
    it(name, () => {
      expect(JSON.parse(JSON.stringify(readExif(bytes)))).toEqual(
        JSON.parse(JSON.stringify(FULL)),
      );
    });
  }
});

/* ─────────────────────────── 白名单：该读的读、不该读的不碰 ─────────────────────────── */

describe('只读白名单 tag', () => {
  it('GPS / MakerNote / 缩略图指针一律忽略，且不会跟进去', () => {
    const tiff = buildTiff([
      // GPSInfo 指向另一个 IFD —— 解析器不得跟进（D12：忽略 ≠ 谎报，但不能被绕死）
      { tag: 0x8825, type: 4, value: [0], ifd: '0' },
      { tag: 0x927c, type: 7, value: [1, 2, 3, 4, 5, 6, 7, 8], ifd: 'exif' },
      { tag: 0x0201, type: 4, value: [999999], ifd: '0' }, // 缩略图数据偏移：越界也不崩
      { tag: 0x0112, type: 3, value: [8], ifd: '0' },
      { tag: 0x0110, type: 2, value: 'NX', ifd: '0' },
    ]);
    const got = readExif(tiff);
    expect(got).toEqual({
      found: true,
      valid: true,
      exif: { ...FULL.exif, orientation: 8, make: null, model: 'NX', dateTimeOriginal: null, exposureTime: null, fNumber: null, iso: null, focalLength: null },
    });
  });

  it('未知类型（如 UNDEFINED 的私有段）跳过，不影响其余字段', () => {
    const tiff = buildTiff([
      { tag: 0x0112, type: 3, value: [3], ifd: '0' },
      { tag: 0x9999, type: 13, value: [1, 2, 3], ifd: '0' },
      { tag: 0x0110, type: 2, value: 'OK', ifd: '0' },
    ]);
    const got = readExif(tiff);
    if (got.found && got.valid) {
      expect(got.exif.orientation).toBe(3);
      expect(got.exif.model).toBe('OK');
    } else throw new Error(JSON.stringify(got));
  });
});

/* ─────────────────────────── 坏数据不抛、不猜 ─────────────────────────── */

describe('恶意或残缺的字节', () => {
  it('朝向值不在 1..8 → orientation 为 null（不回落成 1 假装"正常"）', () => {
    for (const bad of [0, 9, 17, 65535]) {
      const got = readExif(buildTiff([{ tag: 0x0112, type: 3, value: [bad], ifd: '0' }]));
      expect(exifOrientationOf(got), `朝向 ${bad} 被当成了有效值`).toBeNull();
    }
    expect(exifOrientationOf(readExif(buildTiff(cameraEntries())))).toBe(6);
  });

  it('值偏移指向块外 → 该字段为 null，整体仍算读通', () => {
    const tiff = buildTiff(cameraEntries());
    // 把 IFD0 第一条（朝向）的"值/偏移"字段改成天文数字，模拟坏指针
    const evil = Uint8Array.from(tiff);
    new DataView(evil.buffer).setUint32(8 + 2 + 0 * 12 + 8, 0x7fffffff, true);
    const got = readExif(evil);
    expect(got.found && got.valid).toBe(true);
    if (got.found && got.valid) {
      expect(got.exif.orientation).toBeNull();
      expect(got.exif.model).toBe('ILCE-7M4'); // 其余字段照常
    }
  });

  it('SubIFD 指针回指 IFD0（环形）→ 不死循环', () => {
    const tiff = buildTiff(cameraEntries());
    const loop = Uint8Array.from(tiff);
    const dv = new DataView(loop.buffer);
    // IFD0 最后一条是自动补的 0x8769，把它指向 IFD0 自己
    const count = dv.getUint16(8, true);
    dv.setUint32(8 + 2 + count * 12 - 4, 8, true);
    const got = readExif(loop);
    if (got.found && got.valid) {
      expect(got.exif.orientation).toBe(6);
      expect(got.exif.model).toBe('ILCE-7M4');
    } else throw new Error(JSON.stringify(got));
  });

  it('RATIONAL 分母为 0 → 该字段 null（不产出 Infinity）', () => {
    const got = readExif(buildTiff([{ tag: 0x829d, type: 5, value: [18, 0], ifd: '0' }]));
    if (got.found && got.valid) expect(got.exif.fNumber).toBeNull();
    else throw new Error(JSON.stringify(got));
  });

  it('同样的坏字节反复解析结果确定（纯函数，无内部状态）', () => {
    const junk = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x49, 0x49]);
    const a = JSON.stringify(readExif(junk));
    const b = JSON.stringify(readExif(junk));
    expect(b).toBe(a);
  });
});

/* ─────────────────────────── 信息条文案（桌面与 CLI 共用） ─────────────────────────── */

describe('formatExif', () => {
  it('完整参数排成一行', () => {
    expect(formatExif(readExif(buildTiff(cameraEntries())))).toBe(
      'SONY ILCE-7M4 · f/1.8 · 1/125s · ISO100 · 55mm · 2024-05-01',
    );
  });

  it('长曝光写秒数', () => {
    const got = readExif(buildTiff([{ tag: 0x829a, type: 5, value: [4, 1], ifd: '0' }]));
    expect(formatExif(got)).toContain('4s');
  });

  it('三态各有各的话，不混为一谈', () => {
    expect(formatExif({ found: false })).toBe('无 EXIF');
    expect(formatExif({ found: true, valid: false, reason: 'EXIF 段过短，无法解析' })).toBe(
      'EXIF 无法解析（EXIF 段过短，无法解析）',
    );
    expect(formatExif(readExif(buildTiff([{ tag: 0x0112, type: 3, value: [1], ifd: '0' }])))).toBe(
      '有 EXIF，无拍摄参数',
    );
  });
});
