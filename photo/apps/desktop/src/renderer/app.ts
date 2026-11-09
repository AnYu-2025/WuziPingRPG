/**
 * 渲染进程的界面接线 —— 唯一允许碰 DOM 的业务代码。
 *
 * 这一层刻意做得**薄**：所有编辑语义（哪些操作合并、预览与导出怎么同源、
 * 缓存怎么复用）都在 `EditSession` 里，这里只负责把控件事件翻译成 session 调用、
 * 再把结果画到 canvas 上。因此界面改版不会碰到底层逻辑，底层逻辑也不会
 * 因为某个按钮换了位置而改变行为。
 */
import { doc as docApi, metadata, presets, color, type CollageMode, type PixelBuffer } from '@photo/core';
import { sniffImageMime } from '../image-io.js';
import { createSampleImage } from '../sample-image.js';
import { EditSession, type ImportResult } from '../session.js';
import { shellBridge } from '../shell-api.js';
import { createBrowserRenderKit } from '../shell-adapter.js';
import { createRenderPort } from '../worker-port.js';

/* ───────────────────────── DOM 取用 ───────────────────────── */

function el<T extends Element>(selector: string, ctor: new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof ctor)) {
    throw new Error(`页面元素缺失或类型不符：${selector}`);
  }
  return found;
}

const preview = el('#preview', HTMLCanvasElement);
const emptyHint = el('#empty', HTMLParagraphElement);
const presetSelect = el('#preset', HTMLSelectElement);
const presetIntensityInput = el('#preset-intensity', HTMLInputElement);
const presetIntensityValue = el('#preset-intensity-val', HTMLElement);
const presetIntensityField = el('#preset-intensity-field', HTMLElement);

/* 自定义预设（#4）：库在内核里解析，这里只列与选。 */
const presetNameInput = el('#preset-name', HTMLInputElement);
const btnSavePreset = el('#btn-save-preset', HTMLButtonElement);

/* 工程文件（序 2）：存的是文档，像素仍在用户硬盘上。 */
const btnSaveProject = el('#btn-save-project', HTMLButtonElement);
const btnOpenProject = el('#btn-open-project', HTMLButtonElement);

/* 自动增强（序 6）：分析在内核 `pixels.analyzeAuto`，壳只负责触发与回显。 */
const btnAuto = el('#btn-auto', HTMLButtonElement);
const btnAutoClear = el('#btn-auto-clear', HTMLButtonElement);
const sliderHost = el('#sliders', HTMLDivElement);
const watermarkInput = el('#watermark', HTMLInputElement);
const statusList = el('#status', HTMLDListElement);
const toastBox = el('#toast', HTMLDivElement);

const btnOpen = el('#btn-open', HTMLButtonElement);
const btnSample = el('#btn-sample', HTMLButtonElement);
const btnUndo = el('#btn-undo', HTMLButtonElement);
const btnRedo = el('#btn-redo', HTMLButtonElement);
const btnRotate = el('#btn-rotate', HTMLButtonElement);
const btnFlip = el('#btn-flip', HTMLButtonElement);
const btnFlipV = el('#btn-flip-v', HTMLButtonElement);
const btnExport = el('#btn-export', HTMLButtonElement);
const btnExportZip = el('#btn-export-zip', HTMLButtonElement);

/* 几何：水平校正滑杆。 */
const straightenInput = el('#straighten', HTMLInputElement);
const straightenValue = el('#straighten-val', HTMLElement);

/* 导出选项（不参与撤销，UI 侧局部状态）。 */
const formatSelect = el('#format', HTMLSelectElement);
const qualityInput = el('#quality', HTMLInputElement);
const qualityValue = el('#quality-val', HTMLElement);
const longEdgeSelect = el('#longEdge', HTMLSelectElement);
const gateBox = el('#gate', HTMLDivElement);
const sizeTip = el('#size-tip', HTMLDivElement);

/* 水印进阶（位置 / 颜色 / 描边 / 字号 / 不透明度）。 */
const wmPos = el('#wm-pos', HTMLSelectElement);
const wmColor = el('#wm-color', HTMLInputElement);
const wmStroke = el('#wm-stroke', HTMLInputElement);
const wmSize = el('#wm-size', HTMLInputElement);
const wmSizeVal = el('#wm-size-val', HTMLElement);
const wmAlpha = el('#wm-alpha', HTMLInputElement);
const wmAlphaVal = el('#wm-alpha-val', HTMLElement);

/* 贴纸（文字 / 样式 / 位置 / 字号）。 */
const stickerText = el('#sticker-text', HTMLInputElement);
const stickerStyle = el('#sticker-style', HTMLSelectElement);
const stickerPos = el('#sticker-pos', HTMLSelectElement);
const stickerSize = el('#sticker-size', HTMLInputElement);
const stickerSizeVal = el('#sticker-size-val', HTMLElement);

/* HSL 八色分调。 */
const hslBandSelect = el('#hsl-band', HTMLSelectElement);
const hslH = el('#hsl-h', HTMLInputElement);
const hslHVal = el('#hsl-h-val', HTMLElement);
const hslS = el('#hsl-s', HTMLInputElement);
const hslSVal = el('#hsl-s-val', HTMLElement);
const hslL = el('#hsl-l', HTMLInputElement);
const hslLVal = el('#hsl-l-val', HTMLElement);

/* 直方图。 */
const histogramCanvas = el('#histogram', HTMLCanvasElement);

/* 曲线编辑器。 */
const curveCanvas = el('#curve-canvas', HTMLCanvasElement);
const curveChannelSelect = el('#curve-channel', HTMLSelectElement);
const curveResetBtn = el('#curve-reset', HTMLButtonElement);

/* 口语指令。 */
const kouyuInput = el('#kouyu-input', HTMLInputElement);
const kouyuBtn = el('#kouyu-btn', HTMLButtonElement);
const kouyuTip = el('#kouyu-tip', HTMLDivElement);

/* 视图缩放（#28）—— 纯展示层，不进编辑状态、不参与撤销。 */
const zoomOutBtn = el('#btn-zoom-out', HTMLButtonElement);
const zoomInBtn = el('#btn-zoom-in', HTMLButtonElement);
const zoomFitBtn = el('#btn-zoom-fit', HTMLButtonElement);
const zoomLabel = el('#zoom-label', HTMLElement);
/* 对比原图（#29）：按住显示观感归零的版本，同样纯视图。 */
const compareBtn = el('#btn-compare', HTMLButtonElement);

/* 裁剪（#14）。 */
const stage = el('.stage', HTMLElement);
const btnCrop = el('#btn-crop', HTMLButtonElement);
const cropOverlay = el('#crop-overlay', HTMLCanvasElement);
const cropPanel = el('#crop-panel', HTMLFieldSetElement);
const cropRatioSelect = el('#crop-ratio', HTMLSelectElement);
const cropApplyBtn = el('#crop-apply', HTMLButtonElement);
const cropCancelBtn = el('#crop-cancel', HTMLButtonElement);

/* 多图（#22）。 */
const btnAdd = el('#btn-add', HTMLButtonElement);
const thumbsBox = el('#thumbs', HTMLDivElement);
const thumbList = el('#thumb-list', HTMLDivElement);
const btnDelCurrent = el('#btn-del-current', HTMLButtonElement);
const btnClear = el('#btn-clear', HTMLButtonElement);

/* 拼图 / 切图 / 边框（#15 / #16 / #17）。 */
const collageModeSelect = el('#collage-mode', HTMLSelectElement);
const collageGapInput = el('#collage-gap', HTMLInputElement);
const collageGapVal = el('#collage-gap-val', HTMLElement);
const collageBgSelect = el('#collage-bg', HTMLSelectElement);
const cutColsSelect = el('#cut-cols', HTMLSelectElement);
const cutRowsSelect = el('#cut-rows', HTMLSelectElement);
const borderWidthInput = el('#border-width', HTMLInputElement);
const borderWidthVal = el('#border-width-val', HTMLElement);
const borderColorSelect = el('#border-color', HTMLSelectElement);
const collageGapField = el('#collage-gap-field', HTMLElement);
const collageBgField = el('#collage-bg-field', HTMLElement);
const cutColsField = el('#cut-cols-field', HTMLElement);
const cutRowsField = el('#cut-rows-field', HTMLElement);
const borderWidthField = el('#border-width-field', HTMLElement);
const borderColorField = el('#border-color-field', HTMLElement);
const gridOverlay = el('#grid-overlay', HTMLCanvasElement);

/** 当前编辑的色彩带（HSL 分色滑杆作用于它）。 */
let hslBand: color.HslBand = 'red';

/** 当前编辑的曲线通道（RGB 主通道 / R / G / B 分量通道）。 */
let curveChannel: color.CurveChannel = 'rgb';

/** 导出格式与画质（长边走 session 状态，因其决定内存门）。 */
let exportFormat: 'png' | 'jpeg' = 'png';
let exportQuality = 92;

/* ───────────────────────── 会话 ───────────────────────── */

/* 渲染执行体：优先真 Worker（重负载离 UI 线程），不可用则**自动**退回内联端口 ——
 * 于是"Worker 没起来"永远不会变成白屏，只会变成"跟以前一样跑在主线程"。
 *
 * 这里用顶层 await：端口的可用性必须在**建会话之前**定下来，会话才不必知道
 * "Worker 到底起没起来"这件事（见 `SessionOptions.port` 的注释）。
 * 解码入口也一并由它给出 —— 顺序反过来会变成"先建好图片管道、再决定它在
 * 哪个线程解"，那只能靠事后回填，而回填一旦漏了就是静默留在主线程。 */
