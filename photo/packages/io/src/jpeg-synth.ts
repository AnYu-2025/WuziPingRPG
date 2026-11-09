/**
 * 测试夹具用的**最小 baseline JPEG 码流写入器**。
 *
 * ⚠️ 它不是编码器：不做 DCT、不选量化表、不优化码表、不接受像素。
 * 调用方直接给出每块的 64 个 DCT 系数，本模块只负责"把这些已知答案
 * 正确地写成符合 T.81 的字节流"（段结构、规范码、字节填充、重启标记）。
 *
 * 存在的唯一理由：仓库里**一个 JPEG 样本都没有**，而解码器的两类断言都需要
 * "我知道里面是什么"的码流 ——
 *   - 正确性：解出来的像素 must 等于独立写的朴素 IDCT 参考值；
 *   - 拒绝路径（C3）：渐进式 / 12 位 / 4 分量 / 多扫描 / 截断 / 缺 EOI，
 *     每一类都得**造得出来**才谈得上"明确拒绝"。
 *
 * 因此它只被 `jpeg.test.ts` 引用，不进 `index.ts`，运行时不加载。
 */

/* ─────────────────────────── 规范附录 K 的码表 ─────────────────────────── */

/** 亮度 DC（K.3.3.1）。 */
export const STD_LUMA_DC = {
  counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** 色度 DC（K.3.3.1）：长度 2 上三个码字，长度 3..11 各一个，共 12 个符号。 */
export const STD_CHROMA_DC = {
  counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** 亮度 AC（K.3.3.2）。 */
export const STD_LUMA_AC = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  symbols: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
    0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83,
    0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

/** 色度 AC（K.3.3.3）。 */
export const STD_CHROMA_AC = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  symbols: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x07, 0x13, 0x51, 0x61, 0x22, 0x71,
    0x81, 0x08, 0x14, 0x32, 0x91, 0xa1, 0xb1, 0x09, 0x23, 0x33, 0x15, 0x52, 0xc1, 0x62, 0xd1, 0xf0, 0x24, 0x34,
    0xe1, 0x25, 0x16, 0x0a, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3a, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a,
    0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
    0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2,
    0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2,
    0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

/* ─────────────────────────── 夹具规格 ─────────────────────────── */

export interface HuffSpec {
  /** 16 项：每个码长上的符号个数。 */
  readonly counts: readonly number[];
  readonly symbols: readonly number[];
}

export interface SynthComp {
  /** 分量编号（SOS 用它对上帧头）。 */
  readonly id: number;
  readonly h: number;
  readonly v: number;
  /** 量化表编号。 */
  readonly tq: number;
  /** 64 项量化步长，**zigzag 序**（与 DQT 段里的书写顺序一致）。 */
  readonly quant: readonly number[];
  /**
   * 每块的 64 个**量化级别**，**zigzag 序**（与量化表同一顺序，DC 在第 0 项）：
   * 块数必须是 `mcusX·mcusY·h·v`，边缘重复块要真实存在（解码器按规范要它们）。
   */
  readonly blocks: readonly (readonly number[])[];
  readonly dc?: HuffSpec;
  readonly ac?: HuffSpec;
  /** 码表编号：DC 用 `dcId`，AC 用 `acId`（同一类里 0..3）。 */
  readonly dcId?: number;
  readonly acId?: number;
}

export interface SynthSpec {
  readonly width: number;
  readonly height: number;
  readonly comps: readonly SynthComp[];
  /** 帧头标记，默认 0xc0（baseline）。传 0xc2 可造渐进式、0xc3 无损等拒绝用例。 */
  readonly sofMarker?: number;
  /** 默认 8。传 12 造"12 位精度"拒绝用例。 */
  readonly precision?: number;
  /** DQT 的精度位，默认 0（8 位）。传 1 造 16 位量化表。 */
  readonly quantPrecision?: number;
  /** 每多少个 MCU 一个重启间隔（写 DRI + RSTn）。 */
  readonly restartInterval?: number;
  /** Ss / Se / Ah+Al，默认 0 / 63 / 0（即 baseline）。 */
  readonly scanStart?: number;
  readonly scanEnd?: number;
  readonly successive?: number;
  /** 帧头之后再塞一个 SOF（造"SOF 出现两次"）。 */
  readonly doubleSof?: boolean;
  /** 熵数据末尾少写 N 个块（造"边缘块缺失 / 扫描被截断"）。 */
  readonly dropLastBlocks?: number;
  /** 不写 EOI。 */
  readonly dropEoi?: boolean;
  /** 把同一份扫描再写一遍（造"多扫描"）。 */
  readonly repeatScan?: boolean;
  /** 插入 Adobe APP14，`colorTransform` 取该值。 */
  readonly adobeTransform?: number;
  /** 截断到前 N 个字节。 */
  readonly truncateBytes?: number;
  /** 帧头声明的宽高（默认与 width/height 相同；传更小的值可让帧头与实际不符）。 */
  readonly headerWidth?: number;
  readonly headerHeight?: number;
}

/* ─────────────────────────── 字节 / 位写入 ─────────────────────────── */

class Bytes {
  readonly out: number[] = [];

  u8(v: number): this {
    this.out.push(v & 0xff);
    return this;
  }

  u16(v: number): this {
    this.out.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }

  push(...vs: readonly number[]): this {
    for (const v of vs) this.out.push(v & 0xff);
    return this;
  }

  /**
   * 迭代器版的 `push`。
   *
   * 不能写成 `push(...entropy)`：spread 走的是**实参列表**，几十万字节时
   * 直接 `Maximum call stack size exceeded` —— 夹具在一张 1200×800 的图上就爆。
   */
  pushAll(vs: Iterable<number>): this {
    for (const v of vs) this.out.push(v & 0xff);
    return this;
  }

  /** 标记 + 段长 + 体。 */
  segment(marker: number, body: Iterable<number>): this {
    const arr = [...body];
    this.out.push(0xff, marker, (arr.length + 2) >> 8, (arr.length + 2) & 0xff);
    this.pushAll(arr);
    return this;
  }

  /** 只有标记的独立段（SOI / EOI / RSTn / TEM）。 */
  standalone(marker: number): this {
    this.out.push(0xff, marker);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/**
 * 位写入器（MSB 优先）：按规范在字节尾部用 1 填充，并把数据里的 0xFF stuffing 成 0xFF 00。
 *
 * stuffing 规则是"字节值 0xFF 之后必须跟 0x00"，与字节从哪来无关，所以放在这里统一做；
 * 熵段之后要插的真标记（RSTn / EOI）由调用方直接写进数组，不经本类。
 */
class Bits {
  private cache = 0;
  private cnt = 0;

  constructor(private readonly out: number[]) {}

  write(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      this.cache = (this.cache << 1) | ((value >> i) & 1);
      this.cnt++;
      if (this.cnt === 8) {
        this.out.push(this.cache);
        if (this.cache === 0xff) this.out.push(0x00); // 字节填充
        this.cache = 0;
        this.cnt = 0;
      }
    }
  }

  /** 用 1 补齐当前字节（写标记前必须调用）。 */
  flush(): void {
    while (this.cnt !== 0) this.write(1, 1);
  }
}

/* ─────────────────────────── 规范码生成 ─────────────────────────── */

/** 与解码器同一套 spec 规则：按码长递增、同长内按给出顺序分配连续码字。 */
function canonicalCodes(spec: HuffSpec): Map<number, { code: number; len: number }> {
  const m = new Map<number, { code: number; len: number }>();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < spec.counts[len - 1]; i++) {
      m.set(spec.symbols[k], { code, len });
      k++;
      code++;
    }
    code <<= 1;
  }
  return m;
}

function category(abs: number): number {
  let n = 0;
  while (abs >> n) n++;
  return n;
}

/* ─────────────────────────── 主函数 ─────────────────────────── */

/** 写一个 8×8 块（zigzag 序的量化级别）到位流。 */
function writeBlock(
  bits: Bits,
  block: readonly number[],
  dcCodes: Map<number, { code: number; len: number }>,
  acCodes: Map<number, { code: number; len: number }>,
  pred: number[],
  compIndex: number,
): number {
  /* 数组里给的就是码流中逐项写出的**量化级别**：夹具既过量化的除法，也量化的乘法都不做
   * —— 步长只进 DQT 段，由解码器负责乘回去（`系数 = 级别 × 步长`）。 */
  const level = (k: number) => block[k];

  // DC：差分编码
  const dc = level(0);
  const diff = dc - pred[compIndex];
  const dcCat = diff === 0 ? 0 : category(Math.abs(diff));
  const dcEntry = dcCodes.get(dcCat);
  if (dcEntry === undefined) throw new Error(`夹具码表里没有 DC 类别 ${dcCat}`);
  bits.write(dcEntry.code, dcEntry.len);
  if (dcCat > 0) bits.write(diff < 0 ? diff + (1 << dcCat) - 1 : diff, dcCat);
  pred[compIndex] = dc;

  // AC：run/size + EOB / ZRL
  let run = 0;
  let lastNonZero = 0;
  for (let k = 1; k < 64; k++) {
    const value = level(k);
    if (value === 0) {
      run++;
      continue;
    }
    lastNonZero = k;
    while (run > 15) {
      const zrl = acCodes.get(0xf0);
      if (zrl === undefined) throw new Error('夹具码表里没有 ZRL(0xf0)');
      bits.write(zrl.code, zrl.len);
      run -= 16;
    }
    const size = category(Math.abs(value));
    const symbol = (run << 4) | size;
    const entry = acCodes.get(symbol);
    if (entry === undefined) throw new Error(`夹具码表里没有 AC 符号 0x${symbol.toString(16)}`);
    bits.write(entry.code, entry.len);
    bits.write(value < 0 ? value + (1 << size) - 1 : value, size);
    run = 0;
  }
  /* 规范 F.1.3.1：系数一路填到 63 号位时不写 EOB。 */
  if (lastNonZero !== 63) {
    const eob = acCodes.get(0x00);
    if (eob === undefined) throw new Error('夹具码表里没有 EOB(0x00)');
    bits.write(eob.code, eob.len);
  }
  return dc;
}

/**
 * 生成一张（可能是故意坏掉的）baseline JPEG 码流。
 * @throws 夹具规格自相矛盾（块数与 MCU 网格不符等）时抛错 —— 那是测试写错了，不是解码器的事。
 */
export function synthJpeg(spec: SynthSpec): Uint8Array {
  /* 采样因子先卡住：h=0 会让 MCU 网格算成 Infinity，夹具自己先转不完 —— 这类"帧头非法"
   * 的用例必须改走 poke()，解码器才有东西可拒。 */
  for (const c of spec.comps) {
    if (!Number.isInteger(c.h) || c.h < 1 || c.h > 4 || !Number.isInteger(c.v) || c.v < 1 || c.v > 4) {
      throw new Error(`夹具：分量 ${c.id} 的采样因子 ${c.h}×${c.v} 超出 1..4，写不出帧头`);
    }
  }
  const maxH = Math.max(...spec.comps.map((c) => c.h));
  const maxV = Math.max(...spec.comps.map((c) => c.v));
  const mcusX = Math.ceil(spec.width / (maxH * 8));
  const mcusY = Math.ceil(spec.height / (maxV * 8));
  for (const c of spec.comps) {
    const want = mcusX * mcusY * c.h * c.v;
    if (c.blocks.length < want) {
      throw new Error(`夹具：分量 ${c.id} 需要 ${want} 块（${mcusX}×${mcusY} MCU × ${c.h}×${c.v}），只给了 ${c.blocks.length}`);
    }
  }

  const body = new Bytes();
  body.standalone(0xd8); // SOI

  // APP0：JFIF 签名，让文件"像张照片"（解码器只是跳过它）
  body.segment(0xe0, [...strBytes('JFIF\0'), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

  if (spec.adobeTransform !== undefined) {
    body.segment(0xee, [...strBytes('Adobe'), 0x00, 0x64, 0x00, 0x00, 0x00, spec.adobeTransform & 0xff]);
  }

  // DQT：每个不同的 tq 编号写一张表（同编号的表按规范必须一致，夹具不去校验）
  const written = new Set<number>();
  for (const c of spec.comps) {
    if (written.has(c.tq)) continue;
    written.add(c.tq);
    if ((spec.quantPrecision ?? 0) === 1) {
      const arr: number[] = [(1 << 4) | c.tq];
      for (const v of c.quant) arr.push((v >> 8) & 0xff, v & 0xff);
      body.segment(0xdb, arr);
    } else {
      body.segment(0xdb, [c.tq, ...c.quant]);
    }
  }

  // DHT：收集用到的码表
  const tables = new Map<string, { cls: number; id: number; spec: HuffSpec }>();
  const addTable = (key: string, cls: number, id: number, spec: HuffSpec, compId: number): void => {
    const prev = tables.get(key);
    if (prev !== undefined && prev.spec !== spec) {
      throw new Error(`夹具：分量 ${compId} 想把另一张表挂到 ${cls === 0 ? 'DC' : 'AC'}#${id} 上，同号两张表写不出来`);
    }
    tables.set(key, { cls, id, spec });
  };
  for (const c of spec.comps) {
    /* 表号取默认 0：同一类里多个分量共用一张表是合法写法，但两张不同的表不能挂同一个号
     * （真文件里亮度用 0、色度用 1，见 `jpeg.test.ts` 的 color() 夹具）。 */
    addTable(`dc${c.dcId ?? 0}`, 0, c.dcId ?? 0, c.dc ?? STD_LUMA_DC, c.id);
    addTable(`ac${c.acId ?? 0}`, 1, c.acId ?? 0, c.ac ?? STD_LUMA_AC, c.id);
  }
  for (const t of tables.values()) {
    /* counts 之和必须等于 symbols 个数：抄错一张附录 K 的表会让整条码流错位，
     * 报错看起来像解码器的毛病，所以先在夹具这一侧卡死。 */
    const total = t.spec.counts.reduce((a, b) => a + b, 0);
    if (t.spec.counts.length !== 16 || total !== t.spec.symbols.length) {
      throw new Error(
        `夹具：${t.cls === 0 ? 'DC' : 'AC'}#${t.id} 的 counts 共 ${total} 个码字，symbols 却给了 ${t.spec.symbols.length} 个`,
      );
    }
    body.segment(0xc4, [(t.cls << 4) | t.id, ...t.spec.counts, ...t.spec.symbols]);
  }

  // SOF
  const sof = (): number[] => {
    const arr = [spec.precision ?? 8, (spec.headerHeight ?? spec.height) >> 8, (spec.headerHeight ?? spec.height) & 0xff];
    arr.push((spec.headerWidth ?? spec.width) >> 8, (spec.headerWidth ?? spec.width) & 0xff, spec.comps.length);
    for (const c of spec.comps) arr.push(c.id, (c.h << 4) | c.v, c.tq);
    return arr;
  };
  body.segment(spec.sofMarker ?? 0xc0, sof());
  if (spec.doubleSof) body.segment(spec.sofMarker ?? 0xc0, sof());

  if (spec.restartInterval !== undefined) body.segment(0xdd, [0, spec.restartInterval]);

  const writeScan = (): void => {
    const sos: number[] = [spec.comps.length];
    for (const c of spec.comps) sos.push(c.id, ((c.dcId ?? 0) << 4) | (c.acId ?? 0));
    sos.push(spec.scanStart ?? 0, spec.scanEnd ?? 63, spec.successive ?? 0);
    body.segment(0xda, sos);

    const entropy: number[] = [];
    const bits = new Bits(entropy);
    const pred = spec.comps.map(() => 0);
    const interval = spec.restartInterval ?? 0;
    let mcuNo = 0;
    let rst = 0;
    const blockCursor = spec.comps.map(() => 0);
    const total = mcusX * mcusY;
    const drop = spec.dropLastBlocks ?? 0;

    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        for (let ci = 0; ci < spec.comps.length; ci++) {
          const c = spec.comps[ci];
          const dcCodes = canonicalCodes(c.dc ?? STD_LUMA_DC);
          const acCodes = canonicalCodes(c.ac ?? STD_LUMA_AC);
          for (let by = 0; by < c.v; by++) {
            for (let bx = 0; bx < c.h; bx++) {
              const index = blockCursor[ci]++;
              const skipLast = drop > 0 && index >= c.blocks.length - drop;
              if (skipLast) continue; // 连码都不写：模拟"编码器偷懒少写边缘块"
              const block = c.blocks[index];
              if (block === undefined) throw new Error(`夹具：分量 ${c.id} 第 ${index} 块不存在`);
              writeBlock(bits, block, dcCodes, acCodes, pred, ci);
            }
          }
        }
        mcuNo++;
        if (interval > 0 && mcuNo % interval === 0 && mcuNo < total) {
          bits.flush();
          entropy.push(0xff, 0xd0 + rst);
          rst = (rst + 1) & 0x07;
          for (let i = 0; i < pred.length; i++) pred[i] = 0;
        }
      }
    }
    bits.flush();
    body.pushAll(entropy);
    if (spec.repeatScan) {
      body.segment(0xda, sos);
      body.pushAll(entropy);
    }
  };
  writeScan();

  if (!spec.dropEoi) body.standalone(0xd9); // EOI

  const all = body.bytes();
  if (spec.truncateBytes !== undefined) return all.subarray(0, spec.truncateBytes);
  return all;
}

/** 拼一个"标记 + 段长 + 体"的段：测试手工塞段（含故意坏掉的段）时用。 */
export function segment(marker: number, body: Iterable<number>): number[] {
  const arr = [...body];
  const len = arr.length + 2;
  if (len > 0xff_ff) throw new Error('夹具：段长超过 JPEG 的 16 位上限');
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...arr];
}

