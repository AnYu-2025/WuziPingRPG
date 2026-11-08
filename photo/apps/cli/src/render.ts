/**
 * 无头渲染引擎 —— "同一份内核，换一个壳"的落点。
 *
 * 这个文件里没有任何 Node API。它只做四件事：
 *   1. 用注册表把输入字节解成像素；
 *   2. 用配方构造文档（与桌面端同一个 `PhotoDocument`）；
 *   3. 调 `buildPlan` + `executePlan`（与桌面端同一个计划、同一个执行器）；
 *   4. 把结果编码成字节。
 *
 * 因此 CLI 与桌面端**不存在"两套渲染实现"**：差别只在第 1 步与第 4 步
 * 用了哪个壳的能力。这也是为什么它可以被离线测试 —— 测试直接给内存里的
 * 字节，不需要文件系统、不需要浏览器。
 *
 * 顺带把 P1-4（内存峰值）在批处理场景里也解决了：
 * `ScratchState` 让整批图共用一份卷积中间缓冲，而不是每张图重新分配一份
 * `w·h·3` 的 Float32Array。
 */

import { doc as docApi, metadata, pipeline, type PixelBuffer, type geometry } from '@photo/core';
import { detectFormat, pushUniqueName, type CodecRegistry, type ZipEntry } from '@photo/io';
import { errorMessage } from './errors.js';
import { baseName } from './paths.js';
import type { Recipe } from './recipe.js';

/** 与内核 geometry.Size 同构，省得调用方再 import 一次。 */
export type Size = geometry.Size;

/** 一份待处理输入。像素在 bytes 里，名字只用于报告与输出命名。 */
export interface RenderInput {
  /** 展示名（通常是文件名）。 */
  readonly name: string;
  /** 输出基准名（不含扩展名）。 */
  readonly baseName: string;
  readonly bytes: Uint8Array;
}

/** 内存门参数：预算由外壳注入（内核不读 `process.env`）。 */
export interface ExportGateOptions {
  /** 预算字节数；缺省走内核默认（2 GB）。 */
  readonly budgetBytes?: number;
  /** 是否授权在原尺寸下超预算执行（CLI 的 `--allow-oversize`）。 */
  readonly allowFullSize?: boolean;
}

export interface PlanRequest {
  readonly recipe: Recipe;
  readonly target: pipeline.RenderTarget;
  /** 内存门参数；缺省则用内核默认预算。 */
  readonly gate?: ExportGateOptions;
}

export interface PlanReport {
  readonly name: string;
  readonly sourceSize: Size;
  readonly outputSize: Size;
  /** 人类可读的阶段描述，与 RenderPlan.stages 一一对应、同序。 */
  readonly stages: readonly string[];
  readonly warnings: readonly pipeline.PlanWarning[];
  readonly memory: pipeline.MemoryEstimate;
  /** 导出内存门判定（策略来自内核，CLI 只翻译成行为与文案）。 */
  readonly gate: pipeline.ExportGate;
}

export type PlanOutcome =
  | { readonly ok: true; readonly report: PlanReport }
  | { readonly ok: false; readonly name: string; readonly error: string };

export interface RenderRequest extends PlanRequest {
  readonly format: string;
  readonly quality: number;
  readonly outputName: string;
}

export type RenderOutcome =
  | {
      readonly ok: true;
      readonly report: PlanReport;
      readonly outputName: string;
      readonly bytes: Uint8Array;
    }
  | { readonly ok: false; readonly name: string; readonly error: string };

/** 跨图复用的重负载缓冲（对应 P1-4）。批处理里整批共用一份。 */
export interface ScratchState {
  buffer?: Float32Array;
}

export interface ImageInfo {
  readonly name: string;
  readonly format: string;
  /** 显示态尺寸（EXIF 朝向置换后）—— 与渲染实际吃进去的一致。 */
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** 置换前的存储态尺寸；朝向未换轴时与上面相同。 */
  readonly storedWidth: number;
  readonly storedHeight: number;
  /** 朝向码 + 参数一行，取自内核（与桌面信息条**同一份**格式化，见 X1/X4）。 */
  readonly orientation: string;
  readonly exif: string;
}

