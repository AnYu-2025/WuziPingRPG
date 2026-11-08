import { mixWithNeutral } from '../presets/params.js';
import { findPreset } from '../presets/builtin.js';
import { sanitizeEditState } from './sanitize.js';
import type { EditState, Op, PhotoDocument } from './types.js';

/**
 * 单纯的归约：一次"整值设置"。**刻意不设防**。
 *
 * 注意 applyPreset 依赖 applyPreset 的**幂等性**：
 * 无论当前状态如何，给定 (key, intensity) 得到的参数完全一致。
 * 因此重放任意操作序列的结果与逐步执行一致。
 *
 * 防护放在 `applyOp` 出口，而不是这里 —— 这样"怎么归约"与"如何抵御坏输入"
 * 各自只有一处定义，互不干扰。
 */
function reduceOnce(state: EditState, op: Op): EditState {
  switch (op.k) {
    case 'setSources': {
      const next = op.value;
      const current = next.length === 0 ? 0 : Math.max(0, Math.min(op.current, next.length - 1));
      return { ...state, sources: next, current };
    }
    case 'setAdjust':
      /* 这里**不做** clampParams：它会把缺失键按「区间最小值」补齐
       * （亮度缺失 → 50 → 整图发黑），而且补完之后出口再收敛也救不回来。
       * 补齐与钳制统一交给出口的 sanitizeParams —— 它按 NEUTRAL 补齐，缺键等于没调。 */
      return { ...state, params: op.value, presetKey: null, presetIntensity: 1 };
    case 'applyPreset': {
      const preset = findPreset(op.key);
      if (preset === undefined) return state;
      return {
        ...state,
        params: mixWithNeutral(preset.params, op.intensity),
        presetKey: op.key,
        presetIntensity: op.intensity,
      };
    }
    case 'setLevels':
      return { ...state, levels: op.value };
    case 'setCurves':
      return { ...state, curves: op.value };
    case 'setBands':
      return { ...state, bands: op.value };
    case 'setGeometry':
      return { ...state, geometry: op.value };
    case 'setCrop':
      return { ...state, crop: op.value };
    case 'setCollage':
      return { ...state, collage: op.value };
    case 'setWatermark':
      return { ...state, watermark: op.value };
    case 'setSticker':
      return { ...state, sticker: op.value };
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

/**
 * 把单个操作作用到编辑状态上。纯函数，无副作用。
 *
 * 出口处统一过一遍 `sanitizeEditState`。理由：内核的 op 语义是整值设置，
 * 而**无类型输入（配方 JSON / 项目文件）能绕过 TS 类型**给出稀疏或非法的 value ——
 * 少一个 `straighten` 就让仿射角变成 `NaN`，整张图静默碎掉（现场记录见 sanitize.ts）。
 * 在这里收敛一次，"applyOp 的输出恒为『类型为真且数值有限』"就成为内核不变量，
 * 下游 buildPlan / executePlan / UI 都不必各自设防。
 */
export function applyOp(state: EditState, op: Op): EditState {
  return sanitizeEditState(reduceOnce(state, op));
}

/** 重放前 cursor 个操作，得到当前权威编辑状态。 */
export function deriveEdit(doc: PhotoDocument): EditState {
  return deriveEditWith(doc, doc.cursor);
}

/**
 * 从文档基线出发重放到指定 cursor。
 * 供测试与"时间旅行"调试使用（例如预览某个历史节点）。
 */
export function deriveEditWith(doc: PhotoDocument, cursor: number): EditState {
  const end = Math.max(0, Math.min(cursor, doc.ops.length));
  let state = doc.baseline;
  for (let i = 0; i < end; i++) {
    state = applyOp(state, doc.ops[i]);
  }
  /* 出口再收敛一次：cursor 为 0 时 baseline 会**原样返回**，而 baseline 正是
   * "加载工程文件"的落点（见 PhotoDocument.baseline 的注释），可能带着未校验的
   * JSON 值。这一行让「读出来的状态一定干净」也成立，而不只是"写进去的时候干净"。 */
  return sanitizeEditState(state);
}

/** 文档是否为空（无源图且无操作）。 */
export function isDocumentEmpty(doc: PhotoDocument): boolean {
  return doc.baseline.sources.length === 0 && doc.ops.length === 0;
}