function strBytes(s: string): number[] {
  return [...s].map((ch) => ch.charCodeAt(0));
}

/**
 * 造一个系数块：键是 **zigzag 位置**（0 = DC），值是量化级别，其余为 0。
 * `zigzagBlock({ 0: 8, 1: -30 })` —— 第 1 项是自然序 (0,1) 的水平一次分量。
 */
export function zigzagBlock(entries: Readonly<Record<number, number>>): number[] {
  const out = new Array<number>(64).fill(0);
  for (const [k, v] of Object.entries(entries)) out[Number(k)] = v;
  return out;
}

/** 全零块（配合 DC-only 的用例）。 */
export const ZERO_BLOCK: readonly number[] = new Array<number>(64).fill(0);

/** 平灰度：一张 1 分量、每块只有 DC 的图，解出来应是常数灰。 */
export function flatGray(width: number, height: number, dc: number, h = 1, v = 1): SynthSpec {
  const mcusX = Math.ceil(width / (h * 8));
  const mcusY = Math.ceil(height / (v * 8));
  const one = zigzagBlock({ 0: dc });
  const blocks = new Array(mcusX * mcusY * h * v).fill(0).map(() => one);
  return {
    width,
    height,
    comps: [{ id: 1, h, v, tq: 0, quant: new Array(64).fill(1), blocks, dc: STD_LUMA_DC, ac: STD_LUMA_AC }],
  };
}

