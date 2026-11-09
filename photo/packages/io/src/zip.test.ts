import { describe, expect, it } from 'vitest';
import { crc32, pushUniqueName, utf8Bytes, zipStore, type ZipEntry } from './zip.js';

/* ── 测试内的极简 ZIP 回读器 ─────────────────────────────────────────
 *
 * 刻意**不复用**任何生产代码来解析：如果读写共用同一段逻辑，那么"两边
 * 同时错"就会互相掩盖。这里按规范从 EOCD 倒推 central directory、
 * 再按相对偏移找 local header —— 与写手的推导路径**方向相反**，
 * 于是"偏移写错"这类 bug 一定会被抓到。
 */
interface ParsedEntry {
  readonly nameBytes: Uint8Array;
  readonly crc: number;
  readonly crcInLocal: number;
  readonly flags: number;
  readonly method: number;
  readonly data: Uint8Array;
  readonly madeBy: number;
  readonly needed: number;
}

function parse(bytes: Uint8Array): { entries: ParsedEntry[]; time: number; date: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  expect(view.getUint16(eocd + 4, true)).toBe(0); // 不分卷
  expect(view.getUint16(eocd + 20, true)).toBe(0); // 无注释

  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdStart = view.getUint32(eocd + 16, true);
  // central directory 必须**紧贴** EOCD，中间不能有缝
  expect(cdStart + cdSize).toBe(eocd);

  const entries: ParsedEntry[] = [];
  let at = cdStart;
  let time = 0;
  let date = 0;
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const madeBy = view.getUint16(at + 4, true);
    const needed = view.getUint16(at + 6, true);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    time = view.getUint16(at + 12, true);
    date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compSize = view.getUint32(at + 20, true);
    const rawSize = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const nameBytes = bytes.slice(at + 46, at + 46 + nameLen);

    // 从 central directory 给的位置回读 local header
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    expect(localNameLen).toBe(nameLen);
    expect(bytes.slice(localOffset + 30, localOffset + 30 + nameLen)).toEqual(nameBytes);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.slice(dataStart, dataStart + rawSize);

    // store 模式：压缩大小 == 原始大小
    expect(compSize).toBe(rawSize);
    expect(data.length).toBe(rawSize);

    entries.push({
      nameBytes,
      crc,
      crcInLocal: view.getUint32(localOffset + 14, true),
      flags,
      method,
      data,
      madeBy,
      needed,
    });

    at += 46 + nameLen + extraLen + commentLen;
  }
  expect(at).toBe(eocd);
  return { entries, time, date };
}

const bytesOf = (text: string): Uint8Array => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe('utf8Bytes', () => {
  it('按 RFC 3629 编码 1/2/3/4 字节序列', () => {
    expect(utf8Bytes('A')).toEqual(Uint8Array.from([0x41]));
    expect(utf8Bytes('é')).toEqual(Uint8Array.from([0xc3, 0xa9]));
    expect(utf8Bytes('中')).toEqual(Uint8Array.from([0xe4, 0xb8, 0xad]));
    // U+1F600 😀
    expect(utf8Bytes('\u{1f600}')).toEqual(Uint8Array.from([0xf0, 0x9f, 0x98, 0x80]));
  });

  it('ASCII 与逐字符编码等价', () => {
    expect(utf8Bytes('photo_1.png')).toEqual(bytesOf('photo_1.png'));
  });

  it('中英混排按字符边界切分', () => {
    // "照a片" → 照(e7 85 a7) a(61) 片(e7 89 87)
    expect(utf8Bytes('照a片')).toEqual(
      Uint8Array.from([0xe7, 0x85, 0xa7, 0x61, 0xe7, 0x89, 0x87]),
    );
  });
});

describe('crc32', () => {
  /* 这三个是 CRC-32/ISO-HDLC 的公开已知值 —— 不用自己的实现算出来再喂给自己，
   * 所以它们能真正证明多项式、初值、异或出口都没写反。 */
  it('已知向量："123456789" → 0xCBF43926', () => {
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
  });

  it('已知向量：空缓冲 → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('已知向量："a" → 0xE8B7BE43', () => {
    expect(crc32(bytesOf('a'))).toBe(0xe8b7be43);
  });

  it('种子可续算：分段累计 === 一次算完', () => {
    const whole = bytesOf('123456789');
    const seed = crc32(whole.subarray(0, 4));
    expect(crc32(whole.subarray(4), seed)).toBe(crc32(whole));
  });
});