const renderPort = await createRenderPort();
const kit = createBrowserRenderKit({ jpegDecoder: renderPort.decodeJpeg });
const session = new EditSession({
  imageIo: kit.imageIo,
  textRenderer: kit.textRenderer,
  port: renderPort.port,
});
if (renderPort.kind !== 'worker') {
  /* 不静默：功能没降级，但性能降了，用户有权知道。
   * 悄悄跑在主线程会让人以为"这软件就是卡" —— 那是更坏的误导。 */
  toast(`渲染 Worker 不可用，已退回主线程：${renderPort.reason ?? '未知原因'}`, 'error');
}
const bridge = shellBridge();

/* ───────────────────────── 提示 ───────────────────────── */

let toastTimer = 0;

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  toastBox.textContent = message;
  toastBox.dataset['kind'] = kind;
  toastBox.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastBox.hidden = true;
  }, kind === 'error' ? 6000 : 3200);
}

/** 统一把异常变成可见提示 —— 静默失败是这个项目最想消灭的东西。 */
function guard(action: () => unknown): () => void {
  return () => {
    try {
      const result = action();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          toast(error instanceof Error ? error.message : String(error), 'error');
        });
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  };
}

/* ───────────────────────── 控件 ───────────────────────── */

const SLIDERS: readonly { readonly key: presets.AdjustKey; readonly label: string }[] = [
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比' },
  { key: 'saturate', label: '饱和' },
  { key: 'exposure', label: '曝光' },
  { key: 'warm', label: '色温' },
  { key: 'vignette', label: '暗角' },
  { key: 'grain', label: '颗粒' },
  { key: 'sharpen', label: '锐化' },
  { key: 'dehaze', label: '去雾' },
  { key: 'soften', label: '磨皮' },
  { key: 'rain', label: '雨丝' },
  { key: 'fog', label: '雾气' },
];

const sliderInputs = new Map<presets.AdjustKey, HTMLInputElement>();
const sliderValues = new Map<presets.AdjustKey, HTMLElement>();

/* ───────────────────── 预设下拉框（内置 + 自定义） ───────────────────── */

/** 自定义项在 `<option value>` 里的前缀：与内置 key 分开，撞名也不会互相劫持。 */
const CUSTOM_PREFIX = 'custom:';

/** 预设库：key → 已解析的预设。文件由外壳读，解析与校验在内核（`parseSharedPreset`）。 */
const customPresets = new Map<string, docApi.SharedPreset>();

/**
 * 最近一次套用的自定义预设，以及它那一刻的观感指纹。
 *
 * 为什么需要这份状态：内置预设落地成一条 `applyPreset`（文档里存着 key），
 * 自定义预设落地成一串**参数类 op**（否则就会去查内置表，见 `EditSession.applySharedPreset`）。
 * 于是 `state.presetKey` 是空的，下拉框没地方读"当前是哪个预设"，只能反过来问：
 * 当前观感还等不等于刚套用的那一个。
 */
let customApplied: { readonly key: string; readonly stamp: string } | null = null;

/**
 * 观感指纹 = 预设真正管的那四样。
 *
 * 刻意不含几何 / 裁切 / 水印 / 拼图：用户套完预设去转个方向，
 * 预设并没有"被改掉"，下拉框不该因此跳回「自定义」。
 */
function lookStamp(state: docApi.EditState): string {
  return JSON.stringify([state.params, state.curves, state.levels, state.bands]);
}

/** 下拉框当前该显示哪一项。选不中的项回落「自定义」，不保留一个不存在的选中。 */
function wantedPresetOption(state: docApi.EditState): string {
  if (state.presetKey !== null) return state.presetKey;
  if (customApplied !== null && customApplied.stamp === lookStamp(state)) {
    return `${CUSTOM_PREFIX}${customApplied.key}`;
  }
  return '';
}

/** 重建下拉框选项：内置在前、我的在后，尽量保住当前选中项。 */
function rebuildPresetOptions(): void {
  const wanted = presetSelect.value;
  presetSelect.replaceChildren(new Option('自定义', ''));
  for (const preset of presets.BUILTIN_PRESETS) {
    presetSelect.append(new Option(preset.name, preset.key));
  }
  for (const preset of customPresets.values()) {
    presetSelect.append(new Option(`${preset.name}（我的）`, `${CUSTOM_PREFIX}${preset.key}`));
  }
  if ([...presetSelect.options].some((option) => option.value === wanted)) {
    presetSelect.value = wanted;
  }
}

/**
 * 读一遍预设库。坏文件**不静默**：能用的照常列出，读不了的点名报出来。
 *
 * 这里不"顺手跳过"就完事 —— 用户存过 5 个、下拉框只有 4 个，
 * 少的那一个必须说一句为什么少，否则他会以为是软件弄丢了。
 */
