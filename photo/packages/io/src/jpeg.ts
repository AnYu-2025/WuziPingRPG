import type { ImageCodec, RasterImage } from './types.js';

/**
 * JPEG 解码 —— **baseline DCT（顺序扫描 + Huffman）**，零依赖、零平台 API。
 *
 * ── 为什么手写（决策 D15）────────────────────────────────────────────
 * "核心零依赖"和"三端同源"是同一件事的两面：一旦引入第三方解码库，
 * 同一份配方在 Node / 浏览器 / WebView 就可能解出不同的像素，而本项目的
 * 主断言形态恰恰是**逐字节一致**。所以解码器自己写 —— 一份码，三端跑。
 *
 * ── 支持范围（够用即止）──────────────────────────────────────────────
 *   ✅ SOF0（baseline）与 SOF1（extended sequential）：解码路径完全相同，
 *      差别只是允许更大的帧尺寸，故一并接。
 *   ✅ 8 位精度、1 分量（灰度）或 3 分量（YCbCr）。
 *   ✅ 采样因子 1..4 的任意组合（覆盖 4:4:4 / 4:2:2 / 4:2:0 / 4:1:1）。
 *   ✅ 多量化表、多 Huffman 表、重启标记（DRI / RSTn）、字节填充（0xFF00）、
 *      任意 APPn / COM 段（含 EXIF —— 本模块**跳过**它，朝向由内核 `metadata` 读，
 *      见 D12/D13：解码器不管朝向，只管像素）。
 *   ❌ 渐进式（SOF2）/ 无损 / 分层 / 算术编码（SOF9..15）/ 16 位量化表 /
 *      12 位精度 / 4 分量（CMYK）/ 多帧 / 多扫描
 *      → **明确拒绝并给人话原因**，不返回半张图。
 *
 * ── 为什么"拒绝"而不是"尽力解" ──────────────────────────────────────
 * 解错像素是**静默**的：图看着正常，参数一调就露馅。这与 `image-io.ts` 里
 * `REJECTED_MAGIC` 的立场一致 —— 宁可吵，不要错。
 * 同一立场还延伸到一个容易漏的角落：**Adobe APP14 的 colorTransform ≠ 1**
 * 时，三个分量其实是 R/G/B 而不是 YCbCr。硬按 YCbCr 常数解会得一张色相全错的图，
 * 而且看起来"挺正常"，所以这里读到 APP14 就把它问清楚（见 `rejectAdobeRgb`）。
 *
 * ── 写死的四个口径（跨端一致的前提）──────────────────────────────────
 * 这几处是"合法实现之间会有差异"的地方，因此把选择钉成一份代码而不是留给平台：
 *   1. **IDCT**：按 spec 公式做可分离变换（先横后纵），双精度累加，
 *      最后 `Math.round(sum/4 + 128)` 再截幅。不是 libjpeg 的整数快速路径 ——
 *      两者在有理数域上等价，浮点上最多差 1 级。
 *   2. **色度上采样**：中心对齐的线性插值（见 `buildAxis`）—— 色度样本坐在它
 *      覆盖的那块亮度样本的正中心。4:2:2 只插横、4:2:0 横竖都插。
 *      浏览器的 libjpeg-turbo 用 fancy upsampling，平滑区一致、色度锐边可差若干级
 *      —— 这正是跨解码器比对必须带**白名单容差**（`docs/P6E-PLAN.md` §3.4 C2）
 *      而不是逐字节的原因。
 *   3. **YCbCr→RGB**：JFIF / ITU-R T.801 全范围常数
 *      R=Y+1.402·Cr′，G=Y−0.344136·Cb′−0.714136·Cr′，B=Y+1.772·Cb′。
 *   4. **边缘 MCU**：要求码流里**真的有**那些重复块（规范要求；libjpeg 会复制补齐）。
 *      遇到"少写了边缘块"的宽松编码器，本解码器报"扫描提前结束"而不是补一张。
 *
 * ── 不做的事 ─────────────────────────────────────────────────────────
 * 编码。桌面端有浏览器编码器兜底；CLI 需要 JPEG 输出时再单列决策。
 */

