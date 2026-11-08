/**
 * 测试替身：假画布 + 假编解码。
 *
 * ── 这层替身解决什么问题 ─────────────────────────────────────────
 * 外壳的业务逻辑（session / 文字栅格化 / 图片编解码）刻意只依赖
 * `surface.ts` 里那组结构化接口，而不依赖 DOM。于是它们能在 Node 里
 * 配一块**假画布**跑完整个链路 —— 这正是 P6C-PLAN 验收条件
 * F（导出与预览同源）与 H（缓存复用 > 0）"要求自动化"的前提。
 * 否则这两条就只能靠人去点窗口，而那正是本轮要消灭的
 * "几百个测试测不到一次真实点击"。
 *
 * ── 替身的诚实边界（读测试前请先读这段）──────────────────────────
 * 它**不模拟浏览器**，只做三件事：
 *   1. **像素搬运与混合**（putImageData / getImageData / drawImage / fill /
 *      fillText 的落点）—— 语义与 Canvas2D 一致，混合运算是**真在算**，
 *      因此可以作逐字节断言；
 *   2. **状态机**（save / restore / font / textAlign / globalAlpha）——
 *      状态栈是真的，因此"样式泄漏到下一次绘制"这类缺陷测得出来；
 *   3. **绘制调用记录**（`drawLog`）—— 供断言"用什么样式、画在哪个坐标"。
 *
 * 它**不**做字形栅格化：`fillText` 只按度量结果涂一块实心区域。
 * 因此测试只能断言"调用了 fillText 且样式与几何正确"，**不能**断言
 * "字形长得对" —— 后者由 Electron 冒烟测试里的真实 Canvas 覆盖。
 * 把这条写在最前面，是为了防止替身悄悄退化成"假装验证过"。
 */
import type { PixelBuffer } from '@photo/core';
import {
  createShellImageIo,
  type DecodedBitmapLike,
  type EncodableSurface,
  type EncodableSurfaceFactory,
  type ShellImageIo,
} from './image-io.js';
import type {
  Canvas2DContextLike,
  DrawableSurface,
  ImageDataLike,
  ImageSourceLike,
  SurfaceFactory,
  TextAlignLike,
  TextBaselineLike,
} from './surface.js';

/* ───────────────────────── 颜色解析 ───────────────────────── */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function channel(raw: string): number {
  const t = raw.trim();
  const v = t.endsWith('%') ? (parseFloat(t) / 100) * 255 : parseFloat(t);
  return Math.max(0, Math.min(255, Math.round(finite(v))));
}

function alphaOf(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const t = raw.trim();
  const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Math.max(0, Math.min(1, finite(v, 1)));
}

/**
 * CSS 颜色 → RGBA。只覆盖本项目实际用到的写法（#rgb / #rrggbb / #rrggbbaa /
 * rgb() / rgba()）。解析不出来时返回不透明黑 —— 与浏览器"非法值被忽略"
 * 的行为不同，但**明显地错**好过静默透明（后者会让测试假绿）。
 */
export function parseColor(css: string): Rgba {
  const s = css.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const dup = (c: string): number => parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: finite(dup(hex[0]), 0),
        g: finite(dup(hex[1]), 0),
        b: finite(dup(hex[2]), 0),
        a: hex.length === 4 ? finite(dup(hex[3])) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const at = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      return {
        r: finite(at(0), 0),
        g: finite(at(2), 0),
        b: finite(at(4), 0),
        a: hex.length === 8 ? finite(at(6)) / 255 : 1,
      };
    }
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m !== null) {
    const parts = m[1].split(',');
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alphaOf(parts[3]) };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/* ───────────────────────── 绘制调用记录 ───────────────────────── */

