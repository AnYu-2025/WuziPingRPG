import type { BandAdjustMap, CurvePoints } from '../color/types.js';
import type { LevelsState } from '../color/levels.js';
import type { Rect, Rotate } from '../geometry/types.js';
import type { ExifOrientation } from '../metadata/orientation.js';
import type { AdjustParams } from '../presets/params.js';
import type { CollageMode, ImageFormat } from '../types.js';

/**
 * 文档模型 —— 单一真相源。
 *
 * ── 核心契约 ──────────────────────────────────────────────────────
 * 1. 文档**只存描述，不存像素**。源图以引用（SourceRef）形式存在，
 *    编辑以操作（Op）序列形式存在。因此一份文档是几十 KB 的 JSON，
 *    不是几百 MB 的 base64。
 * 2. 撤销 = 移动 cursor 指针，**不丢弃数据**。重做同理。
 *    这样 undo/redo 的语义天然对称，不存在 legacy 那种
 *    "旋转能撤销、滑杆撤销无效"的不一致。
 * 3. 文档可序列化 ⇒ 项目文件、预设分享、批处理脚本、协作、版本控制
 *    全部免费获得。
 * 4. 渲染状态由 `deriveEdit(doc)` 从 ops 投影得出，**不做第二份存储**，
 *    因此不存在"状态与历史不一致"的可能。
 */

export type DocumentVersion = 1;

/**
 * 源图引用。像素由宿主（浏览器/Electron/Node）持有，内核只记元数据。
 *
 * **尺寸是显示态**：带 EXIF 朝向的照片，解码拿到的是存储态像素，宿主必须先经
 * 内核 `pixels.applyOrientation` 置换成显示态再交进来，`width/height` 记录的
 * 就是置换后的尺寸（D13）。于是下游（裁切 / 切图 / 导出尺寸显示）拿到的宽高
 * 与用户看见的一致，不需要各自再考虑朝向。
 */
export interface SourceRef {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 宿主自定义的不透明句柄（文件路径 / blob URL / FS 句柄 id）。 */
  readonly handle?: string;
  /**
   * 源文件的 EXIF 朝号码，**仅作来源记录**。
   *
   * 渲染路径**不得读它**：朝向已经在导入那一次置换进像素里，再读一遍就是
   * 双重旋转（X3 的第三条断言就是钉这条）。留在文档里的理由有两个：
   * 信息条要说"这张图原本转了 90°"，以及序2 的工程文件要能复述来源。
   */
  readonly exifOrientation?: ExifOrientation;
  /**
   * 源文件的**字节数**（存储态，非显示态）。同样只是来源记录，渲染不读。
   *
   * 它和 `fingerprint` 一起撑起工程文件的 D4：光靠 `handle` 路径认不出
   * "文件被覆盖过"，而大小是随手就能核对的一层粗筛。
   */
  readonly bytes?: number;
  /**
   * 源文件内容的**指纹**（内核 `identity.sourceFingerprint` 算，十六进制串）。
   *
   * 用途只有一个：打开工程时核对"这张文件还是当初那张吗"。它**不是**密码学
   * 哈希，不防篡改，只防拿错图（详见 `document/identity.ts`）。缺失表示
   * "这份来源没读过容器字节"，此时核对退化为按尺寸比对——**退化要说得出依据，
   * 不能装作核过**。
   */
  readonly fingerprint?: string;
}

/** 构图状态：旋转、镜像、水平校正。 */
export interface GeometryState {
  readonly rotate: Rotate;
  readonly flipH: boolean;
  readonly flipV: boolean;
  /** 水平校正角度，-15..15。 */
  readonly straighten: number;
}

/** 拼图 / 切图状态。 */
export interface CollageState {
  readonly mode: CollageMode;
  /** 缝隙宽度，0..40。 */
  readonly gap: number;
  /** 背景处理方式。 */
  readonly bg: 'color' | 'blur';
  /** 切图列数 2..4。 */
  readonly cutCols: number;
  /** 切图行数 2..4。 */
  readonly cutRows: number;
  /** 边框宽度 0..80。 */
  readonly borderWidth: number;
  /** 边框/底色。 */
  readonly borderColor: '#ffffff' | '#000000';
}

/** 水印状态。 */
export interface WatermarkState {
  readonly text: string;
  readonly pos: 'br' | 'bl' | 'tr' | 'tl' | 'c';
  readonly color: string;
  readonly stroke: boolean;
  /** 字号档位 1..8（相对图幅）。 */
  readonly size: number;
  /** 不透明度 10..100。 */
  readonly alpha: number;
}

/** 标题贴纸状态。 */
export interface StickerState {
  readonly text: string;
  readonly style: 'white' | 'black' | 'gold' | 'seal';
  readonly pos: 'bottom' | 'top' | 'center';
  /** 字号档位 3..12（相对图幅）。 */
  readonly size: number;
}