export type InfoOutcome =
  | { readonly ok: true; readonly info: ImageInfo }
  | { readonly ok: false; readonly name: string; readonly error: string };

/* ────────────────────────────── 阶段描述 ────────────────────────────── */

/**
 * 把一个渲染阶段写成人话。
 *
 * switch 覆盖联合类型的全部成员且没有 default —— 于是**新增阶段而忘了
 * 在这里描述它，编译就会失败**。展示层的完备性也由编译器兜着。
 */
function describeStage(stage: pipeline.RenderStage): string {
  switch (stage.kind) {
    case 'raster': {
      const bits: string[] = [];
      if (stage.rotate !== 0) bits.push(`旋转${stage.rotate}°`);
      if (stage.flipH) bits.push('水平镜像');
      if (stage.flipV) bits.push('垂直镜像');
      if (stage.straighten !== 0) bits.push(`校正${stage.straighten}°`);
      if (stage.border > 0) bits.push(`边框${stage.border}px`);
      bits.push(`${stage.contentSize.w}×${stage.contentSize.h}`);
      return `raster(${bits.join(' ')})`;
    }
    case 'collage':
      return `collage(${stage.tiles.length} 贴片 ${stage.contentSize.w}×${stage.contentSize.h})`;
    case 'levels': {
      const ch = (c: { lo: number; hi: number; gain: number }): string =>
        `${c.lo}-${c.hi}×${Math.round(c.gain * 1000) / 1000}`;
      return `levels(r${ch(stage.levels.r)} g${ch(stage.levels.g)} b${ch(stage.levels.b)})`;
    }
    case 'color': {
      const { brightness, contrast, saturate, exposure } = stage.params;
      const bits: string[] = [];
      if (brightness !== 100) bits.push(`亮度${brightness}`);
      if (contrast !== 100) bits.push(`对比${contrast}`);
      if (saturate !== 100) bits.push(`饱和${saturate}`);
      if (exposure !== 0) bits.push(`曝光${exposure}`);
      return `color(${bits.join(' ')})`;
    }
    case 'warm':
      return `warm(${stage.warm})`;
    case 'soften':
      return `soften(${stage.amount})`;
    case 'grade':
      return 'grade(曲线/分调)';
    case 'vignette':
      return `vignette(${stage.amount})`;
    case 'grain':
      return `grain(${stage.amount})`;
    case 'enhance':
      return `enhance(锐化${stage.sharpen} 去雾${stage.dehaze})`;
    case 'weather':
      return `weather(雨${stage.rain} 雾${stage.fog})`;
    case 'text': {
      const bits: string[] = [];
      if (stage.watermark.text.trim() !== '') bits.push('水印');
      if (stage.sticker.text.trim() !== '') bits.push('贴纸');
      return `text(${bits.join('+')})`;
    }
  }
}

/** 导出供报告层与测试复用。 */
export function describeStages(plan: pipeline.RenderPlan): readonly string[] {
  return plan.stages.map(describeStage);
}

/* ──────────────────────────── 文档与计划的构造 ──────────────────────────── */