/* ───────────────────────────── 常量表 ───────────────────────────── */

/** zigzag → 自然序索引（自然序里 `v*8+u`，u 为水平频率、v 为垂直频率。spec 表 K.1）。 */
const ZIGZAG: readonly number[] = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7,
  14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39,
  46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** SOF / DAC 标记 → 人话名字。只有标 ✅ 的两个进解码路径。 */
const SOF_NAMES: Readonly<Record<number, string>> = {
  0xc0: 'baseline（SOF0）',
  0xc1: 'extended sequential（SOF1）',
  0xc2: '渐进式（SOF2）',
  0xc3: '无损（SOF3）',
  0xc5: '差分层次（SOF5）',
  0xc6: '无损差分（SOF6）',
  0xc7: '差分无损层次（SOF7）',
  0xc8: '保留（JPEG-LS / CANL）',
  0xc9: '算术顺序（SOF9）',
  0xca: '算术渐进（SOF10）',
  0xcb: '算术无损（SOF11）',
  0xcc: '算术直流（DAC）',
  0xcd: '算术差分层次（SOF13）',
  0xce: '算术差分无损（SOF14）',
  0xcf: '算术差分无损层次（SOF15）',
};

/* ───────────────────────────── 错误文案 ───────────────────────────── */

function unsupported(what: string): never {
  throw new Error(
    `不支持的 JPEG：${what}。本解码器只做 baseline（8 位精度、顺序扫描、Huffman 熵编码）。` +
      `与其解出一张"看着正常、像素全错"的图，不如直接拒绝 —— 请另存为 baseline JPEG 或 PNG。`,
  );
}

function corrupt(what: string): never {
  throw new Error(`JPEG 已损坏或不完整：${what}。`);
}

function hex(marker: number): string {
  return `0x${marker.toString(16).padStart(2, '0')}`;
}

/* ─────────────────────────── 段扫描器 ─────────────────────────── */

/** 段读取游标。JPEG 的段长度字段一律大端，且**含自身这 2 字节**。 */
class Cursor {
  private pos: number;

  constructor(
    private readonly src: Uint8Array,
    private readonly view: DataView,
    start: number,
  ) {
    this.pos = start;
  }

  get offset(): number {
    return this.pos;
  }

  u8(): number {
    if (this.pos >= this.src.length) corrupt('读到文件尾，但还期待更多字节');
    return this.src[this.pos++];
  }

  u16(): number {
    if (this.pos + 2 > this.src.length) corrupt('长度字段越过文件尾');
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  take(n: number): Uint8Array {
    if (this.pos + n > this.src.length) corrupt(`期待 ${n} 字节段体，剩余不足`);
    const v = this.src.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  skip(n: number): void {
    if (this.pos + n > this.src.length) corrupt('段体越过文件尾');
    this.pos += n;
  }

  /** 读下一个标记（连续的 0xFF 填充被跳过，规范附则 B.2.1）。
   * @returns 标记低字节；到文件尾返回 null。
   */
  nextMarker(): number | null {
    while (this.pos < this.src.length && this.src[this.pos] !== 0xff) this.pos++;
    if (this.pos >= this.src.length) return null;
    this.pos++; // 吃掉 0xFF
    while (this.pos < this.src.length) {
      const b = this.src[this.pos++];
      if (b === 0xff) continue; // 填充字节
      if (b === 0x00) continue; // 假标记：段结构里出现时等同填充
      return b;
    }
    return null;
  }
}

/* ─────────────────────────── Huffman 码表 ─────────────────────────── */

/**
 * 规范码（canonical）码表：`maps[len]` 把该长度上的码字映射到符号值。
 *
 * 前缀码保证"逐位增长 + 命中即停"是对的：较短的码字不会是较长码字的前缀。
 */
interface HuffTable {
  readonly maps: readonly (Map<number, number> | undefined)[];
  readonly label: string;
}

/** 读一张 DHT 表项（调用方已读过 Tc/Th 那个字节）。 */
function readHuffmanTable(cur: Cursor, end: number, label: string): HuffTable {
  const counts: number[] = [];
  let total = 0;
  for (let i = 0; i < 16; i++) {
    const c = cur.u8();
    counts.push(c);
    total += c;
  }
  // 16 位码长最多容 2^16 个码字，但符号只有 256 种；超出即表本身坏了。
  if (total > 256) corrupt(`Huffman 表 ${label} 声明了 ${total} 个符号`);
  if (cur.offset + total > end) corrupt(`Huffman 表 ${label} 的符号表越过段界`);
  const symbols = cur.take(total);

  const maps: (Map<number, number> | undefined)[] = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1];
    if (n > 0) {
      const m = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        m.set(code, symbols[k]);
        code++;
        k++;
      }
      maps[len] = m;
      // 该长度的码字用完了整个码空间，后面还有更长的码 → 前缀码被破坏。
      if (len < 16 && code >= 1 << len) corrupt(`Huffman 表 ${label} 在长度 ${len} 上过约束（over-subscribed）`);
    }
    code <<= 1;
  }
  return { maps, label };
}