export interface FillTextCall {
  readonly kind: 'fillText';
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly fontSize: number;
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly strokeWidth: number;
  readonly textAlign: TextAlignLike;
  readonly textBaseline: TextBaselineLike;
  readonly letterSpacing: number;
  readonly globalAlpha: number;
  /** 落点包围盒（由度量与对齐推导），供几何断言。 */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface StrokeTextCall {
  readonly kind: 'strokeText';
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

export interface FillPathCall {
  readonly kind: 'fill';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fillStyle: string;
  readonly rounded: boolean;
  readonly radius: number;
  readonly globalAlpha: number;
}

export type DrawCall = FillTextCall | StrokeTextCall | FillPathCall;

/* ───────────────────────── 假画布 ───────────────────────── */

interface FakeStyle {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: TextAlignLike;
  textBaseline: TextBaselineLike;
  letterSpacing: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
}

function defaultStyle(): FakeStyle {
  return {
    font: '10px sans-serif',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetY: 0,
  };
}

function numOfPx(raw: string): number {
  return finite(parseFloat(raw), 0);
}

/** 从 CSS font 简写里取字号。取不到时回落到 10px（与默认样式一致）。 */
function fontSizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m === null ? 10 : finite(parseFloat(m[1]), 10);
}

export interface FakeSurfaceOptions {
  /**
   * 是否提供 `roundRect`。设为 false 用来验证降级分支
   * （老实现没有该 API 时必须退化成直角矩形，而**不是**什么都不画）。
   */
  readonly roundRect?: boolean;
}

export class FakeCanvasContext implements Canvas2DContextLike {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: TextAlignLike;
  textBaseline: TextBaselineLike;
  letterSpacing: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;

  /** 圆角矩形 API：老实现下**刻意不存在**，用于验证降级。 */
  roundRect?: (x: number, y: number, w: number, h: number, radius: number) => void;

  private style: FakeStyle = defaultStyle();
  private readonly stack: FakeStyle[] = [];
  private path: { x: number; y: number; w: number; h: number; radius: number; rounded: boolean } | null =
    null;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly data: Uint8ClampedArray,
    private readonly log: DrawCall[],
    options: FakeSurfaceOptions,
  ) {
    const s = this.style;
    this.font = s.font;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.letterSpacing = s.letterSpacing;
    this.shadowColor = s.shadowColor;
    this.shadowBlur = s.shadowBlur;
    this.shadowOffsetY = s.shadowOffsetY;

    if (options.roundRect !== false) {
      this.roundRect = (x, y, w, h, radius): void => {
        this.path = { x, y, w, h, radius, rounded: true };
      };
    }
  }

  /* ── 状态栈：属性走 getter/setter，save/restore 是**深拷贝语义** ── */

  private sync(): void {
    const s = this.style;
    s.font = this.font;
    s.fillStyle = this.fillStyle;
    s.strokeStyle = this.strokeStyle;
    s.lineWidth = this.lineWidth;
    s.globalAlpha = this.globalAlpha;
    s.textAlign = this.textAlign;
    s.textBaseline = this.textBaseline;
    s.letterSpacing = this.letterSpacing;
    s.shadowColor = this.shadowColor;
    s.shadowBlur = this.shadowBlur;
    s.shadowOffsetY = this.shadowOffsetY;
  }

  private load(s: FakeStyle): void {
    this.font = s.font;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.letterSpacing = s.letterSpacing;
    this.shadowColor = s.shadowColor;
    this.shadowBlur = s.shadowBlur;
    this.shadowOffsetY = s.shadowOffsetY;
    this.style = s;
  }

