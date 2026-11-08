/**
 * 真实画布适配层 —— **唯一**允许出现 `Canvas` / `OffscreenCanvas` /
 * `createImageBitmap` / `convertToBlob` 的文件。
 *
 * ── 边界 ──────────────────────────────────────────────────────────
 * 上面的 `surface.ts` / `text-renderer.ts` / `image-io.ts` / `session.ts`
 * 全都只认那组结构化接口。真实实现收拢到这一个文件里，好处有两个：
 *
 *   1. **可验证**。业务逻辑因此能在 Node 里配假画布跑完（见 canvas-fakes.ts），
 *      P6C-PLAN 的验收 F / H 才能自动化。
 *   2. **可换**。将来换 node-canvas、换 WebGPU 后端，只动这一个文件。
 *
 * ── 为什么选 OffscreenCanvas ───────────────────────────────────────
 * 因为**编码**只有它有：`convertToBlob({ type, quality })` 是 OffscreenCanvas
 * 独有的，DOM `<canvas>` 没有。图片解码/编码都必须离开主线程式地做，
 * 用 OffscreenCanvas 省掉了"再建一个 <canvas> 只为导出"的折腾。
 */
/* 类型导入（理由同 `text-renderer.ts`）：本文件只用到 `ops.TextRenderer` 这个**类型**。
 * 保持为值导入会让本文件的产物里留下 `import { ops } from '@photo/core'`，
 * 而本文件正是**模块 Worker** 的平台层入口 —— Worker 里没有 import map，
 * 那条裸说明符会当场解析失败，整条 Worker 加载链路断在这里。 */
import type { ops, PixelBuffer } from '@photo/core';
import {
  createShellImageIo,
  type DecodedBitmapLike,
  type EncodableSurface,
  type EncodableSurfaceFactory,
  type ShellImageIo,
} from './image-io.js';
import { SurfacePool, type Canvas2DContextLike, type DrawableSurface, type ImageDataLike } from './surface.js';
import { createCanvasTextRenderer } from './text-renderer.js';

type Offscreen2D = OffscreenCanvasRenderingContext2D;

/**
 * 把 DOM 的 2D 上下文收窄成本项目的窄接口。
 *
 * `OffscreenCanvasRenderingContext2D` 是本接口的**超集**：唯一不兼容的是
 * `fillStyle` / `strokeStyle` 的联合类型（还允许 gradient / pattern），
 * 而本项目只往里写字符串。所以这里用一次显式断言对齐，而**不是**包一层
 * 转发类 —— 转发类每加一个成员就多一处可能写漏的地方，反而更危险。
 *
 * 注意断言的是**同一个对象**（不是 `Object.create` 或 Proxy）。这一点很要紧：
 * DOM 方法只接受"真正的宿主对象"作为 `this`，用 `Object.create(ctx)` 造出的
 * 视图调 `fillText` 会抛 "Illegal invocation"。保持同一对象，`this` 就是对的。
 *
 * `putImageData` / `getImageData` 刻意**不在**这个接口上：它们需要
 * 结构化像素 ↔ 原生 `ImageData` 的转换，那一步收在画布层（见 `putPixels`）。
 */
function asContext(ctx: Offscreen2D | null): Canvas2DContextLike {
  if (ctx === null) throw new Error('无法取得 OffscreenCanvas 的 2D 上下文。');
  return ctx as unknown as Canvas2DContextLike;
}

class OffscreenDrawableSurface implements DrawableSurface {
  private cached: Canvas2DContextLike | null = null;

  constructor(protected readonly canvas: OffscreenCanvas) {}

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  private raw(): Offscreen2D {
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('无法取得 OffscreenCanvas 的 2D 上下文。');
    return ctx;
  }

  ctx(): Canvas2DContextLike {
    /* 上下文句柄缓存起来：`getContext('2d')` 每次调用都要走一遍 Chromium 的
     * 上下文查找，在"每个文字元素一次绘制"的循环里不划算。 */
    if (this.cached === null) this.cached = asContext(this.raw());
    return this.cached;
  }

  putPixels(image: ImageDataLike, dx: number, dy: number): void {
    /* 零拷贝：`new ImageData(data, w, h)` 直接引用同一段 Buffer，不做复制。
     *
     * `as` 断言只是因为 lib 把 `ImageData` 的构造签名限制成了
     * `Uint8ClampedArray<ArrayBuffer>`（排除 SharedArrayBuffer），
     * 而内核的缓冲类型标注是更宽的 ArrayBufferLike。运行期不做任何转换 ——
     * 内核里每一份像素都由 `new Uint8ClampedArray(n)` 创建，底层必然是普通
     * ArrayBuffer（见 core/src/types.ts 的 createPixelBuffer）。 */
    this.raw().putImageData(
      new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
      dx,
      dy,
    );
  }

