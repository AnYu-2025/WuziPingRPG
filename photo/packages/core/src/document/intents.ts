import { addParams } from '../presets/params.js';
import type { HslBand } from '../color/types.js';
import type { EditState, Op } from './types.js';
import type { Intent } from '../nlp/types.js';

/**
 * 口语意图 → 文档操作 适配层。
 *
 * 把 `nlp.parseKouyu` 产出的**纯意图**翻译成内核的 `Op`。
 * 设计边界（与 `nlp/types.ts` 的注释一致）：本层只负责"能落进文档的那部分"；
 * 视图/动作类意图（crop 进入裁剪、tab 切页、export 触发导出、zoom 缩放、
 * compare 对比、undo 撤销、deleteCurrent 删图、video* 视频、autoEnhance 自动增强）
 * 不是文档 op，返回 null，由外壳按自己的 UI 处理。
 *
 * 返回的 `op` 为 null 时，调用方**不应**假装该意图已经生效；
 * 它要么归入"已识别但本次未执行"（pending，诚实回显），要么由外壳另行处理
 * （如 undo 走历史栈、crop 进入交互态）。这条纪律是为杜绝"用户说裁一下、
 * UI 显示已裁剪、实际预览纹丝不动"这类静默落差。
 */
export interface AdaptedIntent {
  readonly intent: Intent;
  /** 可转化为文档操作的意图给出 Op；否则为 null。 */
  readonly op: Op | null;
}

/** 把单个意图翻译成文档 op（可翻译时）；不能翻译的意图返回 null。 */
export function adaptIntent(intent: Intent, edit: EditState): Op | null {
  switch (intent.k) {
    case 'mode':
      return {
        k: 'setCollage',
        value: {
          ...edit.collage,
          mode: intent.mode,
          ...(intent.cols !== undefined ? { cutCols: intent.cols } : {}),
          ...(intent.rows !== undefined ? { cutRows: intent.rows } : {}),
        },
      };
    case 'preset':
      return { k: 'applyPreset', key: intent.preset, intensity: 1 };
    case 'adjust':
      /* 复用内核 `addParams`：在现有参数上叠加增量并自动钳制到合法范围，
       * 与滑杆末端调参走同一条收敛路径（见 presets/params.ts）。 */
      return { k: 'setAdjust', value: addParams(edit.params, intent.delta) };
    case 'band': {
      const bands = { ...edit.bands } as Record<HslBand, { h: number; s: number; l: number }>;
      const cur = bands[intent.band] ?? { h: 0, s: 0, l: 0 };
      bands[intent.band] = {
        h: cur.h + (intent.delta.h ?? 0),
        s: cur.s + (intent.delta.s ?? 0),
        l: cur.l + (intent.delta.l ?? 0),
      };
      return { k: 'setBands', value: bands };
    }
    case 'rotate':
      return {
        k: 'setGeometry',
        value: {
          ...edit.geometry,
          rotate: (((edit.geometry.rotate + 90) % 360) as EditState['geometry']['rotate']),
        },
      };
    case 'flip':
      return { k: 'setGeometry', value: { ...edit.geometry, flipH: !edit.geometry.flipH } };
    case 'intensity':
      /* 预设强度必须有"当前预设"才有意义 —— 与 legacy 写死 intensity=1 不同，
       * 这里不臆造预设；没有预设就落不了地（归入 pending，由外壳提示先套个预设）。 */
      return edit.presetKey !== null
        ? { k: 'applyPreset', key: edit.presetKey, intensity: intent.value }
        : null;
    case 'collageBg':
      return { k: 'setCollage', value: { ...edit.collage, bg: intent.bg } };
    default:
      /* crop / zoom / tab / export / autoEnhance / compare / undo / deleteCurrent /
       * videoTrim / videoMark / exportPreset 不是文档 op，返回 null 交外壳处理。 */
      return null;
  }
}

/** 批量翻译：把一组意图逐一映射为（意图, op?）对。 */
export function adaptIntents(
  intents: readonly Intent[],
  edit: EditState,
): readonly AdaptedIntent[] {
  return intents.map((intent) => ({ intent, op: adaptIntent(intent, edit) }));
}