  save(): void {
    this.sync();
    this.stack.push({ ...this.style });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s !== undefined) this.load(s);
  }

  /* ── 度量 ── */

  measureText(text: string): { readonly width: number } {
    const fs = fontSizeOf(this.font);
    /* 0.5em/字符 + 字距 —— 与真实字体无关，只要**稳定且随字号线性增长**，
     * 就足以驱动"盖章底框尺寸"这类几何断言。 */
    const spacing = numOfPx(this.letterSpacing);
    const width = text.length * fs * 0.5 + Math.max(0, text.length - 1) * spacing;
    return { width };
  }

  /* ── 路径 ── */

  beginPath(): void {
    this.path = null;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path = { x, y, w, h, radius: 0, rounded: false };
  }

  fill(): void {
    const p = this.path;
    if (p === null) return;
    this.sync();
    this.log.push({
      kind: 'fill',
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      fillStyle: this.fillStyle,
      rounded: p.rounded,
      radius: p.radius,
      globalAlpha: this.globalAlpha,
    });
    this.blend(p.x, p.y, p.w, p.h, parseColor(this.fillStyle), this.globalAlpha);
  }

  /* ── 文本：只涂一块实心区域，不做字形栅格化 ── */

  private textBox(text: string, x: number, y: number): { x: number; y: number; w: number; h: number } {
    const fs = fontSizeOf(this.font);
    const w = this.measureText(text).width;
    const align = this.textAlign === 'start' ? 'left' : this.textAlign === 'end' ? 'right' : this.textAlign;
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const top = this.textBaseline === 'middle' ? y - fs / 2 : y - fs * 0.8;
    return { x: left, y: top, w, h: fs };
  }

  fillText(text: string, x: number, y: number): void {
    this.sync();
    const box = this.textBox(text, x, y);
    this.log.push({
      kind: 'fillText',
      text,
      x,
      y,
      font: this.font,
      fontSize: fontSizeOf(this.font),
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      strokeWidth: this.lineWidth,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      letterSpacing: numOfPx(this.letterSpacing),
      globalAlpha: this.globalAlpha,
      box,
    });
    this.blend(box.x, box.y, box.w, box.h, parseColor(this.fillStyle), this.globalAlpha);
  }

  strokeText(text: string, x: number, y: number): void {
    this.sync();
    this.log.push({
      kind: 'strokeText',
      text,
      x,
      y,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
    });
    /* 不涂像素：真实渲染里描边会被随后的 fillText 覆盖大半，
     * 而替身无法表现"字形轮廓"。只记录调用，供断言"描边被正确配置"。 */
  }

  /* ── 位图铺设 ── */

  /* 注：像素的整块读写（putPixels / readPixels）在**画布**上，
   * 不在上下文上 —— 见 surface.ts 里那段说明。假画布照同一个边界实现，
   * 否则替身会掩盖"真实 Canvas 只认真 ImageData"这类平台差异。 */

  drawImage(source: ImageSourceLike, dx: number, dy: number, dw: number, dh: number): void {
    const src = source as Partial<FakeBitmap>;
    if (src.data === undefined || source.width <= 0 || source.height <= 0) {
      this.log.push({ kind: 'strokeText', text: '<drawImage:no-pixels>', x: dx, y: dy, strokeStyle: '', lineWidth: 0 });
      return;
    }
    const W = Math.max(1, Math.round(dw));
    const H = Math.max(1, Math.round(dh));
    for (let y = 0; y < H; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      const sy = Math.min(source.height - 1, Math.floor((y * source.height) / H));
      for (let x = 0; x < W; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const sx = Math.min(source.width - 1, Math.floor((x * source.width) / W));
        const si = (sy * source.width + sx) * 4;
        const di = (ty * this.width + tx) * 4;
        this.data[di] = src.data[si];
        this.data[di + 1] = src.data[si + 1];
        this.data[di + 2] = src.data[si + 2];
        this.data[di + 3] = src.data[si + 3];
      }
    }
  }

  /** source-over 混合到画布，乘上 globalAlpha。 */
  private blend(x: number, y: number, w: number, h: number, color: Rgba, alpha: number): void {
    const A = color.a * Math.max(0, Math.min(1, alpha));
    if (A <= 0) return;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const o = (py * this.width + px) * 4;
        const d = this.data;
        d[o] = d[o] * (1 - A) + color.r * A;
        d[o + 1] = d[o + 1] * (1 - A) + color.g * A;
        d[o + 2] = d[o + 2] * (1 - A) + color.b * A;
        d[o + 3] = d[o + 3] * (1 - A) + 255 * A;
      }
    }
  }
}

export class FakeSurface implements DrawableSurface {
  readonly data: Uint8ClampedArray;
  readonly drawLog: DrawCall[] = [];
  private readonly context: FakeCanvasContext;