/** 四条曲线。 */
export interface CurveSet {
  readonly rgb: CurvePoints;
  readonly r: CurvePoints;
  readonly g: CurvePoints;
  readonly b: CurvePoints;
}

/** 导出偏好（不参与撤销）。 */
export interface ExportState {
  /** 长边像素上限；0 表示保持原尺寸。 */
  readonly longEdge: number;
  readonly format: ImageFormat;
  /** 画质 10..100。 */
  readonly quality: number;
}

export interface DocumentSettings {
  readonly export: ExportState;
}

/** 视图状态（不参与撤销，不进项目文件的语义部分）。 */
export interface ViewState {
  readonly tab: 'img' | 'vid';
  readonly zoom: number;
  /** 进行中的裁剪框（尚未提交为 op）。 */
  readonly pendingCrop: Rect | null;
}

/**
 * 一个编辑操作。
 *
 * 设计取舍：op 采用「把某类状态设为某值」的形态，而非细粒度增量。
 * 理由：
 *   - 应用简单（reducer 里一次 Object.assign），不会有累积漂移；
 *   - 体积仍然极小（AdjustParams 只有 12 个数字），比 base64 图片小 5 个数量级；
 *   - 与 Lightroom 等商业软件的参数模型一致，便于未来做 XMP 式互操作。
 */
export type Op =
  | { readonly k: 'setSources'; readonly value: readonly SourceRef[]; readonly current: number }
  | { readonly k: 'setAdjust'; readonly value: AdjustParams }
  | { readonly k: 'applyPreset'; readonly key: string; readonly intensity: number }
  | { readonly k: 'setLevels'; readonly value: LevelsState }
  | { readonly k: 'setCurves'; readonly value: CurveSet }
  | { readonly k: 'setBands'; readonly value: BandAdjustMap }
  | { readonly k: 'setGeometry'; readonly value: GeometryState }
  | { readonly k: 'setCrop'; readonly value: Rect | null }
  | { readonly k: 'setCollage'; readonly value: CollageState }
  | { readonly k: 'setWatermark'; readonly value: WatermarkState }
  | { readonly k: 'setSticker'; readonly value: StickerState };

export type OpKind = Op['k'];

/**
 * 可由 ops 投影得到的完整编辑状态。
 * 任何时刻 `deriveEdit(doc)` 都是唯一权威，UI 只读取它，不自己存一份。
 */
export interface EditState {
  readonly sources: readonly SourceRef[];
  readonly current: number;
  readonly params: AdjustParams;
  /** 色阶（自动增强的产物）。恒等表示未做自动增强。 */
  readonly levels: LevelsState;
  readonly curves: CurveSet;
  readonly bands: BandAdjustMap;
  readonly geometry: GeometryState;
  /**
   * 裁切框，**归一化到内容坐标系**（各分量 0..1，相对旋转/缩放后的内容区）。
   *
   * 为什么不存像素：内容尺寸随 `maxEdge` 变化（预览 1400 / 导出原尺寸），
   * 存像素会让同一份文档在预览与导出裁到不同区域；存归一化比例则两者等价，
   * "预览 == 导出同源"这条架构保证对裁切同样成立。
   * 容差：允许 w/h 为负（反向框选），由 `pipeline.plan` 的 `clampCrop` 归一。
   */
  readonly crop: Rect | null;
  readonly collage: CollageState;
  readonly watermark: WatermarkState;
  readonly sticker: StickerState;
  /** 最近套用的预设 key；为 null 表示当前参数不是预设投影的结果。 */
  readonly presetKey: string | null;
  /**
   * 最近套用预设时的强度，0..1（1 = 完整预设，0.55 = 五成半）。
   *
   * 为什么强度要进 EditState，而不是由壳自存一份 UI 状态：
   *   参数是 `mixWithNeutral(preset.params, intensity)` 的投影结果，强度与参数是
   *   **同一份事实**的两个面。壳若另存强度，撤销一步后参数退回去了、滑杆却停在
   *   新值，用户看到"参数动过、滑杆没动" —— 这正是 legacy"滑杆撤销无效"的同族病根。
   *   放进 EditState 后，`deriveEdit` 一投影，滑杆自然跟着历史走。
   * `presetKey` 为 null（手调参数）时该值无意义，约定恒为 1。
   */
  readonly presetIntensity: number;
}

export interface PhotoDocument {
  readonly version: DocumentVersion;
  /**
   * 基线编辑状态：ops 在此之上重放。
   *
   * 之所以把基线做成一整份 EditState 而不是只存源图列表：
   * 压平历史（squash）、加载工程文件、以及"以当前效果为新起点继续编辑"
   * 都需要一个完整的起点，否则清空 ops 会让参数掉回中性。
   */
  readonly baseline: EditState;
  /** 操作序列（含被撤销的部分，cursor 之前为生效区间）。 */
  readonly ops: readonly Op[];
  /** 生效操作数，取值 0..ops.length。 */
  readonly cursor: number;
  readonly settings: DocumentSettings;
  readonly view: ViewState;
}
