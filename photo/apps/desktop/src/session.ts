/**
 * 编辑会话 —— 外壳侧**唯一**的状态持有者。
 *
 * 这一层是 P6-c 的关键设计：把"窗口里发生的事"与"窗口本身"分开。
 *
 *      Electron 主进程      窗口生命周期 + 文件对话框（不碰内核）
 *        └─ 渲染进程
 *             ├─ EditSession   ← 文档 + 缓存 + 预览/导出（本文件，零 DOM 依赖）
 *             └─ app.ts        ← 把 session 接到真实 canvas / 控件（DOM 接线）
 *
 * 好处不是"好看"，是**可验证**：P6C-PLAN 的验收条件 F（导出与预览同源）
 * 与 H（改末端参数时缓存复用 > 0）因此能在 Node 里作为单元测试跑，
 * 而不是靠人去点。这正是本轮要消灭的"逻辑层测试测不到一次真实点击"。
 *
 * 壳里不许出现像素算法（P6C-PLAN §3.4）：所有像素运算都经
 * `buildPlan` + `executePlan`。本文件里没有任何一处直接改像素。
 */
import {
  doc as docApi,
  color,
  geometry,
  metadata,
  ops,
  pipeline,
  pixels,
  presets,
  nlp,
  type PixelBuffer,
} from '@photo/core';
import { pushUniqueName, zipStore } from '@photo/io';
import type { ShellImageIo, ImageFormatName } from './image-io.js';

export interface SessionOptions {
  /** 平台图片编解码（PNG / JPEG）。 */
  readonly imageIo: ShellImageIo;
  /** 文字光栅化（水印 / 贴纸）。缺省用内核的 noop 兜底 —— 但那样文字不会显示。 */
  readonly textRenderer?: ops.TextRenderer;
  /** 预览目标。默认长边 1400、含水印。 */
  readonly previewTarget?: pipeline.RenderTarget;
  /**
   * 内存预算（字节），与导出准入 `gateExport` 同一个数；缺省用内核默认（2 GB）。
   *
   * 这里**不给**"快照能占多少"：留几张阶段快照 = 输出像素 × 4 随计划规模变，
   * 24MP 一张就是 96 MB，而预览长边 1400 一张才 5 MB —— 一个固定数两头都不对。
   * 推导在内核（`cacheBudgetFor`），端口只领预算。导出刻意**不落快照**
   * （`cache:false`，见 `renderExport`），所以这条只管预览与交互重绘。
   *
   * 该预算交给**端口**（缓存跟着执行体走，见 `port`）。
   */
  readonly memoryBudgetBytes?: number;
  /**
   * 渲染执行体 —— 会话里**全部**渲染的唯一出口。默认 `InlinePort`（当前线程）。
   *
   * ── 为什么这是个注入点 ────────────────────────────────────────────
   * 会话只认内核的 `PixelWorkerPort` 契约，它不知道对面是同线程还是真 Worker。
   * 于是"重负载离线程"（序 5 / A1）**不需要**在会话里加任何分支：外壳把真
   * Worker 端口注入进来即可；单测与无 Worker 环境继续用内联端口。
   *
   * 更关键的是：这样一来"同一份会话逻辑"在两种执行体下**完全同源** ——
   * 不会出现"壳里另开一条渲染回路"，于是"预览 == 导出同源"这条架构保证
   * 不会被"多了一个线程"悄悄打破。
   */
  readonly port?: pipeline.PixelWorkerPort;
}

/**
 * 一次"从字节导入"带来的**来源事实**：容器字节数 + 那一次 `readExif` 的结果。
 *
 * 为什么不直接传 `ExifRead`：信息条还要报"这张图多大"（X4 对齐 legacy 的
 * `名称 ｜ 尺寸 ｜ 大小 ｜ 拍摄参数`），而那个数只能从字节来。
 * 两者同源于同一份字节，因此捆成一个入参 —— 分开传会出现"字节数与 EXIF 不是一轮"的错配。
 */
export interface SourceFacts {
  readonly bytes: number;
  readonly read: metadata.ExifRead;
  /**
   * 容器字节的**内容指纹**（内核 `doc.sourceFingerprint`）。
   *
   * 工程文件靠它认出"这张文件被换过了"（D4）。省略 = 这份来源没读过字节，
   * 核对会退化为按字节数/尺寸比对，并如实标出退化的依据。
   */
  readonly fingerprint?: string;
  /** 宿主给的路径 / 句柄（进工程文件当来源记录，渲染不读）。 */
  readonly handle?: string;
}

export interface ImportResult {
  readonly name: string;
  /** **显示态**尺寸：EXIF 朝向已在导入那一次置换进像素（内核 D13）。 */
  readonly width: number;
  readonly height: number;
  /** 存储态尺寸；只在朝向改变宽高时与上面不同。无容器字节可考时为 null。 */
  readonly stored: SourceSize | null;
  /** 容器字节数；null = 直接喂像素的路径，没有字节可考。 */
  readonly bytes: number | null;
  /** EXIF 朝号码；null = 这份来源没有朝向信息（含"未读过容器字节"）。 */
  readonly orientation: metadata.ExifOrientation | null;
  /**
   * 拍摄参数一行（机型 / 光圈 / 快门 / ISO / 焦距 / 日期）。
   *
   * null = **没读过容器字节**（例如直接喂像素的测试与示例图），
   * 与"读过、但里面没有 EXIF"（`'无 EXIF'`）是两句不同的话 —— X4 要求
   * 界面能区分这两种，不许拿"无"糊过去。
   */
  readonly exifLine: string | null;
}

/** 打开工程时外壳交回的一张源图（容器字节 + 外壳知道的名字与路径）。 */
export interface ProjectSource {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mime?: string;
  readonly handle?: string;
}

/** `loadProject` 的成功结果。 */
export interface ProjectLoadResult {
  readonly sources: readonly ImportResult[];
  /** 生效的历史步数（= cursor）。 */
  readonly history: number;
  /** 操作栈总步数；`history < total` 表示还有重做分支。 */
  readonly total: number;
}

/** `projectNeeds` 的结果：打开之前就能说清工程要什么。 */
export interface ProjectNeeds {
  /** 源图清单，**顺序即用户挑选时必须用的顺序**（工程按下标配对，见内核 identity）。 */
  readonly sources: readonly { readonly name: string; readonly width: number; readonly height: number }[];
  readonly history: number;
  readonly total: number;
}