/* ─────────────────────────── 熵解码位流 ─────────────────────────── */

/**
 * 熵编码段的位流。三件事必须在这里处理干净：
 *   - **字节填充**：数据里的 0xFF 后跟 0x00，读出来是 0xFF；
 *   - **真标记**：0xFF 后跟非零（含 RSTn / EOI）意味着熵数据到此为止 ——
 *     位流把它记在 `marker` 上并停止喂字节，由 MCU 循环决定是重启还是收尾；
 *   - **半字节对齐**：标记只可能出现在字节边界上，所以取标记前要把填充位丢掉。
 */
class BitStream {
  private cache = 0;
  private cnt = 0;
  /** 提前看到的真标记（不含 0xFF00 填充）。 */
  private marker: number | null = null;

  constructor(
    private readonly src: Uint8Array,
    private pos: number,
  ) {}

  private nextByte(): number | null {
    if (this.pos >= this.src.length) return null;
    const b = this.src[this.pos++];
    if (b !== 0xff) return b;
    if (this.pos >= this.src.length) return null; // 尾部填充
    const n = this.src[this.pos];
    if (n === 0x00) {
      this.pos++;
      return 0xff;
    }
    this.marker = n; // 标记留在原地，交给 takeMarker()
    return null;
  }

  /** 取一位；熵数据结束返回 null。 */
  private bit(): number | null {
    if (this.cnt === 0) {
      const b = this.nextByte();
      if (b === null) return null;
      this.cache = b;
      this.cnt = 8;
    }
    this.cnt--;
    return (this.cache >> this.cnt) & 1;
  }

  /**
   * 丢掉半个字节的填充，取回紧随熵数据的那个标记（spec B.2.3：标记必须在字节边界上）。
   *
   * 只有两处调用：重启间隔到点（期待 RSTn）与整幅解完（期待 EOI）。
   */
  takeMarker(): number {
    this.cache = 0;
    this.cnt = 0;
    if (this.marker !== null) {
      const m = this.marker;
      this.marker = null;
      this.pos++; // 位流只吃掉了 0xFF，这里吃掉标记的低字节
      return m;
    }
    let p = this.pos;
    while (p < this.src.length && this.src[p] === 0xff) p++;
    if (p === this.pos || p >= this.src.length) corrupt('熵数据结束处缺少标记（文件被截断？）');
    const m = this.src[p];
    this.pos = p + 1;
    return m;
  }

  /** 解码一个 Huffman 符号。 */
  symbol(table: HuffTable | undefined): number {
    if (table === undefined) corrupt('扫描引用了未定义的 Huffman 表');
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      const bit = this.bit();
      if (bit === null) corrupt(`码字在 ${table.label} 上读到一半就没数据了`);
      code = (code << 1) | bit;
      const m = table.maps[len];
      if (m !== undefined) {
        const v = m.get(code);
        if (v !== undefined) return v;
      }
    }
    corrupt('码字超过 16 位仍未命中（码表或数据有误）');
  }

  /** 连续取 n 位（n ≤ 16）。 */
  receive(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = this.bit();
      if (bit === null) corrupt('系数幅度位读到一半就没数据了');
      v = (v << 1) | bit;
    }
    return v;
  }
}