/**
 * 常数色的 4:2:0 彩图（真文件惯例：亮度用码表 0，色度用码表 1）。
 *
 * 三张平面的 DC 挑成能手算的三元组 —— Y 129 / Cb 200 / Cr 100 解出来
 * 每个像素都是 **(90, 124, 255, 255)**（B 通道截幅），逐像素推导见 `jpeg.test.ts` 的 J2。
 * 谁都需要"一张真会解出已知颜色的 JPEG"时用这个，别各自再抄一遍系数。
 */
export function flatColorJpeg(width: number, height: number): Uint8Array {
  const mcusX = Math.ceil(width / 16);
  const mcusY = Math.ceil(height / 16);
  const plane = (
    id: number,
    h: number,
    v: number,
    dc: number,
    count: number,
    dcSpec: HuffSpec,
    acSpec: HuffSpec,
  ): SynthComp => ({
    id,
    h,
    v,
    tq: 0,
    quant: new Array(64).fill(1),
    blocks: new Array(count).fill(0).map(() => zigzagBlock({ 0: dc })),
    dc: dcSpec,
    ac: acSpec,
    dcId: id === 1 ? 0 : 1,
    acId: id === 1 ? 0 : 1,
  });
  return synthJpeg({
    width,
    height,
    comps: [
      plane(1, 2, 2, 8, mcusX * mcusY * 4, STD_LUMA_DC, STD_LUMA_AC),
      plane(2, 1, 1, 576, mcusX * mcusY, STD_CHROMA_DC, STD_CHROMA_AC),
      plane(3, 1, 1, -224, mcusX * mcusY, STD_CHROMA_DC, STD_CHROMA_AC),
    ],
  });
}