export interface PreviewResult {
  readonly pixels: PixelBuffer;
  readonly stats: pipeline.CacheStats;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * 导出体积预估结果。
 *
 * `bytes` 是**估算值**而非实测值（见 `estimateExportSize` 的方法注释）。
 * 只有 UI 展示用得上它，因此把"这是估算"写进类型，避免被当成真实编码结果。
 */
export interface ExportSizeEstimate {
  /** 预估字节数。 */
  readonly bytes: number;
  /** 导出成品宽（来自内核计划的 `outputSize`，是**准确值**）。 */
  readonly width: number;
  readonly height: number;
}

/** 批量导出里的一项成品（已编码）。 */
export interface BatchExportEntry {
  /** 归档内使用的文件名（已去重，扩展名与 `format` 一致）。 */
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** 批量导出结果：成品清单 + 打包好的 ZIP；不可行时给出**人话原因**。 */
export type BatchExportOutcome =
  | {
      readonly ok: true;
      readonly entries: readonly BatchExportEntry[];
      readonly zip: Uint8Array;
      /** 是否为切图分片（决定 UI 文案："9 张分片" vs "3 张成品"）。 */
      readonly sliced: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** 输出扩展名。JPEG 用 `.jpg` —— 用户认得的是它，不是 `.jpeg`。 */
const EXTENSION: Readonly<Record<ImageFormatName, string>> = { png: 'png', jpeg: 'jpg' };

/** 口语指令的执行结果（供 UI 诚实回显）。 */
export interface KouyuOutcome {
  /** 未识别出任何意图。 */
  readonly empty: boolean;
  /** 已落到文档 / 已执行（撤销）的意图中文标签。 */
  readonly applied: readonly string[];
  /** 已识别但当前壳未接 UI 的意图中文标签（裁剪 / 切页 / 导出 / 缩放 / …）。 */
  readonly pending: readonly string[];
}

/** 计划摘要 —— 用于断言"预览与导出同源"。 */
export interface PlanSummary {
  readonly kinds: readonly string[];
  readonly width: number;
  readonly height: number;
}

/**
 * 端口未回传缓存统计时的占位。
 *
 * 什么时候会发生：端口没有阶段缓存（例如某个只跑无状态执行器的端口）。
 * 显示"复用 0 / 重算 0"是**诚实**的 —— 它确实一个阶段都没复用；
 * 而伪造一个好看的复用数字才是欺骗。
 */
const NO_CACHE_STATS: pipeline.CacheStats = { reused: 0, computed: 0, hit: false, snapshots: 0 };

function requireSources(sources: readonly PixelBuffer[]): readonly PixelBuffer[] {
  if (sources.length === 0) throw new Error('尚未导入图片。');
  return sources;
}

/** 记下**置换前**的解码尺寸（`SourceMeta.stored`）。 */
type SourceSize = { readonly width: number; readonly height: number };

function sizeOf(buf: PixelBuffer): SourceSize {
  return { width: buf.width, height: buf.height };
}

/**
 * 「按住看原图」用的文档 —— 把**观感**归零，把**取景**原样留下。
 *
 * ── 为什么从这里改 baseline，而不是"重放一部分 op" ──────────────
 * 文档的生效状态 = `baseline` + `ops[0..cursor]`。`baseline` 不是空状态：
 * 它可以承载一整份已经压平的编辑（squash、读工程文件、"以当前效果为新起点"）。
 * 因此"挑出结构性 op 重放"这条思路是错的 —— 那段并未来得及进入 ops 的结构
 * 会被无声丢掉，用户按住看到的就不是自己的原图了。
 *
 * 正确做法：**先 `deriveEdit` 拿到当前真实生效状态**，只把它里面的观感字段
 * 换成中性值，再作为一个"没有 ops"的文档交回给 `buildPlan`。
 * 这样无论 editing 是从 ops 来的还是从 baseline 来的，都一视同仁。
 *
 * ── 哪些算"观感"，哪些算"取景" ──────────────────────────────────
 *   观感（归零）：调色 params、自动增强 levels、曲线、HSL 分色、水印、贴纸
 *   取景（保留）：几何 rotate/flip/straighten、裁切、拼图模式与边框
 *
 * 与 legacy `comparing` 唯一的差别：legacy **保留水印**（`if(comparing){ watermarkTo(); return; }`）
 * 却丢掉贴纸。这里两者一并归零 —— 「原图」就该是没动过手的样子，
 * 留一枚水印在原图上，反而让"水印到底加上了没有"变得看不清。
 */
function compareDocument(doc: docApi.PhotoDocument): docApi.PhotoDocument {
  const edit = docApi.deriveEdit(doc);
  const neutral = docApi.createEditState(edit.sources, edit.current);
  return {
    ...doc,
    baseline: {
      ...neutral,
      geometry: edit.geometry,
      crop: edit.crop,
      collage: edit.collage,
    },
    ops: [],
    cursor: 0,
  };
}

/**
 * 一张源图的**来源事实**（不是派生值，见 `EditSession.metas`）。
 *
 * `stored` 是**置换前**的解码尺寸 —— 有了它，信息条才能说清
 * "原图是 4000×3000 横的，按 EXIF 转正后是 3000×4000"，而不是让用户以为尺寸读错了。
 */
interface SourceMeta extends SourceFacts {
  readonly stored: SourceSize;
}

export class EditSession {
  private document_: docApi.PhotoDocument = docApi.createDocument();
  /** 源像素（多图：下标与文档 `sources` 引用一一对应）。**已是显示态**（朝向已置换）。 */
  private sources: PixelBuffer[] = [];
  private names: string[] = [];
  /**
   * 来源元数据，下标与 `sources` 严格对齐；`null` = **没有容器字节可考**
   * （直接喂像素的路径：测试、示例图）。
   *
   * 这里存的是"事实"（解码时的尺寸 + 那一次 `readExif` 的结果），不是派生值。
   * 派生（朝向码、参数一行）在 `described` 里现算，于是不会出现两份真相。
   */
  private metas: (SourceMeta | null)[] = [];
  /**
   * 渲染执行体。会话**不持有**阶段缓存 —— 缓存跟着执行体走。
   *
   * 这不是形式主义：端口可能是远程的（真 Worker），缓存若留在本线程，
   * 每帧都得把快照跨线程搬一遍，传输开销会把缓存省下的全部吃掉。
   */
  private readonly port: pipeline.PixelWorkerPort;
  /** 任务号 —— 端口用它把结果与本任务对上（完成顺序不保证）。 */
  private nextJobId = 1;
  private readonly previewTarget: pipeline.RenderTarget;
  private readonly imageIo: ShellImageIo;
  private readonly textRenderer: ops.TextRenderer | undefined;
  /** 导出长边上限（0 = 原尺寸）。UI 通过 `setExportMaxEdge` 设置。 */
  private exportMaxEdge = 0;

  constructor(options: SessionOptions) {
    this.imageIo = options.imageIo;
    this.textRenderer = options.textRenderer;
    this.previewTarget = options.previewTarget ?? pipeline.PREVIEW_TARGET;
    this.port =
      options.port ??
      new pipeline.InlinePort({ memoryBudgetBytes: options.memoryBudgetBytes });
  }

  /* ─────────────────────────── 读 ─────────────────────────── */

  get document(): docApi.PhotoDocument {
    return this.document_;
  }

  /** 当前权威编辑状态（由 ops 投影，不做第二份存储）。 */
  get state(): docApi.EditState {
    return docApi.deriveEdit(this.document_);
  }

  get hasSource(): boolean {
    return this.sources.length > 0;
  }

  get sourceCount(): number {
    return this.sources.length;
  }

  /** 当前下标（拼图/切图按它取"当前图"）。 */
  get currentIndex(): number {
    return this.state.current;
  }

  /** 当前源图信息。 */
  get sourceInfo(): ImportResult | null {
    return this.infoAt(this.state.current);
  }

  /** 全部源图信息（缩略图列表用）。 */
  get sourceInfos(): readonly ImportResult[] {
    return this.sources.map((src, i) => this.described(src, i));
  }

  private infoAt(index: number): ImportResult | null {
    const src = this.sources[index];
    return src === undefined ? null : this.described(src, index);
  }

  /**
   * 由**当前像素 + 来源事实**组装对外信息。调用方保证下标合法
   * （`sources` 与 `metas` 由同一批增删操作维护，长度始终一致）。
   */
  private described(src: PixelBuffer, index: number): ImportResult {
    const meta = this.metas[index];
    return {
      name: this.names[index] ?? '',
      width: src.width,
      height: src.height,
      stored: meta?.stored ?? null,
      bytes: meta?.bytes ?? null,
      orientation: meta === null ? null : metadata.exifOrientationOf(meta.read),
      /* null 与 '无 EXIF' 是两句不同的话（X4）：前者是"没读过容器字节"，
       * 后者是"读了，里面确实没有"。界面不许把两者合并成"无"。 */
      exifLine: meta === null ? null : metadata.formatExif(meta.read),
    };
  }

  /**
   * 第 `index` 张源图的缩略图（缩略图列表用）。
   *
   * 刻意**走内核**而不是在壳里 drawImage：缩略图是一次真实的重采样，
   * 属于像素运算（P6-c §3.4 红线）。内核 `THUMBNAIL_TARGET` 长边 256、不含文字，
   * 与预览/导出共用同一条 `buildPlan`，因此"缩略图长什么样"与"主视图长什么样"
   * 不会漂移。为了让每张缩略图各自独立，这里在一份**派生文档**上强制
   * 单图模式 + 无裁切 —— 派生文档用完即弃，不影响会话历史。
   */
  thumbnailAt(index: number): PixelBuffer | null {
    const src = this.sources[index];
    if (src === undefined) return null;
    return pipeline.makeThumbnail(src, pipeline.THUMBNAIL_TARGET.maxEdge);
  }

  /**
   * 本次渲染要喂给内核的源图序列。
   *
   * 拼图（h/v/grid）需要**全部**源图（`runCollage` 按下标取片）；
   * 单图 / 切图只喂**当前**那张 —— 因为 `executePlan` 的光栅阶段固定取
   * `sources[0]`，若把全部源图都传进去，"切换当前图"将不改变渲染结果
   * （一个不会报错的静默失效）。
   */
  private activeSources(): readonly PixelBuffer[] {
    const mode = this.state.collage.mode;
    if (mode === 'h' || mode === 'v' || mode === 'grid') return this.sources;
    const cur = this.sources[this.state.current];
    return cur === undefined ? [] : [cur];
  }

  get canUndo(): boolean {
    return docApi.canUndo(this.document_);
  }

  get canRedo(): boolean {
    return docApi.canRedo(this.document_);
  }

  /* ─────────────────────────── 导入 ─────────────────────────── */

  /** 从字节导入（**替换**全部源图；真实路径：字节来自文件或剪贴板）。 */
  async importBytes(bytes: Uint8Array, name: string, mime?: string, handle?: string): Promise<ImportResult> {
    const decoded = await this.imageIo.decode(bytes, mime);
    return this.importPixels(decoded, name, this.factsOf(bytes, handle));
  }

  /** 从字节**追加**一张源图（多图导入）。 */
  async addBytes(bytes: Uint8Array, name: string, mime?: string, handle?: string): Promise<ImportResult> {
    const decoded = await this.imageIo.decode(bytes, mime);
    return this.addPixels(decoded, name, this.factsOf(bytes, handle));
  }

  /**
   * 容器字节 → 来源事实（字节数 + EXIF + 指纹）。
   *
   * 三处"从字节进来"的入口（导入 / 追加 / 打开工程）必须走同一个口径，
   * 否则工程文件里记的指纹与实际核对用的指纹可能来自不同算法 —— 那等于
   * D4 形同虚设，却每次都能"对上"。
   */
  private factsOf(bytes: Uint8Array, handle?: string): SourceFacts {
    return {
      bytes: bytes.length,
      read: metadata.readExif(bytes),
      fingerprint: docApi.sourceFingerprint(bytes),
      ...(handle === undefined ? {} : { handle }),
    };
  }

  /**
   * 导入像素，**替换**全部源图并重置文档。
   *
   * 两件必须同时成立的事：
   *
   *   1. 把**真实尺寸**写进 `setSources` —— 几何与拼图数学拿到的必须是真尺寸，
   *      否则旋转后的宽高、边框内缩都会算错（legacy P1-1 的同类坑）。
   *   2. 按 `facts.read` 里的 EXIF 朝向做**一次**索引置换（内核 D13）—— 于是此后
   *      文档里的宽高就是**显示态**，单图/拼图/切图/缩略图四条渲染路径都直接
   *      用它们，不必各自再转一次（各自再转一次就是病根1 的复发）。
   *
   * `facts` 省略 = 没有容器字节可考（测试与示例图），此时**不做置换**、
   * 对外也只报 null，不假造一份 EXIF。
   */
  importPixels(pixels: PixelBuffer, name: string, facts?: SourceFacts): ImportResult {
    const oriented = this.orient(pixels, facts);
    this.sources = [oriented];
    this.names = [name];
    this.metas = [facts === undefined ? null : { ...facts, stored: sizeOf(pixels) }];
    this.document_ = this.withSources(docApi.createDocument(), 0);
    /* 换了源图，旧快照的指纹已失效 —— 显式清掉，别让缓存"看起来命中"。 */
    this.port.reset();
    return this.described(oriented, 0);
  }

  /** 追加一张源图；空文档时等价于 replace。选中新加入的那张。 */
  addPixels(pixels: PixelBuffer, name: string, facts?: SourceFacts): ImportResult {
    if (this.sources.length === 0) return this.importPixels(pixels, name, facts);
    const oriented = this.orient(pixels, facts);
    this.sources = [...this.sources, oriented];
    this.names = [...this.names, name];
    this.metas = [...this.metas, facts === undefined ? null : { ...facts, stored: sizeOf(pixels) }];
    this.document_ = this.withSources(this.document_, this.sources.length - 1);
    this.port.reset();
    return this.described(oriented, this.sources.length - 1);
  }

  /**
   * EXIF 朝向进入像素的**唯一**一处调用。
   *
   * 为什么只有一处：朝向若在渲染阶段生效，就得在单图/拼图/切图/缩略图四条路径
   * 各写一遍（拼图与切图绕过栅格阶段，写不满），那正是"同一件事有好几份实现"
   * 的老毛病。置换在下标 1..8 里是精确索引重排，无插值、无损。
   * 朝向为 1 或 null 时内核原样返回**同一个引用**，所以常见路径不多一次拷贝。
   */
  private orient(pixels: PixelBuffer, facts: SourceFacts | undefined): PixelBuffer {
    if (facts === undefined) return pixels;
    return metadata.applyOrientation(pixels, metadata.exifOrientationOf(facts.read));
  }

  /** 切换当前源图（缩略图点击）。 */
  setCurrentSource(index: number): void {
    if (index < 0 || index >= this.sources.length || index === this.state.current) return;
    this.document_ = this.withSources(this.document_, index);
  }

  /** 删除当前源图，并把 current 收拢到合法范围。 */
  removeCurrentSource(): void {
    if (this.sources.length === 0) return;
    const i = this.state.current;
    this.sources = this.sources.filter((_, k) => k !== i);
    this.names = this.names.filter((_, k) => k !== i);
    this.metas = this.metas.filter((_, k) => k !== i);
    const next = Math.min(i, Math.max(0, this.sources.length - 1));
    this.document_ = this.withSources(
      this.sources.length === 0 ? docApi.createDocument() : this.document_,
      next,
    );
    this.port.reset();
  }

  /** 清空全部源图。 */
  clearSources(): void {
    this.sources = [];
    this.names = [];
    this.metas = [];
    this.document_ = this.withSources(docApi.createDocument(), 0);
    this.port.reset();
  }

  /**
   * 当前源图的引用（`setSources` 的值；像素不进文档，只记元数据）。
   *
   * 宽高是**显示态**（朝向已置换过），`exifOrientation` 只是**留痕**：
   * 渲染路径不许读它 —— 读了就是第二次旋转。它进文档的意义在于"同一份文档
   * 在两端比对时能看出转过一次"，以及工程文件回读后仍能如实报出原始朝向。
   */
  private sourceRefs(): docApi.SourceRef[] {
    return this.sources.map((p, i) => {
      const meta = this.metas[i];
      const orientation = meta === null ? null : metadata.exifOrientationOf(meta.read);
      return {
        id: `src-${i}`,
        name: this.names[i] ?? '',
        width: p.width,
        height: p.height,
        ...(meta?.handle === undefined ? {} : { handle: meta.handle }),
        ...(orientation === null ? {} : { exifOrientation: orientation }),
        /* 字节数与指纹是工程文件核对源图身份的两个依据（D4）。meta 为 null
         * （直接喂像素的路径）时**不写**，而不是写个像样的值 —— 伪造的指纹
         * 会让一次本该报警的漂移看起来"核过了"。 */
        ...(meta === null ? {} : { bytes: meta.bytes }),
        ...(meta?.fingerprint === undefined ? {} : { fingerprint: meta.fingerprint }),
      };
    });
  }

  /** 把当前 `sources` 的引用三元组以 `setSources` 落进给定文档。 */
  private withSources(doc: docApi.PhotoDocument, current: number): docApi.PhotoDocument {
    return docApi.pushOp(doc, { k: 'setSources', value: this.sourceRefs(), current });
  }

  /* ─────────────────────────── 工程文件（序 2 · D14） ─────────────────────────── */

  /**
   * 当前会话 → `photo.doc/v1` 文本。
   *
   * 序列化整个交给内核（`doc.serializeDocument`），壳只递文档：于是"工程文件里
   * 能有什么"这件事三端只有一个答案，CLI 与网页将来读写同一份文件不必壳配合。
   */
  serializeProject(): string {
    return docApi.serializeDocument(this.document_);
  }

  /**
   * 这个工程文件想要什么 —— **只读**，不改会话，也不碰像素。
   *
   * 存在的理由是对话框的顺序：主进程要先弹"选这 N 张源图"，才能把文件交给
   * `loadProject`。不先读一眼，就无法告诉用户"要选 3 张、按这个顺序"，
   * 只能等他挑完再报错 —— 那是把工程的契约藏在失败信息里。
   *
   * 结构错的文本在这里就抛 `DocumentParseError`（与 `loadProject` 同一道闸门，
   * 不另写一套判断）。
   */
  projectNeeds(text: string): ProjectNeeds {
    const doc = docApi.parseDocument(text);
    const sources = docApi.deriveEdit(doc).sources;
    return {
      sources: sources.map((s) => ({
        name: s.name,
        width: s.width,
        height: s.height,
      })),
      history: doc.cursor,
      total: doc.ops.length,
    };
  }

  /**
   * 工程文件 + 那几张源图 → 会话现状（含整条撤销栈与 cursor）。
   *
   * 两件必须同时成立的事：
   *
   *   1. **顺序即契约**：`files[i]` 对应工程里的第 i 张。挑错顺序不会"蒙对"，
   *      因为每张都要过内核的指纹核对（D4）。
   *   2. **对不上就整次失败**，并把"哪张、差在哪"写进错误里 —— 宁可开不了，
   *      也不静默用错的图渲染。工程文件最有价值的部分是它的历史，
   *      拿错图去重放那段历史，产出的是一张看起来成功、其实全错的成品。
   *
   * 朝向在这里与导入完全同源（同一个 `orient`、同一个 `factsOf`），所以
   * "存工程 → 开工程"不会让图转第二次，也不会把显示态宽高记成存储态。
   */
  async loadProject(text: string, files: readonly ProjectSource[]): Promise<ProjectLoadResult> {
    const doc = docApi.parseDocument(text); // 结构错在这里抛 DocumentParseError
    const expected = docApi.deriveEdit(doc).sources;

    type Loaded = { readonly pixels: PixelBuffer; readonly name: string; readonly facts: SourceFacts; readonly stored: SourceSize };
    const loaded: Loaded[] = [];
    for (const file of files) {
      const raw = await this.imageIo.decode(file.bytes, file.mime);
      const facts = this.factsOf(file.bytes, file.handle);
      loaded.push({ pixels: this.orient(raw, facts), name: file.name, facts, stored: sizeOf(raw) });
    }

    const identity = docApi.verifySourceIdentity(
      expected,
      loaded.map((l) => ({
        name: l.name,
        width: l.pixels.width,
        height: l.pixels.height,
        bytes: l.facts.bytes,
        fingerprint: l.facts.fingerprint ?? null,
      })),
    );
    if (!identity.ok) {
      throw new Error(`工程文件的源图对不上：${identity.problems.join('；')}`);
    }

    this.sources = loaded.map((l) => l.pixels);
    this.names = loaded.map((l) => l.name);
    this.metas = loaded.map((l) => ({ ...l.facts, stored: l.stored }));
    this.document_ = doc;
    this.port.reset();

    return {
      sources: this.sources.map((p, i) => this.described(p, i)),
      /** 生效的历史步数（cursor）与总步数：UI 用它写"已恢复 4/6 步"。 */
      history: doc.cursor,
      total: doc.ops.length,
    };
  }

  /* ─────────────────────────── 编辑 ─────────────────────────── */

  /**
   * 设定若干调色参数（**整值设置**：未提供的键保持当前值）。
   *
   * `merge: true` 让连续拖动只留最后一步 —— 一次拖拽 = 一步撤销，
   * 而不是产生几十条历史（legacy 的滑杆撤销之所以无效，就是这里没做好）。
   */
  setParams(partial: Partial<presets.AdjustParams>): void {
    const current = this.state.params;
    this.push({
      k: 'setAdjust',
      value: { ...current, ...partial },
    });
  }

  setParam(key: presets.AdjustKey, value: number): void {
    this.setParams({ [key]: value } as Partial<presets.AdjustParams>);
  }

  applyPreset(key: string, intensity = 1): void {
    if (presets.findPreset(key) === undefined) {
      throw new Error(`未知预设：${key}`);
    }
    this.push({ k: 'applyPreset', key, intensity });
  }

  /**
   * 当前观感 → 一份可保存的自定义预设（#4）。
   *
   * 收集哪些字段由内核决定（`sharedPresetFromEditState`）：只有参数 / 曲线 /
   * 色阶 / 分色带算"风格"，几何、裁切、水印、拼图算"构图"，不进预设。
   * 壳在这里只是个搬运工 —— 免得两边各写一份"什么算风格"。
   */
  currentAsPreset(key: string, name: string): docApi.SharedPreset {
    return docApi.sharedPresetFromEditState(key, name, this.state);
  }

  /**
   * 套用自定义预设：把预设展开成 op 逐条推入。
   *
   * 刻意**不走 `applyPreset`**：那条 op 存的是一个 key，渲染时去内置表里查
   * （`presets.findPreset`）。自定义预设住在用户的磁盘上，不在那张表里 ——
   * 拿它套 `applyPreset` 会抛"未知预设"，或者更糟：与某个内置 key 撞名，
   * 于是"我的胶片感"实际生效的是内置的那一个，而且工程文件也说不清自己存了什么。
   *
   * 于是这里显式展开成参数类 op（内核 `sharedPresetToOps` 的产物）。代价要说清：
   * 一个纯滑杆预设是**一步**历史（只有 `setAdjust`）；若它还带着曲线/色阶/分色，
   * 撤销它就要按同样多次 —— 因为 op 栈里没有"复合步骤"这个概念。
   * 这不是可以偷偷抹掉的细节，它是 D14"工程文件只记录已有 op 种类"的直接后果。
   *
   * 另一点：套用后 `presetKey` 为空（没有内置 key），因此**预设强度滑杆会禁用** ——
   * 与 #2 的口径一致：没有基准，就不摆个能拖但没效果的控件。
   */
  applySharedPreset(preset: docApi.SharedPreset): void {
    for (const op of docApi.sharedPresetToOps(preset)) this.push(op);
  }

  /**
   * 设置预设强度（0..1）—— 按**当前预设 key** 重推一次 `applyPreset`。
   *
   * 为什么走"合并历史"：拖强度滑杆会连发几十个 input 事件，每次都是一次
   * 参数重算；若各占一步历史，撤销一下只退 1% 强度，用户要按几十次才能退回
   * 上一个预设 —— 这正是 legacy「滑杆撤销无效」的同一类病根，只是换了个控件。
   * `merge: true` 让一次拖拽收敛成一步。
   *
   * 没有当前预设时是**合法空操作**（强度没有基准可言），调用方无需判空；
   * 强度值本身由内核 `mixWithNeutral` 钳到 0..1，这里先钳一道只为让
   * `EditState.presetIntensity` 与滑杆显示一致。
   */
  setPresetIntensity(intensity: number): void {
    const key = this.state.presetKey;
    if (key === null) return;
    const k = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
    this.document_ = docApi.pushOp(
      this.document_,
      { k: 'applyPreset', key, intensity: k },
      { merge: true },
    );
  }

  /** 顺时针 90°。宽高互换由内核的 `rotatedSize` 唯一决定。 */
  rotateClockwise(): void {
    const g = this.state.geometry;
    const next = ((g.rotate + 90) % 360) as docApi.GeometryState['rotate'];
    this.setGeometry({ ...g, rotate: next });
  }

  flipHorizontal(): void {
    const g = this.state.geometry;
    this.setGeometry({ ...g, flipH: !g.flipH });
  }

  /** 垂直镜像。宽高互换由内核的 `rotatedSize` 唯一决定。 */
  flipVertical(): void {
    const g = this.state.geometry;
    this.setGeometry({ ...g, flipV: !g.flipV });
  }

  setStraighten(degrees: number): void {
    const g = this.state.geometry;
    this.setGeometry({ ...g, straighten: degrees });
  }

  setGeometry(patch: Partial<docApi.GeometryState>): void {
    const g = this.state.geometry;
    this.push({ k: 'setGeometry', value: { ...g, ...patch } });
  }

  setCrop(rect: geometry.Rect | null): void {
    this.push({ k: 'setCrop', value: rect });
  }

  setWatermarkText(text: string): void {
    const wm = this.state.watermark;
    this.push({ k: 'setWatermark', value: { ...wm, text } });
  }

  /** 水印进阶：合并任意字段（位置 / 颜色 / 描边 / 字号 / 不透明度）。 */
  setWatermark(patch: Partial<docApi.WatermarkState>): void {
    const wm = this.state.watermark;
    this.push({ k: 'setWatermark', value: { ...wm, ...patch } });
  }

  setStickerText(text: string): void {
    const st = this.state.sticker;
    this.push({ k: 'setSticker', value: { ...st, text } });
  }

  /** 贴纸进阶：合并任意字段（样式 / 位置 / 字号）。 */
  setSticker(patch: Partial<docApi.StickerState>): void {
    const st = this.state.sticker;
    this.push({ k: 'setSticker', value: { ...st, ...patch } });
  }

  /** HSL 八色分调：合并任意色彩带的调整量。 */
  setBands(partial: Partial<color.BandAdjustMap>): void {
    const bands = this.state.bands;
    this.push({ k: 'setBands', value: { ...bands, ...partial } });
  }

  /**
   * 曲线编辑器：把某一通道的控制点写回。
   *
   * 推送前先经 `color.normalizeCurvePoints` 过内核白名单（钳 0..255 / 按 x 升序 /
   * 相邻同 x 去重）—— 与台账"曲线控制点须走 sanitize 白名单"一致；即便漏过，
   * `applyOp` 出口的 `sanitizeEditState` 也会兜底再洗一遍。
   */
  setCurves(channel: color.CurveChannel, points: color.CurvePoints): void {
    const curves = this.state.curves;
    const next: docApi.CurveSet = {
      rgb: channel === 'rgb' ? color.normalizeCurvePoints(points) : curves.rgb,
      r: channel === 'r' ? color.normalizeCurvePoints(points) : curves.r,
      g: channel === 'g' ? color.normalizeCurvePoints(points) : curves.g,
      b: channel === 'b' ? color.normalizeCurvePoints(points) : curves.b,
    };
    this.push({ k: 'setCurves', value: next });
  }

  /**
   * 拼图 / 切图：合并任意字段（模式 / 缝隙 / 背景 / 切图行列 / 边框）。
   * 走 op 整值设置，因此与单图共用同一条管线（拼图不是另一套渲染）。
   */
  setCollage(patch: Partial<docApi.CollageState>): void {
    const c = this.state.collage;
    this.push({ k: 'setCollage', value: { ...c, ...patch } });
  }

  /**
   * 自动增强（"一键救废片"）—— **算法在内核，壳只做搬运**。
   *
   * 流程：取当前源图 → `pixels.analyzeAuto` 统计出色阶参数 →
   * 以 `setLevels` 推成一条 op。因此结果是**非破坏性**的：
   * 可撤销、可重做、还能在其上继续调色（legacy 把它烘进像素，不可逆）。
   *
   * 与 legacy 的算法一致（逐通道 1% 掐头去尾 + 灰世界增益），差别只在
   * "落成文档参数"而非"改像素"，详见 `packages/core/src/pixels/auto.ts` 文件头。
   *
   * @returns 是否真的推入了新操作。返回 `false` 有两种情形：
   *   - 分析结果是中性（这张图层次与色偏都已正常）→ 不推空操作；
   *   - 与当前色阶相同（重复点按钮）→ 历史里不留重复项。
   *   两种情况都不是"失败"，调用方据此给出**诚实的**提示，而不是假装生效。
   */
  autoEnhance(): boolean {
    const src = this.sources[this.state.current];
    if (src === undefined) return false;
    const levels = pixels.analyzeAuto(src);
    if (color.isIdentityLevels(levels)) return false;
    if (levelsEqual(this.state.levels, levels)) return false;
    this.push({ k: 'setLevels', value: levels });
    return true;
  }

  /** 当前是否已套用非恒等色阶（UI 据此显示"还原色阶"是否可用）。 */
  get hasLevels(): boolean {
    return !color.isIdentityLevels(this.state.levels);
  }

  /** 还原色阶为中性（自动增强的"撤销这个功能"入口，与曲线重置同构）。 */
  resetLevels(): void {
    this.push({ k: 'setLevels', value: color.identityLevels() });
  }

  /** 把某一通道的曲线重置为恒等（左下→右上斜线）。 */
  resetCurve(channel: color.CurveChannel): void {
    const curves = this.state.curves;
    const identity = color.identityCurve();
    const next: docApi.CurveSet = {
      rgb: channel === 'rgb' ? identity : curves.rgb,
      r: channel === 'r' ? identity : curves.r,
      g: channel === 'g' ? identity : curves.g,
      b: channel === 'b' ? identity : curves.b,
    };
    this.push({ k: 'setCurves', value: next });
  }

  undo(): void {
    this.document_ = docApi.undo(this.document_);
  }

  redo(): void {
    this.document_ = docApi.redo(this.document_);
  }

  /**
   * 口语指令：一句话解析成语义意图并落到文档。
   *
   * 纯壳侧入口：先 `nlp.parseKouyu` 解析，再经内核 `doc.adaptIntents` 把可落文档的
   * 意图翻译成 op 推入历史；非 op 意图里，`undo` 走历史栈，`crop` 等视图/动作意图
   * 归入 `pending` —— 绝不假装已经生效。
   *
   * 返回 `applied` / `pending` 标签，UI 据此诚实回显（"已镜像" vs "裁剪待交互"）。
   */
  applyKouyu(text: string): KouyuOutcome {
    const result = nlp.parseKouyu(text);
    if (result.empty) return { empty: true, applied: [], pending: [] };
    const edit = this.state;
    const adapted = docApi.adaptIntents(result.intents, edit);
    const applied: string[] = [];
    const pending: string[] = [];
    for (const a of adapted) {
      if (a.op !== null) {
        this.push(a.op);
        applied.push(a.intent.label);
      } else if (a.intent.k === 'undo') {
        this.undo();
        applied.push(a.intent.label);
      } else if (a.intent.k === 'autoEnhance') {
        /* 自动增强不是"纯文档 op"（要先读像素统计），但它在本内核里**有明确实现**：
         * 由壳调用内核算法后落成 `setLevels`。因此它不该像 crop/zoom 那样
         * 笼统归入 pending —— 那样等于"识别到了却假装不做"。 */
        if (this.autoEnhance()) applied.push(a.intent.label);
        else applied.push('这张图层次与色偏都已正常，无需增强');
      } else {
        /* 已识别但当前壳未接 UI（裁剪 / 切页 / 导出 / 缩放 / 对比 / 删图 / 视频）。
         * 归入 pending，由 UI 明确告知"待交互"，绝不假装生效。 */
        pending.push(a.intent.label);
      }
    }
    return { empty: false, applied, pending };
  }

  /* ─────────────────────────── 渲染 ─────────────────────────── */

  previewPlanSummary(): PlanSummary {
    return summarize(pipeline.buildPlan(this.document_, this.previewTarget));
  }

  exportPlanSummary(): PlanSummary {
    return summarize(pipeline.buildPlan(this.document_, this.buildExportTarget()));
  }

  /**
   * 跑一个渲染任务 —— 会话里**全部**渲染的唯一出口。
   *
   * ── 为什么返回 Promise，却又刻意不写成 `async` 方法 ─────────────
   * 端口可能是远程的（真 Worker），结果必然异步；但**源图缺失属于调用方状态
   * 错误**，必须**同步**抛出 —— 写成 `async` 会把它变成"要等一轮微任务才拒绝
   * 的 Promise"，调用方于是以为"请求已受理"，单测里的同步 `toThrow` 断言也会
   * 当场失效。非 `async` 方法体里先做完校验、再返回 Promise，两个要求同时成立。
   *
   * `cache: false` 走内核的无状态执行器 `executePlan`：**不读也不写**快照。
   * 一次性大图导出用它省下数百 MB（理由见 `renderExport`）。
   */
  private execute(
    sources: readonly PixelBuffer[],
    plan: pipeline.RenderPlan,
    cache: boolean,
  ): Promise<pipeline.JobResult> {
    const id = this.nextJobId;
    this.nextJobId += 1;
    return this.port
      .run({ id, sources, plan, options: this.execOptions(), cache })
      .then((result) => {
        /* 端口把错误**关在任务内**（一个任务失败不该拖垮端口），因此这里必须
         * 重新抛出：静默交回一张 1×1 的图，会让"渲染失败"伪装成"渲染成功"。 */
        if (result.error !== undefined) throw new Error(result.error);
        return result;
      });
  }

  /**
   * 预览一帧 —— **走缓存**。
   *
   * 缓存的正确性由内核的 `cache.test.ts` 锁死（"复用结果 === 全量重算结果"
   * 逐字节一致），因此这里可以放心地只关心"复用了几个阶段"。
   *
   * 注意 `stats` 反映的是**执行体那一侧**的缓存：接上 Worker 之后，复用的就是
   * Worker 线程内的快照 —— 这正是要的（拖滑杆时省下的正是 Worker 的重算时间）。
   */
  renderPreview(): Promise<PreviewResult> {
    const sources = requireSources(this.activeSources());
    const plan = pipeline.buildPlan(this.document_, this.previewTarget);
    return this.execute(sources, plan, true).then(({ pixels, stats }) => ({
      pixels,
      stats: stats ?? NO_CACHE_STATS,
    }));
  }

  /** 执行一次但**不读也不写缓存**，用于验证"复用结果 == 全量重算"这类不变量。 */
  renderPreviewUncached(): Promise<PixelBuffer> {
    const sources = requireSources(this.activeSources());
    const plan = pipeline.buildPlan(this.document_, this.previewTarget);
    return this.execute(sources, plan, false).then((result) => result.pixels);
  }

  /**
   * 预览**原图**（#29「按住看原图」的输入）。
   *
   * ── 为什么不是"把文档退回到第 0 步" ──────────────────────────
   * 退回空文档会把旋转 / 裁切 / 拼图一起卸掉，输出尺寸随之变化；
   * 按住时要看的两张图**必须同宽同高**，否则画面在按下/松开的瞬间一跳，
   * 前后对比就失去了意义（也容易读成"闪烁 bug"）。
   * 因此这里保留**结构性** op（源图选择 / 几何 / 裁切 / 拼图），
   * 只丢弃**改变画面观感**的那一类（调色 / 预设 / 曲线 / 分色 / 自动增强 /
   * 水印 / 贴纸）—— 即"取景不变，只看处理前后的差别"。
   *
   * 顺带：这也是 legacy `comparing` 的语义（它同样保留旋转与取景，
   * 只跳过 `soften/grade/sharpen/...` 那一串）。差异只有一处，见 `compareDocument`。
   *
   * 走不落缓存的一次性执行：这是在按下期间反复发生的瞬时视图，
   * 让它占用（并污染）正常预览的快照预算不值得。
   */
  renderPreviewOriginal(): Promise<PixelBuffer> {
    const sources = requireSources(this.activeSources());
    const plan = pipeline.buildPlan(compareDocument(this.document_), this.previewTarget);
    return this.execute(sources, plan, false).then((result) => result.pixels);
  }

  /**
   * 预览**未裁切**的完整内容 —— 供裁剪框编辑在原图上取景。
   *
   * 与 `renderPreview` 走同一条 `buildPlan`，唯一差别是 target 带 `ignoreCrop`，
   * 因此除裁切外的所有阶段（旋转/调色/文字…）完全一致。刻意不用缓存：
   * 这是进入/退出裁剪态才发生一次的瞬时视图，命中率低，且避免污染正常预览缓存。
   */
  renderPreviewForCrop(): Promise<PixelBuffer> {
    const sources = requireSources(this.activeSources());
    const plan = pipeline.buildPlan(this.document_, { ...this.previewTarget, ignoreCrop: true });
    return this.execute(sources, plan, false).then((result) => result.pixels);
  }

  /**
   * 导出渲染阶段 —— **全尺寸**（`maxEdge: 0`），且**不落快照**。
   *
   * 单独暴露这一步有两个理由，都不是为了测试好看：
   *   1. **导出是两段式**（渲染像素 → 编码字节），UI 将来要显示"正在渲染 /
   *      正在压缩"两段进度，本就必须拆开；把渲染阶段藏进 `exportBytes`
   *      里，进度条就无从谈起。
   *   2. 于是"预览与导出同源"这条验收（P6C-PLAN F）可以**逐字节**断言：
   *      同一张图在 `maxEdge` 不生效的尺寸下，两条路径的输出缓冲必须完全相同。
   *
   * 不落快照的理由很实际：24MP 一次导出的中间快照是 96 MB × 阶段数 ≈ 数百 MB，
   * 而导出是"一次性"的，缓存命中率几乎为零 —— 拿内存换不到任何东西。
   * 交互式预览才需要缓存，那才是反复重算同一份前缀的场景。
   */
  renderExport(): Promise<PixelBuffer> {
    return this.renderExportAt(this.exportMaxEdge);
  }

  /**
   * 按指定长边上限渲染导出像素。
   *
   * `maxEdge = 0` 表示保持原尺寸；否则内核 `buildPlan` 会把输出长边
   * 收敛到该上限。导出刻意**不落快照**（理由见 `renderExport` 注释）。
   */
  renderExportAt(maxEdge: number): Promise<PixelBuffer> {
    const sources = requireSources(this.activeSources());
    const plan = pipeline.buildPlan(this.document_, this.buildExportTarget(maxEdge));
    return this.execute(sources, plan, false).then((result) => result.pixels);
  }

  /**
   * 释放渲染执行体（真 Worker 端口会 terminate 线程）。
   *
   * 会话其余部分都是纯数据，不需要释放；只有端口持有平台资源，
   * 所以要有一个显式出口，而不是等 GC —— 线程不会被 GC 回收。
   */
  dispose(): void {
    this.port.dispose();
  }

  /**
   * 预估导出体积 —— 让用户**导出之前**就知道大概多大，而不是导出完才发现。
   *
   * ── 为什么不"真的渲染一遍再编码" ──────────────────────────────
   * 真实一次全尺寸渲染 + 编码是导出本身的主要开销；为显示一个数字付一次整
   * 套代价，代价与收益严重不对等。因此复用**已有的预览像素**：拿它按当前
   * 格式 / 画质实际编码一次，再按像素数比例放大到导出尺寸。
   * 这也是 legacy `scheduleEstimate()` 的做法，我们在日记归档里见过它的效果。
   *
   * ── 精度与诚实 ────────────────────────────────────────────────
   * 体积与像素数**近似成正比**，故比例放大是合理近似；但它终究是估算：
   * 高频细节多的图会比线性外推更大，平坦区域多的图会更小。所以 UI 文案
   * 必须写「约」，不能写成确定值 —— 这与内核「绝不静默」是同一条铁律：
   * 估算要**标明是估算**，不给用户错误的安全感。
   *
   * 宽高则是**准确值**（直接来自内核计划的 `outputSize`），不估算。
   *
   * @param previewPixels 最近一帧预览像素（已经按同一配方渲过）。
   */
  async estimateExportSize(
    previewPixels: PixelBuffer,
    format: ImageFormatName = 'png',
    quality = 90,
  ): Promise<ExportSizeEstimate> {
    const { width, height } = this.exportOutputSize;
    const previewArea = previewPixels.width * previewPixels.height;
    const exportArea = width * height;
    if (previewArea <= 0 || exportArea <= 0) {
      return { bytes: 0, width, height };
    }
    const encoded = await this.imageIo.encode(previewPixels, format, quality);
    const bytes = Math.round(encoded.byteLength * (exportArea / previewArea));
    return { bytes, width, height };
  }

  /**
   * 导出成品的宽高 —— 直接取内核计划的 `outputSize`，**由内核负责推导**。
   *
   * 壳不自己算：它不知道旋转后宽高怎么互换、裁切怎么改面积、边框怎么外扩、
   * 拼图怎么合成。这些都在 `buildPlan` 里，问内核要就是唯一正确的来源。
   */
  get exportOutputSize(): { readonly width: number; readonly height: number } {
    const plan = pipeline.buildPlan(this.document_, this.buildExportTarget());
    return { width: plan.outputSize.w, height: plan.outputSize.h };
  }

  /** 导出成品：渲染（`renderExportAt`）→ 平台编码。 */
  async exportBytes(format: ImageFormatName = 'png', quality = 90): Promise<ExportResult> {
    const pixels = await this.renderExportAt(this.exportMaxEdge);
    const bytes = await this.imageIo.encode(pixels, format, quality);
    return { bytes, width: pixels.width, height: pixels.height };
  }

  /**
   * 按指定长边上限降采样后导出（内存门判定为 `downscale` 时的执行路径）。
   * 与 `renderExportAt` 同源 —— 降采样只是改了 `maxEdge`，阶段序列不变，
   * 因此"预览 == 导出"这条架构保证不会被悄悄打破。
   */
  async exportBytesDownscaled(
    maxEdge: number,
    format: ImageFormatName = 'png',
    quality = 90,
  ): Promise<ExportResult> {
    const pixels = await this.renderExportAt(maxEdge);
    const bytes = await this.imageIo.encode(pixels, format, quality);
    return { bytes, width: pixels.width, height: pixels.height };
  }

  /**
   * 批量导出 —— 按当前模式决定语义，全部打成一份 ZIP。
   *
   *   - **单图模式**：库里每张图各套一份**当前编辑**（几何 / 调色 / 曲线 /
   *     色阶 / 水印…），逐张全尺寸渲染并编码。这正是 legacy「批量导出」的本意：
   *     预设调好一次，其余图一键套到底。
   *   - **切图模式**：只渲染当前这张的底图（切图本就忽略几何、水印贴纸不进底图），
   *     再按 `cutCols × cutRows` 均分成分片 —— 用户看到 3×3 宫格，就该拿到 9 张。
   *   - **拼接模式（横向 / 纵向 / 网格）**：成品只有"拼起来的那一张"，批量导出
   *     没有意义，因此**明确拒绝**，而不是给出一堆逐字节相同的重复图。
   *
   * ── 为什么不落历史 ──────────────────────────────────────────────
   * 单图分支要把文档的 `current` 逐张指过去（`setCurrentSource` 会推一条
   * `setSources`）。但导出是**读操作**：用户不该在导出之后发现撤销栈里多了
   * N 步"切换当前图"。文档是不可变值对象，因此先把 `document_` 快照下来、
   * 结束时把引用**整体还原** —— 历史与缓存都回到调用前的样子，
   * 比"再推一条反向 op"更彻底（连历史长度都不变）。
   *
   * ── 内存 ────────────────────────────────────────────────────────
   * 逐张渲染、渲染完只保留**编码后的字节**，像素缓冲随即可回收；
   * 因此峰值 ≈ 单张渲染峰值 + 已编码字节之和，与单张导出同量级。
   * 准入判定仍由调用方先过 `previewExportGate`（壳的「绝不静默 OOM」）。
   */
  async exportBatch(
    format: ImageFormatName = 'png',
    quality = 90,
    maxEdge: number = this.exportMaxEdge,
  ): Promise<BatchExportOutcome> {
    if (this.sources.length === 0) return { ok: false, reason: '还没有导入图片。' };
    const mode = this.state.collage.mode;
    const blocked = this.batchExportBlocker;
    if (blocked !== null) return { ok: false, reason: blocked };

    const ext = EXTENSION[format];
    const used = new Set<string>();
    const entries: BatchExportEntry[] = [];

    try {
      if (mode === 'cut') {
        const cols = this.state.collage.cutCols;
        const rows = this.state.collage.cutRows;
        const base = baseNameOf(this.names[this.state.current] ?? '切图');
        const rendered = await this.renderExportAt(maxEdge);
        for (const tile of pixels.sliceGrid(rendered, cols, rows)) {
          const name = pushUniqueName(used, `${base}_r${tile.row + 1}c${tile.col + 1}.${ext}`);
          entries.push({
            name,
            bytes: await this.imageIo.encode(tile.pixels, format, quality),
            width: tile.pixels.width,
            height: tile.pixels.height,
          });
        }
      } else {
        const snapshot = this.document_;
        try {
          for (let i = 0; i < this.sources.length; i += 1) {
            this.setCurrentSource(i);
            const rendered = await this.renderExportAt(maxEdge);
            const name = pushUniqueName(used, withExtension(this.names[i] ?? '', ext));
            entries.push({
              name,
              bytes: await this.imageIo.encode(rendered, format, quality),
              width: rendered.width,
              height: rendered.height,
            });
          }
        } finally {
          /* 还原引用即完全回滚：文档是不可变值对象，指针一换，
           * 期间产生的所有 `setSources` 都不再可达。 */
          this.document_ = snapshot;
        }
      }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }

    const zip = zipStore(entries.map((entry) => ({ name: entry.name, bytes: entry.bytes })));
    return { ok: true, entries, zip, sliced: mode === 'cut' };
  }

  /** 批量导出是否可行（供 UI 置灰按钮）。 */
  get canBatchExport(): boolean {
    return this.batchExportBlocker === null;
  }

  /** 批量导出不可行的原因（可行时为 `null`）—— 直接拿去当禁用提示。 */
  get batchExportBlocker(): string | null {
    if (this.sources.length === 0) return '还没有导入图片。';
    const mode = this.state.collage.mode;
    if (mode === 'h' || mode === 'v' || mode === 'grid') {
      return '横向 / 纵向 / 网格拼接的成品只有一张，请用「导出」保存。';
    }
    return null;
  }

  /** 切图分片的数量（非切图模式为 0）—— UI 用它写提示条。 */
  get cutSliceCount(): number {
    if (this.state.collage.mode !== 'cut') return 0;
    return this.state.collage.cutCols * this.state.collage.cutRows;
  }

  /** 导出计划的阶段描述（给 UI 显示"这张图会经过哪几步"）。 */
  get exportTarget(): pipeline.RenderTarget {
    return this.buildExportTarget();
  }

  /**
   * 设置导出长边上限（0 = 原尺寸）。
   * 同时决定内存门（`previewExportGate`）与导出渲染的实际上限。
   */
  setExportMaxEdge(maxEdge: number): void {
    this.exportMaxEdge = Math.max(0, Math.floor(maxEdge));
  }

  get exportMaxEdgeValue(): number {
    return this.exportMaxEdge;
  }

  /**
   * 导出前的内存准入判定 —— **壳只负责把这四分支翻译成交互**，
   * 判定本身是内核纯函数 `pipeline.gateExport`（策略放内核，见 P6D-PLAN §2.3）。
   *
   * `plan` 用**当前**导出目标（含已选长边）构建；`planFor` 用同一个
   * `buildPlan` 换 `maxEdge` 重建，保证降采样方案与"预览==导出同源"
   * 这条架构保证不冲突（降采样只是改了 maxEdge，没改阶段序列）。
   */
  previewExportGate(
    budgetBytes?: number,
    explicitFullSize?: boolean,
  ): pipeline.ExportGate {
    const plan = pipeline.buildPlan(this.document_, this.buildExportTarget());
    return pipeline.gateExport({
      plan,
      budgetBytes,
      explicitFullSize,
      planFor: (maxEdge: number) =>
        pipeline.buildPlan(this.document_, this.buildExportTarget(maxEdge)),
    });
  }

  private execOptions(): pipeline.ExecuteOptions {
    return this.textRenderer === undefined ? {} : { textRenderer: this.textRenderer };
  }

  private push(op: docApi.Op): void {
    /* merge：连续同类操作只留最后一步。
     *
     * 判据是"用户的一次连续动作"而不是"操作类型"：
     *   - 拖动滑杆 / 拉曲线 → 几十个事件其实是一次拖动；
     *   - 逐字输入水印 → 一次输入是一次文本编辑；
     * 这些都必须各占一步历史（否则撤销一下只退一个字符 / 一个像素）。
     * 而旋转、套预设、切换裁剪这类"点一下"的操作走非合并路径，
     * 每次点击各占一步。 */
    const mergeable =
      op.k === 'setAdjust' ||
      op.k === 'setGeometry' ||
      op.k === 'setCurves' ||
      op.k === 'setCollage' ||
      op.k === 'setWatermark' ||
      op.k === 'setSticker';
    this.document_ = docApi.pushOp(this.document_, op, { merge: mergeable });
  }

  /** 导出目标：长边上限由 `maxEdge` 决定（0 = 原尺寸），含水印。 */
  private buildExportTarget(maxEdge: number = this.exportMaxEdge): pipeline.RenderTarget {
    return { kind: 'export', maxEdge, withText: true };
  }
}

function summarize(plan: pipeline.RenderPlan): PlanSummary {
  return {
    kinds: plan.stages.map((s) => s.kind),
    width: plan.outputSize.w,
    height: plan.outputSize.h,
  };
}

/**
 * 两组色阶是否逐字段相同。
 *
 * 只用于"避免重复推同一条 op"：色阶由**源图统计**决定，同一张源图重复点
 * 「自动增强」必然得到同一组参数；再推一次只会让历史里多一条空操作。
 * 这里不做容差比较 —— 参数是由同一段确定性代码算出来的，要么全等要么不同。
 */
function levelsEqual(a: color.LevelsState, b: color.LevelsState): boolean {
  const same = (x: color.LevelChannel, y: color.LevelChannel): boolean =>
    x.lo === y.lo && x.hi === y.hi && x.gain === y.gain;
  return same(a.r, b.r) && same(a.g, b.g) && same(a.b, b.b);
}

/**
 * 取文件名的"主干"：去掉目录前缀与最后一个扩展名。
 *
 * `dot > 0` 而不是 `dot >= 0` —— 否则 `.gitignore` 这种以点开头的名字会被
 * 误当成"扩展名是 .gitignore、主干为空"，切图分片就会全叫 `.png`。
 * 导出名的拼接只此一处，因此这个判断只写一遍。
 */
function stemOf(name: string): string {
  const seg = name.split(/[\\/]/).pop() ?? '';
  const dot = seg.lastIndexOf('.');
  return dot > 0 ? seg.slice(0, dot) : seg;
}

/** 切图分片的主干名（源名为空时给个有意义的兜底）。 */
function baseNameOf(name: string): string {
  const stem = stemOf(name);
  return stem === '' ? '切图' : stem;
}

/** 把扩展名换成 `ext`（原名的扩展名不带过来 —— 输出格式由用户选，不由输入决定）。 */
function withExtension(name: string, ext: string): string {
  const stem = stemOf(name);
  return `${stem === '' ? 'image' : stem}.${ext}`;
}