  readPixels(sx: number, sy: number, sw: number, sh: number): ImageDataLike {
    return this.raw().getImageData(sx, sy, sw, sh);
  }
}

class OffscreenEncodableSurface extends OffscreenDrawableSurface implements EncodableSurface {
  async toBlob(mime: string, quality: number): Promise<Uint8Array> {
    const blob = await this.canvas.convertToBlob({ type: mime, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }
}

export function createBrowserEncodableFactory(): EncodableSurfaceFactory {
  return {
    create: (width, height) => new OffscreenEncodableSurface(new OffscreenCanvas(width, height)),
  };
}

/**
 * 字节 → 位图。
 *
 * 格式判定已在 image-io 里做完，这里只管解。
 *
 * 注意**直接返回真实的 `ImageBitmap`**，不要包成 `{ width, height, close }`
 * 这样的结构化对象 —— `drawImage` 只接受宿主对象（ImageBitmap / Canvas / …），
 * 传普通对象会抛 "The provided value is not of type '(CSSImageValue or
 * HTMLCanvasElement or …)'"。
 *
 * 这与 `putImageData` 只认真 `ImageData` 是**同一个陷阱**：结构化接口让单元
 * 测试过得去，但真实宿主 API 拒绝。本项目里这两处都是 Electron 冒烟抓出来的
 * （见 docs/P6C-PLAN.md 的"冒烟发现了什么"）。
 *
 * `imageOrientation: 'none'` 是**必须**的，不是可选优化：Chromium 默认会按 EXIF
 * 自己把 JPEG 转正（`'from-image'`），而转正这件事归内核（导入时那一次索引置换）。
 * 两边各转一次 = 双重旋转 —— 朝 6 的照片会变成朝 3，而且**不报错**。
 * 解码必须交出**存储态**像素，让"转了几次"只有一个答案。
 *
 * 导出它只有一个用途：冒烟把 Chromium 的解码器当**独立参照**解一次 JPEG
 * （桌面的 JPEG 解码自序3 起归内核，应用路径不再经过这里）。
 * 平台 API 仍然只在这一个文件里出现 —— 那是 `ARCHITECTURE.md` §4 的边界。
 */
export async function decodeBitmap(bytes: Uint8Array, mime: string): Promise<DecodedBitmapLike> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return createImageBitmap(blob, { imageOrientation: 'none' });
}

/** 渲染侧全部平台能力的**单一组装点**。 */
export interface BrowserRenderKit {
  readonly imageIo: ShellImageIo;
  readonly textRenderer: ops.TextRenderer;
}

/**
 * 组装渲染侧能力。
 *
 * 文字栅格化与图片编解码**共用同一块画布**：两者都是"灌像素 → 画 → 取回"
 * 的短生命周期操作，且不会同时发生（导出时先渲染完文字阶段，才轮到编码）。
 * 共用之后，24MP 导出只有**一块**大画布驻留，而不是两块（那会是 ~192 MB）。
 *
 * 关于"两层池"：`createShellImageIo` 内部自己也会包一层 `SurfacePool`。
 * 这里把外层池当作 `surfaces` 工厂交给它，两层最终指向同一块画布 ——
 * 尺寸相同就复用，尺寸不同则重建。多一层只是多一次 Map 级的查表，
 * 换来的是"编解码层不必知道文字层也在用这块画布"。
 */
/** 组装渲染侧能力时可外部决定的那件事：JPEG 在哪个线程解。 */
export interface BrowserRenderKitOptions {
  readonly jpegDecoder?: (bytes: Uint8Array) => Promise<PixelBuffer>;
}

export function createBrowserRenderKit(
  options: BrowserRenderKitOptions = {},
): BrowserRenderKit {
  const shared = new SurfacePool<EncodableSurface>(createBrowserEncodableFactory());
  return {
    imageIo: createShellImageIo({
      surfaces: { create: (width, height) => shared.acquire(width, height) },
      decodeBitmap,
      jpegDecoder: options.jpegDecoder,
    }),
    textRenderer: createCanvasTextRenderer(shared),
  };
}

