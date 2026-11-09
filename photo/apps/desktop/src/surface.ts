/**
 * 画布能力接口 —— **刻意结构化**，而不是直接依赖 DOM 的
 * `CanvasRenderingContext2D` / `OffscreenCanvas`。
 *
 * ── 为什么要多这一层 ─────────────────────────────────────────────
 * 两个理由，都不是洁癖：
 *
 *   1. **可验证**。P6C-PLAN 的验收条件里，"导出与预览同源"（F）和
 *      "改末端参数时缓存复用 > 0"（H）**要求自动化**。如果壳的业务逻辑直接
 *      抓 `document.createElement('canvas')`，那这两条就只能靠人点 ——
 *      而这正是本轮要消灭的"288 个测试测不到一次真实点击"。
 *      收窄成这组接口后，session / 文字栅格化 / 编解码都能在 Node 里
 *      配一块**假画布**跑完整链路（见 `canvas-fakes.ts`）。
 *
 *   2. **可换**。换到 OffscreenCanvas、node-canvas、甚至将来某个 GPU 后端时，
 *      只要满足这组接口，业务代码一行不动。
 *
 * 这里**只列真正用到的成员**。宽接口会让假实现变成负担，
 * 也会把真实依赖藏起来 —— 依赖越窄，"换壳"才越便宜。
 */

/** 与 DOM `ImageData` 结构一致（但不依赖它）。 */
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type TextAlignLike = 'left' | 'right' | 'center' | 'start' | 'end';
export type TextBaselineLike = 'alphabetic' | 'middle' | 'top' | 'bottom' | 'hanging' | 'ideographic';

/** 2D 上下文中我们确实用到的那部分。 */
export interface Canvas2DContextLike {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  textAlign: TextAlignLike;
  textBaseline: TextBaselineLike;
  /** CSS 长度字符串，如 `"2px"`。Chromium 99+ 支持。 */
  letterSpacing: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  /** 必须成对出现 —— 假实现也要照做，否则测试会掩盖状态泄漏。 */
  save(): void;
  restore(): void;
  measureText(text: string): { readonly width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  beginPath(): void;
  /** 圆角矩形；老实现没有时要能退化（见 text-renderer 的降级分支）。 */
  roundRect?(x: number, y: number, w: number, h: number, radius: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  /** 只用于把解码出来的位图铺到画布上。 */
  drawImage(source: ImageSourceLike, dx: number, dy: number, dw: number, dh: number): void;
}

/** 可被 drawImage 消费的东西（浏览器里是 ImageBitmap / Canvas 等）。 */
export interface ImageSourceLike {
  readonly width: number;
  readonly height: number;
}

export interface DrawableSurface {
  readonly width: number;
  readonly height: number;
  ctx(): Canvas2DContextLike;
  /**
   * 把一块 RGBA 像素灌到画布 (dx, dy) 处。
   *
   * ── 为什么这个放在**画布**上，而不是当成 ctx 的 `putImageData` ──────
   * 真实 Canvas 的 `putImageData` 只接受**真正的** `ImageData` 实例
   * （同一 realm 的构造函数产物）。而内核的像素是结构化对象
   * `{ width, height, data }` —— 结构相同不等于同一个类，Chromium 会当场抛
   * `parameter 1 is not of type 'ImageData'`。
   *
   * 所以"结构化像素 → 平台原生实例"这一步转换**必须**发生在平台侧。
   * 把它收在画布接口上，业务代码（文字栅格化、图片编解码）就完全不需要
   * 知道 `ImageData` 的存在，继续零平台依赖。
   *
   * （这一条是 Electron 冒烟测试抓出来的：假画布结构匹配，所以单元测试
   *   根本发现不了 —— 正是"逻辑对"与"真接在 Chromium 上能跑"的差别。）
   */
  putPixels(image: ImageDataLike, dx: number, dy: number): void;
  /** 从画布取回结构化像素（对应 getImageData；返回的对象调用方只读）。 */
  readPixels(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
}

export interface SurfaceFactory<S extends DrawableSurface = DrawableSurface> {
  /** 建一块**离屏**画布。像素运算全部在这里做，不碰 DOM。 */
  create(width: number, height: number): S;
}

/**
 * 复用一块与目标同尺寸的画布。
 *
 * 文字栅格化与编解码都是"灌进去 → 画 → 取回来"的短生命周期操作，
 * 每次新建画布在 24MP 下会带来可观的分配压力，因此这里做一层最小缓存。
 *
 * 泛型参数是为了让编解码层能拿到"能导出字节"的**具体**画布类型
 * （`EncodableSurface`）—— 抽象接口里不该出现 `convertToBlob`，
 * 那会把浏览器细节泄漏进纯逻辑层。
 */
export class SurfacePool<S extends DrawableSurface = DrawableSurface> {
  private current: S | null = null;

  constructor(private readonly factory: SurfaceFactory<S>) {}

  /** 取得一块恰好 `width × height` 的画布（尺寸变了才重建）。 */
  acquire(width: number, height: number): S {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.current === null || this.current.width !== w || this.current.height !== h) {
      this.current = this.factory.create(w, h);
    }
    return this.current;
  }
}