async function refreshCustomPresets(): Promise<void> {
  const entries = await bridge.listPresets();
  customPresets.clear();
  const broken: string[] = [];
  for (const entry of entries) {
    try {
      const preset = docApi.parseSharedPreset(entry.text);
      customPresets.set(preset.key, preset);
    } catch (error) {
      broken.push(`${entry.file}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  rebuildPresetOptions();
  if (broken.length > 0) {
    toast(`预设库有 ${broken.length} 个文件读不了 —— ${broken.join('；')}`, 'error');
  }
}

/** 把当前观感存成自定义预设（同名即覆盖，覆盖会说出来）。 */
async function saveCurrentAsPreset(): Promise<void> {
  if (!session.hasSource) {
    toast('还没有图 —— 先导入或生成一张，再存预设', 'error');
    return;
  }
  const name = presetNameInput.value.trim();
  if (name === '') {
    toast('先给预设起个名字', 'error');
    presetNameInput.focus();
    return;
  }
  const key = docApi.presetKeyFromName(name);
  const replacing = customPresets.has(key);
  const preset = session.currentAsPreset(key, name);
  await bridge.savePreset(docApi.presetFileName(key), docApi.serializeSharedPreset(preset));
  presetNameInput.value = '';
  await refreshCustomPresets();
  toast(
    replacing
      ? `已覆盖同名预设「${name}」（展示名相同就是同一个预设）`
      : `已存为预设「${name}」—— 在预设下拉框里选它，或写进工程文件一起保存`,
  );
}

function buildSliders(): void {
  for (const { key, label } of SLIDERS) {
    const range = presets.PARAM_RANGE[key];
    const wrap = document.createElement('div');
    wrap.className = 'slider';

    const head = document.createElement('div');
    head.className = 'slider__head';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'slider__value';
    head.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range[0]);
    input.max = String(range[1]);
    input.step = '1';
    input.addEventListener('input', () => {
      session.setParam(key, Number(input.value));
      value.textContent = input.value;
      scheduleRender();
    });

    wrap.append(head, input);
    sliderHost.append(wrap);
    sliderInputs.set(key, input);
    sliderValues.set(key, value);
  }

  rebuildPresetOptions();
  presetSelect.addEventListener('change', () => {
    const value = presetSelect.value;
    if (value === '') return;
    if (value.startsWith(CUSTOM_PREFIX)) {
      const preset = customPresets.get(value.slice(CUSTOM_PREFIX.length));
      /* 库里的文件刚被删掉：点名说明，然后把列表刷新，不把下拉框留在一个
       * 不存在的选择上 —— 那会让下一次"看起来套了其实没套"。 */
      if (preset === undefined) {
        toast('这个预设的文件已经不在预设库里了', 'error');
        void refreshCustomPresets().then(syncControls);
        return;
      }
      session.applySharedPreset(preset);
      customApplied = { key: preset.key, stamp: lookStamp(session.state) };
      scheduleRender();
      return;
    }
    /* 按**当前强度**落地：滑杆值就是 `EditState.presetIntensity` 的镜像，
     * 所以"先调低强度、再换个预设"时新预设沿用同一强度，
     * 而不是偷偷弹回 100%（`.state` 无预设时该值为 1，即默认满强度）。 */
    session.applyPreset(value, session.state.presetIntensity);
    customApplied = null;
    scheduleRender();
  });

  btnSavePreset.addEventListener(
    'click',
    guard(() => saveCurrentAsPreset()),
  );

  /* 预设强度（#2）：0..100% 映射到内核的 0..1，由 `mixWithNeutral` 完成插值。
   * 没有插值基准时（没预设，或套的是自定义预设）由 `syncControls` 禁用该控件。 */
  presetIntensityInput.addEventListener('input', () => {
    const pct = Number(presetIntensityInput.value);
    presetIntensityValue.textContent = `${pct}%`;
    session.setPresetIntensity(pct / 100);
    scheduleRender();
  });

  /* 自动增强：内核分析（1% 掐头去尾 + 灰世界增益）→ 落成 `setLevels`。
   * 提示语按**实际结果**分叉 —— 没改动就直说"无需增强"，不假装做了事。 */
  btnAuto.addEventListener(
    'click',
    guard(() => {
      const changed = session.autoEnhance();
      render();
      toast(
        changed
          ? '已自动增强：拉开层次 + 校正偏色（可撤销、可在其上继续调色）'
          : '这张图层次与色偏都已正常，无需增强',
      );
    }),
  );
  btnAutoClear.addEventListener(
    'click',
    guard(() => {
      session.resetLevels();
      render();
      toast('已还原色阶');
    }),
  );
}

/** 用内核的色彩带定义填充 HSL 分色下拉（单一真相源，不手抄 8 个选项）。 */
function buildBands(): void {
  for (const band of color.HSL_BANDS) {
    hslBandSelect.append(new Option(band.label, band.key));
  }
  hslBandSelect.value = hslBand;
}

/** 用内核的曲线通道定义填充通道下拉（RGB 主通道 + R/G/B 分量）。 */
function buildCurveChannels(): void {
  curveChannelSelect.append(new Option('RGB（主）', 'rgb'));
  curveChannelSelect.append(new Option('红 R', 'r'));
  curveChannelSelect.append(new Option('绿 G', 'g'));
  curveChannelSelect.append(new Option('蓝 B', 'b'));
  curveChannelSelect.value = curveChannel;
}

/** 把 session 的权威状态刷回控件 —— 撤销/重做/套预设之后必须调一次。 */
function syncControls(): void {
  const state = session.state;
  for (const { key } of SLIDERS) {
    const value = state.params[key];
    const input = sliderInputs.get(key);
    const label = sliderValues.get(key);
    if (input !== undefined) input.value = String(value);
    if (label !== undefined) label.textContent = String(Math.round(value));
  }
  presetSelect.value = wantedPresetOption(state);
  /* 强度与参数同源：滑杆读的是 `EditState.presetIntensity`，因此撤销/重做、
   * 口语"效果轻一点"之后，滑杆都会自动跟到正确位置（不另存一份）。 */
  const intensityPct = Math.round(state.presetIntensity * 100);
  presetIntensityInput.value = String(intensityPct);
  presetIntensityValue.textContent = `${intensityPct}%`;
  /* 没有预设时强度无基准 —— 禁用，而不是留个"能拖但没效果"的控件。 */
  presetIntensityInput.disabled = state.presetKey === null;
  presetIntensityField.classList.toggle('field--muted', state.presetKey === null);
  watermarkInput.value = state.watermark.text;

  const wm = state.watermark;
  wmPos.value = wm.pos;
  wmColor.value = wm.color;
  wmStroke.checked = wm.stroke;
  wmSize.value = String(wm.size);
  wmSizeVal.textContent = String(wm.size);
  wmAlpha.value = String(wm.alpha);
  wmAlphaVal.textContent = String(wm.alpha);

  const st = state.sticker;
  stickerText.value = st.text;
  stickerStyle.value = st.style;
  stickerPos.value = st.pos;
  stickerSize.value = String(st.size);
  stickerSizeVal.textContent = String(st.size);

  const band = state.bands[hslBand];
  hslH.value = String(band.h);
  hslHVal.textContent = String(band.h);
  hslS.value = String(band.s);
  hslSVal.textContent = String(band.s);
  hslL.value = String(band.l);
  hslLVal.textContent = String(band.l);
  hslBandSelect.value = hslBand;
  curveChannelSelect.value = curveChannel;
  drawCurveEditor();

  /* 拼图 / 切图 / 边框：整值回填 + 按模式显隐对应字段。 */
  const collage = state.collage;
  collageModeSelect.value = collage.mode;
  collageGapInput.value = String(collage.gap);
  collageGapVal.textContent = String(collage.gap);
  collageBgSelect.value = collage.bg;
  cutColsSelect.value = String(collage.cutCols);
  cutRowsSelect.value = String(collage.cutRows);
  borderWidthInput.value = String(collage.borderWidth);
  borderWidthVal.textContent = String(collage.borderWidth);
  borderColorSelect.value = collage.borderColor;
  const collageLike = collage.mode === 'h' || collage.mode === 'v' || collage.mode === 'grid';
  const cutting = collage.mode === 'cut';
  collageGapField.hidden = !collageLike;
  collageBgField.hidden = !collageLike;
  cutColsField.hidden = !cutting;
  cutRowsField.hidden = !cutting;
  /* 切图模式无边框（内核 isCut 分支强制 border=0）—— 隐藏而非留个无效控件。 */
  borderWidthField.hidden = cutting;
  borderColorField.hidden = cutting;

  straightenInput.value = String(state.geometry.straighten);
  straightenValue.textContent = String(Math.round(state.geometry.straighten));
  longEdgeSelect.value = String(session.exportMaxEdgeValue);

  btnUndo.disabled = !session.canUndo;
  btnRedo.disabled = !session.canRedo;
  btnRotate.disabled = !session.hasSource;
  btnFlip.disabled = !session.hasSource;
  btnFlipV.disabled = !session.hasSource;
  btnExport.disabled = !session.hasSource;
  btnExportZip.disabled = !session.canBatchExport;
  /* 按钮上直接写清这一次会产出什么 —— 用户不必先点一下才知道是 1 张还是 9 张。 */
  btnExportZip.textContent =
    session.cutSliceCount > 0 ? `切图分片 ZIP（${session.cutSliceCount} 张）` : '批量导出 ZIP';
  btnExportZip.title =
    session.batchExportBlocker ??
    (session.cutSliceCount > 0
      ? `按当前宫格切成 ${session.cutSliceCount} 张，打成一个 ZIP`
      : `库中 ${session.sourceCount} 张图各套一份当前编辑，打成一个 ZIP`);
  btnCrop.disabled = !session.hasSource;
  btnCrop.textContent = cropMode ? '退出裁剪' : '裁剪';
  btnDelCurrent.disabled = !session.hasSource;
  btnClear.disabled = !session.hasSource;
  btnAuto.disabled = !session.hasSource;
  /* "还原色阶" 只在真的有色阶时可用 —— 否则是个点了没反应的按钮。 */
  btnAutoClear.disabled = !session.hasLevels;
}

/* ───────────────────────── 状态栏 ───────────────────────── */

function renderStatus(lines: readonly (readonly [string, string])[]): void {
  statusList.replaceChildren(
    ...lines.map(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );
}

/* ───────────────────────── 照片信息条（序1 / X4） ───────────────────────── */

/**
 * 朝向一行。
 *
 * 朝向改变了宽高时才补上**存储态**尺寸 —— 否则"源图 3000×4000"看起来像读错了，
 * 而实际上那是 4000×3000 的横图被 EXIF 转正后的样子。
 */
function orientationLine(info: ImportResult | null): string {
  if (info === null) return '—';
  const text = metadata.describeOrientation(info.orientation);
  const stored = info.stored;
  if (stored === null) return text;
  if (stored.width === info.width && stored.height === info.height) return text;
  return `${text}（存储 ${stored.width}×${stored.height}）`;
}

/**
 * 文件名 + 体积一行（X4 对齐 legacy 信息条的 `名称 ｜ 尺寸 ｜ KB`）。
 *
 * 体积省略的条件是"这张图不是从字节进来的"（示例图 / 测试直接喂像素），
 * 此时**不报 0 B** —— 0 与"无从得知"是两件事。
 */
function fileLine(info: ImportResult | null): string {
  if (info === null) return '—';
  return info.bytes === null ? info.name : `${info.name} · ${formatBytes(info.bytes)}`;
}

/**
 * EXIF 一行。三态必须分得开（X4）：
 *   '无容器' = 这张图不是从字节进来的（示例图 / 测试），无从谈起；
 *   '无 EXIF' = 读了字节，里面确实没有；
 *   其余 = 内核排好的参数，或"EXIF 无法解析（原因）"。
 * 把前两者合并成"无"，就等于告诉用户"这文件格式不对"，而事实不是。
 */
function exifLine(info: ImportResult | null): string {
  if (info === null) return '—';
  return info.exifLine ?? '无容器';
}

/* ───────────────────────── 渲染 ───────────────────────── */

/**
 * 用 rAF 合并同一帧内的多个渲染请求。
 *
 * 拖滑杆时 input 事件可能每毫秒来一次；每来一次就整条管线重跑一遍，
 * 会在拖动时把 CPU 占满。合并到下一帧既省算力，又让"一帧内多次调参
 * 只渲染一次"，观感反而更顺。
 */
let renderScheduled = false;

/**
 * 渲染代次 —— 异步渲染下必须有的"最新者胜"守卫。
 *
 * 改成 Worker 之后每帧都是**异步**的：拖动滑杆时第 N 帧的结果可能在第 N+1 帧
 * 之后才回来，于是画面会**倒退** —— 贴回一张按过期参数渲出的画布，
 * 看起来就是"拖到一半跳回去"。每条渲染路径开头领一个代次号，回来时只有
 * "自己仍是最新那一条"才允许上屏，这类倒退从根上消失。
 *
 * （同步渲染时代不需要它：谁调用谁立刻拿到结果，"旧结果后到"不可能发生。
 *   它是"把负载搬去别的线程"必须付的代价，也是最容易漏掉的一处。）
 */
let renderGeneration = 0;

/**
 * 最近一帧预览像素 —— 导出体积预估的唯一输入。
 *
 * 留它而不重新渲染，是因为预估只需要"已有的一帧"：按像素数比例外推就能得到
 * 数量级正确的值，而重新跑一次全尺寸渲染 + 编码恰好是导出本身的主要开销，
 * 为一个"约 xx KB"的提示付这份代价不划算。详见 `session.estimateExportSize`。
 */
let lastPreviewPixels: PixelBuffer | null = null;

function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  window.requestAnimationFrame(() => {
    renderScheduled = false;
    /* `render` 现在是异步的；这里显式 `void`，表明**故意不等它** ——
     * 与 `scheduleRender` 的语义一致：它只负责把渲染排进下一帧。 */
    void render();
  });
}

/**
 * 复用的预览 ImageData。
 *
 * 两点考虑：
 *   - **类型**：`PixelBuffer.data` 是 `Uint8ClampedArray<ArrayBufferLike>`，
 *     而 `ImageData` 的构造签名只接受 `Uint8ClampedArray<ArrayBuffer>`。
 *     与其硬断言语义，不如让 `new ImageData(w, h)` 自己分配、再用 `.set()` 灌进去
 *     —— 语义清楚，且不把内核的缓冲交给画布持有。
 *   - **性能**：拖滑杆时每帧都新建一块 5 MB 的 ImageData 纯属浪费；
 *     尺寸不变就复用同一块，只在换图/旋转导致尺寸变化时才重建。
 */
let previewImage: ImageData | null = null;

function toImageData(pixels: { width: number; height: number; data: Uint8ClampedArray }): ImageData {
  if (
    previewImage === null ||
    previewImage.width !== pixels.width ||
    previewImage.height !== pixels.height
  ) {
    previewImage = new ImageData(pixels.width, pixels.height);
  }
  previewImage.data.set(pixels.data);
  return previewImage;
}

/**
 * 渲染一帧的**外层**：把异步渲染的失败变成一次可见提示。
 *
 * 为什么要多这一层：渲染改成异步之后，抛错不再落在调用栈上，而是一个
 * **未处理的 Promise 拒绝** —— 控制台一条警告，界面上毫无反应。对用户而言
 * 那就是"点了没反应"，比明确报错更难排查。这里统一接住并提示。
 *
 * 注意外层**不领代次号**：代次属于 `renderOnce` 那一段真正的渲染流程。
 */
async function render(): Promise<void> {
  try {
    await renderOnce();
  } catch (error) {
    toast(`渲染失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function renderOnce(): Promise<void> {
  /* 领一个代次号；回来时若已不是最新，就丢弃这一帧（见 `renderGeneration`）。 */
  const token = renderGeneration + 1;
  renderGeneration = token;

  if (!session.hasSource) {
    emptyHint.hidden = false;
    preview.hidden = true;
    cropOverlay.hidden = true;
    gridOverlay.hidden = true;
    sizeTip.hidden = true;
    lastPreviewPixels = null;
    renderThumbs();
    renderStatus([['状态', '尚未导入']]);
    syncControls();
    return;
  }

  /* 裁剪态用"未裁切"预览（在原图上取景）；其余情况用正常（含裁切）预览。
   *
   * `comparing`（按住看原图）优先级最高：它是临时快照视图，且由于保留了
   * 几何 / 裁切 / 拼图，输出尺寸与正常预览完全一致 —— 按下去不会跳。 */
  let pixels: PixelBuffer;
  let cacheLine: string;
  if (comparing) {
    pixels = await session.renderPreviewOriginal();
    cacheLine = '按住看原图（观感归零）';
  } else if (cropMode) {
    pixels = await session.renderPreviewForCrop();
    cacheLine = '裁剪态 · 未裁切取景';
  } else {
    const rendered = await session.renderPreview();
    pixels = rendered.pixels;
    cacheLine = `复用 ${rendered.stats.reused} / 重算 ${rendered.stats.computed}`;
  }

  /* 过期帧丢弃：参数已被更新的一帧取代，贴上去就是画面倒退。
   * 丢弃前**什么都不动**（不碰画布、不碰覆盖层、不碰状态行），所以不会闪。 */
  if (token !== renderGeneration) return;

  const ctx = preview.getContext('2d');
  if (ctx === null) throw new Error('预览画布无法取得 2D 上下文。');

  /* 只在尺寸变化时改 canvas 尺寸 —— 赋值会清空画布，每帧都赋会闪。 */
  if (preview.width !== pixels.width || preview.height !== pixels.height) {
    preview.width = pixels.width;
    preview.height = pixels.height;
  }
  ctx.putImageData(toImageData(pixels), 0, 0);
  drawHistogram(pixels);
  /* 上屏之后才更新预估输入 —— 保证预估用的是"用户现在看见的这一帧"，
   * 而不是某个被中途丢弃的中间结果。 */
  /* 对比视图**不**喂给导出体积预估 —— 预估要反映的是"会被导出那张"，
   * 也就是**编辑后**的版本；按住时若更新它，数字会忽大忽小。 */
  if (!comparing) {
    lastPreviewPixels = pixels;
    scheduleEstimate();
  }
  /* 画布 intrinsic 尺寸可能刚变过（换图 / 旋转），倍率要按新尺寸重新落到
   * 界面上，否则"100%"就不再等于 1:1。 */
  applyZoom();

  emptyHint.hidden = true;
  preview.hidden = false;

  if (cropMode) {
    const border =
      session.state.collage.mode === 'single' ? Math.max(0, session.state.collage.borderWidth) : 0;
    cropMetrics = {
      contentW: Math.max(1, preview.width - border * 2),
      contentH: Math.max(1, preview.height - border * 2),
      border,
    };
    cropOverlay.hidden = false;
    positionOverlay(cropOverlay);
    drawCropOverlay();
  } else {
    cropOverlay.hidden = true;
  }

  /* 切图模式：在预览上叠宫格线 + 序号（仅视图，不进导出）。裁剪态优先，不叠宫格。 */
  if (!cropMode && session.state.collage.mode === 'cut') {
    gridOverlay.hidden = false;
    positionOverlay(gridOverlay);
    drawGridOverlay();
  } else {
    gridOverlay.hidden = true;
  }

  const info = session.sourceInfo;
  const summary = session.previewPlanSummary();
  renderStatus([
    ['文件', fileLine(info)],
    ['源图', info === null ? '—' : `${info.width}×${info.height}`],
    ['预览', `${pixels.width}×${pixels.height}`],
    ['朝向', orientationLine(info)],
    ['EXIF', exifLine(info)],
    ['管线', `${summary.kinds.length} 步`],
    ['色阶', session.hasLevels ? '已增强' : '—'],
    ['缓存', cacheLine],
  ]);
  updateGate();
  renderThumbs();
  syncControls();
}

/** 把内核 `gateExport` 的判定结果呈现给用户 —— 导出前到底会不会超内存，一眼可见。 */
function updateGate(): void {
  if (!session.hasSource) {
    gateBox.hidden = true;
    return;
  }
  const gate = session.previewExportGate();
  gateBox.hidden = false;
  gateBox.dataset['decision'] = gate.decision;
  gateBox.textContent = gate.message;
}

/** 人类可读的体积。1024 进制，保留一位小数；不足 1 KB 直接给字节数。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * 体积预估的防抖定时器。
 *
 * 为什么要防抖：预估要真的编码一次预览像素，而拖滑杆每秒能产生几十个事件。
 * 每动一格就编码一遍会把"顺带显示个数字"变成主要的 CPU 开销。
 * 反过来也不必太保守 —— 松手 260 ms 后出数字，体感上是"即时"。
 */
let estimateTimer = 0;

function scheduleEstimate(): void {
  window.clearTimeout(estimateTimer);
  estimateTimer = window.setTimeout(() => {
    void updateSizeEstimate();
  }, 260);
}

/**
 * 刷新导出体积预估。
 *
 * 文案里的「约」是刻意的：体积按像素数比例外推，是估算而非实测
 * （见 `session.estimateExportSize`）。把它写成确定值，就等于给了用户
 * 一份错误的安全感 —— 与内核「绝不静默」同一条铁律。
 */
async function updateSizeEstimate(): Promise<void> {
  if (!session.hasSource || lastPreviewPixels === null) {
    sizeTip.hidden = true;
    return;
  }
  try {
    const est = await session.estimateExportSize(lastPreviewPixels, exportFormat, exportQuality);
    const label = exportFormat === 'jpeg' ? `JPEG 画质 ${exportQuality}` : 'PNG（无损）';
    sizeTip.hidden = false;
    sizeTip.textContent =
      `约 ${formatBytes(est.bytes)} · 成品 ${est.width}×${est.height} · ${label}`;
  } catch {
    /* 预估失败不该打断用户在做的事 —— 它不是主链路，最多是少看一个数。
     * 历史上这里若向上抛，会变成一个未处理的 Promise 拒绝。 */
    sizeTip.hidden = true;
  }
}

/** 直方图：把当前预览像素的 RGB 分布画成三条折线（纯视图，不参与编辑状态）。 */
function drawHistogram(pixels: PixelBuffer): void {
  if (!session.hasSource) {
    histogramCanvas.hidden = true;
    return;
  }
  histogramCanvas.hidden = false;
  const hist = color.computeHistogram(pixels);
  const ctx = histogramCanvas.getContext('2d');
  if (ctx === null) return;

  const w = histogramCanvas.width;
  const h = histogramCanvas.height;
  ctx.clearRect(0, 0, w, h);

  let max = 1;
  for (let i = 0; i < hist.r.length; i++) {
    max = Math.max(max, hist.r[i], hist.g[i], hist.b[i]);
  }
  const n = hist.r.length;
  const bw = w / n;
  const channel = (data: Uint32Array, stroke: string): void => {
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * bw;
      const y = h - (data[i] / max) * (h - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  channel(hist.r, '#ff5a5a');
  channel(hist.g, '#5aff7a');
  channel(hist.b, '#5a8bff');
}

/**
 * 曲线编辑器：画出当前通道的曲线（用内核 `buildCurveLut` 采样 256 点）、
 * 参考对角线、以及控制点手柄。纯视图 —— 编辑状态由 session 持有，
 * 拖拽在 `wire()` 里翻译为 `session.setCurves`。坐标约定：画布 (0,0) 在左上，
 * 而曲线 (x,y) 取值 0..255 且 y 向上，故画布 y = H - (y/255)*H。
 */
function drawCurveEditor(): void {
  const ctx = curveCanvas.getContext('2d');
  if (ctx === null) return;
  const w = curveCanvas.width;
  const h = curveCanvas.height;
  ctx.clearRect(0, 0, w, h);

  /* 背景与网格。 */
  ctx.fillStyle = '#0e0e14';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2a2a37';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * w;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(w, p);
    ctx.stroke();
  }

  /* 参考对角线（恒等曲线）。 */
  ctx.strokeStyle = '#3a3a4a';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();

  /* 当前曲线：用内核 LUT 采样，保证与导出完全一致（同源）。 */
  const lut = color.buildCurveLut(session.state.curves[curveChannel]);
  ctx.strokeStyle = '#ffce4d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < 256; x++) {
    const px = (x / 255) * w;
    const py = h - (lut[x] / 255) * h;
    if (x === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  /* 控制点手柄（白色圆点，带深色描边）。 */
  const pts = session.state.curves[curveChannel];
  ctx.lineWidth = 1.5;
  for (const [px, py] of pts) {
    const cx = (px / 255) * w;
    const cy = h - (py / 255) * h;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0e0e14';
    ctx.stroke();
  }
}

/* ───────────────────────── 多图 / 缩略图（#22） ───────────────────────── */

/**
 * 缩略图条签名 —— 只有"源图集合或当前选中"变化时才重建缩略图。
 *
 * 缩略图是一次真实的重采样（每张一遍内核 rasterize）。若每帧都重建，
 * 拖滑杆时会把 CPU 白白吃掉；而拖滑杆并不改变"导入了哪几张图"。
 * 把源图的名字/尺寸并入签名，是为了覆盖"张数相同但换了一张图"的情形。
 */
let thumbSignature = '';

function renderThumbs(): void {
  const infos = session.sourceInfos;
  const signature = `${session.currentIndex}|${infos.map((i) => `${i.name}/${i.width}x${i.height}`).join(',')}`;
  if (signature === thumbSignature) {
    thumbsBox.hidden = infos.length === 0;
    return;
  }
  thumbSignature = signature;

  const current = session.currentIndex;
  const buttons = infos.map((info, index) => {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = index === current ? 'thumb thumb--active' : 'thumb';
    thumb.title = `${info.name} · ${info.width}×${info.height}`;

    const canvas = document.createElement('canvas');
    const pixels = session.thumbnailAt(index);
    if (pixels !== null) {
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const image = new ImageData(pixels.width, pixels.height);
        image.data.set(pixels.data);
        ctx.putImageData(image, 0, 0);
      }
    }

    const badge = document.createElement('span');
    badge.className = 'thumb__idx';
    badge.textContent = String(index + 1);
    thumb.append(canvas, badge);
    thumb.addEventListener(
      'click',
      guard(() =>
        step(() => {
          session.setCurrentSource(index);
          /* 切图/单图模式下换图要重画预览；缩放/裁剪框状态一并复位更安全。 */
        }),
      ),
    );
    return thumb;
  });

  thumbList.replaceChildren(...buttons);
  thumbsBox.hidden = infos.length === 0;
  btnDelCurrent.disabled = infos.length === 0;
  btnClear.disabled = infos.length === 0;
}

/* ───────────────────────── 切图宫格线（#16，仅视图） ───────────────────────── */

/**
 * 在预览覆盖层上画宫格线与序号。
 *
 * 这是**纯视图装饰**（与直方图、裁剪框同类）：宫格线只帮用户看清"这张图会被切成几块"，
 * 绝不进导出 —— 底图仍由内核 `singlePlan` 的切图分支产出（忽略旋转/镜像/边框/水印）。
 * 切图模式无边框，故内容区就是整块画布。
 */
function drawGridOverlay(): void {
  const ctx = gridOverlay.getContext('2d');
  if (ctx === null) return;
  const w = gridOverlay.width;
  const h = gridOverlay.height;
  ctx.clearRect(0, 0, w, h);

  const collage = session.state.collage;
  const cols = Math.max(1, Math.round(collage.cutCols));
  const rows = Math.max(1, Math.round(collage.cutRows));
  const cellW = w / cols;
  const cellH = h / rows;

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  for (let i = 1; i < cols; i++) {
    const x = Math.round(cellW * i) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let j = 1; j < rows; j++) {
    const y = Math.round(cellH * j) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.font = '600 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = String(n++);
      const x = c * cellW + 8;
      const y = r * cellH + 8;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(label, x, y);
    }
  }
}

/* ───────────────────────── 裁剪（#14） ───────────────────────── */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CropDrag =
  | { readonly kind: 'move'; readonly startX: number; readonly startY: number; readonly box0: Box }
  | { readonly kind: 'new'; readonly anchorX: number; readonly anchorY: number }
  | { readonly kind: 'corner'; readonly corner: number; readonly box0: Box };

/** 是否处于裁剪态。 */
let cropMode = false;
/**
 * 归一化裁切框（相对**未裁切**内容区，各分量 0..1）。
 * 与内核 `EditState.crop` 同一坐标系，因此可直接写回 `session.setCrop`。
 */
let cropBox: Box = { x: 0, y: 0, w: 1, h: 1 };
/** 比例锁：真实宽高比 w/h；null 表示自由。 */
let cropRatio: number | null = null;
/** 未裁切预览的内容尺寸（像素）与边框宽度 —— 覆盖层坐标换算基准。 */
let cropMetrics = { contentW: 1, contentH: 1, border: 0 };
let cropDrag: CropDrag | null = null;

/**
 * 归一化比例换算：真实宽高比 R → 归一化坐标下的 w/h 比。
 * 内容宽高不等时二者不同（例如内容 1200×800 上做 1:1，归一化 w/h = 0.667）。
 */
function normRatio(): number | null {
  if (cropRatio === null) return null;
  return cropRatio * (cropMetrics.contentH / cropMetrics.contentW);
}

function clampNormBox(b: Box): Box {
  const w = Math.max(0.02, Math.min(1, b.w));
  const h = Math.max(0.02, Math.min(1, b.h));
  const x = Math.max(0, Math.min(1 - w, b.x));
  const y = Math.max(0, Math.min(1 - h, b.y));
  return { x, y, w, h };
}

/** 由锚点与当前点构造框（含比例锁）。 */
function boxFrom(ax: number, ay: number, cx: number, cy: number): Box {
  let w = Math.abs(cx - ax);
  let h = Math.abs(cy - ay);
  const r = normRatio();
  if (r !== null) {
    if (w / r >= h) h = w / r;
    else w = h * r;
  }
  const x = cx >= ax ? ax : ax - w;
  const y = cy >= ay ? ay : ay - h;
  return clampNormBox({ x, y, w, h });
}

/** 把某个覆盖层对齐到预览的显示位置与尺寸（预览被 CSS 缩放时也能精确贴合）。 */
/* ── 视图缩放（#28） ────────────────────────────────────────────
 *
 * 纯展示层：**不写成 op、不进历史** —— 用户不该在放大之后按撤销去"撤销一次缩放"。
 * 这与 legacy 一致，也对应内核 `ViewState.zoom 不参与撤销` 的约定。
 *
 * 另一个容易漏的点：画布的 intrinsic 尺寸会变（换图 / 旋转 / 改长边）。
 * 倍率语义必须保持不变 —— 原来 100% 就还是有像素 1:1 ——
 * 所以每次上屏后都要重新应用一次，否则倍率会悄悄漂到别的值。
 */
/** 上下限与 legacy 一致：小到 5% 看全局，大到 800% 看像素。 */
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;
/** 单步倍率。低于 1.15 会"推不动"，再高则容易一下跳过想要的那一档。 */
const ZOOM_STEP = 1.25;

type ZoomMode = 'fit' | 'custom';
let zoomMode: ZoomMode = 'fit';
let zoomFactor = 1;

/**
 * 是否正在"按住看原图"（#29）。
 *
 * 纯 UI 标记，不进文档、不进历史 —— 按住期间 `renderOnce` 改用
 * `renderPreviewOriginal()` 取像素。
 *
 * 松开要覆盖**四种**情况，缺一种就会永久卡在原图视图上：
 *   - `mouseup` —— 常规松开；
 *   - `mouseleave` —— 在按钮上按下、挪开再松开（此时收不到 mouseup）；
 *   - `blur` / `mouseup` 落在窗口外 —— 按住时 Alt+Tab 切走；
 *   - `contextmenu` —— 右键菜单弹出会吞掉 mouseup。
 * 另外 `touchstart/touchend` 保证触屏可用（与 legacy 一致）。
 */
let comparing = false;

function setComparing(next: boolean): void {
  if (comparing === next) return;
  comparing = next;
  compareBtn.dataset['active'] = next ? 'true' : 'false';
  scheduleRender();
}

/** 舞台可用像素 —— padding 读计算值而不是写死 16，免得改样式时缩放跟着算错。 */
function stageAvail(): { w: number; h: number } {
  const sr = stage.getBoundingClientRect();
  const cs = getComputedStyle(stage);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return { w: Math.max(0, sr.width - padX), h: Math.max(0, sr.height - padY) };
}

/** "适应窗口"对应的倍率。 */
function fitFactor(): number {
  if (preview.width <= 0 || preview.height <= 0) return 1;
  const avail = stageAvail();
  if (avail.w <= 0 || avail.h <= 0) return 1;
  return Math.min(avail.w / preview.width, avail.h / preview.height);
}

/**
 * 把当前倍率落到画布上。
 *
 * 用**显式像素宽高**而不是 CSS 百分比：裁切 / 宫格覆盖层是靠
 * `preview.getBoundingClientRect()` 对齐的（`positionOverlay`），显式尺寸
 * 保证覆盖层与预览永远同宽高 —— 缩放不会让裁切框和画面错位。
 */
function applyZoom(): void {
  if (preview.width <= 0 || preview.height <= 0) return;
  const raw = zoomMode === 'fit' ? fitFactor() : zoomFactor;
  const factor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));
  /* fit 模式也回写（legacy 同款行为）：之后点「＋」是从"适应"继续放大，
   * 而不是跳回某个陈旧的倍率。 */
  zoomFactor = factor;

  preview.style.width = `${Math.max(1, Math.round(preview.width * factor))}px`;
  preview.style.height = `${Math.max(1, Math.round(preview.height * factor))}px`;
  zoomLabel.textContent = `${Math.round(factor * 100)}%`;

  /* 覆盖层跟着新的显示尺寸重新对齐；看不见的不必动。 */
  if (!cropOverlay.hidden) positionOverlay(cropOverlay);
  if (!gridOverlay.hidden) positionOverlay(gridOverlay);
}

/** 切到自定义倍率并钳到合法区间 —— 按钮 / 滚轮共用的唯一入口。 */
function setZoomFactor(next: number): void {
  zoomMode = 'custom';
  zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  applyZoom();
}

function positionOverlay(canvas: HTMLCanvasElement): void {
  const pr = preview.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  canvas.style.left = `${pr.left - sr.left}px`;
  canvas.style.top = `${pr.top - sr.top}px`;
  canvas.style.width = `${pr.width}px`;
  canvas.style.height = `${pr.height}px`;
  if (canvas.width !== preview.width || canvas.height !== preview.height) {
    canvas.width = preview.width;
    canvas.height = preview.height;
  }
}

/** 画裁切框：变暗遮罩 + 挖空选区 + 三分线 + 四角手柄。 */
function drawCropOverlay(): void {
  const ctx = cropOverlay.getContext('2d');
  if (ctx === null) return;
  const w = cropOverlay.width;
  const h = cropOverlay.height;
  ctx.clearRect(0, 0, w, h);
  const b = cropMetrics.border;
  const bx = b + cropBox.x * cropMetrics.contentW;
  const by = b + cropBox.y * cropMetrics.contentH;
  const bw = cropBox.w * cropMetrics.contentW;
  const bh = cropBox.h * cropMetrics.contentH;

  ctx.fillStyle = 'rgba(10,10,14,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(bx, by, bw, bh);

  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const gx = bx + (bw * i) / 3;
    const gy = by + (bh * i) / 3;
    ctx.beginPath();
    ctx.moveTo(gx, by);
    ctx.lineTo(gx, by + bh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, gy);
    ctx.lineTo(bx + bw, gy);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  for (const [hx, hy] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]] as const) {
    ctx.fillRect(hx - 4, hy - 4, 8, 8);
  }
}

