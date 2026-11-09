/**
 * 冒烟自检 —— 在**真实 Electron 渲染进程**里跑一遍全链路。
 *
 * ── 它到底补上了什么 ──────────────────────────────────────────────
 * 单元测试（session/image-io/text-renderer）用假画布覆盖了业务逻辑；
 * 但"真实 Canvas 能不能编码出合法 PNG""preload 桥通不通""窗口配置对不对"
 * 这三件事假画布查不出来。冒烟测试就是补这一段的。
 *
 * 与单元的**边界**要说清楚：
 *   - 单元测试证明"逻辑对"；
 *   - 冒烟证明"这套逻辑真的接在 Chromium 上能跑"。
 * 两者都不替代对方。冒烟跑得快、断言粗，是为了一次真实点击级别的保证。
 *
 * 素材用 `createSampleImage` 现生成，不往仓库塞测试图片。
 */
import { doc as docApi, metadata, pipeline, presets, type PixelBuffer } from '@photo/core';
import { decodeJpeg } from '@photo/io';
import { firstByteDiff, hasMagic } from './bytes.js';
import { createSampleImage } from './sample-image.js';
import { EditSession } from './session.js';
import { shellBridge, type SmokeCheck, type SmokeReport } from './shell-api.js';
import {
  createBrowserEncodableFactory,
  createBrowserRenderKit,
  decodeBitmap,
} from './shell-adapter.js';
import { createRenderPort } from './worker-port.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 800;

function check(name: string, ok: boolean, detail?: string): SmokeCheck {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

/* ── C2 的白名单容差 ─────────────────────────────────────────────────
   两个独立实现之间没有"逐字节"这条路（`docs/P6E-PLAN.md` §5.1），所以按
   **差异的来源**拆开，各给一个上限，而不是塞进一个笼统的大容差：
     · Y：两边读的是同一组 DCT 系数，只可能差在 IDCT 的取整路径上
       （Chromium 走 libjpeg-turbo 的整数 islow，内核走浮点）。给 8。
     · 色度：4:2:0 还多一层上采样，而两边插值口径不同（Chromium 是合并式
       fancy upsample，内核是中心对齐线性）。这份差没有解析上界，只能实测钉。
     · 均值：合法误差集中在少数像素上；MCU 对不齐、Cb/Cr 互换、行跨度算错
       这类**结构性**错误会让整幅图的均值一起崩 —— 所以"均值很小"本身就是
       "结构没错"的证据，它比任何单点上限都能抓住要害。
   数值是按上面三条推理给的，**尚未在真机上量过**（本轮只跑到离线门）。
   第一次 smoke 跑通后把实测值记进 §3.4.1，并且只许往下调、
   不许因为红了就往上抬。 */
const C2_Y_TOLERANCE = 8;
const C2_CHROMA_TOLERANCE = 32;
const C2_MEAN_TOLERANCE = 1.5;

interface CrossDecodeStats {
  readonly maxChroma: number;
  readonly maxLuma: number;
  readonly maxRgb: number;
  readonly meanRgb: number;
  /** 同一坐标上 RGB 三通道全等的像素占比（0..1），只报数不当门。 */
  readonly exactRate: number;
  /** 差异最大那个像素的坐标。 */
  readonly worst: string;
}

/**
 * C2 用：把两份解码结果按 Y / 色度 / 均值分开量。
 *
 * 转换按 JFIF 全范围系数正向做一遍（不是反解），与内核解码器里的
 * YCbCr→RGB 是同一条公式，于是这里的差就是两边像素的差本身，
 * 不掺进第二套换算口径。
 */
function compareCrossDecoder(a: PixelBuffer, b: PixelBuffer): CrossDecodeStats {
  const n = Math.min(a.width * a.height, b.width * b.height);
  let maxLuma = 0;
  let maxChroma = 0;
  let maxRgb = 0;
  let sumRgb = 0;
  let exact = 0;
  let worstAt = 0;
  let worstSum = -1;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    maxRgb = Math.max(maxRgb, dr, dg, db);
    sumRgb += dr + dg + db;
    if (dr === 0 && dg === 0 && db === 0) exact += 1;
    if (dr + dg + db > worstSum) {
      worstSum = dr + dg + db;
      worstAt = i;
    }
    const ya = 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
    const yb = 0.299 * b.data[o] + 0.587 * b.data[o + 1] + 0.114 * b.data[o + 2];
    const ca = -0.168736 * a.data[o] - 0.331264 * a.data[o + 1] + 0.5 * a.data[o + 2];
    const cb = -0.168736 * b.data[o] - 0.331264 * b.data[o + 1] + 0.5 * b.data[o + 2];
    const ra = 0.5 * a.data[o] - 0.418688 * a.data[o + 1] - 0.081312 * a.data[o + 2];
    const rb = 0.5 * b.data[o] - 0.418688 * b.data[o + 1] - 0.081312 * b.data[o + 2];
    maxLuma = Math.max(maxLuma, Math.abs(ya - yb));
    maxChroma = Math.max(maxChroma, Math.abs(ca - cb), Math.abs(ra - rb));
  }
  return {
    maxLuma,
    maxChroma,
    maxRgb,
    meanRgb: sumRgb / (n * 3),
    exactRate: exact / n,
    worst: `${worstAt % a.width},${Math.floor(worstAt / a.width)}`,
  };
}

/**
 * C2 的独立参照：直接问 Chromium 的解码器要一份像素。
 *
 * 这**不是**应用路径 —— 桌面的 JPEG 解码已改走内核，为的是与 CLI 逐字节同源。
 * 这里借 Chromium 纯粹当第二套实现来照："手写解码器自洽地错"的时候，
 * 单元用例的码流和它出自同一个夹具，照不出来；另一套实现才照得出来。
 * `imageOrientation:'none'` 由 `decodeBitmap` 保证：朝向归内核，参照侧也不许先转。
 */
async function chromiumOracle(bytes: Uint8Array): Promise<PixelBuffer> {
  const bitmap = await decodeBitmap(bytes, 'image/jpeg');
  try {
    const surface = createBrowserEncodableFactory().create(bitmap.width, bitmap.height);
    surface.ctx().drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    const image = surface.readPixels(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  } finally {
    bitmap.close?.();
  }
}

/**
 * 把切图分片**解码回来**并贴回一张整图。
 *
 * 刻意在冒烟里重新实现一遍边界（`round(i·L/n)`）而不是 import 内核的
 * `gridBoundaries`：这样"切片写错位置"才会露出来 —— 若两边共用同一段
 * 逻辑，同一个错误会在读写两侧互相抵消，验证就白做了。
 */
async function reassembleSlices(
  io: { decode(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray }> },
  entries: readonly { name: string; bytes: Uint8Array }[],
  width: number,
  height: number,
  cols: number,
  rows: number,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const out = new Uint8ClampedArray(width * height * 4);
  const boundary = (len: number, parts: number, i: number): number => Math.round((i * len) / parts);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const tile = await io.decode(entries[index].bytes);
      const x0 = boundary(width, cols, col);
      const y0 = boundary(height, rows, row);
      for (let y = 0; y < tile.height; y += 1) {
        const from = y * tile.width * 4;
        const to = ((y0 + y) * width + x0) * 4;
        out.set(tile.data.subarray(from, from + tile.width * 4), to);
      }
    }
  }
  return { width, height, data: out };
}

