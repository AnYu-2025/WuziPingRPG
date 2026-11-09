import { describe, expect, it } from 'vitest';

import { createRegistry, detectFormat } from './detect.js';
import { decodeJpeg, isJpeg, jpegCodec } from './jpeg.js';
import {
  STD_CHROMA_AC,
  STD_CHROMA_DC,
  flatGray,
  segment,
  synthJpeg,
  zigzagBlock,
  type SynthComp,
  type SynthSpec,
} from './jpeg-synth.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 解码器的正确性证据分三层，缺一层就有一层是空的：
 *   1. 本文件的**离线**断言：已知系数的码流 → 逐样本对上独立写的参考 IDCT；
 *   2. `jpeg-synth.ts` 造的**故意坏掉**的码流 → 每一类都得到明确拒绝（C3）；
 *   3. `apps/desktop/src/smoke.ts` 里与浏览器 `createImageBitmap` 的**跨解码器**
 *      比对（C2）—— 那才是"真照片"证据，只能在实机跑，见 §3.4。
 *
 * 参考实现刻意不复用解码器里的任何一张表、任何一个中间量：zigzag 由走对角线
 * 现算，IDCT 按定义做四重循环（解码器用的是可分离两段式）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 独立生成规范表 K.1 的 zigzag 顺序：按对角线走，偶数对角线自下而上、奇数自上而下。 */
function zigzagNatural(): number[] {
  const out: number[] = [];
  for (let s = 0; s <= 14; s++) {
    for (let t = 0; t <= s; t++) {
      const v = s % 2 === 0 ? s - t : t;
      const u = s - v;
      if (v < 8 && u < 8) out.push(v * 8 + u);
    }
  }
  return out;
}

const ZZ = zigzagNatural(); // zigzag 位置 → 自然序索引
const ZP = ZZ.map(() => 0);
ZZ.forEach((natural, pos) => {
  ZP[natural] = pos;
});

/** 按**自然序**给系数值，返回夹具要的 zigzag 序数组。`blk({ 0: 20, 3: -5 })`。 */
function blk(entries: Readonly<Record<number, number>>): number[] {
  const out = new Array<number>(64).fill(0);
  for (const [natural, value] of Object.entries(entries)) out[ZP[Number(natural)]] = value;
  return out;
}

/** 朴素二维参考 IDCT（按定义四重循环）→ 8×8 样本，已 +128 并四舍五入。 */
function refIdct(blockZigzag: readonly number[], quantZigzag: readonly number[]): number[] {
  const c = new Array<number>(64).fill(0);
  for (let k = 0; k < 64; k++) c[ZZ[k]] = blockZigzag[k] * quantZigzag[k];
  const out: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const nu = u === 0 ? Math.SQRT1_2 : 1;
          const nv = v === 0 ? Math.SQRT1_2 : 1;
          sum +=
            nu *
            nv *
            c[v * 8 + u] *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      out[y * 8 + x] = Math.round(sum / 4 + 128);
    }
  }
  return out;
}

const ONE = new Array(64).fill(1);
/** 步长沿 zigzag 变化，顺便验证反量化没串位。 */
function variedQuant(): number[] {
  return Array.from({ length: 64 }, (_, k) => 1 + (k % 5));
}

function gray(comp: Partial<SynthComp>): SynthComp {
  return { id: 1, h: 1, v: 1, tq: 0, quant: ONE, blocks: [], ...comp };
}

/** 三分量：按真文件的惯例，亮度用码表 0，色度用码表 1。 */
function color(y: SynthComp, cb: SynthComp, cr: SynthComp): SynthComp[] {
  return [
    { ...y, id: 1 },
    { ...cb, id: 2, dc: STD_CHROMA_DC, ac: STD_CHROMA_AC, dcId: 1, acId: 1 },
    { ...cr, id: 3, dc: STD_CHROMA_DC, ac: STD_CHROMA_AC, dcId: 1, acId: 1 },
  ];
}

function px(img: { width: number; data: Uint8ClampedArray }, x: number, y: number, ch: number): number {
  return img.data[(y * img.width + x) * 4 + ch];
}

function findMarker(bytes: Uint8Array, marker: number): number {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i + 2; // 指向段体首字节
  }
  throw new Error(`夹具里找不到标记 0x${marker.toString(16)}`);
}