  constructor(
    readonly width: number,
    readonly height: number,
    options: FakeSurfaceOptions = {},
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = new FakeCanvasContext(width, height, this.data, this.drawLog, options);
  }

  ctx(): Canvas2DContextLike {
    return this.context;
  }

  putPixels(image: ImageDataLike, dx: number, dy: number): void {
    const w = Math.min(image.width, this.width - dx);
    const h = Math.min(image.height, this.height - dy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * image.width + x) * 4;
        const di = ((dy + y) * this.width + (dx + x)) * 4;
        this.data[di] = image.data[si];
        this.data[di + 1] = image.data[si + 1];
        this.data[di + 2] = image.data[si + 2];
        this.data[di + 3] = image.data[si + 3];
      }
    }
  }

  readPixels(sx: number, sy: number, sw: number, sh: number): ImageDataLike {
    const w = Math.max(1, Math.round(sw));
    const h = Math.max(1, Math.round(sh));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx0 = sx + x;
        const sy0 = sy + y;
        if (sx0 < 0 || sy0 < 0 || sx0 >= this.width || sy0 >= this.height) continue;
        const si = (sy0 * this.width + sx0) * 4;
        const di = (y * w + x) * 4;
        out[di] = this.data[si];
        out[di + 1] = this.data[si + 1];
        out[di + 2] = this.data[si + 2];
        out[di + 3] = this.data[si + 3];
      }
    }
    return { width: w, height: h, data: out };
  }
}

/* ───────────────────────── 假编解码 ───────────────────────── */

/** 假容器格式：magic 'PFAK' + u32 w + u32 h + u32 quality×1000 + u8 mimeLen + mime + raw RGBA。 */
const FAKE_MAGIC = [0x50, 0x46, 0x41, 0x4b];