/** 覆盖层像素坐标 → 归一化内容坐标。 */
function overlayToContent(evt: MouseEvent): { x: number; y: number } {
  const rect = cropOverlay.getBoundingClientRect();
  const ox = ((evt.clientX - rect.left) / rect.width) * cropOverlay.width;
  const oy = ((evt.clientY - rect.top) / rect.height) * cropOverlay.height;
  const nx = (ox - cropMetrics.border) / cropMetrics.contentW;
  const ny = (oy - cropMetrics.border) / cropMetrics.contentH;
  return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
}

function enterCropMode(): void {
  if (!session.hasSource) {
    toast('先导入一张图再裁剪', 'info');
    return;
  }
  cropMode = true;
  const committed = session.state.crop;
  cropBox =
    committed === null
      ? { x: 0, y: 0, w: 1, h: 1 }
      : { x: committed.x, y: committed.y, w: committed.w, h: committed.h };
  cropRatio = null;
  cropRatioSelect.value = 'free';
  cropPanel.hidden = false;
  render();
}

function exitCropMode(): void {
  cropMode = false;
  cropDrag = null;
  cropPanel.hidden = true;
  cropOverlay.hidden = true;
  render();
}

function applyCrop(): void {
  const full =
    cropBox.x <= 0.002 && cropBox.y <= 0.002 && cropBox.w >= 0.998 && cropBox.h >= 0.998;
  session.setCrop(full ? null : { ...cropBox });
  toast(full ? '已取消裁切' : '已应用裁切');
  exitCropMode();
}