/** 把解码结果转成内核的 PixelBuffer。显式构造，顺带把结构兼容落成一处注释。 */
function toPixelBuffer(decoded: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): PixelBuffer {
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

/**
 * 构造待渲染文档。
 *
 * 先把**真实尺寸**以 setSources 压入，再重放配方 —— 于是同一份配方
 * 可以套在任意尺寸的图上，几何与拼图数学永远拿到正确的宽高。
 *
 * 传进来的 `size` 必须是**显示态**（朝向已在 `makePlan` 置换过），
 * `orientation` 只作留痕写进 ref —— 渲染读到它才会出错，所以它不进任何计算。
 */
function buildDocument(
  recipe: Recipe,
  size: Size,
  sourceName: string,
  orientation: metadata.ExifOrientation | null,
): docApi.PhotoDocument {
  const source: docApi.SourceRef = {
    id: 'src-0',
    name: sourceName,
    width: size.w,
    height: size.h,
    ...(orientation === null ? {} : { exifOrientation: orientation }),
  };
  let document: docApi.PhotoDocument = docApi.createDocument();
  document = docApi.pushOp(document, { k: 'setSources', value: [source], current: 0 });
  for (const op of recipe.ops) {
    document = docApi.pushOp(document, op);
  }
  return document;
}

interface Planned {
  /** 解码得到的源像素（`renderOne` 要用它执行；只解码一次）。**已是显示态**。 */
  readonly source: PixelBuffer;
  /** 按请求尺寸（`target.maxEdge`）建出的计划。 */
  readonly plan: pipeline.RenderPlan;
  /** 内存门判定。 */
  readonly gate: pipeline.ExportGate;
  /** 按任意 `maxEdge` 重建计划 —— 降采样复用**同一个** `buildPlan`，于是"预览==导出同源"不破。 */
  readonly planFor: (maxEdge: number) => pipeline.RenderPlan;
}

function makePlan(
  input: RenderInput,
  request: PlanRequest,
  registry: CodecRegistry,
): Planned {
  /* EXIF 朝向在**导入这一步**置换一次（内核 D13），与桌面端的 session 同一处语义：
   * 两端都是"解码 → 按容器里的朝向码重排像素 → 用显示态尺寸建计划"，
   * 于是同一份配方在两端拿到的是同样的输入像素 —— X1 的逐字节一致由此成立。 */
  const read = metadata.readExif(input.bytes);
  const source = metadata.applyOrientation(
    toPixelBuffer(registry.decode(input.bytes)),
    metadata.exifOrientationOf(read),
  );
  const document = buildDocument(
    request.recipe,
    { w: source.width, h: source.height },
    input.name,
    metadata.exifOrientationOf(read),
  );
  const planFor = (maxEdge: number): pipeline.RenderPlan =>
    pipeline.buildPlan(document, { ...request.target, maxEdge });
  const plan = planFor(request.target.maxEdge);
  const gate = pipeline.gateExport({
    plan,
    planFor,
    ...(request.gate?.budgetBytes === undefined
      ? {}
      : { budgetBytes: request.gate.budgetBytes }),
    ...(request.gate?.allowFullSize === undefined
      ? {}
      : { explicitFullSize: request.gate.allowFullSize }),
  });
  return { source, plan, gate, planFor };
}

/** 门若不允许执行，返回**可执行的原因**；允许则返回 null。 */
function gateBlockReason(gate: pipeline.ExportGate, allowFullSize: boolean): string | null {
  if (gate.decision === 'reject') return gate.message;
  if (gate.decision === 'confirm' && !allowFullSize) {
    return `${gate.message} 若确认继续，请加 --allow-oversize。`;
  }
  return null;
}

/** 门建议降采样时就换用降采样计划（同一 `buildPlan`，只改 `maxEdge`）。 */
function selectPlan(planned: Planned): pipeline.RenderPlan {
  return planned.gate.decision === 'downscale'
    ? planned.planFor(planned.gate.maxEdge)
    : planned.plan;
}

function toReport(
  name: string,
  plan: pipeline.RenderPlan,
  gate: pipeline.ExportGate,
): PlanReport {
  return {
    name,
    sourceSize: plan.sourceSize,
    outputSize: plan.outputSize,
    stages: describeStages(plan),
    warnings: plan.warnings,
    memory: pipeline.estimateMemory(plan),
    gate,
  };
}

/** 是否含卷积类阶段（磨皮 / 锐化去雾）—— 决定要不要准备 scratch。 */
function needsScratch(plan: pipeline.RenderPlan): boolean {
  if (plan.warnings.some((w) => w.code === 'oversize')) return false;
  return plan.stages.some((s) => s.kind === 'soften' || s.kind === 'enhance');
}

/* ─────────────────────────────── 单张处理 ─────────────────────────────── */

/** 只算计划，不渲染。用于 `photo plan` 与配方调试。 */
export function planOne(
  input: RenderInput,
  request: PlanRequest,
  registry: CodecRegistry,
): PlanOutcome {
  try {
    const planned = makePlan(input, request, registry);
    const blocked = gateBlockReason(planned.gate, request.gate?.allowFullSize === true);
    if (blocked !== null) return { ok: false, name: input.name, error: blocked };
    // 预演与真实渲染必须看到同一个尺寸 —— 否则"预演说 OK、真跑被拒"就是报告层的分裂。
    return { ok: true, report: toReport(input.name, selectPlan(planned), planned.gate) };
  } catch (e) {
    return { ok: false, name: input.name, error: errorMessage(e) };
  }
}

/**
 * 批量出计划。
 *
 * 读取器以参数注入：真实调用传 `readInput`（文件系统），
 * 测试传内存里的假读取器 —— 于是"读取失败也是一条结果"这条规则
 * 可以被离线验证，不需要造真实坏文件。
 */
export function planPaths(
  paths: readonly string[],
  read: (path: string) => RenderInput,
  request: PlanRequest,
  registry: CodecRegistry,
): readonly PlanOutcome[] {
  return paths.map((path) => {
    try {
      return planOne(read(path), request, registry);
    } catch (e) {
      return { ok: false, name: path, error: errorMessage(e) };
    }
  });
}

/** 渲染一张图。失败被收敛成结果对象 —— 批处理不该因为一张图崩掉整批。 */
export function renderOne(
  input: RenderInput,
  request: RenderRequest,
  registry: CodecRegistry,
  scratch: ScratchState = {},
): RenderOutcome {
  try {
    const planned = makePlan(input, request, registry);
    const blocked = gateBlockReason(planned.gate, request.gate?.allowFullSize === true);
    if (blocked !== null) return { ok: false, name: input.name, error: blocked };

    // 门建议降采样 → 用门给出的长边重建计划（同一 buildPlan，只差 maxEdge）。
    const plan = selectPlan(planned);

    // 只在真的有卷积阶段时才申请 scratch：24MP 且无磨皮时白白吃 288MB 是不可接受的。
    if (needsScratch(plan)) {
      scratch.buffer = pipeline.ensureScratch(
        scratch.buffer,
        plan.outputSize.w,
        plan.outputSize.h,
      );
    }
    const rendered = pipeline.executePlan(
      [planned.source],
      plan,
      scratch.buffer === undefined ? {} : { scratch: scratch.buffer },
    );
    const bytes = registry.encode(request.format, rendered, request.quality);

    return {
      ok: true,
      report: toReport(input.name, plan, planned.gate),
      outputName: request.outputName,
      bytes,
    };
  } catch (e) {
    return { ok: false, name: input.name, error: errorMessage(e) };
  }
}

/* ─────────────────────────────── 批处理 ─────────────────────────────── */

export interface BatchJob {
  /** 展示名（读取失败时也得有个名字可报）。 */
  readonly name: string;
  /** 读取成功的输入；读取失败时为 null。 */
  readonly input: RenderInput | null;
  /** 读取失败原因；成功时为 null。 */
  readonly error: string | null;
  readonly outputName: string;
}

export interface BatchOptions {
  readonly recipe: Recipe;
  readonly target: pipeline.RenderTarget;
  readonly format: string;
  readonly quality: number;
  /** 内存门参数；整批共用同一份预算。 */
  readonly gate?: ExportGateOptions;
}

export interface BatchResult {
  readonly outcomes: readonly RenderOutcome[];
  readonly okCount: number;
  readonly failCount: number;
  /** 整批实际用掉的 scratch 字节数（0 表示没有卷积阶段）。 */
  readonly scratchBytes: number;
}

/**
 * 顺序处理一批图，整批共用一份 scratch。
 *
 * 读取失败（文件不存在 / 不是普通文件）也走同一条结果通道 ——
 * 于是"某个输入有问题"是一条可报告的失败，而不是中断整批的异常。
 * 这在批处理里是必须的：跑 200 张图时，一张坏文件不该让另外 199 张白跑。
 */
export function runBatch(
  jobs: readonly BatchJob[],
  options: BatchOptions,
  registry: CodecRegistry,
): BatchResult {
  const scratch: ScratchState = {};
  const outcomes: RenderOutcome[] = [];
  let okCount = 0;

  for (const job of jobs) {
    if (job.input === null) {
      outcomes.push({ ok: false, name: job.name, error: job.error ?? '读取失败。' });
      continue;
    }
    const outcome = renderOne(
      job.input,
      {
        recipe: options.recipe,
        target: options.target,
        format: options.format,
        quality: options.quality,
        outputName: job.outputName,
        ...(options.gate === undefined ? {} : { gate: options.gate }),
      },
      registry,
      scratch,
    );
    if (outcome.ok) okCount += 1;
    outcomes.push(outcome);
  }

  return {
    outcomes,
    okCount,
    failCount: outcomes.length - okCount,
    scratchBytes: scratch.buffer?.byteLength ?? 0,
  };
}

/* ─────────────────────────────── 头信息 ─────────────────────────────── */

/**
 * 把一批渲染结果整理成 ZIP 条目。
 *
 * 条目名取输出文件的**文件名**（丢掉 `--out` 那几层目录，否则解压出来凭空
 * 多出目录）；重名交给 `pushUniqueName` —— 两个不同目录下的同名输入是最常见
 * 的踩坑，而重名条目解压时会互相覆盖，用户丢图却毫无提示。
 *
 * 之所以抽在渲染层而不是写在 `main.ts`：`main` 是"读 argv → 调函数 → 打印"
 * 的薄壳（且模块加载即执行），归档命名规则留在里面就只能靠人肉跑一遍验证。
 */
export function zipEntriesOf(outcomes: readonly RenderOutcome[]): ZipEntry[] {
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const outcome of outcomes) {
    if (!outcome.ok) continue;
    entries.push({ name: pushUniqueName(used, baseName(outcome.outputName)), bytes: outcome.bytes });
  }
  return entries;
}