/** spec 附则 F.2.2.1：n 位无符号读值 → 有符号差值。 */
function extend(value: number, n: number): number {
  return value < 1 << (n - 1) ? value + (-1 << n) + 1 : value;
}

function isRst(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

/* ─────────────────────────── IDCT ─────────────────────────── */

/** `COS[x*8+u] = cos((2x+1)uπ/16)`。 */
const COS_TABLE = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return t;
})();

/** 归一因子：u=0 时 1/√2，其余 1。 */
const NORM = (() => {
  const t = new Float64Array(8).fill(1);
  t[0] = Math.SQRT1_2;
  return t;
})();

/**
 * 可分离浮点逆 DCT：`coef`（自然序 `v*8+u`，已反量化、未电平偏移）
 * → `out`（8×8 样本，已 +128 并截幅）。
 *
 * 先横后纵，最后统一乘 spec 的 1/4 —— 与直接按公式求和在有理数域上相同。
 */
function idctBlock(coef: Float64Array, tmp: Float64Array, out: Uint8ClampedArray): void {
  for (let v = 0; v < 8; v++) {
    const row = v * 8;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        const c = coef[row + u];
        if (c !== 0) sum += c * NORM[u] * COS_TABLE[x * 8 + u];
      }
      tmp[row + x] = sum;
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        const t = tmp[v * 8 + x];
        if (t !== 0) sum += t * NORM[v] * COS_TABLE[y * 8 + v];
      }
      out[y * 8 + x] = Math.round(sum * 0.25 + 128);
    }
  }
}

/* ─────────────────────────── 帧与分量 ─────────────────────────── */

interface Comp {
  readonly id: number;
  /** 水平 / 垂直采样因子（1..4）。 */
  readonly h: number;
  readonly v: number;
  readonly tq: number;
  /** 下面三项在 SOS 段里才定得下来。 */
  quant: Uint16Array | undefined;
  dc: HuffTable | undefined;
  ac: HuffTable | undefined;
  /** DC 差分预测器（重启时归零）。 */
  pred: number;
  /** 采样平面：MCU 网格展开后的原始样本（未上采样、未截色域）。 */
  plane: Uint8ClampedArray;
  planeW: number;
  planeH: number;
}

interface Jpeg {
  readonly quant: (Uint16Array | undefined)[];
  readonly huffDc: (HuffTable | undefined)[];
  readonly huffAc: (HuffTable | undefined)[];
  comps: Comp[];
  width: number;
  height: number;
  maxH: number;
  maxV: number;
  restartInterval: number;
}

function createJpeg(): Jpeg {
  return {
    quant: [],
    huffDc: [undefined, undefined, undefined, undefined],
    huffAc: [undefined, undefined, undefined, undefined],
    comps: [],
    width: 0,
    height: 0,
    maxH: 0,
    maxV: 0,
    restartInterval: 0,
  };
}

/** 把平面上的一块 8×8 样本写到 `(px, py)`。平面按 MCU 网格开的，因此永不越界。 */
function putBlock(
  plane: Uint8ClampedArray,
  planeW: number,
  px: number,
  py: number,
  block: Uint8ClampedArray,
): void {
  for (let y = 0; y < 8; y++) {
    const start = (py + y) * planeW + px;
    for (let x = 0; x < 8; x++) plane[start + x] = block[y * 8 + x];
  }
}

/* ─────────────────────────── 段解析 ─────────────────────────── */

function readDqt(cur: Cursor, end: number, jpeg: Jpeg): void {
  // 一个 DQT 段可以打包多张表
  while (cur.offset < end) {
    const pqTq = cur.u8();
    const precision = pqTq >> 4;
    const id = pqTq & 0x0f;
    if (precision !== 0) unsupported(`16 位量化表（表 ${id}）—— 属扩展 / 12 位规范，非 baseline`);
    const raw = cur.take(64);
    const table = new Uint16Array(64);
    for (let k = 0; k < 64; k++) table[ZIGZAG[k]] = raw[k];
    jpeg.quant[id] = table;
  }
  if (cur.offset !== end) corrupt('DQT 段长不是表长度的整数倍');
}