function setCropRatio(value: string): void {
  const r = Number(value);
  cropRatio = value === 'free' || !Number.isFinite(r) || r <= 0 ? null : r;
  const nr = normRatio();
  if (nr === null) return;
  let h = cropBox.w / nr;
  if (cropBox.y + h > 1) {
    h = 1 - cropBox.y;
    cropBox = clampNormBox({ x: cropBox.x, y: cropBox.y, w: h * nr, h });
  } else {
    cropBox = clampNormBox({ ...cropBox, h });
  }
  drawCropOverlay();
}

/* ───────────────────────── 动作 ───────────────────────── */

function suggestedName(): string {
  const info = session.sourceInfo;
  const base = info === null ? 'export' : info.name.replace(/\.[^.]+$/, '');
  const ext = exportFormat === 'jpeg' ? 'jpg' : 'png';
  return `${base}-edited.${ext}`;
}

/** 归档的默认文件名 —— 用"当前这张"的名字当基准，便于用户认领这一批。 */
function zipName(): string {
  const info = session.sourceInfo;
  const base = info === null ? 'photos' : info.name.replace(/\.[^.]+$/, '');
  return session.cutSliceCount > 0 ? `${base}-切图分片.zip` : `${base}-批量导出.zip`;
}

/**
 * 打开图片（可多选）—— **替换**全部源图。
 *
 * 多选一次导入即"这一批就是这个工程"，与 legacy 的 `fileInput[multiple]` 一致；
 * 想往当前工程里再加，用「添加图片」。
 */