/** 读图片头信息。用于 `photo info`，也用于排查"为什么这张图没处理"。 */
export function infoOne(input: RenderInput, registry: CodecRegistry): InfoOutcome {
  try {
    const format = detectFormat(input.bytes);
    const codec = registry.resolve(input.bytes);
    if (codec === undefined) {
      const registered = registry.list().map((c) => c.format).join(', ');
      throw new Error(`没有可用的解码器（探测到格式：${format}）。已注册：${registered}`);
    }
    const decoded = codec.decode(input.bytes);
    /* 头信息也走"朝向置换后"的口径：`info` 报的尺寸若和渲染真正吃的尺寸不一致，
     * 它就成了排查时的假线索 —— 那正是这个命令存在的目的。 */
    const read = metadata.readExif(input.bytes);
    const orientation = metadata.exifOrientationOf(read);
    const shown = metadata.orientedSize(
      { w: decoded.width, h: decoded.height },
      orientation,
    );
    return {
      ok: true,
      info: {
        name: input.name,
        format,
        width: shown.w,
        height: shown.h,
        storedWidth: decoded.width,
        storedHeight: decoded.height,
        orientation: metadata.describeOrientation(orientation),
        exif: metadata.formatExif(read),
        bytes: input.bytes.length,
      },
    };
  } catch (e) {
    return { ok: false, name: input.name, error: errorMessage(e) };
  }
}