/** 改写字节流里的某几个字节，造出"结构合法但语义坏了"的文件。 */
function poke(bytes: Uint8Array, at: number, ...values: number[]): Uint8Array {
  const out = Uint8Array.from(bytes);
  values.forEach((v, i) => {
    out[at + i] = v;
  });
  return out;
}

/* ─────────────────── J1 灰度：像素必须等于独立参考值 ─────────────────── */

describe('J1 灰度解码：与独立参考 IDCT 对齐', () => {
  it('只有 DC 的一块 → 常数灰，且 alpha 恒为 255', () => {
    const img = decodeJpeg(synthJpeg(flatGray(8, 8, 8)));
    expect([img.width, img.height]).toEqual([8, 8]);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(px(img, x, y, 0)).toBe(129); // DC 8 → 8/8 + 128
        expect(px(img, x, y, 1)).toBe(129);
        expect(px(img, x, y, 2)).toBe(129);
        expect(px(img, x, y, 3)).toBe(255);
      }
    }
  });

  it('多频系数 + 变化步长 → 逐样本与四重循环参考值相差 ≤ 1', () => {
    // 横向频率与纵向频率**不对称**，转置或串位都会被这套系数抓到
    const block = blk({ 0: 120, 8: -44, 16: 30, 32: -18, 6: 25, 57: -12, 63: 9 });
    const quant = variedQuant();
    const spec: SynthSpec = {
      width: 8,
      height: 8,
      comps: [gray({ quant, blocks: [block] })],
    };
    const img = decodeJpeg(synthJpeg(spec));
    const ref = refIdct(block, quant);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(Math.abs(px(img, x, y, 0) - ref[y * 8 + x])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('非方形网格（17×9）→ 每块按 MCU 顺序落位，边缘重复块被裁掉', () => {
    // maxH=maxV=1 ⇒ MCU 是 8×8：17×9 需要 3×2 = 6 块，其中第 3 列与第 2 行是重复块
    const dcs = [8, 40, 72, 104, 136, 168];
    const blocks = dcs.map((d) => zigzagBlock({ 0: d }));
    const spec: SynthSpec = { width: 17, height: 9, comps: [gray({ blocks })] };
    const img = decodeJpeg(synthJpeg(spec));
    expect([img.width, img.height]).toEqual([17, 9]);
    for (let my = 0; my < 2; my++) {
      for (let mx = 0; mx < 3; mx++) {
        const want = dcs[my * 3 + mx] / 8 + 128;
        if (mx === 2 || my === 1) continue; // 重复块落在裁掉的区域，不参与断言
        expect(px(img, mx * 8 + 3, my * 8 + 4, 0)).toBe(want);
      }
    }
    // 越界方向上仍取到有效样本（右侧被裁的两列来自第 3 块）
    expect(px(img, 16, 0, 0)).toBe(dcs[2] / 8 + 128);
  });

  it('块满 63 号位时不写 EOB —— 解码器不许因此吃下一块的 DC 码字', () => {
    const full = new Array(64).fill(0).map((_, k) => (k === 0 ? 4 : 1));
    const spec: SynthSpec = {
      width: 16,
      height: 8,
      comps: [gray({ blocks: [full, zigzagBlock({ 0: 8 })] })],
    };
    const img = decodeJpeg(synthJpeg(spec));
    // 第二块只有 DC：若第一块的 63 号位之后被多读了一个符号，这里必花
    expect(px(img, 8, 0, 0)).toBe(129);
    expect(px(img, 15, 7, 0)).toBe(129);
  });
});

/* ─────────────── J2 彩色：上采样口径与 YCbCr→RGB 常数 ─────────────── */

describe('J2 彩色解码：色度上采样与色彩变换', () => {
  /* 选一组能手算的数：Y 样本 129、Cb 样本 200、Cr 样本 100
   *   R = 129 + 1.402·(100−128) = 89.744 → 90
   *   G = 129 − 0.344136·72 − 0.714136·(−28) = 124.218 → 124
   *   B = 129 + 1.772·72 = 256.584 → 截幅 255      */
  const Y_DC = 8; // 8/8 + 128 = 129
  const CB_DC = 576; // 576/8 + 128 = 200
  const CR_DC = -224; // −224/8 + 128 = 100

  function flat420(width: number, height: number): Uint8Array {
    const mcusX = Math.ceil(width / 16);
    const mcusY = Math.ceil(height / 16);
    return synthJpeg({
      width,
      height,
      comps: color(
        gray({ h: 2, v: 2, blocks: new Array(mcusX * mcusY * 4).fill(zigzagBlock({ 0: Y_DC })) }),
        gray({ blocks: new Array(mcusX * mcusY).fill(zigzagBlock({ 0: CB_DC })) }),
        gray({ blocks: new Array(mcusX * mcusY).fill(zigzagBlock({ 0: CR_DC })) }),
      ),
    });
  }

  it('4:2:0 常数色度 → 全图像素等于手算 RGB（含截幅与 alpha）', () => {
    const img = decodeJpeg(flat420(20, 20));
    for (const [x, y] of [
      [0, 0],
      [7, 9],
      [16, 19],
      [19, 3],
    ]) {
      expect([px(img, x, y, 0), px(img, x, y, 1), px(img, x, y, 2), px(img, x, y, 3)]).toEqual([90, 124, 255, 255]);
    }
  });

  it('Cb 与 Cr 接反必须被这套断言抓到', () => {
    const img = decodeJpeg(flat420(16, 16));
    expect(px(img, 3, 3, 2)).toBe(255); // B 被 Cb 抬到截幅
    expect(px(img, 3, 3, 0)).toBeLessThan(129); // Cr 低于中性 ⇒ R 只降不升
  });

  it('4:2:2 水平插值 = 中心对齐线性，两端做 clamp', () => {
    // maxH=2, maxV=1；色度平面 16 样本：前 8 个来自块 0（值 A），后 8 个来自块 1（值 B）
    const A = 170;
    const B = 90;
    const img = decodeJpeg(
      synthJpeg({
        width: 32,
        height: 8,
        comps: color(
          gray({ h: 2, v: 1, blocks: new Array(4).fill(zigzagBlock({ 0: Y_DC })) }),
          gray({ blocks: [zigzagBlock({ 0: 8 * (A - 128) }), zigzagBlock({ 0: 8 * (B - 128) })] }),
          gray({ blocks: new Array(2).fill(zigzagBlock({ 0: CR_DC })) }),
        ),
      }),
    );
    /* B 通道混了 Cr，不能直接当 Cb 用：另造一张 Cr 为中性（128）的图来反解 Cb */
    const neutral = decodeJpeg(
      synthJpeg({
        width: 32,
        height: 8,
        comps: color(
          gray({ h: 2, v: 1, blocks: new Array(4).fill(zigzagBlock({ 0: 0 })) }),
          gray({ blocks: [zigzagBlock({ 0: 8 * (A - 128) }), zigzagBlock({ 0: 8 * (B - 128) })] }),
          gray({ blocks: new Array(2).fill(zigzagBlock({ 0: 0 })) }),
        ),
      }),
    );
    // B = Y + 1.772·(Cb−128)，Y = 128 ⇒ Cb = 128 + (B−128)/1.772
    const cbOf = (x: number) => 128 + (px(neutral, x, 0, 2) - 128) / 1.772;
    // 只有 x=15、16 两列跨在两个色度块之间
    expect(Math.abs(cbOf(0) - A)).toBeLessThan(1);
    expect(Math.abs(cbOf(14) - A)).toBeLessThan(1);
    expect(Math.abs(cbOf(15) - (0.75 * A + 0.25 * B))).toBeLessThan(1);
    expect(Math.abs(cbOf(16) - (0.25 * A + 0.75 * B))).toBeLessThan(1);
    expect(Math.abs(cbOf(17) - B)).toBeLessThan(1);
    expect(Math.abs(cbOf(31) - B)).toBeLessThan(1); // 右端 clamp：不许越到平面之外
    expect(img.width).toBe(32);
  });

  it('4:1:1 与 4:4:4 的采样因子组合都能解', () => {
    const mk = (yh: number, yv: number, ch: number, cv: number): SynthSpec => {
      const mcusX = Math.ceil(32 / (yh * 8));
      const mcusY = Math.ceil(16 / (yv * 8));
      return {
        width: 32,
        height: 16,
        comps: color(
          gray({
            h: yh,
            v: yv,
            blocks: new Array(mcusX * mcusY * yh * yv).fill(zigzagBlock({ 0: Y_DC })),
          }),
          gray({ h: ch, v: cv, blocks: new Array(mcusX * mcusY * ch * cv).fill(zigzagBlock({ 0: CB_DC })) }),
          gray({ h: ch, v: cv, blocks: new Array(mcusX * mcusY * ch * cv).fill(zigzagBlock({ 0: CR_DC })) }),
        ),
      };
    };
    for (const [yh, yv, ch, cv] of [
      [4, 1, 1, 1], // 4:1:1
      [1, 1, 1, 1], // 4:4:4
      [2, 1, 1, 1], // 4:2:2
      [2, 2, 1, 1], // 4:2:0
      [3, 2, 1, 1], // 非常见组合
    ]) {
      const img = decodeJpeg(synthJpeg(mk(yh, yv, ch, cv)));
      expect([img.width, img.height, px(img, 5, 5, 3)]).toEqual([32, 16, 255]);
    }
  });
});

/* ─────────────────────── J3 重启标记（DRI / RSTn） ─────────────────────── */

describe('J3 重启间隔：预测器必须归零，像素不许改变', () => {
  it('同一组块，写 DRI+RSTn 与不写的解码结果逐字节一致', () => {
    const dcs = [8, 40, 72, 104, 136, 168, 200, 232];
    const blocks = dcs.map((d) => zigzagBlock({ 0: d }));
    const spec: Omit<SynthSpec, 'restartInterval'> = { width: 64, height: 8, comps: [gray({ blocks })] };
    const plain = decodeJpeg(synthJpeg({ ...spec }));
    const restarted = decodeJpeg(synthJpeg({ ...spec, restartInterval: 1 }));
    expect(restarted.data).toEqual(plain.data);
    expect(restarted.data).not.toBe(plain.data);
    // 顺带证明"每块确实不同"：否则上面那条相等是空断言
    expect(px(plain, 0, 0, 0)).not.toBe(px(plain, 8, 0, 0));
  });

  it('重启位置上是别的标记 → 明确报错，不许当作没看见', () => {
    const bytes = synthJpeg({
      width: 32,
      height: 8,
      comps: [gray({ blocks: new Array(4).fill(zigzagBlock({ 0: 8 })) })],
      restartInterval: 1,
    });
    const first = findMarker(bytes, 0xd0);
    expect(poke(bytes, first - 1, 0xdb).length).toBe(bytes.length); // 只改一个字节
    expect(() => decodeJpeg(poke(bytes, first - 1, 0xdb))).toThrow(/RSTn|损坏/);
  });
});

/* ───────────────── C3：不支持的子集必须明确拒绝 ───────────────── */

describe('C3 拒绝路径：每一类都不许静默', () => {
  const dec = (spec: SynthSpec) => () => decodeJpeg(synthJpeg(spec));
  const one = (): SynthComp => gray({ blocks: [zigzagBlock({ 0: 8 })] });

  it('渐进式 / 无损 / 算术编码 → 按 SOF 名字拒绝', () => {
    expect(dec({ width: 8, height: 8, comps: [one()], sofMarker: 0xc2 })).toThrow(/渐进式/);
    expect(dec({ width: 8, height: 8, comps: [one()], sofMarker: 0xc3 })).toThrow(/无损/);
    expect(dec({ width: 8, height: 8, comps: [one()], sofMarker: 0xc9 })).toThrow(/算术/);
    expect(dec({ width: 8, height: 8, comps: [one()], sofMarker: 0xc5 })).toThrow(/差分层次/);
  });

  it('12 位精度 / 16 位量化表 → 拒绝', () => {
    expect(dec({ width: 8, height: 8, comps: [one()], precision: 12 })).toThrow(/12 位精度/);
    expect(dec({ width: 8, height: 8, comps: [one()], quantPrecision: 1 })).toThrow(/16 位量化表/);
  });

  it('分量数不是 1 或 3 → 拒绝（含 CMYK）', () => {
    const two: SynthComp[] = [{ ...one(), id: 1 }, { ...one(), id: 2 }];
    expect(dec({ width: 8, height: 8, comps: two })).toThrow(/2 分量/);
    const four: SynthComp[] = [1, 2, 3, 4].map((id) => ({ ...one(), id }));
    expect(dec({ width: 8, height: 8, comps: four })).toThrow(/4 分量/);
  });

  it('采样因子越界 / 帧头出现两次 / 第二个扫描 → 拒绝', () => {
    /* 采样因子只能在帧头字节上造假：夹具自己先卡住 1..4，写不出 0×0 的 MCU 网格。 */
    const sof = findMarker(synthJpeg({ width: 8, height: 8, comps: [one()] }), 0xc0);
    const bytes = synthJpeg({ width: 8, height: 8, comps: [one()] });
    expect(() => decodeJpeg(poke(bytes, sof + 9, 0x00))).toThrow(/采样因子 0×0/); // Hi<<4|Vi
    expect(() => decodeJpeg(poke(bytes, sof + 9, 0x55))).toThrow(/采样因子 5×5/);
    expect(dec({ width: 8, height: 8, comps: [one()], doubleSof: true })).toThrow(/SOF）出现两次/);
    expect(dec({ width: 8, height: 8, comps: [one()], repeatScan: true })).toThrow(/多个扫描段/);
  });

  it('非 baseline 的扫描参数 → 拒绝', () => {
    expect(dec({ width: 8, height: 8, comps: [one()], scanEnd: 5 })).toThrow(/Ss=0 Se=5/);
    expect(dec({ width: 8, height: 8, comps: [one()], scanStart: 1 })).toThrow(/Ss=1/);
    expect(dec({ width: 8, height: 8, comps: [one()], successive: 0x10 })).toThrow(/Ah\/Al/);
  });

  it('Adobe APP14 声明分量是 RGB / YCCK → 拒绝（否则色相全错还"看着正常"）', () => {
    expect(dec({ width: 8, height: 8, comps: [one()], adobeTransform: 0 })).toThrow(/Adobe APP14/);
    expect(dec({ width: 8, height: 8, comps: [one()], adobeTransform: 2 })).toThrow(/Adobe APP14/);
    // transform=1 是 YCbCr，必须照常解
    expect(decodeJpeg(synthJpeg({ width: 8, height: 8, comps: [one()], adobeTransform: 1 })).width).toBe(8);
  });

  it('缺 EOI / 少写边缘块 / 截断 → 报"损坏"，不返回半张图', () => {
    const spec = (extra: Partial<SynthSpec>): SynthSpec => ({ width: 16, height: 8, comps: [one()], ...extra });
    expect(() => decodeJpeg(synthJpeg(spec({ comps: [gray({ blocks: new Array(2).fill(zigzagBlock({ 0: 8 })) })], dropEoi: true }))))
      .toThrow(/截断|损坏/);
    expect(() =>
      decodeJpeg(
        synthJpeg({
          width: 16,
          height: 8,
          comps: [gray({ blocks: new Array(2).fill(zigzagBlock({ 0: 8 })) })],
          dropLastBlocks: 1,
        }),
      ),
    ).toThrow(/损坏|读到一半|RSTn/);
    const whole = synthJpeg(spec({ comps: [gray({ blocks: new Array(2).fill(zigzagBlock({ 0: 8 })) })] }));
    for (const cut of [4, 12, 20, 36]) {
      expect(() => decodeJpeg(whole.subarray(0, cut))).toThrow(/损坏|不支持/);
    }
  });

  it('帧头尺寸与实际扫描不符 → 报错而不是裁一张出来', () => {
    const blocks = new Array(4).fill(zigzagBlock({ 0: 8 }));
    const bytes = synthJpeg({ width: 32, height: 8, comps: [gray({ blocks })], headerWidth: 8 });
    expect(() => decodeJpeg(bytes)).toThrow(/损坏|EOI/);
    expect(() => decodeJpeg(synthJpeg({ width: 8, height: 8, comps: [gray({ blocks })], headerHeight: 0 }))).toThrow(
      /帧尺寸/,
    );
  });

  it('SOS 与帧头/码表对不上 → 拒绝', () => {
    const bytes = synthJpeg({ width: 8, height: 8, comps: [one()] });
    const sos = findMarker(bytes, 0xda);
    expect(() => decodeJpeg(poke(bytes, sos + 3, 0x07))).toThrow(/帧头里没有的分量/); // Csj 指向不存在的分量
    expect(() => decodeJpeg(poke(bytes, sos + 4, 0x23))).toThrow(/Huffman 表/); // 未定义的表号
    const sof = findMarker(bytes, 0xc0);
    expect(() => decodeJpeg(poke(bytes, sof + 10, 0x05))).toThrow(/量化表/); // Tq 指向未定义的表
  });

  it('过约束（over-subscribed）的 Huffman 表 → 拒绝', () => {
    // 长度 1 上放两个码字就已经用满码空间，却还声明有符号
    const body = [0x00, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x0b];
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc4, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
    expect(() => decodeJpeg(bytes)).toThrow(/过约束/);
  });

  it('Huffman 表类别不是 DC/AC → 拒绝', () => {
    const body = [0x20, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00];
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xc4, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
    expect(() => decodeJpeg(bytes)).toThrow(/表类别 2/);
  });

  it('SOF 之前没有扫描 / 帧头之后再无数据 → 拒绝', () => {
    expect(() => decodeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/EOI/);
    const sos = [0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
    expect(() => decodeJpeg(Uint8Array.from(sos))).toThrow(/SOS 之前没有帧头/);
  });

  it('第二个 SOI（串接多帧）→ 拒绝', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b]);
    expect(() => decodeJpeg(bytes)).toThrow(/第二幅图|不支持/);
  });

  it('APP1 里嵌整幅缩略图（EXIF 常见写法）→ 按段长跳过，不许把它当第二帧', () => {
    const thumb = synthJpeg({ width: 8, height: 8, comps: [gray({ blocks: [zigzagBlock({ 0: 40 })] })] });
    const main = synthJpeg({ width: 8, height: 8, comps: [one()] });
    const bytes = Uint8Array.from([
      0xff, 0xd8,
      ...segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...thumb]), // "Exif\0\0" + 一整套 JPEG 字节
      ...main.subarray(2),
    ]);
    // 缩略图 DC 40 → 灰 133；主图 DC 8 → 灰 129。取到 133 就说明解错图了
    const img = decodeJpeg(bytes);
    expect(px(img, 0, 0, 0)).toBe(129);
    expect(px(img, 7, 7, 0)).toBe(129);
  });

  it('EOI 之后还有垃圾字节 → 忽略，不影响解出整幅', () => {
    const bytes = synthJpeg({ width: 8, height: 8, comps: [one()] });
    const padded = Uint8Array.from([...bytes, 0x00, 0xff, 0xd8, 0x4a, 0x46, 0x49, 0xff, 0xd9]);
    const img = decodeJpeg(padded);
    expect([img.width, img.height, px(img, 3, 3, 0)]).toEqual([8, 8, 129]);
  });
});