async function openImages(): Promise<void> {
  const opened = await bridge.openImages();
  const [first, ...rest] = opened;
  if (first === undefined) return;
  await session.importBytes(
    first.bytes,
    first.name,
    sniffImageMime(first.bytes) ?? undefined,
    first.path,
  );
  for (const item of rest) {
    await session.addBytes(item.bytes, item.name, sniffImageMime(item.bytes) ?? undefined, item.path);
  }
  render();
  toast(opened.length === 1 ? `已导入 ${first.name}` : `已导入 ${opened.length} 张图`);
}

/** 追加图片（不替换已有源图）—— 拼图 / 切图的前置。 */
async function addImages(): Promise<void> {
  const opened = await bridge.openImages();
  if (opened.length === 0) return;
  for (const item of opened) {
    await session.addBytes(item.bytes, item.name, sniffImageMime(item.bytes) ?? undefined, item.path);
  }
  render();
  toast(`已添加 ${opened.length} 张图 —— 选「横向/纵向/网格拼接」把它们拼起来`);
}

/* ───────────────────────── 工程文件（序 2 · D14） ───────────────────────── */

/** 默认文件名跟着第一张源图走：一 folder 一张图时，工程与图同名最好认。 */
function projectDefaultName(): string {
  const stem = (session.sourceInfo?.name ?? '').replace(/\.[^.]*$/, '').slice(0, 40);
  return `${stem === '' ? 'project' : stem}.photo.doc.json`;
}

async function saveProject(): Promise<void> {
  if (!session.hasSource) {
    toast('还没有图 —— 工程文件里除了步骤什么都没有', 'error');
    return;
  }
  const saved = await bridge.saveProject(projectDefaultName(), session.serializeProject());
  /* 取消对话框不是错误，不该弹提示；保存成功则要说清"不含像素"，
   * 否则用户会以为工程文件像 psd 一样能单独带走。 */
  if (saved !== null) toast(`工程已存到 ${saved}（只有编辑步骤，重开时要再选同样的源图）`);
}

async function openProject(): Promise<void> {
  const picked = await bridge.openProject();
  if (picked === null) return;
  /* 先读一眼工程要什么，再弹"选源图"：顺序与张数都必须提前说，
   * 不然用户挑完才被告知"对不上"。结构错的文件在这里就抛，不浪费一次选择。 */
  const needs = session.projectNeeds(picked.text);
  toast(
    `「${picked.name}」需要 ${needs.sources.length} 张源图，按这个顺序选：` +
      needs.sources.map((s, i) => `${i + 1}·${s.name}`).join('　'),
  );
  const files = await bridge.openImages();
  if (files.length === 0) {
    toast('没选源图，已取消打开（当前会话没被动过）', 'error');
    return;
  }
  const res = await session.loadProject(
    picked.text,
    files.map((f) => ({
      name: f.name,
      bytes: f.bytes,
      mime: sniffImageMime(f.bytes) ?? undefined,
      ...(f.path === undefined ? {} : { handle: f.path }),
    })),
  );
  customApplied = null;
  render();
  toast(
    res.history < res.total
      ? `已恢复「${picked.name}」：${res.sources.length} 张图 · 历史停在第 ${res.history}/${res.total} 步，还能重做 ${res.total - res.history} 步`
      : `已恢复「${picked.name}」：${res.sources.length} 张图 · ${res.total} 步历史全部接上`,
  );
}

function useSample(): void {
  const sample = createSampleImage(1600, 1067);
  session.importPixels(sample, '示例图.png');
  render();
  toast('已生成示例图 —— 可直接试预设与滑杆');
}

async function runExport(maxEdge?: number): Promise<void> {
  btnExport.disabled = true;
  btnExport.textContent = '导出中…';
  try {
    const result =
      maxEdge === undefined
        ? await session.exportBytes(exportFormat, exportQuality)
        : await session.exportBytesDownscaled(maxEdge, exportFormat, exportQuality);
    const saved = await bridge.saveImage(suggestedName(), result.bytes);
    toast(saved === null ? '已取消导出' : `已导出 ${result.width}×${result.height} → ${saved}`);
  } finally {
    btnExport.textContent = '导出';
    syncControls();
  }
}

/**
 * 导出入口：先过内存门，再按判定分支行动。
 *
 * - `run`：直接导出；
 * - `downscale`：按内核建议长边降采样并**明确告知**用户目标尺寸；
 * - `confirm`：把风险摆到台面上，用户知情确认后才执行（非交互场景的等价物是 CLI 的 `--allow-oversize`）；
 * - `reject`：明确拒绝并说明原因，绝不悄悄 OOM。
 *
 * 与内核「绝不静默」同一条铁律（P6D-PLAN §2.3）。
 */
async function exportImage(): Promise<void> {
  if (!session.hasSource) return;
  const gate = session.previewExportGate();
  if (gate.decision === 'reject') {
    toast(gate.message, 'error');
    return;
  }
  if (gate.decision === 'confirm' && !window.confirm(gate.message)) return;
  if (gate.decision === 'downscale') {
    toast(gate.message);
    await runExport(gate.maxEdge);
    return;
  }
  await runExport();
}

