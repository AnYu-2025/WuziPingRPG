import type { HslBand } from '../color/types.js';
import type { AdjustParams } from '../presets/params.js';
import type { CollageMode, ExportUse } from '../types.js';

/**
 * 口语解析的输出：**结构化意图**，而不是副作用。
 *
 * 与 legacy 的根本差别：
 *   legacy 的 parseKouyu 返回带 tip 的动作数组，由 renderer 用 if/else 现场解释；
 *   本层只描述"用户想做什么"，具体怎么落到文档上是 document 层的职责。
 *   好处是同一句话可以被 UI、批处理脚本、自动化测试或无头 CLI 复用。
 */

interface IntentBase {
  /** 中文回显短语，直接可用于 UI 提示。 */
  readonly label: string;
}

export type Intent =
  | (IntentBase & {
      readonly k: 'mode';
      readonly mode: CollageMode;
      readonly cols?: number;
      readonly rows?: number;
    })
  | (IntentBase & { readonly k: 'preset'; readonly preset: string })
  | (IntentBase & { readonly k: 'adjust'; readonly delta: Partial<AdjustParams> })
  | (IntentBase & {
      readonly k: 'band';
      readonly band: HslBand;
      readonly delta: { readonly h?: number; readonly s?: number; readonly l?: number };
    })
  | (IntentBase & { readonly k: 'rotate' })
  | (IntentBase & { readonly k: 'flip' })
  | (IntentBase & { readonly k: 'intensity'; readonly value: number })
  | (IntentBase & { readonly k: 'crop' })
  | (IntentBase & { readonly k: 'zoom'; readonly mode: 'in' | 'out' | 'fit' | 'one' })
  | (IntentBase & { readonly k: 'autoEnhance' })
  | (IntentBase & { readonly k: 'compare' })
  | (IntentBase & { readonly k: 'undo' })
  | (IntentBase & { readonly k: 'deleteCurrent' })
  | (IntentBase & { readonly k: 'collageBg'; readonly bg: 'color' | 'blur' })
  | (IntentBase & { readonly k: 'tab'; readonly tab: 'img' | 'vid' })
  | (IntentBase & { readonly k: 'videoTrim'; readonly start: number; readonly end: number })
  | (IntentBase & { readonly k: 'videoMark'; readonly which: 'start' | 'end' })
  | (IntentBase & {
      readonly k: 'export';
      readonly target: 'image' | 'batch' | 'video' | 'cover';
    })
  | (IntentBase & { readonly k: 'exportPreset'; readonly use: ExportUse });

export type IntentKind = Intent['k'];

export interface ParseResult {
  readonly text: string;
  readonly intents: readonly Intent[];
  /** 未能识别出任何意图。UI 可据此给出提示。 */
  readonly empty: boolean;
}
