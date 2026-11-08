/**
 * 外壳侧的图片编解码 —— **解码按格式分两条路**，编码走平台原生能力。
 *
 *   · JPEG：调 `packages/io` 的内核解码器（同步）。**不问 `createImageBitmap`。**
 *     这样桌面与 CLI 对同一份字节解出同一份像素（P6E 的 X1），跨端差异
 *     全部收进内核，而内核正是逐字节断言的地盘。
 *   · PNG（以及将来的其它平台格式）：走浏览器 Canvas —— 内核没有 PNG 解码器，
 *     这条没有替代物。
 *   · 编码：PNG / JPEG 都走 `convertToBlob`（内核刻意不做 JPEG 编码）。
 *
 * ── 一个必须说清的架构事实：平台解码**进不了** io 的注册表 ────────────
 * `packages/io` 的 `ImageCodec` 是**同步**契约：
 *     decode(bytes): RasterImage
 *     encode(format, image, quality): Uint8Array
 * 这在 Node 侧完全够用（BMP/PPM 手写解析、PNG 走 `node:zlib` 都是同步的）。
 *
 * 但浏览器原生的解码/编码天生是**异步**的：
 *     createImageBitmap(blob) → Promise<ImageBitmap>
 *     offscreenCanvas.convertToBlob() → Promise<Blob>
 * 而同步契约装不下 Promise —— "注册进注册表"这条路在浏览器侧根本走不通，
 * 除非把 io 的接口改成异步（那是一次 io 语义变更，不在 P6-c 范围，
 * 也不该由壳来单方面决定）。
 *
 * 因此本模块**并列**于 io 的注册表，而不是塞进它：
 *   - io 的注册表继续服务"同步、零依赖"的格式（BMP / PPM / Node 的 PNG / JPEG 解码）；
 *   - 本模块服务"平台原生、异步"的能力（PNG 解码 / PNG 与 JPEG 编码）。
 * JPEG 这一格从第二条搬到第一条，是序3 的裁定：外壳调的是 io 导出的同一个函数，
 * 不是自己实现第二套解码 —— 壳里仍然一像素不算。
 *
 * > 异步那半条已记入 `docs/P6C-PLAN.md`。若将来要统一，正确做法是在 io 里加一个
 * > **异步编解码器端口**（`AsyncImageCodec`），由外壳注册 —— 而不是让壳
 * > 绕过注册表各干各的。**本轮不擅自改 io 的契约。**
 */
import type { PixelBuffer } from '@photo/core';
/* 绝对 URL 而非裸名 `@photo/io`：本文件在 **Worker 的模块图**里
 * （render-worker → shell-adapter → 这里），而 import map 只作用于文档 ——
 * 裸说明符会让 Worker 脚本在加载阶段直接失败，整条渲染链退回主线程。
 * 类型由 src/app-url.d.ts 的环境声明指回 @photo/io，不降级成 any。 */
import { decodeJpeg, isJpeg } from 'app://io/index.js';
import { SurfacePool, type DrawableSurface } from './surface.js';

/** 能导出字节的画布。这一层才允许出现 `convertToBlob` 之类的浏览器细节。 */
export interface EncodableSurface extends DrawableSurface {
  /** mime 形如 `image/png`；quality 为 0..1。 */
  toBlob(mime: string, quality: number): Promise<Uint8Array>;
}

export interface EncodableSurfaceFactory {
  create(width: number, height: number): EncodableSurface;
}