describe('zipStore · 结构', () => {
  const entries: ZipEntry[] = [
    { name: 'a.png', bytes: Uint8Array.from([1, 2, 3]) },
    { name: '目录/中文 b.jpg', bytes: Uint8Array.from([9, 8, 7, 6, 5]) },
  ];

  it('回读能拿到与写入完全相同的名字与数据', () => {
    const zip = zipStore(entries);
    const { entries: parsed } = parse(zip);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].nameBytes).toEqual(utf8Bytes('a.png'));
    expect(parsed[1].nameBytes).toEqual(utf8Bytes('目录/中文 b.jpg'));
    expect(parsed[0].data).toEqual(Uint8Array.from([1, 2, 3]));
    expect(parsed[1].data).toEqual(Uint8Array.from([9, 8, 7, 6, 5]));
  });

  it('CRC 与 sizes 与真实数据一致', () => {
    const { entries: parsed } = parse(zipStore(entries));
    for (let i = 0; i < entries.length; i += 1) {
      expect(parsed[i].crc).toBe(crc32(entries[i].bytes));
      expect(parsed[i].crcInLocal).toBe(parsed[i].crc);
    }
  });

  it('store 模式：method=0，且置了 UTF-8 名字位', () => {
    const { entries: parsed } = parse(zipStore(entries));
    for (const entry of parsed) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry.madeBy).toBe(20);
      expect(entry.needed).toBe(20);
    }
  });

  it('总量恰好等于三段定长和（没有多余 padding）', () => {
    const zip = zipStore(entries);
    const nameBytes = entries.reduce((n, e) => n + utf8Bytes(e.name).length, 0);
    const dataBytes = entries.reduce((n, e) => n + e.bytes.length, 0);
    expect(zip.length).toBe(entries.length * (30 + 46) + nameBytes * 2 + dataBytes + 22);
  });

  it('空归档是合法的：只剩 22 字节 EOCD', () => {
    const zip = zipStore([]);
    expect(zip.length).toBe(22);
    const { entries: parsed } = parse(zip);
    expect(parsed).toHaveLength(0);
  });

  it('缺省时间戳固定为 1980-01-01（可复现）', () => {
    const { time, date } = parse(zipStore(entries));
    expect(time).toBe(0);
    expect(date).toBe((1 << 5) | 1);
  });

  it('同样输入两次打包逐字节相同', () => {
    expect(zipStore(entries)).toEqual(zipStore(entries));
  });

  it('传入 now 会写进 DOS 时间戳', () => {
    const when = new Date(2024, 4, 6, 13, 30, 20); // 2024-05-06 13:30:20 本地时间
    const { time, date } = parse(zipStore(entries, { now: when }));
    expect(date).toBe(((2024 - 1980) << 9) | (5 << 5) | 6);
    expect(time).toBe((13 << 11) | (30 << 5) | 10); // 秒数按 2 秒粒度
  });
});

describe('zipStore · 拒绝静默出错', () => {
  it('重名条目直接抛错（不静默覆盖）', () => {
    expect(() =>
      zipStore([
        { name: 'same.png', bytes: Uint8Array.from([1]) },
        { name: 'same.png', bytes: Uint8Array.from([2]) },
      ]),
    ).toThrow(/重名/);
  });

  it('反斜杠分隔符被拒绝（ZIP 规范只认正斜杠）', () => {
    expect(() => zipStore([{ name: 'a\\b.png', bytes: new Uint8Array(0) }])).toThrow(/正斜杠/);
  });

  it('零长度条目是合法的', () => {
    const { entries: parsed } = parse(zipStore([{ name: 'empty.bin', bytes: new Uint8Array(0) }]));
    expect(parsed[0].data.length).toBe(0);
    expect(parsed[0].crc).toBe(0);
  });
});

describe('pushUniqueName', () => {
  it('首次出现原样通过', () => {
    const used = new Set<string>();
    expect(pushUniqueName(used, 'a.png')).toBe('a.png');
  });

  it('重名按 -2/-3 递增并保留扩展名', () => {
    const used = new Set<string>();
    expect(pushUniqueName(used, 'a.png')).toBe('a.png');
    expect(pushUniqueName(used, 'a.png')).toBe('a-2.png');
    expect(pushUniqueName(used, 'a.png')).toBe('a-3.png');
  });

  it('无扩展名的名字也能去重', () => {
    const used = new Set<string>();
    expect(pushUniqueName(used, 'LICENSE')).toBe('LICENSE');
    expect(pushUniqueName(used, 'LICENSE')).toBe('LICENSE-2');
  });

  it('跳过已被占用的 -2 序号', () => {
    const used = new Set<string>(['a.png', 'a-2.png']);
    expect(pushUniqueName(used, 'a.png')).toBe('a-3.png');
  });

  it('切图分片命名不会互相撞车', () => {
    const used = new Set<string>();
    const names = ['p_r1c1.png', 'p_r1c2.png', 'p_r1c1.png', 'p_r1c2.png'].map((n) =>
      pushUniqueName(used, n),
    );
    expect(names).toEqual(['p_r1c1.png', 'p_r1c2.png', 'p_r1c1-2.png', 'p_r1c2-2.png']);
  });
});