export interface FakeBitmap extends DecodedBitmapLike {
  readonly data: Uint8ClampedArray;
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export class FakeEncodableSurface extends FakeSurface implements EncodableSurface {
  constructor(width: number, height: number, options: FakeSurfaceOptions = {}) {
    super(width, height, options);
  }

  async toBlob(mime: string, quality: number): Promise<Uint8Array> {
    const mimeBytes = new TextEncoder().encode(mime);
    const header = 4 + 4 + 4 + 4 + 1 + mimeBytes.length;
    const out = new Uint8Array(header + this.data.length);
    out.set(FAKE_MAGIC, 0);
    const view = new DataView(out.buffer);
    writeU32(view, 4, this.width);
    writeU32(view, 8, this.height);
    writeU32(view, 12, Math.round(quality * 1000));
    out[16] = mimeBytes.length;
    out.set(mimeBytes, 17);
    out.set(this.data, header);
    return out;
  }
}

/** 解出假容器的元信息（供编解码测试断言 quality / mime 被正确传递）。 */
export function readFakeHeader(bytes: Uint8Array): {
  width: number;
  height: number;
  quality: number;
  mime: string;
} | null {
  if (bytes.length < 17) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== FAKE_MAGIC[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mimeLen = bytes[16];
  const mime = new TextDecoder().decode(bytes.subarray(17, 17 + mimeLen));
  return {
    width: view.getUint32(4, true),
    height: view.getUint32(8, true),
    quality: view.getUint32(12, true) / 1000,
    mime,
  };
}

export function decodeFake(bytes: Uint8Array): FakeBitmap {
  const header = readFakeHeader(bytes);
  if (header === null) throw new Error('不是本替身可解的假容器（magic 不匹配）。');
  const mimeLen = bytes[16];
  const data = new Uint8ClampedArray(bytes.subarray(17 + mimeLen));
  return { width: header.width, height: header.height, data };
}

export function createFakeSurfaceFactory(options: FakeSurfaceOptions = {}): SurfaceFactory<FakeSurface> {
  return { create: (w, h) => new FakeSurface(w, h, options) };
}

export function createFakeEncodableSurfaceFactory(
  options: FakeSurfaceOptions = {},
): EncodableSurfaceFactory {
  return { create: (w, h) => new FakeEncodableSurface(w, h, options) };
}

/**
 * 造工厂，同时**留下每一块被造出来的画布的句柄**。
 *
 * `SurfacePool` 刻意不暴露 `current`（那是实现细节），但测试需要拿到那块
 * 画布才能读它的 `drawLog`。与其为了测试在池子上开个后门，不如在这里记录。
 */
export interface RecordingFactory<S extends DrawableSurface> {
  readonly factory: SurfaceFactory<S>;
  readonly created: S[];
}

export function createRecordingSurfaceFactory(
  options: FakeSurfaceOptions = {},
): RecordingFactory<FakeSurface> {
  const created: FakeSurface[] = [];
  return {
    created,
    factory: {
      create: (w, h) => {
        const s = new FakeSurface(w, h, options);
        created.push(s);
        return s;
      },
    },
  };
}

export function createRecordingEncodableFactory(
  options: FakeSurfaceOptions = {},
): RecordingFactory<FakeEncodableSurface> {
  const created: FakeEncodableSurface[] = [];
  return {
    created,
    factory: {
      create: (w, h) => {
        const s = new FakeEncodableSurface(w, h, options);
        created.push(s);
        return s;
      },
    },
  };
}

/** 与真实外壳同构的图片编解码，只是底层换成假画布 + 假容器。 */
export function createFakeImageIo(): ShellImageIo {
  return createShellImageIo({
    surfaces: createFakeEncodableSurfaceFactory(),
    decodeBitmap: async (bytes) => decodeFake(bytes),
  });
}

export interface RecordingImageIo {
  readonly io: ShellImageIo;
  /** 平台解码器被调了几次、每次收到多少字节。JPEG 必须是**空**。 */
  readonly platformDecodes: number[];
  /** 外置解码器（桌面上就是渲染 Worker 那条路）被调了几次。 */
  readonly offThreadDecodes: number[];
}

/**
 * 同 `createFakeImageIo`，但把"有没有去问平台解码器"这件事记下来。
 *
 * 需要它是为了钉住一条容易悄悄退回去的边界：JPEG 归内核解，一次都不该
 * 落到 `createImageBitmap` 上。只看解出来的像素分不出"谁解的" ——
 * 像素一样就以为同源，其实可能只是巧合。
 *
 * 传入 `jpegDecoder` 时顺带钉第二条：序3.5 之后 JPEG 该交给外置解码器
 * （Worker），而**只有** JPEG 该交给它。
 */
export function createRecordingImageIo(jpegDecoder?: JpegDecoderLike): RecordingImageIo {
  const platformDecodes: number[] = [];
  const offThreadDecodes: number[] = [];
  const io = createShellImageIo({
    surfaces: createFakeEncodableSurfaceFactory(),
    decodeBitmap: async (bytes) => {
      platformDecodes.push(bytes.byteLength);
      return decodeFake(bytes);
    },
    jpegDecoder:
      jpegDecoder === undefined
        ? undefined
        : async (bytes) => {
            offThreadDecodes.push(bytes.byteLength);
            return jpegDecoder(bytes);
          },
  });
  return { io, platformDecodes, offThreadDecodes };
}

type JpegDecoderLike = (bytes: Uint8Array) => Promise<PixelBuffer>;

/* ───────────────────────── 素材构造 ───────────────────────── */

/** 单色缓冲（带不透明 alpha）。 */
export function solidBuffer(width: number, height: number, r: number, g: number, b: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/**
 * 带结构的图案缓冲。
 *
 * 刻意**不加**随机噪声：测试要能重复跑出同一结果。
 * 但也不能是纯色 —— 纯色会让旋转/暗角/颗粒的断言退化成"看不出差别"。
 */
export function patternBuffer(width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = (x * 255) / Math.max(1, width - 1);
      data[o + 1] = (y * 255) / Math.max(1, height - 1);
      data[o + 2] = ((x ^ y) & 0xff);
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}