/** 解码出来的位图（浏览器 `ImageBitmap` 的最小结构）。 */
export interface DecodedBitmapLike {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

export interface ShellImageIoDeps {
  readonly surfaces: EncodableSurfaceFactory;
  /**
   * 字节 → 位图。浏览器实现见 `shell-adapter.ts`。
   *
   * **必须**带 `{ imageOrientation: 'none' }`：朝向归内核在导入时置换一次，
   * 平台层若自己也转就是双重旋转。
   */
  decodeBitmap(bytes: Uint8Array, mime: string): Promise<DecodedBitmapLike>;
  /**
   * JPEG 解码的**执行位置**。省略 = 在本线程直接解（内核那一份 `decodeJpeg`）。
   *
   * 桌面把它接到渲染 Worker 的解码入口（`worker-port.ts` 的 `decodeJpeg`），
   * 于是 24MP ≈ 2.9 s 的同步解码不再占住界面线程。**换的是线程，不是实现** ——
   * 两条路最终都调用 io 里同一个 `decodeJpeg`，所以 X1「桌面与 CLI 逐字节一致」
   * 与 Worker 起没起来无关，也与"降级后答案会变"无关。
   */
  jpegDecoder?: (bytes: Uint8Array) => Promise<PixelBuffer>;
}

export interface ShellImageIo {
  /** 解码成内核像素。`mime` 省略时按探测结果猜。 */
  decode(bytes: Uint8Array, mime?: string): Promise<PixelBuffer>;
  /** 编码内核像素。`format` 支持 `png` / `jpeg`。 */
  encode(pixels: PixelBuffer, format: ImageFormatName, quality?: number): Promise<Uint8Array>;
  /** 该外壳声称能处理的格式（供 UI 的 accept 与错误提示共用）。 */
  readonly formats: readonly ImageFormatName[];
}

export type ImageFormatName = 'png' | 'jpeg';

const MIME: Readonly<Record<ImageFormatName, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/** 外壳**声称**支持的格式。放在模块级，避免在方法里依赖 `this`。 */
const SUPPORTED: readonly ImageFormatName[] = ['png', 'jpeg'];

/**
 * 按格式取 mime。返回 `string | undefined` 而不是直接索引 `MIME` ——
 * 项目关掉了 `noUncheckedIndexedAccess`，直接索引拿到的类型是 `string`，
 * 于是 `mime === undefined` 这种合法校验会被 TS 判为"无重叠比较"（TS2367）。
 * 用一个显式返回 `string | undefined` 的函数把"可能没有"表达出来。
 */
function mimeFor(format: string): string | undefined {
  return (MIME as Readonly<Record<string, string | undefined>>)[format];
}

/** 明确的拒绝名单 —— 与 apps/cli 的 node-png 一样，宁可吵也不要静默解出错图。 */
const REJECTED_MAGIC: readonly { readonly name: string; readonly bytes: readonly number[] }[] = [
  /* 这些不是"没实现"，是**刻意不做**：多帧 / 矢量 / 位深超出 8 位的语义
   * 与内核的 PixelBuffer 不是一一对应，硬解会静默丢信息。 */
  { name: 'GIF（可能多帧）', bytes: [0x47, 0x49, 0x46] },
  { name: 'WebP', bytes: [0x52, 0x49, 0x46, 0x46] },
];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * 按 magic bytes 猜格式 —— **不看扩展名**（与 io 的 `detectFormat` 同一原则：
 * 扩展名是用户随手改的，magic 才是事实）。
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return MIME.png;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return MIME.jpeg;
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWith(bytes, [0x77, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/** 被刻意拒绝的格式（给出人话原因，而不是"不支持"两个字）。 */
export function rejectReason(bytes: Uint8Array): string | null {
  for (const item of REJECTED_MAGIC) {
    if (startsWith(bytes, item.bytes)) {
      return `${item.name} 尚未支持。请另存为 PNG 或 JPEG 后再导入。`;
    }
  }
  return null;
}

/** 校验 quality：0..100，非法则回落 90。 */
function normalizeQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 0.9;
  return Math.min(1, Math.max(0, quality / 100));
}

export function createShellImageIo(deps: ShellImageIoDeps): ShellImageIo {
  const pool = new SurfacePool<EncodableSurface>(deps.surfaces);

  return {
    formats: SUPPORTED,

    async decode(bytes: Uint8Array, mime?: string): Promise<PixelBuffer> {
      const rejected = rejectReason(bytes);
      if (rejected !== null) throw new Error(rejected);

      /* JPEG 交给**内核解码器**，一次都不问平台。
       *
       * 为什么：同一份字节必须在桌面与 CLI 解出同一份像素（P6E 的 X1）。
       * 只要桌面还让 `createImageBitmap` 解 JPEG，这件事就永远做不到 ——
       * 两个独立实现之间只有容差，没有逐字节。改成同源之后，跨端的差异
       * 全部落在内核里，而内核是逐字节断言的地盘。
       *
       * 代价照实记着，别藏在注释里：
       *   1. 内核只做 baseline，渐进式 / 算术 / 多帧 / CMYK 一律明确报错
       *      —— Chromium 本来能解的那部分，现在解不了了（错误信息会说是哪一种）；
       *   2. 解码是同步 JS，大图会占住调用线程（本机量级 24MP ≈ 2.9 s）。
       *      序3.5 把这一条挪走了：有 `jpegDecoder` 就交给它（桌面接的是渲染
       *      Worker），没有才就地解。仍然**没有**在壳里另写一套解码。
       * 按 magic 判定而不是按传进来的 mime —— 与下面的 `sniffImageMime` 同一原则。 */
      if (isJpeg(bytes)) return deps.jpegDecoder?.(bytes) ?? decodeJpeg(bytes);

      const resolved = mime ?? sniffImageMime(bytes) ?? '';
      if (resolved === '') {
        throw new Error('无法识别这张图的格式（magic bytes 不在已知列表内）。');
      }
      if (resolved !== MIME.png && resolved !== MIME.jpeg) {
        throw new Error(`桌面壳目前只解 PNG / JPEG，收到 ${resolved}。`);
      }

      const bitmap = await deps.decodeBitmap(bytes, resolved);
      try {
        const surface = pool.acquire(bitmap.width, bitmap.height);
        surface.ctx().drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        const image = surface.readPixels(0, 0, bitmap.width, bitmap.height);
        /* 拷贝一份交给内核：画布的下一次 acquire 会覆盖这块内存，
         * 不能把它的视图直接当像素缓冲交出去。 */
        return {
          width: image.width,
          height: image.height,
          data: new Uint8ClampedArray(image.data),
        };
      } finally {
        bitmap.close?.();
      }
    },

    async encode(
      pixels: PixelBuffer,
      format: ImageFormatName,
      quality = 90,
    ): Promise<Uint8Array> {
      const mime = mimeFor(format);
      if (mime === undefined) {
        throw new Error(`未知输出格式：${format}（可用：${SUPPORTED.join(' / ')}）。`);
      }
      /* 复用与解码同一块画布：这两件事不会重叠发生（导出的输入像素
       * 已经是一份独立缓冲），共用一块省一次分配。 */
      const surface = deps.surfaces.create(
        Math.max(1, Math.round(pixels.width)),
        Math.max(1, Math.round(pixels.height)),
      );
      surface.putPixels(
        { width: pixels.width, height: pixels.height, data: pixels.data },
        0,
        0,
      );
      return surface.toBlob(mime, normalizeQuality(quality));
    },
  };
}