function readDht(cur: Cursor, end: number, jpeg: Jpeg): void {
  while (cur.offset < end) {
    const tcTh = cur.u8();
    const tableClass = tcTh >> 4;
    const id = tcTh & 0x0f;
    if (tableClass !== 0 && tableClass !== 1) unsupported(`Huffman 表类别 ${tableClass}（只有 0=DC / 1=AC）`);
    if (id > 3) unsupported(`Huffman 表号 ${id}（baseline 只允许 0..3）`);
    const label = `${tableClass === 0 ? 'DC' : 'AC'}#${id}`;
    const table = readHuffmanTable(cur, end, label);
    if (tableClass === 0) jpeg.huffDc[id] = table;
    else jpeg.huffAc[id] = table;
  }
}

function readSof(cur: Cursor, jpeg: Jpeg): void {
  if (jpeg.comps.length > 0) unsupported('帧头（SOF）出现两次');
  const precision = cur.u8();
  if (precision !== 8) unsupported(`${precision} 位精度 —— baseline 只有 8 位`);
  jpeg.height = cur.u16();
  jpeg.width = cur.u16();
  if (jpeg.width === 0 || jpeg.height === 0) corrupt(`帧尺寸为 ${jpeg.width}×${jpeg.height}`);
  const n = cur.u8();
  if (n !== 1 && n !== 3) unsupported(`${n} 分量（只有灰度 1 与 YCbCr 3；4 分量 CMYK 属 Adobe 扩展）`);
  const comps: Comp[] = [];
  for (let i = 0; i < n; i++) {
    const id = cur.u8();
    const hv = cur.u8();
    const h = hv >> 4;
    const v = hv & 0x0f;
    if (h < 1 || h > 4 || v < 1 || v > 4) unsupported(`分量 ${id} 的采样因子 ${h}×${v}（规范限 1..4）`);
    const tq = cur.u8();
    if (comps.some((c) => c.id === id)) corrupt(`帧头里分量编号 ${id} 重复`);
    comps.push({
      id,
      h,
      v,
      tq,
      quant: undefined,
      dc: undefined,
      ac: undefined,
      pred: 0,
      plane: EMPTY_PLANE,
      planeW: 0,
      planeH: 0,
    });
    jpeg.maxH = Math.max(jpeg.maxH, h);
    jpeg.maxV = Math.max(jpeg.maxV, v);
  }
  jpeg.comps = comps;
}

const EMPTY_PLANE = new Uint8ClampedArray(0);

/**
 * Adobe 的 APP14：`colorTransform` 说明三个分量到底是不是 YCbCr。
 * 不是的话（0 或 2 = RGB / YCCK）按 YCbCr 常数解会得到一张色相全错的图，
 * 而且"看着挺正常" —— 必须在解码前吵出来。
 */
function rejectAdobeRgb(body: Uint8Array): void {
  /* 'A' 'd' 'o' 'b' 'e' 0x00 ver flags0 flags1 flags2 transform
   * → transform 是第 11 个字节（下标 10）。 */
  if (body.length < 11) return;
  const isAdobe =
    body[0] === 0x41 && body[1] === 0x64 && body[2] === 0x6f && body[3] === 0x62 && body[4] === 0x65;
  if (!isAdobe) return;
  const transform = body[10];
  if (transform === 0 || transform === 2) {
    unsupported(`Adobe APP14 声明色彩变换为 ${transform}（分量是 R/G/B 或 YCCK，不是 YCbCr）`);
  }
}