/* ─────────────────────── J4 编解码器门面 ─────────────────────── */

describe('J4 门面：签名识别与编码能力', () => {
  const good = synthJpeg({ width: 8, height: 8, comps: [gray({ blocks: [zigzagBlock({ 0: 8 })] })] });

  it('isJpeg 认 magic bytes，不认扩展名', () => {
    expect(isJpeg(good)).toBe(true);
    expect(isJpeg(Uint8Array.from([0x42, 0x4d]))).toBe(false);
    expect(isJpeg(Uint8Array.from([0xff, 0xd8]))).toBe(false); // 两字节不算 JPEG
    expect(isJpeg(Uint8Array.from([0xff, 0xd8, 0x00]))).toBe(false); // SOI 后必须是 FF
  });

  it('jpegCodec 报的能力与实际一致：能解、不声称无损、不编码', () => {
    expect(jpegCodec.format).toBe('jpeg');
    expect(jpegCodec.lossless).toBe(false);
    expect(jpegCodec.canDecode(good)).toBe(true);
    expect(jpegCodec.decode(good).width).toBe(8);
    expect(() => jpegCodec.encode({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow(/不支持 JPEG 编码/);
  });

  it('jpeg 已进内置注册表：探测与解码走同一条路，编码仍明确拒绝', () => {
    expect(detectFormat(good)).toBe('jpeg');
    const reg = createRegistry();
    expect(reg.list().map((c) => c.format)).toEqual(['bmp', 'ppm', 'jpeg']);
    expect(reg.resolve(good)?.format).toBe('jpeg');
    expect(reg.decode(good).width).toBe(8);
    expect(() => reg.encode('jpeg', { width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow(
      /不支持 JPEG 编码/,
    );
  });
});