/**
 * 批量导出（打包成一个 ZIP）。
 *
 * 与单张导出**共用同一道内存门**：批量是逐张渲染的，单张峰值就是整批峰值，
 * 因此"当前这张能不能全尺寸跑"是整批能否安全执行的正确代理。
 *
 * 门判定为 `downscale` 时把同一个长边上限套给整批 —— 这是个**近似**（各图
 * 尺寸不同，门给的上限是按当前这张算的），但方向保守，且比"整批硬吃原尺寸"
 * 安全得多。提示里如实写明"已降采样"，不含糊过去。
 */
async function exportZip(): Promise<void> {
  if (!session.canBatchExport) {
    toast(session.batchExportBlocker ?? '当前状态不支持批量导出。', 'error');
    return;
  }
  const gate = session.previewExportGate();
  if (gate.decision === 'reject') {
    toast(gate.message, 'error');
    return;
  }
  if (gate.decision === 'confirm' && !window.confirm(gate.message)) return;

  const label = btnExportZip.textContent ?? '批量导出 ZIP';
  btnExportZip.disabled = true;
  btnExportZip.textContent = '打包中…';
  try {
    const maxEdge = gate.decision === 'downscale' ? gate.maxEdge : session.exportMaxEdgeValue;
    const result = await session.exportBatch(exportFormat, exportQuality, maxEdge);
    if (!result.ok) {
      toast(result.reason, 'error');
      return;
    }
    const saved = await bridge.saveImage(zipName(), result.zip);
    if (saved === null) {
      toast('已取消导出');
      return;
    }
    const what = result.sliced
      ? `切图分片 ${result.entries.length} 张`
      : `成品 ${result.entries.length} 张`;
    const note = gate.decision === 'downscale' ? '（已按内存门建议降采样）' : '';
    toast(`已打包 ${what}${note} → ${saved}`);
  } finally {
    btnExportZip.textContent = label;
    syncControls();
  }
}

function step(action: () => void): void {
  action();
  render();
}

/**
 * 口语指令入口：解析 → 意图 → 落地，并把结果诚实回显到提示条。
 *
 * 没导入图片时不执行 —— `importPixels` 会重建文档，先说的话会被清掉，没意义。
 * `session.applyKouyu` 内部已把可落文档的意图翻译成 op 推入历史；
 * 已识别但壳未接 UI 的（裁剪/切页/导出…）归入 pending，提示条明确说"待交互"。
 */
function runKouyu(): void {
  const text = kouyuInput.value.trim();
  if (text.length === 0) return;
  if (!session.hasSource) {
    toast('先导入一张图，再用口语指令调它', 'info');
    return;
  }
  const out = session.applyKouyu(text);
  if (out.empty) {
    kouyuTip.hidden = false;
    kouyuTip.dataset['kind'] = 'warn';
    kouyuTip.textContent = '没听懂，换个说法？比如「亮一点」「横向拼」「套个胶片」。';
  } else {
    const parts: string[] = [];
    if (out.applied.length > 0) parts.push(out.applied.join(' · '));
    if (out.pending.length > 0) parts.push(`（${out.pending.join('、')} 待交互，暂未执行）`);
    kouyuTip.hidden = false;
    kouyuTip.dataset['kind'] = out.pending.length > 0 ? 'warn' : 'info';
    kouyuTip.textContent = parts.join(' ');
  }
  syncControls();
  scheduleRender();
}