/** 解析到 SOS 为止的段循环；返回时帧头与码表已就绪。 */
function parseSegments(cur: Cursor, src: Uint8Array, jpeg: Jpeg): void {
  for (;;) {
    const marker = cur.nextMarker();
    if (marker === null) corrupt('读到文件尾也没有扫描段（SOS）');

    /* 无长度字段的独立标记 */
    if (marker === 0xd9) corrupt('EOI 出现在任何像素数据之前');
    if (marker === 0xd8) unsupported('一个文件里串了第二幅图（多帧 / 内嵌缩略图）');
    if (marker === 0x01 || isRst(marker)) continue; // TEM / 扫描外的 RST：忽略

    const segLen = cur.u16();
    if (segLen < 2) corrupt(`标记 ${hex(marker)} 的段长 ${segLen} 非法`);
    const end = cur.offset + segLen - 2;
    if (end > src.length) corrupt(`标记 ${hex(marker)} 声明的段体越过文件尾`);

    switch (marker) {
      case 0xdb:
        readDqt(cur, end, jpeg);
        break;
      case 0xc4:
        readDht(cur, end, jpeg);
        break;
      case 0xc0:
      case 0xc1:
        readSof(cur, jpeg);
        break;
      case 0xdd:
        jpeg.restartInterval = cur.u16();
        break;
      case 0xda: {
        if (jpeg.comps.length === 0) corrupt('SOS 之前没有帧头（SOF）');
        decodeScan(cur, src, jpeg, end);
        return;
      }
      case 0xee:
        rejectAdobeRgb(cur.take(end - cur.offset));
        break;
      default:
        if ((marker >> 4) === 0xc) unsupported(SOF_NAMES[marker] ?? `帧内标记 ${hex(marker)}`);
        break; // APPn / COM 等：整段跳过
    }
    cur.skip(end - cur.offset);
  }
}

/* ─────────────────────────── 扫描解码 ─────────────────────────── */

/** 解一个 8×8 块：Huffman → 反量化 → IDCT → `out`（自然序 8×8 样本）。 */
function decodeBlock(bs: BitStream, comp: Comp, coef: Float64Array, tmp: Float64Array, out: Uint8ClampedArray): void {
  coef.fill(0);
  const quant = comp.quant;
  if (quant === undefined) corrupt(`分量 ${comp.id} 的量化表未定义`);

  const dcSize = bs.symbol(comp.dc);
  if (dcSize > 11) corrupt(`分量 ${comp.id} 的 DC 幅度位数 ${dcSize} 超出 8 位精度的取值范围`);
  if (dcSize > 0) comp.pred += extend(bs.receive(dcSize), dcSize);
  coef[0] = comp.pred * quant[0];

  let k = 1;
  for (;;) {
    const rs = bs.symbol(comp.ac);
    const s = rs & 0x0f;
    const r = rs >> 4;
    if (s === 0) {
      if (r === 15) {
        k += 16; // ZRL：连续 16 个零
        if (k >= 64) corrupt('ZRL 把系数指针推出了块');
        continue;
      }
      break; // EOB：剩下的系数按定义全为 0，而 coef 已经是 0
    }
    if (s > 10) corrupt(`AC 系数幅度位数 ${s} 超出 8 位精度的取值范围`);
    k += r;
    if (k >= 64) corrupt('AC 系数指针越过块尾');
    const z = ZIGZAG[k];
    coef[z] = extend(bs.receive(s), s) * quant[z];
    k++;
    /* 63 号位置被填上之后块就满了：规范此时**不写** EOB，
     * 再读一个符号就会吃掉下一块的 DC 码字。 */
    if (k > 63) break;
  }
  idctBlock(coef, tmp, out);
}