/** 最小 TIFF：IFD0 只有一条 `Orientation = 6`（小端，26 字节）。 */
const TIFF_ORIENT_6 = Uint8Array.from([
  0x49, 0x49, 0x2a, 0x00, // "II" + 42
  0x08, 0x00, 0x00, 0x00, // IFD0 在偏移 8
  0x01, 0x00, // 1 条目录项
  0x12, 0x01, // tag 0x0112 = Orientation
  0x03, 0x00, // type SHORT
  0x01, 0x00, 0x00, 0x00, // count 1
  0x06, 0x00, 0x00, 0x00, // value = 6（内联在目录项里）
  0x00, 0x00, 0x00, 0x00, // 无后续 IFD
]);

/**
 * 把 EXIF 段插成真实 JPEG 的 APP1（SOI 之后）。
 *
 * 画布编码器**不写 EXIF**（`convertToBlob` 没有这个入口），所以带朝向的相机图
 * 只能手工造：先让 Chromium 真编码出一张合法 JPEG，再塞进 APP1。
 * 这样造出来的字节同时验到三件事 —— Chromium 认这段 APP1、
 * 平台层没有替内核转（`imageOrientation:'none'` 真的生效）、内核按码置换了一次。
 */
function withApp1(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  payload.set(tiff, 6);
  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  const length = payload.length + 2; // 段长度字段含它自己那 2 字节
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(payload, 4);

  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

async function run(): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];

  /* ── 平台能力真的存在吗（这条失败说明运行环境不是渲染进程）── */
  checks.push(
    check(
      'OffscreenCanvas / createImageBitmap 可用',
      typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function',
    ),
  );

  /* ── 序 5 / A1：真 Worker 端口 ──────────────────────────────────────
   *
   * 这条探的不是"能不能 new 一个 Worker"，而是**模块 Worker 能不能解析
   * `app://core/index.js`**。import map 只作用于文档、不作用于 Worker，
   * 于是 Worker 里的裸说明符必然失败 —— 内核只能靠绝对 URL 拉进来。
   * 而 Worker 的导入图里 `engine.js` 是**静态**导入内核的，因此"握手成功"
   * 等价于"内核已在 Worker 线程里解析并执行完毕"。
   *
   * 失败不致命（端口会自动退回内联，功能不降级），但必须**露出原因** ——
   * 否则"Worker 悄悄没用上"会伪装成一切正常，而 A1 的验收正好落空。 */
  const renderPort = await createRenderPort();
  /* 与 `renderer/app.ts` 同一处接线：JPEG 解码交给端口的解码入口。
   * 于是下面所有导入 JPEG 的断言，走的都是**用户真机会走的那条路** ——
   * 冒烟若不走 Worker 解码，它就只证明了内联那一半。
   *
   * 计数器数的不是"解得对不对"，是"这条链还挂在别的线程上吗"：接线一旦退回
   * `createBrowserRenderKit()`（不带参数），像素照样逐字节全对、单测照样全绿，
   * 只有这里会掉回 0。静默的性能回退正是最难发现的那一类。 */
  let throughPortDecodes = 0;
  const kit = createBrowserRenderKit({
    jpegDecoder: (bytes) => {
      throughPortDecodes += 1;
      return renderPort.decodeJpeg(bytes);
    },
  });
  checks.push(
    check(
      '渲染 Worker 端口可用（模块 Worker + app:// 内核解析）',
      renderPort.kind === 'worker',
      renderPort.kind === 'worker' ? undefined : renderPort.reason,
    ),
  );

  /* 主会话**跑在真 Worker 上** —— 于是下面六十多条断言全部都在跨线程链路上
   * 真的走了一遍，而不是"另跑一条只在冒烟里才用的路径"。这正是冒烟的职责：
   * 证明这套逻辑接在 Chromium 上、接在真线程边界上，仍然成立。 */
  const session = new EditSession({
    imageIo: kit.imageIo,
    textRenderer: kit.textRenderer,
    port: renderPort.port,
  });

  /* ── 导入 ── */
  const sample = createSampleImage(SOURCE_WIDTH, SOURCE_HEIGHT);
  const info = session.importPixels(sample, 'sample.png');
  checks.push(
    check(
      '导入后记录的是真实尺寸',
      info.width === SOURCE_WIDTH && info.height === SOURCE_HEIGHT,
      `${info.width}×${info.height}`,
    ),
  );

  /* ── 验收 H：缓存复用 ── */
  const cold = await session.renderPreview();
  checks.push(
    check(
      '首帧预览为冷启动（未命中缓存）',
      cold.stats.reused === 0 && cold.stats.computed > 0,
      `reused=${cold.stats.reused} computed=${cold.stats.computed}`,
    ),
  );

  const warm = await session.renderPreview();
  checks.push(
    check(
      '同文档重渲染全部复用缓存',
      warm.stats.reused === cold.stats.computed && warm.stats.computed === 0,
      `reused=${warm.stats.reused} computed=${warm.stats.computed}`,
    ),
  );

  const uncached = await session.renderPreviewUncached();
  const diff = firstByteDiff(warm.pixels.data, uncached.data);
  checks.push(
    check(
      '缓存复用结果 === 全量重算（逐字节）',
      diff === -1,
      diff === -1 ? undefined : `首个不同字节 @${diff}`,
    ),
  );

  /* ── 预设 + 末端调参：前缀仍应被复用 ── */
  session.applyPreset('rainy_dark', 0.8);
  await session.renderPreview();
  session.setParam('vignette', 80);
  const afterTail = await session.renderPreview();
  checks.push(
    check(
      '改末端参数后仍复用前缀',
      afterTail.stats.reused > 0,
      `reused=${afterTail.stats.reused} computed=${afterTail.stats.computed}`,
    ),
  );

  /* ── #2 预设强度：强度不是"另一个数字"，它就是参数的生成系数 ── */
  session.applyPreset('film', 1);
  const fullStrength = await session.renderPreviewUncached();
  session.setPresetIntensity(0.5);
  const halfStrength = await session.renderPreviewUncached();
  checks.push(
    check(
      '强度 0.5 与满强度的渲染结果不同（强度确实进了管线）',
      firstByteDiff(fullStrength.data, halfStrength.data) !== -1,
      `intensity=${session.state.presetIntensity}`,
    ),
    check(
      '强度写回 EditState.presetIntensity（不另存一份）',
      Math.abs(session.state.presetIntensity - 0.5) < 1e-9,
      `intensity=${session.state.presetIntensity}`,
    ),
  );
  /* 强度 0 == 中性：产物应与"还原(无滤镜)"逐字节一致 —— 这是强度语义的锚。 */
  session.setPresetIntensity(0);
  const zeroStrength = await session.renderPreviewUncached();
  session.applyPreset('none', 1);
  const neutralPreset = await session.renderPreviewUncached();
  checks.push(
    check(
      '强度 0 的产物与「还原(无滤镜)」逐字节一致',
      firstByteDiff(zeroStrength.data, neutralPreset.data) === -1,
      (() => {
        const d = firstByteDiff(zeroStrength.data, neutralPreset.data);
        return d === -1 ? undefined : `首个不同字节 @${d}`;
      })(),
    ),
  );
  /* 还原到本段之前的编辑状态，避免影响后续断言（rainy_dark@0.8 + 手调暗角）。 */
  session.applyPreset('rainy_dark', 0.8);
  session.setParam('vignette', 80);

  /* ── 验收 F：导出与预览同源 ── */
  const kinds = session.previewPlanSummary().kinds;
  checks.push(
    check(
      '预览与导出阶段序列一致',
      kinds.join(',') === session.exportPlanSummary().kinds.join(','),
      kinds.join(' → '),
    ),
  );

  const previewPixels = await session.renderPreviewUncached();
  const exportPixels = await session.renderExport();
  /* 源图长边 1200 < 预览上限 1400，预览没有缩放，两条路径必须逐字节相同。 */
  const feDiff = firstByteDiff(previewPixels.data, exportPixels.data);
  checks.push(
    check(
      '预览与导出像素逐字节相同（尺寸未触发压缩时）',
      feDiff === -1,
      feDiff === -1 ? undefined : `首个不同字节 @${feDiff}`,
    ),
  );

  /* ── 文字：真实 Canvas 栅格化 ── */
  session.setWatermarkText('琉璃 · smoke');
  const marked = await session.renderPreviewUncached();
  const textDiff = firstByteDiff(marked.data, previewPixels.data);
  checks.push(
    check(
      '水印经真实 Canvas 栅格化后确实改动了像素',
      textDiff !== -1,
      textDiff === -1 ? '像素完全没变 —— 文字阶段没生效' : undefined,
    ),
  );

  /* ── 导出 + 真实 PNG 往返 ── */
  const exported = await session.exportBytes('png', 92);
  checks.push(
    check('导出字节带合法 PNG magic', hasMagic(exported.bytes, PNG_MAGIC), `${exported.bytes.length} 字节`),
  );
  checks.push(
    check(
      '导出尺寸等于源尺寸',
      exported.width === SOURCE_WIDTH && exported.height === SOURCE_HEIGHT,
      `${exported.width}×${exported.height}`,
    ),
  );

  /* 解回来比对：这是真实编解码路径（Chromium 的 PNG 编码器 + 解码器）的
   * 端到端证明。PNG 无损，因此必须逐字节还原 —— 若不成立说明编码或
   * 像素搬运环节丢了东西。
   *
   * 注意比较对象要**现取**（`renderExport()`），不能复用上面那份水印前的快照：
   * 内核是确定性的，但两份快照对应的是**不同的编辑状态**。
   * （这条检查第一版就是这么写错的，报了一个看起来像产品缺陷的假警报 ——
   *   差异像素恰好落在水印字形框内。） */
  const roundTrip = await kit.imageIo.decode(exported.bytes, 'image/png');
  const currentExport = await session.renderExport();
  const rtDiff = firstByteDiff(roundTrip.data, currentExport.data);
  checks.push(
    check(
      'PNG 编码 → 解码往返逐字节还原',
      rtDiff === -1 && roundTrip.width === currentExport.width && roundTrip.height === currentExport.height,
      rtDiff === -1 ? undefined : `首个不同字节 @${rtDiff}`,
    ),
  );

  /* ── 序 3 追加：12 调色参数 / 几何全 / 导出选项 / 内存门 ── */

  /* 12 个调色参数每个都能设进去并读回来。 */
  const adjustKeys = Object.keys(presets.PARAM_RANGE) as presets.AdjustKey[];
  let allParamsOk = true;
  let paramDetail = '';
  for (const key of adjustKeys) {
    const [lo, hi] = presets.PARAM_RANGE[key];
    const mid = Math.round((lo + hi) / 2);
    session.setParam(key, mid);
    if (session.state.params[key] !== mid) {
      allParamsOk = false;
      paramDetail = `${key}：期望 ${mid} 实际 ${session.state.params[key]}`;
      break;
    }
  }
  checks.push(
    check(
      `12 个调色参数全部可设（共 ${adjustKeys.length} 个）`,
      allParamsOk && adjustKeys.length === 12,
      allParamsOk ? undefined : paramDetail,
    ),
  );

  /* 垂直翻转：flipV 取反。 */
  const flipBefore = session.state.geometry.flipV;
  session.flipVertical();
  checks.push(check('垂直翻转切换 geometry.flipV', session.state.geometry.flipV === !flipBefore));

  /* 水平校正：straighten 写入角度（-15..15 边界另测）。 */
  session.setStraighten(7);
  const straightenOk = session.state.geometry.straighten === 7;
  session.setStraighten(-15);
  const straightenBoundaryOk = session.state.geometry.straighten === -15;
  session.setStraighten(0);
  checks.push(check('水平校正写入角度（-15..15）', straightenOk && straightenBoundaryOk));

  /* JPEG 导出：编码产出合法 JPEG magic。 */
  const jpg = await session.exportBytes('jpeg', 85);
  checks.push(check('导出字节带合法 JPEG magic', hasMagic(jpg.bytes, JPEG_MAGIC), `${jpg.bytes.length} 字节`));

  /* 导出长边：640 上限应让长边收敛且比原尺寸小。 */
  session.setExportMaxEdge(0);
  const fullPx = await session.renderExport();
  session.setExportMaxEdge(640);
  const dsPx = await session.renderExport();
  checks.push(
    check(
      '导出长边 640 收敛长边且 < 原尺寸',
      dsPx.width < fullPx.width && Math.max(dsPx.width, dsPx.height) <= 640,
      `${fullPx.width}×${fullPx.height} → ${dsPx.width}×${dsPx.height}`,
    ),
  );
  session.setExportMaxEdge(0);

  /* ── 序 4 追加：水印进阶 / 贴纸 / HSL 分色 ── */

  /* 水印进阶：位置 / 颜色 / 描边 / 字号 / 不透明度 全部生效。 */
  session.setWatermark({ pos: 'tl', color: '#ff0000', stroke: true, size: 6, alpha: 50, text: 'wm' });
  const wm = session.state.watermark;
  checks.push(
    check(
      '水印进阶全字段生效',
      wm.pos === 'tl' && wm.color === '#ff0000' && wm.stroke === true && wm.size === 6 && wm.alpha === 50 && wm.text === 'wm',
    ),
  );

  /* 贴纸：文字 / 样式 / 位置 / 字号 全部生效。 */
  session.setSticker({ text: 'st', style: 'gold', pos: 'top', size: 9 });
  const st = session.state.sticker;
  checks.push(
    check('贴纸全字段生效', st.text === 'st' && st.style === 'gold' && st.pos === 'top' && st.size === 9),
  );

  /* HSL 八色分调：写入指定色彩带。 */
  session.setBands({ red: { h: 20, s: -30, l: 10 } });
  const band = session.state.bands.red;
  checks.push(check('HSL 分色写入指定色彩带', band.h === 20 && band.s === -30 && band.l === 10));

  /* 序4 曲线编辑器：setCurves 写入 + 改变像素 + reset 回到恒等。 */
  const curveBefore = await session.renderPreviewUncached();
  session.setCurves('rgb', [[0, 0], [128, 210], [255, 255]]);
  const curveAfter = await session.renderPreviewUncached();
  let curveDiff = 0;
  const cb = curveBefore.data;
  const ca = curveAfter.data;
  for (let i = 0; i < cb.length; i += 4) {
    if (cb[i] !== ca[i] || cb[i + 1] !== ca[i + 1] || cb[i + 2] !== ca[i + 2]) {
      curveDiff++;
      if (curveDiff > 200) break;
    }
  }
  const rgbPts = session.state.curves.rgb;
  checks.push(
    check(
      '曲线 setCurves 写入并改变预览像素',
      curveDiff > 200 && rgbPts.length >= 2,
      `差异像素 ${curveDiff}`,
    ),
  );
  session.resetCurve('rgb');
  const rgbReset = session.state.curves.rgb;
  checks.push(
    check(
      '曲线 reset 回到恒等',
      rgbReset.length === 2 &&
        rgbReset[0][0] === 0 &&
        rgbReset[0][1] === 0 &&
        rgbReset[1][0] === 255 &&
        rgbReset[1][1] === 255,
    ),
  );

  /* 序4 #9 口语指令：解析 → 意图 → op 落地 + 诚实 pending。
   * 这几条断言证明"口语真的改了文档状态"，而不是只在提示条上说话。 */
  session.applyKouyu('亮一点');
  checks.push(
    check('口语 亮一点 使 brightness 上升', session.state.params.brightness > 100, `brightness=${session.state.params.brightness}`),
  );

  session.applyKouyu('镜像一下');
  checks.push(check('口语 镜像 切换 geometry.flipH', session.state.geometry.flipH === true));

  session.applyKouyu('套个胶片');
  checks.push(
    check('口语 胶片预设 落到 presetKey', session.state.presetKey === 'film', `presetKey=${session.state.presetKey}`),
  );

  session.applyKouyu('横向拼');
  checks.push(
    check('口语 横向拼 落到 collage.mode=h', session.state.collage.mode === 'h', `mode=${session.state.collage.mode}`),
  );

  const emptyOut = session.applyKouyu('这串字根本不像人话');
  checks.push(check('口语 无意图时返回 empty', emptyOut.empty === true));

  const pendingOut = session.applyKouyu('裁剪一下');
  checks.push(
    check(
      '口语 裁剪 被识别但未落地（pending，待 #14 接 UI）',
      pendingOut.empty === false && pendingOut.applied.length === 0 && pendingOut.pending.length > 0,
      `pending=${pendingOut.pending.join(',')}`,
    ),
  );

  /* 序4 #14 裁切：归一化裁切框按比例收敛输出尺寸，setCrop(null) 复原。
   * 先切回单图模式 —— 裁切只在单图模式下生效。 */
  session.applyKouyu('单图精修');
  const cropBefore = await session.renderExport();
  session.setCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  const cropAfter = await session.renderExport();
  checks.push(
    check(
      '裁切 setCrop 按归一化比例收敛输出尺寸',
      cropAfter.width === Math.round(cropBefore.width * 0.5) &&
        cropAfter.height === Math.round(cropBefore.height * 0.5),
      `${cropBefore.width}×${cropBefore.height} → ${cropAfter.width}×${cropAfter.height}`,
    ),
  );
  session.setCrop(null);
  const cropReset = await session.renderExport();
  checks.push(
    check(
      '裁切 setCrop(null) 恢复原尺寸',
      cropReset.width === cropBefore.width && cropReset.height === cropBefore.height,
      `${cropReset.width}×${cropReset.height}`,
    ),
  );

  /* ── 序 4 追加：#22 多图 / #15 拼图 / #16 切图 / #17 边框 ── */

  /* #22 多图：替换为 2 张不同长宽方向的图，再追加第 3 张。 */
  session.importPixels(createSampleImage(600, 400), 'a.png');
  session.addPixels(createSampleImage(400, 600), 'b.png');
  session.addPixels(createSampleImage(300, 300), 'c.png');
  checks.push(
    check(
      '多图：追加源图后源图数为 3 且选中最后一张',
      session.sourceCount === 3 && session.currentIndex === 2,
      `count=${session.sourceCount} current=${session.currentIndex}`,
    ),
  );

  /* 切换当前源图必须改变渲染结果。
   * 这条不是废话：`executePlan` 的光栅阶段固定取 `sources[0]`，若壳把
   * 全部源图都喂进去，"换图"会**静默失效**（数字都对，画面不变）。 */
  session.setCurrentSource(0);
  const widePx = await session.renderPreviewUncached();
  session.setCurrentSource(1);
  const tallPx = await session.renderPreviewUncached();
  checks.push(
    check(
      '多图：切换当前源图改变渲染（宽高随之互换）',
      widePx.width === 600 && widePx.height === 400 && tallPx.width === 400 && tallPx.height === 600,
      `${widePx.width}×${widePx.height} → ${tallPx.width}×${tallPx.height}`,
    ),
  );

  const thumb = session.thumbnailAt(0);
  checks.push(
    check(
      '多图：缩略图经内核重采样到长边 ≤ 256',
      thumb !== null && Math.max(thumb.width, thumb.height) <= 256,
      thumb === null ? '返回 null' : `${thumb.width}×${thumb.height}`,
    ),
  );

  /* #15 拼图：横向拼接首步为 collage，输出比单图更宽。 */
  session.setCurrentSource(1);
  session.setGeometry({ ...session.state.geometry, rotate: 0, flipH: false, flipV: false });
  session.setCollage({ mode: 'single', borderWidth: 0 });
  const singlePx = await session.renderExport();
  session.setCollage({ mode: 'h', gap: 8 });
  const hPx = await session.renderExport();
  checks.push(
    check(
      '拼图：横向拼接产出 collage 阶段且总宽 > 单图',
      session.exportPlanSummary().kinds[0] === 'collage' && hPx.width > singlePx.width,
      `单图 ${singlePx.width} → 横拼 ${hPx.width}（阶段 ${session.exportPlanSummary().kinds.join(',')}）`,
    ),
  );

  /* 网格拼图：3 张源图 → 2 列 2 行，输出收敛到内核的基准尺寸。 */
  session.setCollage({ mode: 'grid', gap: 4 });
  const gridPx = await session.renderExport();
  checks.push(
    check(
      '拼图：网格模式输出 1000×1000（3 源 → 2 列 2 行，无缝无边框）',
      gridPx.width === 1000 && gridPx.height === 1000,
      `${gridPx.width}×${gridPx.height}`,
    ),
  );

  /* #16 切图：忽略几何 —— 单图 90° 输出 400×600，切图底图仍为 600×400。 */
  session.setCurrentSource(0);
  session.setCollage({ mode: 'single', borderWidth: 0 });
  session.setGeometry({ ...session.state.geometry, rotate: 90 });
  const rotatedPx = await session.renderExport();
  session.setCollage({ mode: 'cut', cutCols: 3, cutRows: 3 });
  const cutBasePx = await session.renderExport();
  checks.push(
    check(
      '切图：忽略旋转（单图 90° = 400×600，切图底图仍 600×400）',
      rotatedPx.width === 400 && rotatedPx.height === 600 && cutBasePx.width === 600 && cutBasePx.height === 400,
      `单图 ${rotatedPx.width}×${rotatedPx.height} / 切图 ${cutBasePx.width}×${cutBasePx.height}`,
    ),
  );

  /* 切图底图不含水印 / 贴纸（与 legacy 一致：分片要干净底图）。 */
  session.setWatermarkText('');
  const cutPlain = await session.renderExport();
  session.setWatermarkText('切图不该带的水印');
  const cutMarked = await session.renderExport();
  const cutWmDiff = firstByteDiff(cutPlain.data, cutMarked.data);
  checks.push(
    check(
      '切图：水印不进底图（像素逐字节相同）',
      cutWmDiff === -1,
      cutWmDiff === -1 ? undefined : `首个不同字节 @${cutWmDiff}`,
    ),
  );
  session.setWatermarkText('');

  /* #17 边框：单图加 20px 边框 → 宽高各 +40。 */
  session.setCollage({ mode: 'single', borderWidth: 20, borderColor: '#000000' });
  session.setGeometry({ ...session.state.geometry, rotate: 0, flipH: false, flipV: false });
  const borderPx = await session.renderExport();
  checks.push(
    check(
      '边框：单图 20px 边框使输出宽高各 +40',
      borderPx.width === 600 + 40 && borderPx.height === 400 + 40,
      `${borderPx.width}×${borderPx.height}`,
    ),
  );

  /* 复原：回到单图 1200×800，供下面的内存门断言使用。 */
  session.setCollage({ mode: 'single', borderWidth: 0, borderColor: '#ffffff' });
  session.importPixels(createSampleImage(SOURCE_WIDTH, SOURCE_HEIGHT), 'sample.png');

  /* 序6 自动增强：内核算法（逐通道 1% 掐头去尾 + 灰世界增益）→ `setLevels`。
   * 示例图刻意"未占满动态范围 + 有偏色"，因此必然存在可增强空间 ——
   * 若它被判为恒等，说明 `analyzeAuto` 的统计或阈值出了问题。 */
  const beforeAuto = await session.renderExport();
  const autoApplied = session.autoEnhance();
  const afterAuto = await session.renderExport();
  const autoDiff = firstByteDiff(beforeAuto.data, afterAuto.data);
  checks.push(
    check(
      '自动增强在低对比/偏色源图上确实改动了像素',
      autoApplied === true && autoDiff !== -1,
      autoApplied ? undefined : 'analyzeAuto 判为恒等（阈值或统计有误）',
    ),
    check('自动增强落成非恒等色阶（状态可见、可撤销）', session.hasLevels === true),
    check('重复自动增强是幂等空操作（不往历史里塞重复 op）', session.autoEnhance() === false),
  );
  session.resetLevels();
  const autoRestored = await session.renderExport();
  const restoreDiff = firstByteDiff(beforeAuto.data, autoRestored.data);
  checks.push(
    check(
      '还原色阶后像素逐字节回到增强前',
      restoreDiff === -1,
      restoreDiff === -1 ? undefined : `首个不同字节 @${restoreDiff}`,
    ),
  );

  /* 口语「自动增强」应当**真的落地**，而不是像 crop/zoom 那样挂 pending。 */
  const autoKouyu = session.applyKouyu('自动增强');
  checks.push(
    check(
      '口语 自动增强 落地（applied，不归入 pending）',
      autoKouyu.applied.length > 0 && autoKouyu.pending.length === 0,
      `applied=${autoKouyu.applied.join(',')} pending=${autoKouyu.pending.join(',')}`,
    ),
  );
  session.resetLevels();

  /* 内存门：正常图 run；大图在受限预算下被拦（绝不静默 OOM）。
   *
   * 默认 2 GiB 预算下，内核估算 50MP 仅约 381 MB，属安全范围 —— 这正是
   * "不误杀"的体现，故不能直接断言 50MP 在默认预算下被拦。
   * 此处显式给一个 256 MB 的小预算，确定性地触发非 run 分支，
   * 验证门的拦截逻辑与 UI 读取链路真的生效。 */
  const gateNormal = session.previewExportGate();
  checks.push(check('正常图（1200×800）内存门为 run', gateNormal.decision === 'run', gateNormal.message));
  const huge = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  huge.importPixels(createSampleImage(8000, 6250), 'huge.png');
  const gateHuge = huge.previewExportGate(256 * 1024 * 1024);
  checks.push(
    check('大图（50MP）在 256MB 预算下内存门非 run', gateHuge.decision !== 'run', gateHuge.message),
  );

  /* ── #23 批量导出 / 切图分片 ZIP ── */
  const PK_MAGIC = [0x50, 0x4b, 0x03, 0x04];

  /* 单图模式：库里每张图各套一份当前编辑。加第二张（**刻意同名**）
   * 顺带验证归档内的去重 —— 重名条目解压时会互相覆盖，是最容易丢图的那种错。 */
  session.addPixels(createSampleImage(600, 400), 'sample.png');
  const opsBefore = session.document.ops.length;
  const batch = await session.exportBatch('png', 90);
  checks.push(
    check(
      '批量导出产出 ZIP（PK\\x03\\x04 魔数）',
      batch.ok && hasMagic(batch.zip, PK_MAGIC),
      batch.ok ? `${batch.zip.length} 字节` : batch.reason,
    ),
    check(
      '批量导出条目数 === 库中图片数',
      batch.ok && batch.entries.length === session.sourceCount,
      batch.ok ? `${batch.entries.length} 条 / 库中 ${session.sourceCount} 张` : batch.reason,
    ),
    check(
      '条目均为合法 PNG 且文件名去重（sample.png → sample.png / sample-2.png）',
      batch.ok &&
        batch.entries.every((e) => hasMagic(e.bytes, PNG_MAGIC)) &&
        batch.entries[0].name === 'sample.png' &&
        batch.entries[1].name === 'sample-2.png',
      batch.ok ? batch.entries.map((e) => e.name).join(', ') : batch.reason,
    ),
    check(
      '批量导出不落历史（逐张切 current 后整体还原）',
      session.document.ops.length === opsBefore,
      `${opsBefore} → ${session.document.ops.length}`,
    ),
  );

  /* 切图模式：先用一张独立的会话，免得上面那两张同名图把分片名也搅在一起。 */
  const cutSession = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  cutSession.importPixels(createSampleImage(600, 400), '切图源.png');
  cutSession.setCollage({ mode: 'cut', cutCols: 3, cutRows: 2 });
  const cutBase = await cutSession.renderExport();
  const cutZip = await cutSession.exportBatch('png', 90);
  checks.push(
    check(
      '切图分片：条目数 = cutCols × cutRows（3×2 = 6）',
      cutZip.ok && cutZip.entries.length === 6,
      cutZip.ok ? `${cutZip.entries.length} 条` : cutZip.reason,
    ),
    check(
      '切图分片：按行列命名（首片 _r1c1，末片 _r2c3）',
      cutZip.ok &&
        cutZip.entries[0].name === '切图源_r1c1.png' &&
        cutZip.entries[5].name === '切图源_r2c3.png',
      cutZip.ok ? `${cutZip.entries[0].name} … ${cutZip.entries[5].name}` : cutZip.reason,
    ),
  );
  if (cutZip.ok) {
    /* 最硬的一条：把 6 张分片 PNG **解码回来**拼好，必须与切图底图逐字节相同。
     * 这条同时证明了：切片边界不丢像素、PNG 编解码无损、分片顺序正确。 */
    const restored = await reassembleSlices(kit.imageIo, cutZip.entries, cutBase.width, cutBase.height, 3, 2);
    const cutDiff = firstByteDiff(restored.data, cutBase.data);
    checks.push(
      check(
        '切图分片拼回后逐字节等于切图底图（不丢像素 / 顺序正确）',
        cutDiff === -1,
        cutDiff === -1 ? undefined : `首个不同字节 @${cutDiff}`,
      ),
    );
  }

  /* 拼接模式：成品只有一张，必须**明确拒绝**而不是给一堆重复图。 */
  cutSession.setCollage({ mode: 'grid' });
  const gridBatch = await cutSession.exportBatch('png', 90);
  checks.push(
    check(
      '拼接模式批量导出被明确拒绝（不给重复图）',
      gridBatch.ok === false && /拼接/.test(gridBatch.reason),
      gridBatch.ok ? '竟然成功了' : gridBatch.reason,
    ),
  );

  /* ── 序 5 / A1：跨**真线程**的一致性 ──────────────────────────────
   *
   * 单测里那个"假 Worker"跑的是真引擎，但它把"消息进出 + 异步送达"模拟掉了；
   * 结构化克隆的复制语义、结果 buffer 的移交、以及线程边界本身都还没被跑过。
   * 这里用两个**真会话**（一个 Worker 端口、一个内联端口）在同一份素材、同一套
   * 编辑上比字节 —— 若跨线程改变了任何一个像素，"预览 == 导出同源"就不成立了。 */
  const crossSource = createSampleImage(320, 240);
  const crossWorker = new EditSession({
    imageIo: kit.imageIo,
    textRenderer: kit.textRenderer,
    port: renderPort.port,
  });
  const crossInline = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  for (const target of [crossWorker, crossInline]) {
    target.importPixels(crossSource, 'cross.png');
    target.applyPreset('rainy_dark', 0.7);
    target.setStraighten(-4);
    target.setWatermarkText('跨线程');
  }
  const crossWorkerPixels = await crossWorker.renderExport();
  const crossInlinePixels = await crossInline.renderExport();
  const crossDiff = firstByteDiff(crossWorkerPixels.data, crossInlinePixels.data);
  checks.push(
    check(
      'Worker 与内联端口渲染同一编辑逐字节一致（跨真线程 + 结构化克隆 + 水印）',
      crossDiff === -1,
      crossDiff === -1
        ? `${crossWorkerPixels.width}×${crossWorkerPixels.height}`
        : `首个不同字节 @${crossDiff}`,
    ),
  );

  /* ── 序 5 / A1：24MP 下拖滑杆的主线程停顿 ──────────────────────────
   *
   * "重负载移出 UI 线程"必须能被量出来，否则就只是一句声明。
   *
   * ── 为什么量"主线程停顿"而不是 rAF 帧间隔 ────────────────────────
   * 冒烟窗口是隐藏的（`show: !SMOKE`），隐藏窗口没有合成器帧，rAF 何时触发
   * 完全不可依赖。而"拖滑杆掉帧"的**原因**就是主线程被重负载占住 ——
   * 直接量它更贴近因果，也与显示状态无关：用 `setTimeout(0)` 的滴答间隔，
   * 取全程最大间隔即"最长一次卡住多久"。
   *
   * 判定用**同机相对比较**（Worker vs 内联），因此不受机器快慢影响：
   * 若离线程没起作用，两者会一样糟，这条就会失败。具体数值写进 detail ——
   * 验收要的就是"帧间隔有数据"，而不是一句"感觉不卡"。 */
  const DRAG_FRAMES = 6;
  const big = createSampleImage(6000, 4000); // 24 MP
  /* 不再需要手工放大缓存预算：预览输出的快照是按计划规模推导的（序4），
   * 长边 1400 的一张约 5 MB，默认预算全留得住。
   *
   * 顺带修掉这里的一处假象：老写法传的 `cacheBytes` 对 `bigWorker` **根本没用**
   * （预算跟着端口走，端口已经建好了），"预算给足"其实是白写的。 */
  const bigWorker = new EditSession({
    imageIo: kit.imageIo,
    textRenderer: kit.textRenderer,
    port: renderPort.port,
  });
  const bigInline = new EditSession({
    imageIo: kit.imageIo,
    textRenderer: kit.textRenderer,
  });
  for (const target of [bigWorker, bigInline]) {
    target.importPixels(big, '24mp.png');
    /* 刻意开满重负载阶段（磨皮 / 锐化 / 去雾 / 暗角 / 颗粒）—— "掉帧"要掉得出来，
     * 否则一条轻管线两边都快，这条断言就失去了意义。 */
    target.setParams({ soften: 60, sharpen: 55, dehaze: 35, vignette: 70, grain: 20 });
    await target.renderPreview(); // 预热：把 24MP 的光栅阶段先算进缓存
  }

  const drag = async (target: EditSession): Promise<number> => {
    let last = performance.now();
    let worst = 0;
    let running = true;
    const tick = (): void => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (running) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    for (let i = 0; i < DRAG_FRAMES; i += 1) {
      target.setParam('brightness', 45 + i * 3);
      await target.renderPreview();
      /* 每帧之间**让出事件循环**。
       *
       * 这不是为了公平，而是量得准的前提：内联端口在 `run` 里同步算完，
       * `await` 只产生一个微任务 —— 而微任务队列会在**不回到事件循环**的情况下
       * 被排干，于是整圈循环一口气跑完，滴答定时器一次都插不进来，
       * 量出来永远是 0（本脚本第一版就是"内联 0.0ms"，那种数字看不出任何东西）。
       *
       * 真实的拖动本来就发生在各自的任务里（每次输入事件一帧），
       * 所以这里的让出不是迁就测量，而是**更贴近被测量的场景**。 */
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
      });
    }
    running = false;
    return worst;
  };

  const workerStall = await drag(bigWorker);
  const inlineStall = await drag(bigInline);
  checks.push(
    check(
      '24MP 拖滑杆：Worker 的主线程最长停顿低于内联执行',
      workerStall < inlineStall,
      `Worker ${workerStall.toFixed(1)}ms vs 内联 ${inlineStall.toFixed(1)}ms（连续 ${DRAG_FRAMES} 帧调参）`,
    ),
  );
  checks.push(
    check(
      '渲染 Worker 全程未降级（没有偷偷退回主线程）',
      !renderPort.degraded(),
      renderPort.degraded() ? '运行期已降级' : undefined,
    ),
  );

  /* ── 序1 · EXIF 朝向进**真实 JPEG**（X3②）──────────────────────────
   * 单元侧的置换已经逐字节钉住了，这一段查的是真渲染链上的落地：
   * 我们自己造的 APP1，导入时到底读没读到、转了几次。
   *
   * 序3 之后这一段的含义挪过一次位，说清免得误读：桌面的 JPEG 解码改成走内核之后
   * "Chromium 会不会先替我们转一次"这个问题在 JPEG 上已经不存在了（不再问它解 JPEG）。
   * 它只在**仍由平台解码的格式**（PNG 带 eXIf）上还是活的 —— 那里的答案是
   * `imageOrientation:'none'`，见 `shell-adapter.ts`。这里剩下的三条断言查的是
   * "朝向只经导入那一次进入像素"，与解码器属于谁无关。 */
  const exifSrc = createSampleImage(120, 80);
  const exifJpeg = await kit.imageIo.encode(exifSrc, 'jpeg', 92);
  const exifRotated = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  const exifStored = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  const rotInfo = await exifRotated.importBytes(withApp1(exifJpeg, TIFF_ORIENT_6), 'exif.jpg');
  const storedInfo = await exifStored.importBytes(exifJpeg, 'plain.jpg');
  checks.push(
    check(
      '真实 JPEG 的 APP1 被读到：朝向 6、显示态宽高换轴',
      rotInfo.orientation === 6 && rotInfo.width === 80 && rotInfo.height === 120 &&
        rotInfo.exifLine !== null,
      `orientation=${String(rotInfo.orientation)} ${rotInfo.width}×${rotInfo.height} ｜ ${rotInfo.exifLine ?? 'null'}`,
    ),
  );
  checks.push(
    check(
      '同图去掉 APP1 后保持存储态 120×80（对照组成立）',
      storedInfo.orientation === null && storedInfo.width === 120 && storedInfo.height === 80,
      `orientation=${String(storedInfo.orientation)} ${storedInfo.width}×${storedInfo.height}`,
    ),
  );
  const rotOut = await exifRotated.renderExport();
  const storedOut = await exifStored.renderExport();
  checks.push(
    check(
      '整条链路只转一次：带 EXIF 的产物 == 存储态产物再置换一次',
      firstByteDiff(rotOut.data, metadata.applyOrientation(storedOut, 6).data) === -1,
      `EXIF 路径 ${rotOut.width}×${rotOut.height}，对照 ${storedOut.width}×${storedOut.height} 再置换`,
    ),
  );

  /* ── 序2 · 工程文件在**真实渲染链**上往返（D1 / D4）────────────────
   * 单元侧用假解码器证过逻辑；这一段查的是平台边界：真 Chromium 解码 +
   * 真 EXIF 置换之下，存出去的工程再开回来仍是同一张图（朝向不许转第二次）。
   * 素材现造、只在内存里往返 —— 冒烟不往用户目录写任何东西。 */
  const projBytes = withApp1(
    await kit.imageIo.encode(createSampleImage(160, 90), 'jpeg', 90),
    TIFF_ORIENT_6,
  );
  const projFrom = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  await projFrom.importBytes(projBytes, 'project.jpg');
  projFrom.setParams({ brightness: 65, contrast: 115 });
  projFrom.rotateClockwise();
  projFrom.setWatermarkText('冒烟');
  projFrom.undo(); // 留一条重做分支：历史必须整条带走
  const projText = projFrom.serializeProject();
  const projNeeds = projFrom.projectNeeds(projText);
  const projTo = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  const projLoaded = await projTo.loadProject(projText, [
    { name: 'project.jpg', bytes: projBytes },
  ]);
  const projOutFrom = await projFrom.renderExport();
  const projOutTo = await projTo.renderExport();
  checks.push(
    check(
      '工程往返：真解码 + EXIF 置换下逐字节一致，历史停在原位',
      firstByteDiff(projOutFrom.data, projOutTo.data) === -1 &&
        projTo.sourceInfo?.width === projFrom.sourceInfo?.width &&
        projTo.sourceInfo?.exifLine === projFrom.sourceInfo?.exifLine,
      `${projOutFrom.width}×${projOutFrom.height} vs ${projOutTo.width}×${projOutTo.height}`,
    ),
    check(
      '工程带整条历史、且不含像素（几十 KB 量级而不是 MB）',
      projLoaded.total === projFrom.document.ops.length &&
        projLoaded.history === projFrom.document.cursor &&
        projNeeds.sources.length === 1 &&
        !/[A-Za-z0-9+/]{64,}/.test(projText),
      `${projLoaded.history}/${projLoaded.total} 步 · ${projText.length} 字符`,
    ),
  );

  /* D4 的反面：换一个字节就不许开。这里要的不是"抛错"，而是**指名哪一张** ——
   * 只说"打开失败"等于把用户留在猜是哪张图对不上的地方。 */
  const driftProbe = new EditSession({ imageIo: kit.imageIo });
  const driftMessage = await driftProbe
    .loadProject(projText, [{ name: 'project.jpg', bytes: Uint8Array.from([...projBytes, 0x00]) }])
    .then(() => '居然打开了：指纹没有起作用' as string)
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  checks.push(
    check(
      '源图多一个字节：拒绝打开并指名是哪一张',
      /第 1 张/.test(driftMessage) && !driftProbe.hasSource,
      driftMessage.slice(0, 120),
    ),
  );

  /* ── 序2 · #4 自定义预设：存 → 读回 → 套用（同样只在内存里）──────────
   * 落盘那段由主进程的 `presetTarget` 白名单把关（冒烟不写用户目录）；
   * 这里验的是"预设文本"这条路在真渲染链上端到端成立。 */
  const lookFrom = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  await lookFrom.importBytes(projBytes, 'p.jpg');
  lookFrom.setParams({ saturate: 140, warm: 30, vignette: 25 });
  const enhanced = lookFrom.autoEnhance();
  const lookText = docApi.serializeSharedPreset(lookFrom.currentAsPreset('smoke-look', '冒烟观感'));
  const lookTo = new EditSession({ imageIo: kit.imageIo, textRenderer: kit.textRenderer });
  await lookTo.importBytes(projBytes, 'p.jpg');
  lookTo.applySharedPreset(docApi.parseSharedPreset(lookText));
  checks.push(
    check(
      '自定义预设：文本往返后套用，与来源逐字节一致',
      firstByteDiff((await lookFrom.renderExport()).data, (await lookTo.renderExport()).data) ===
        -1,
      `${lookText.length} 字符 · 色阶${enhanced ? '已进文件' : '未产生（该图本就正常）'}`,
    ),
    check(
      '预设套到另一张同图：落地的是参数 op，不是查内置表的 applyPreset',
      lookTo.document.ops.every((op) => op.k !== 'applyPreset') &&
        lookTo.state.presetKey === null,
      `op=${lookTo.document.ops.map((op) => op.k).join(',')}`,
    ),
  );

  /* ── 序3 · C2 + X1：同一份真 JPEG，内核解一遍、Chromium 也解一遍 ─────
   * 桌面自己的 JPEG 解码已改走内核（一次都不问平台），所以这里 Chromium 只是
   * **独立参照**：手写解码器最容易犯的是"自洽地错"，而单元用例的码流出自同一个
   * 作者的夹具，恰好看不出这类错。换一套实现来同意，才算数。
   *
   * 两条断言的形态**不一样**，边界要说清：
   *   ① 应用路径 vs 内核函数：逐字节（同一份代码，没有容差可言）；
   *   ② 内核 vs Chromium：尺寸严格一致 + 亮度 / 色度 / 均值各一条白名单容差
   *      —— 两个独立实现之间没有"逐字节"这条路（§5.1），理由写在文件头 `C2_*` 旁。
   * 尺寸刻意取 319×213：既不是 8 也不是 16 的整数倍，边界块复制的规则两边都会踩到。 */
  const c2Src = createSampleImage(319, 213);
  const c2Jpeg = await kit.imageIo.encode(c2Src, 'jpeg', 90);
  const c2Kernel = decodeJpeg(c2Jpeg);
  const c2App = new EditSession({ imageIo: kit.imageIo });
  await c2App.importBytes(c2Jpeg, 'c2.jpg');
  const c2AppOut = await c2App.renderExport(); // 一条编辑都没有 → 输出就是源像素
  const c2PathDiff = firstByteDiff(c2AppOut.data, c2Kernel.data);
  checks.push(
    check(
      'C2/X1 桌面解 JPEG 走的就是内核那一份：无操作导出与 decodeJpeg 逐字节一致',
      c2PathDiff === -1 && c2AppOut.width === c2Kernel.width && c2AppOut.height === c2Kernel.height,
      `${c2AppOut.width}×${c2AppOut.height} ｜ ${c2PathDiff === -1 ? '逐字节一致' : `首个不同字节 @${c2PathDiff}`}`,
    ),
  );
  /* 上一条只证明"解出来的就是内核那一份"，证明不了"是谁跑的那一份"。
   * 三个条件缺一个都不算数：字节确实经过端口、端口确实是 Worker、
   * 且到目前为止没被任何运行期故障拖回主线程。 */
  checks.push(
    check(
      '序3.5 导入的 JPEG 确实经端口交给 Worker 解码（主线程没被占用）',
      throughPortDecodes > 0 && renderPort.kind === 'worker' && !renderPort.degraded(),
      `经端口解码 ${throughPortDecodes} 次 ｜ 端口 ${renderPort.kind}${renderPort.degraded() ? '（已降级）' : ''}`,
    ),
  );
  const c2Chromium = await chromiumOracle(c2Jpeg);
  checks.push(
    check(
      'C2 尺寸严格一致：内核与 Chromium 对同一份 JPEG 给出同样的宽高',
      c2Kernel.width === c2Chromium.width && c2Kernel.height === c2Chromium.height,
      `内核 ${c2Kernel.width}×${c2Kernel.height} ｜ Chromium ${c2Chromium.width}×${c2Chromium.height}`,
    ),
  );
  const c2 = compareCrossDecoder(c2Kernel, c2Chromium);
  const c2Numbers =
    `Y≤${c2.maxLuma.toFixed(2)} · C≤${c2.maxChroma.toFixed(2)} · 均值${c2.meanRgb.toFixed(3)} · ` +
    `逐像素全等${(c2.exactRate * 100).toFixed(1)}% · 最大偏差@${c2.worst}`;
  checks.push(
    check(
      `C2 亮度最大误差 ≤ ${C2_Y_TOLERANCE}（同一组 DCT 系数，只该差在 IDCT 取整）`,
      c2.maxLuma <= C2_Y_TOLERANCE,
      c2Numbers,
    ),
    check(
      `C2 色度最大误差 ≤ ${C2_CHROMA_TOLERANCE}（4:2:0 上采样插值口径不同 = 白名单内的合法差异）`,
      c2.maxChroma <= C2_CHROMA_TOLERANCE,
      c2Numbers,
    ),
    check(
      `C2 全图平均误差 ≤ ${C2_MEAN_TOLERANCE}（MCU 错位 / Cb-Cr 互换会让整幅一起崩，藏不住）`,
      c2.meanRgb <= C2_MEAN_TOLERANCE,
      c2Numbers,
    ),
  );

  /* C4 的桌面半边：没有文字能力时**必须明确失败**。
   * CLI 那半边量的是退出码；这里量的是真实渲染链 —— 水印在桌面上恰好是
   * "做不出来的东西会不会看起来像做出来了"最难说清的一处，静默丢字比报错糟得多。
   * 复用上面那个会话：它正是"只给了 imageIo、没给 textRenderer"的那一个。 */
  c2App.setWatermarkText('不该被静默丢掉');
  const c4Message = await c2App
    .renderExport()
    .then(() => '居然渲染成功了：水印被静默忽略了' as string)
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  checks.push(
    check(
      '未注入文字能力 + 含水印：真实渲染链上明确失败并说明原因',
      /未注入文字渲染能力/.test(c4Message),
      c4Message.slice(0, 120),
    ),
  );

  /* 桥的面：四个动词必须真的被 preload 注进来了。
   * 只查存在，**不调用** —— 调用会弹对话框或写用户目录，两样都不该在冒烟里发生。 */
  const bridge = shellBridge();
  const bridgeVerbs = bridge as unknown as Record<string, unknown>;
  checks.push(
    check(
      'preload 注入工程/预设四个动词（且没有通用文件读取口子）',
      ['saveProject', 'openProject', 'savePreset', 'listPresets'].every(
        (verb) => typeof bridgeVerbs[verb] === 'function',
      ) && bridgeVerbs['readFile'] === undefined,
    ),
  );

  return {
    ok: checks.every((c) => c.ok),
    checks,
    requirements: pipeline.SHELL_REQUIREMENTS,
  };
}

async function main(): Promise<void> {
  const bridge = shellBridge();
  try {
    bridge.reportSmoke(await run());
  } catch (error) {
    bridge.reportSmoke({
      ok: false,
      checks: [
        {
          name: '冒烟执行期间抛出异常',
          ok: false,
          detail: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
        },
      ],
      requirements: pipeline.SHELL_REQUIREMENTS,
    });
  }
}

void main();