function wire(): void {
  btnOpen.addEventListener('click', guard(openImages));
  btnAdd.addEventListener('click', guard(addImages));
  btnSaveProject.addEventListener('click', guard(saveProject));
  btnOpenProject.addEventListener('click', guard(openProject));
  btnSample.addEventListener('click', guard(useSample));
  btnExport.addEventListener('click', guard(exportImage));
  btnExportZip.addEventListener('click', guard(exportZip));
  btnUndo.addEventListener('click', guard(() => step(() => session.undo())));
  btnRedo.addEventListener('click', guard(() => step(() => session.redo())));
  btnRotate.addEventListener('click', guard(() => step(() => session.rotateClockwise())));
  btnFlip.addEventListener('click', guard(() => step(() => session.flipHorizontal())));
  btnFlipV.addEventListener('click', guard(() => step(() => session.flipVertical())));
  watermarkInput.addEventListener('input', () => {
    session.setWatermarkText(watermarkInput.value);
    scheduleRender();
  });

  /* 视图缩放（#28）：四个入口 + 两个手势，全部绕过历史。 */
  zoomInBtn.addEventListener('click', () => setZoomFactor(zoomFactor * ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setZoomFactor(zoomFactor / ZOOM_STEP));
  zoomFitBtn.addEventListener('click', () => {
    zoomMode = 'fit';
    applyZoom();
  });
  /* 点百分比 = 回到 1:1（校对细节最快的那一档）。 */
  zoomLabel.addEventListener('click', () => setZoomFactor(1));
  /* 双击画布 = 适应窗口（legacy 同款手势）。 */
  preview.addEventListener('dblclick', () => {
    zoomMode = 'fit';
    applyZoom();
  });
  /* 缩放用 Ctrl+滚轮：无修饰的滚轮留给未来的平移 / 面板滚动，
   * 且 Ctrl+滚轮正是桌面读图软件与 Electron 页面缩放的通行语义。
   * `passive: false` 才能 preventDefault —— 否则浏览器的页面缩放会抢先触发。 */
  stage.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const step = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoomFactor(zoomFactor * step);
    },
    { passive: false },
  );

  /* 按住看原图（#29）：每个"松开"信号都要接，理由见 setComparing 的注释。
   * `preventDefault` 挡掉 mousedown 的默认行为，避免按住时把按钮文字选中。 */
  compareBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    setComparing(true);
  });
  compareBtn.addEventListener('touchstart', () => setComparing(true));
  for (const evt of ['mouseup', 'mouseleave', 'blur', 'touchend', 'touchcancel', 'contextmenu']) {
    compareBtn.addEventListener(evt, () => setComparing(false));
  }
  /* 兜底：指针在任何地方松开都要回到编辑视图 —— 比逐个事件兜更稳，
   * 不会因为"焦点此刻不在按钮上"而漏掉这一次松开。 */
  window.addEventListener('mouseup', () => setComparing(false));
  window.addEventListener('touchend', () => setComparing(false));

  straightenInput.addEventListener('input', () => {
    const v = Number(straightenInput.value);
    session.setStraighten(v);
    straightenValue.textContent = String(Math.round(v));
    scheduleRender();
  });

  formatSelect.addEventListener('change', () => {
    exportFormat = formatSelect.value === 'jpeg' ? 'jpeg' : 'png';
    updateGate();
    scheduleEstimate();
  });
  qualityInput.addEventListener('input', () => {
    exportQuality = Number(qualityInput.value);
    qualityValue.textContent = String(exportQuality);
    updateGate();
    scheduleEstimate();
  });
  longEdgeSelect.addEventListener('change', () => {
    session.setExportMaxEdge(Number(longEdgeSelect.value));
    updateGate();
    scheduleEstimate();
  });

  /* 水印进阶。 */
  wmPos.addEventListener('change', () => {
    session.setWatermark({ pos: wmPos.value as 'br' | 'bl' | 'tr' | 'tl' | 'c' });
    scheduleRender();
  });
  wmColor.addEventListener('input', () => {
    session.setWatermark({ color: wmColor.value });
    scheduleRender();
  });
  wmStroke.addEventListener('change', () => {
    session.setWatermark({ stroke: wmStroke.checked });
    scheduleRender();
  });
  wmSize.addEventListener('input', () => {
    const v = Number(wmSize.value);
    session.setWatermark({ size: v });
    wmSizeVal.textContent = String(v);
    scheduleRender();
  });
  wmAlpha.addEventListener('input', () => {
    const v = Number(wmAlpha.value);
    session.setWatermark({ alpha: v });
    wmAlphaVal.textContent = String(v);
    scheduleRender();
  });

  /* 贴纸。 */
  stickerText.addEventListener('input', () => {
    session.setSticker({ text: stickerText.value });
    scheduleRender();
  });
  stickerStyle.addEventListener('change', () => {
    session.setSticker({ style: stickerStyle.value as 'white' | 'black' | 'gold' | 'seal' });
    scheduleRender();
  });
  stickerPos.addEventListener('change', () => {
    session.setSticker({ pos: stickerPos.value as 'bottom' | 'top' | 'center' });
    scheduleRender();
  });
  stickerSize.addEventListener('input', () => {
    const v = Number(stickerSize.value);
    session.setSticker({ size: v });
    stickerSizeVal.textContent = String(v);
    scheduleRender();
  });

  /* HSL 八色分调。 */
  hslBandSelect.addEventListener('change', () => {
    hslBand = hslBandSelect.value as color.HslBand;
    syncControls();
  });
  const onHsl = (): void => {
    const h = Number(hslH.value);
    const s = Number(hslS.value);
    const l = Number(hslL.value);
    hslHVal.textContent = String(h);
    hslSVal.textContent = String(s);
    hslLVal.textContent = String(l);
    session.setBands({ [hslBand]: { h, s, l } });
    scheduleRender();
  };
  hslH.addEventListener('input', onHsl);
  hslS.addEventListener('input', onHsl);
  hslL.addEventListener('input', onHsl);

  /* 曲线编辑器。 */
  curveChannelSelect.addEventListener('change', () => {
    curveChannel = curveChannelSelect.value as color.CurveChannel;
    drawCurveEditor();
  });
  curveResetBtn.addEventListener('click', () => {
    session.resetCurve(curveChannel);
    scheduleRender();
  });

  /* 口语指令：点按钮或回车执行。 */
  kouyuBtn.addEventListener('click', guard(runKouyu));
  kouyuInput.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') runKouyu();
  });

  /* 裁剪（#14）。 */
  btnCrop.addEventListener(
    'click',
    guard(() => {
      if (cropMode) exitCropMode();
      else enterCropMode();
    }),
  );
  cropRatioSelect.addEventListener('change', () => setCropRatio(cropRatioSelect.value));
  cropApplyBtn.addEventListener('click', guard(applyCrop));
  cropCancelBtn.addEventListener('click', guard(exitCropMode));

  cropOverlay.addEventListener('pointerdown', (evt) => {
    if (!cropMode) return;
    const rect = cropOverlay.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * cropOverlay.width;
    const my = ((evt.clientY - rect.top) / rect.height) * cropOverlay.height;
    const b = cropMetrics.border;
    const bx = b + cropBox.x * cropMetrics.contentW;
    const by = b + cropBox.y * cropMetrics.contentH;
    const bw = cropBox.w * cropMetrics.contentW;
    const bh = cropBox.h * cropMetrics.contentH;
    const corners: readonly (readonly [number, number])[] = [
      [bx, by],
      [bx + bw, by],
      [bx, by + bh],
      [bx + bw, by + bh],
    ];
    let hitCorner = -1;
    for (let i = 0; i < corners.length; i++) {
      if (Math.hypot(corners[i][0] - mx, corners[i][1] - my) < 16) {
        hitCorner = i;
        break;
      }
    }
    const box0: Box = { ...cropBox };
    if (hitCorner >= 0) {
      cropDrag = { kind: 'corner', corner: hitCorner, box0 };
    } else if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
      const p = overlayToContent(evt);
      cropDrag = { kind: 'move', startX: p.x, startY: p.y, box0 };
    } else {
      const p = overlayToContent(evt);
      cropDrag = { kind: 'new', anchorX: p.x, anchorY: p.y };
      cropBox = clampNormBox({ x: p.x, y: p.y, w: 0.02, h: 0.02 });
      drawCropOverlay();
    }
    try {
      cropOverlay.setPointerCapture(evt.pointerId);
    } catch {
      /* 部分环境不支持指针捕获，忽略即可。 */
    }
  });

  cropOverlay.addEventListener('pointermove', (evt) => {
    if (!cropMode || cropDrag === null) return;
    const p = overlayToContent(evt);
    if (cropDrag.kind === 'move') {
      cropBox = clampNormBox({
        x: cropDrag.box0.x + (p.x - cropDrag.startX),
        y: cropDrag.box0.y + (p.y - cropDrag.startY),
        w: cropDrag.box0.w,
        h: cropDrag.box0.h,
      });
    } else if (cropDrag.kind === 'new') {
      cropBox = boxFrom(cropDrag.anchorX, cropDrag.anchorY, p.x, p.y);
    } else {
      const b0 = cropDrag.box0;
      const cs: readonly (readonly [number, number])[] = [
        [b0.x, b0.y],
        [b0.x + b0.w, b0.y],
        [b0.x, b0.y + b0.h],
        [b0.x + b0.w, b0.y + b0.h],
      ];
      const opp = cs[3 - cropDrag.corner];
      cropBox = boxFrom(opp[0], opp[1], p.x, p.y);
    }
    drawCropOverlay();
  });

  const endCropDrag = (evt: PointerEvent): void => {
    if (cropDrag === null) return;
    cropDrag = null;
    try {
      cropOverlay.releasePointerCapture(evt.pointerId);
    } catch {
      /* 忽略。 */
    }
  };
  cropOverlay.addEventListener('pointerup', endCropDrag);
  cropOverlay.addEventListener('pointercancel', endCropDrag);

  /* 画布拖拽：拖动已有控制点、在空白处点按加新点、双击删点。
   * dragPoint 用对象引用稳定跟踪被拖的点 —— 因为 setCurves 内部会按 x 重新排序，
   * 只用下标会在排序后指错点；引用不受排序影响。 */
  let dragPoint: [number, number] | null = null;

  /** 屏幕坐标 → 曲线坐标（0..255），并钳到合法域。兼顾 CSS 缩放（用 getBoundingClientRect）。 */
  function toCurvePoint(evt: MouseEvent): { x: number; y: number } {
    const rect = curveCanvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) * (curveCanvas.width / rect.width);
    const my = (evt.clientY - rect.top) * (curveCanvas.height / rect.height);
    return {
      x: Math.max(0, Math.min(255, Math.round((mx / curveCanvas.width) * 255))),
      y: Math.max(0, Math.min(255, Math.round((1 - my / curveCanvas.height) * 255))),
    };
  }

  /** 屏幕坐标 → 画布像素坐标（未钳制），用于命中测试。 */
  function toCanvasXY(evt: MouseEvent): { cx: number; cy: number } {
    const rect = curveCanvas.getBoundingClientRect();
    return {
      cx: (evt.clientX - rect.left) * (curveCanvas.width / rect.width),
      cy: (evt.clientY - rect.top) * (curveCanvas.height / rect.height),
    };
  }

  /** 找最近控制点的下标（命中半径 14 画布像素）。 */
  function nearestPointIndex(cx: number, cy: number): number {
    const pts = session.state.curves[curveChannel];
    let best = -1;
    let bestD = 14;
    for (let i = 0; i < pts.length; i++) {
      const px = (pts[i][0] / 255) * curveCanvas.width;
      const py = curveCanvas.height - (pts[i][1] / 255) * curveCanvas.height;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  curveCanvas.addEventListener('pointerdown', (evt) => {
    const { cx, cy } = toCanvasXY(evt);
    const hit = nearestPointIndex(cx, cy);
    /* 以当前状态拷一份可变副本作为本次拖拽的工作集。 */
    const work = session.state.curves[curveChannel].map((p) => [p[0], p[1]] as [number, number]);
    if (hit >= 0) {
      dragPoint = work[hit];
    } else {
      const np = [0, 0] as [number, number];
      const { x, y } = toCurvePoint(evt);
      np[0] = x;
      np[1] = y;
      work.push(np);
      dragPoint = np;
    }
    work.sort((a, b) => a[0] - b[0]);
    session.setCurves(curveChannel, work);
    try {
      curveCanvas.setPointerCapture(evt.pointerId);
    } catch {
      /* 部分环境不支持指针捕获，忽略即可，不影响拖拽。 */
    }
    scheduleRender();
  });

  curveCanvas.addEventListener('pointermove', (evt) => {
    if (dragPoint === null) return;
    const { x, y } = toCurvePoint(evt);
    dragPoint[0] = x;
    dragPoint[1] = y;
    const work = session.state.curves[curveChannel].map((p) => [p[0], p[1]] as [number, number]);
    work.sort((a, b) => a[0] - b[0]);
    session.setCurves(curveChannel, work);
    scheduleRender();
  });

  function endDrag(evt: PointerEvent): void {
    if (dragPoint === null) return;
    dragPoint = null;
    try {
      curveCanvas.releasePointerCapture(evt.pointerId);
    } catch {
      /* 忽略。 */
    }
  }
  curveCanvas.addEventListener('pointerup', endDrag);
  curveCanvas.addEventListener('pointercancel', endDrag);

  curveCanvas.addEventListener('dblclick', (evt) => {
    const { cx, cy } = toCanvasXY(evt);
    const hit = nearestPointIndex(cx, cy);
    const pts = session.state.curves[curveChannel];
    /* 至少保留两点，否则曲线无意义。 */
    if (hit >= 0 && pts.length > 2) {
      const work = pts.map((p) => [p[0], p[1]] as [number, number]);
      work.splice(hit, 1);
      session.setCurves(curveChannel, work);
      scheduleRender();
    }
  });

  /* 多图（#22）：删除当前 / 清空。 */
  btnDelCurrent.addEventListener('click', guard(() => step(() => session.removeCurrentSource())));
  btnClear.addEventListener('click', guard(() => step(() => session.clearSources())));

  /* 拼图 / 切图 / 边框（#15 / #16 / #17）。 */
  collageModeSelect.addEventListener('change', () => {
    session.setCollage({ mode: collageModeSelect.value as CollageMode });
    render();
  });
  collageGapInput.addEventListener('input', () => {
    const v = Number(collageGapInput.value);
    session.setCollage({ gap: v });
    collageGapVal.textContent = String(v);
    scheduleRender();
  });
  collageBgSelect.addEventListener('change', () => {
    session.setCollage({ bg: collageBgSelect.value as 'color' | 'blur' });
    scheduleRender();
  });
  cutColsSelect.addEventListener('change', () => {
    session.setCollage({ cutCols: Number(cutColsSelect.value) });
    render();
  });
  cutRowsSelect.addEventListener('change', () => {
    session.setCollage({ cutRows: Number(cutRowsSelect.value) });
    render();
  });
  borderWidthInput.addEventListener('input', () => {
    const v = Number(borderWidthInput.value);
    session.setCollage({ borderWidth: v });
    borderWidthVal.textContent = String(v);
    scheduleRender();
  });
  borderColorSelect.addEventListener('change', () => {
    session.setCollage({ borderColor: borderColorSelect.value as '#ffffff' | '#000000' });
    scheduleRender();
  });

  window.addEventListener('resize', scheduleRender);
}

buildSliders();
buildBands();
buildCurveChannels();
wire();
render();
/* 预设库在用户目录里，读盘是异步的：先把界面画出来，读到再补进下拉框。
 * 失败必须露出来 —— 库读不到却一声不吭，用户会以为预设全丢了。 */
void refreshCustomPresets().catch((error: unknown) => {
  toast(
    `预设库读不了：${error instanceof Error ? error.message : String(error)}`,
    'error',
  );
});