function decodeScan(cur: Cursor, src: Uint8Array, jpeg: Jpeg, segEnd: number): void {
  const n = cur.u8();
  if (n !== jpeg.comps.length) {
    unsupported(`扫描里的分量数 ${n} 与帧头的 ${jpeg.comps.length} 不相等（多扫描 / 渐进式编码）`);
  }
  for (let i = 0; i < n; i++) {
    const id = cur.u8();
    const tables = cur.u8();
    const comp = jpeg.comps.find((c) => c.id === id);
    if (comp === undefined) corrupt(`SOS 引用了帧头里没有的分量 ${id}`);
    comp.dc = jpeg.huffDc[tables >> 4];
    comp.ac = jpeg.huffAc[tables & 0x0f];
    comp.quant = jpeg.quant[comp.tq];
    if (comp.dc === undefined) corrupt(`分量 ${id} 的 DC Huffman 表 ${tables >> 4} 未定义`);
    if (comp.ac === undefined) corrupt(`分量 ${id} 的 AC Huffman 表 ${tables & 0x0f} 未定义`);
    if (comp.quant === undefined) corrupt(`分量 ${id} 的量化表 ${comp.tq} 未定义`);
  }
  const ss = cur.u8();
  const se = cur.u8();
  const ahal = cur.u8();
  if (cur.offset !== segEnd) corrupt(`SOS 段长 ${segEnd} 与分量数 ${n} 不匹配`);
  if (ss !== 0 || se !== 63 || ahal !== 0) {
    unsupported(`非 baseline 的扫描参数 Ss=${ss} Se=${se} Ah/Al=${hex(ahal)}（渐进式 / 分层）`);
  }

  const comps = jpeg.comps;
  const mcusX = Math.ceil(jpeg.width / (jpeg.maxH * 8));
  const mcusY = Math.ceil(jpeg.height / (jpeg.maxV * 8));
  for (const comp of comps) {
    comp.planeW = mcusX * comp.h * 8;
    comp.planeH = mcusY * comp.v * 8;
    comp.plane = new Uint8ClampedArray(comp.planeW * comp.planeH);
    comp.pred = 0;
  }

  const bs = new BitStream(src, cur.offset);
  const coef = new Float64Array(64);
  const tmp = new Float64Array(64);
  const block = new Uint8ClampedArray(64);

  /* 重启间隔：最后一个 MCU 之后**不再期待** RSTn —— 规范说的是"每个间隔结束时插一个"，
   * 末段之后紧跟的就是 EOI（仍有编码器会多写一个 RSTn，由下面的收尾吞掉）。 */
  const mcuTotal = mcusX * mcusY;
  let mcuDone = 0;
  let toGo = jpeg.restartInterval;
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (const comp of comps) {
        for (let by = 0; by < comp.v; by++) {
          for (let bx = 0; bx < comp.h; bx++) {
            decodeBlock(bs, comp, coef, tmp, block);
            putBlock(comp.plane, comp.planeW, (mx * comp.h + bx) * 8, (my * comp.v + by) * 8, block);
          }
        }
      }
      mcuDone++;
      if (toGo > 0 && --toGo === 0 && mcuDone < mcuTotal) {
        const m = bs.takeMarker();
        if (!isRst(m)) corrupt(`重启间隔到点，等到的却是标记 ${hex(m)} 而不是 RSTn`);
        for (const comp of comps) comp.pred = 0;
        toGo = jpeg.restartInterval;
      }
    }
  }

  /* 整幅解完：期待 EOI。
   * 有些编码器会在最后一个完整间隔之后再多写一个 RSTn —— 数据仍是对的，
   * 所以吞掉它们；除此之外任何"提前结束的标记"都说明扫描被截断，必须报错。 */
  let m = bs.takeMarker();
  while (isRst(m)) m = bs.takeMarker();
  if (m === 0xda) unsupported('多个扫描段（渐进式或多帧基线编码）—— 只支持一次扫描解完整幅');
  if (m !== 0xd9) corrupt(`扫描数据结束处是标记 ${hex(m)}，期待 EOI（扫描比帧头声明的行数短？）`);
}

/* ─────────────────────── 上采样与色彩转换 ─────────────────────── */

/**
 * 输出坐标 → 采样平面坐标的映射（预计算，逐像素只剩两次乘加）。
 *
 * **中心对齐**：`s = (x + 0.5) · ratio − 0.5`，其中 `ratio = 本分量采样因子 / 最大采样因子`。
 * 于是 ratio=1 时 s=x（原地取点，权重恒 0 即"不插值"），ratio=1/2 时两个亮度样本
 * 共用一个色度样本、色度样本正坐在它们中间 —— 与 spec 的 co-sited 语义一致。
 */
