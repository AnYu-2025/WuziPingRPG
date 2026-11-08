import { identityCurve } from '../color/curve.js';
import { zeroBands } from '../color/hsl.js';
import { identityLevels, type LevelsState } from '../color/levels.js';
import type { BandAdjustMap } from '../color/types.js';
import { NEUTRAL } from '../presets/params.js';
import type { SourceRef } from './types.js';
import type {
  CollageState,
  CurveSet,
  DocumentSettings,
  EditState,
  ExportState,
  GeometryState,
  PhotoDocument,
  StickerState,
  ViewState,
  WatermarkState,
} from './types.js';

export function defaultCurves(): CurveSet {
  return {
    rgb: identityCurve(),
    r: identityCurve(),
    g: identityCurve(),
    b: identityCurve(),
  };
}

export function defaultBands(): BandAdjustMap {
  return zeroBands();
}

/** 中性色阶（未做自动增强）。 */
export function defaultLevels(): LevelsState {
  return identityLevels();
}

export function defaultGeometry(): GeometryState {
  return { rotate: 0, flipH: false, flipV: false, straighten: 0 };
}

export function defaultCollage(): CollageState {
  return {
    mode: 'single',
    gap: 8,
    bg: 'color',
    cutCols: 3,
    cutRows: 3,
    borderWidth: 0,
    borderColor: '#ffffff',
  };
}

export function defaultWatermark(): WatermarkState {
  return { text: '', pos: 'br', color: '#ffffff', stroke: true, size: 3, alpha: 85 };
}

export function defaultSticker(): StickerState {
  return { text: '', style: 'white', pos: 'bottom', size: 6 };
}

export function defaultExport(): ExportState {
  return { longEdge: 1920, format: 'jpeg', quality: 85 };
}

export function defaultSettings(): DocumentSettings {
  return { export: defaultExport() };
}

export function defaultView(): ViewState {
  return { tab: 'img', zoom: 1, pendingCrop: null };
}

/** 以给定源图列表构造一份空白编辑状态。 */
export function createEditState(
  sources: readonly SourceRef[] = [],
  current = 0,
): EditState {
  return {
    sources,
    current: sources.length === 0 ? 0 : Math.max(0, Math.min(current, sources.length - 1)),
    params: NEUTRAL,
    levels: defaultLevels(),
    curves: defaultCurves(),
    bands: defaultBands(),
    geometry: defaultGeometry(),
    crop: null,
    collage: defaultCollage(),
    watermark: defaultWatermark(),
    sticker: defaultSticker(),
    presetKey: null,
    presetIntensity: 1,
  };
}

/** 新建空文档。 */
export function createDocument(): PhotoDocument {
  return {
    version: 1,
    baseline: createEditState(),
    ops: [],
    cursor: 0,
    settings: defaultSettings(),
    view: defaultView(),
  };
}