interface Axis {
  readonly i0: Int32Array;
  readonly i1: Int32Array;
  readonly w: Float64Array;
}

function buildAxis(dstLen: number, ratio: number, srcLen: number): Axis {
  const i0 = new Int32Array(dstLen);
  const i1 = new Int32Array(dstLen);
  const w = new Float64Array(dstLen);
  const last = srcLen - 1;
  for (let x = 0; x < dstLen; x++) {
    let s = (x + 0.5) * ratio - 0.5;
    if (s < 0) s = 0;
    if (s > last) s = last;
    const a = Math.floor(s);
    i0[x] = a;
    i1[x] = Math.min(a + 1, last);
    w[x] = s - a;
  }
  return { i0, i1, w };
}

/** 双线性取一个采样（平面已按 MCU 网格铺满，越界部分只会读到重复块，不会读到 undefined）。 */
function samplePlane(plane: Uint8ClampedArray, planeW: number, ax: Axis, ay: Axis, x: number, y: number): number {
  const wx = ax.w[x];
  const wy = ay.w[y];
  const xa = ax.i0[x];
  const xb = ax.i1[x];
  const r0 = ay.i0[y] * planeW;
  const r1 = ay.i1[y] * planeW;
  const top = plane[r0 + xa] + (plane[r0 + xb] - plane[r0 + xa]) * wx;
  const bot = plane[r1 + xa] + (plane[r1 + xb] - plane[r1 + xa]) * wx;
  return top + (bot - top) * wy;
}

function toRaster(jpeg: Jpeg): RasterImage {
  const { width, height, comps } = jpeg;
  const data = new Uint8ClampedArray(width * height * 4);
  const y = comps[0];

  if (comps.length === 1) {
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const g = y.plane[py * y.planeW + px];
        const o = (py * width + px) * 4;
        data[o] = g;
        data[o + 1] = g;
        data[o + 2] = g;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  }

  const cb = comps[1];
  const cr = comps[2];
  const axCb = buildAxis(width, cb.h / jpeg.maxH, cb.planeW);
  const ayCb = buildAxis(height, cb.v / jpeg.maxV, cb.planeH);
  const axCr = buildAxis(width, cr.h / jpeg.maxH, cr.planeW);
  const ayCr = buildAxis(height, cr.v / jpeg.maxV, cr.planeH);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const yy = y.plane[py * y.planeW + px];
      // 色度减去 128 的电平偏移后才进线性变换
      const b = samplePlane(cb.plane, cb.planeW, axCb, ayCb, px, py) - 128;
      const r = samplePlane(cr.plane, cr.planeW, axCr, ayCr, px, py) - 128;
      const o = (py * width + px) * 4;
      // JFIF 全范围逆变换（写死口径 3）；Uint8ClampedArray 负责截幅与取整
      data[o] = yy + 1.402 * r;
      data[o + 1] = yy - 0.344136 * b - 0.714136 * r;
      data[o + 2] = yy + 1.772 * b;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/* ─────────────────────────── 主入口 ─────────────────────────── */

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * 解码一张 baseline JPEG。
 * @throws 不支持的子集、损坏或截断时抛带人话原因的错误；绝不返回半张图。
 */
export function decodeJpeg(bytes: Uint8Array): RasterImage {
  if (bytes.length < 4) corrupt('字节数不足以构成 JPEG');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) corrupt('缺少 SOI 签名');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cur = new Cursor(bytes, view, 2); // 2 = 跳过 SOI
  const jpeg = createJpeg();
  parseSegments(cur, bytes, jpeg);
  return toRaster(jpeg);
}

export const jpegCodec: ImageCodec = {
  format: 'jpeg',
  extensions: ['.jpg', '.jpeg'],
  lossless: false,
  canDecode: isJpeg,
  decode: decodeJpeg,
  encode(): Uint8Array {
    throw new Error(
      '不支持 JPEG 编码：本轮只做了 baseline 解码。' +
        '桌面端请走浏览器编码器（canvas.toBlob）；CLI 需要 JPEG 输出时再单列决策。',
    );
  },
};
