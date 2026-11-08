import type { HslBand } from '../color/types.js';
import type { AdjustParams } from '../presets/params.js';
import type { Intent, ParseResult } from './types.js';

/**
 * 色彩词 → 色带映射。
 *
 * ⚠ 顺序敏感：必须让**更具体（更长）的词排在前面**。
 * legacy 的 COLMAP 把「红」放在首位，导致「品红饱和一点」被误判为调红色带。
 * 这里按词长降序排列，`品红 / 玫红` 先于 `红` 命中，该类误判不再可能发生。
 */
const COLOR_WORDS: ReadonlyArray<readonly [string, HslBand]> = [
  ['品红', 'magenta'],
  ['玫红', 'magenta'],
  ['橙', 'orange'],
  ['黄', 'yellow'],
  ['绿', 'green'],
  ['青', 'cyan'],
  ['蓝', 'blue'],
  ['紫', 'purple'],
  ['红', 'red'],
];

/** 命中色彩词时，需要绕开的预设词（避免"蓝调""黄昏""印章"被当成调色指令）。 */
const COLOR_EXCLUSIONS: Readonly<Partial<Record<HslBand, readonly string[]>>> = {
  blue: ['蓝调'],
  yellow: ['黄昏', '落日', '金色'],
  red: ['印章', '贴纸'],
};

/**
 * 中文口语 → 结构化意图列表。
 *
 * 纯本地关键词规则，不联网、无副作用。上层可根据 Intents 落到文档或直接由 UI 执行。
 * 未来接入大模型时，只需让模型产出同样形状的 Intent 数组，其余各层无需改动。
 */
export function parseKouyu(text: string): ParseResult {
  const t = text.trim();
  const intents: Intent[] = [];
  if (t.length === 0) return { text: t, intents, empty: true };

  const has = (...ws: string[]): boolean => ws.some((w) => t.includes(w));

  // ───────── 拼图 / 切图模式 ─────────
  const hasH = has('横着拼', '横向拼', '左右拼');
  const hasV = has('竖着拼', '竖向拼', '上下拼');
  if (hasH) intents.push({ k: 'mode', mode: 'h', label: '已切换：横着拼' });
  if (hasV) intents.push({ k: 'mode', mode: 'v', label: '已切换：竖着拼' });
  // 「拼起来」只在未指明方向、且不是切图时才按网格处理，
  // 否则「横着拼起来」会被覆盖、「切四宫格」会串到拼接。
  if (!hasH && !hasV && !has('切') && has('网格', '四宫格', '拼起来', '拼接')) {
    intents.push({ k: 'mode', mode: 'grid', label: '已切换：网格拼' });
  }
  if (has('单图', '一张', '精修')) {
    intents.push({ k: 'mode', mode: 'single', label: '已切换：单图精修' });
  }
  if (has('切四宫', '四宫格切') || (has('切') && has('2x2', '二宫', '四宫'))) {
    intents.push({ k: 'mode', mode: 'cut', cols: 2, rows: 2, label: '已切换：四宫格切图' });
  } else if (has('切图', '切九宫', '九宫格')) {
    intents.push({ k: 'mode', mode: 'cut', cols: 3, rows: 3, label: '已切换：九宫格切图' });
  }

  // ───────── 氛围预设 ─────────
  if (has('雨天暗黑', '暗色调浓重', '暗黑浓重', '雨天感', '阴雨')) {
    intents.push({ k: 'preset', preset: 'rainy_dark', label: '已套用：雨天暗黑浓重' });
  } else if (has('雨天') && has('暗', '浓重', '浓郁', '氛围', '阴')) {
    // 「雨天 + 暗/浓重」分开说也要能命中
    intents.push({ k: 'preset', preset: 'rainy_dark', label: '已套用：雨天暗黑浓重' });
  }
  if (has('去灰', '通透', '去雾')) intents.push({ k: 'preset', preset: 'rainy_clear', label: '已套用：去灰通透' });
  if (has('胶片', '复古')) intents.push({ k: 'preset', preset: 'film', label: '已套用：胶片暖' });
  if (has('黑白', '高级灰')) intents.push({ k: 'preset', preset: 'bw', label: '已套用：黑白高级' });
  if (has('夜景', '霓虹')) intents.push({ k: 'preset', preset: 'neon', label: '已套用：夜景霓虹' });
  if (has('蓝调')) intents.push({ k: 'preset', preset: 'nightblue', label: '已套用：雨夜蓝调' });
  if (has('人像', '柔光')) intents.push({ k: 'preset', preset: 'portrait', label: '已套用：人像柔光' });
  if (has('美食', '鲜艳', '好吃')) intents.push({ k: 'preset', preset: 'food', label: '已套用：美食鲜艳' });
  if (has('落日', '黄昏', '金色')) intents.push({ k: 'preset', preset: 'sunset', label: '已套用：落日金' });
  if (has('还原', '原图参数', '重来', '清除')) intents.push({ k: 'preset', preset: 'none', label: '已还原' });

  // ───────── 参数微调 ─────────
  const adj: Partial<Record<keyof AdjustParams, number>> = {};
  if (has('暗一点', '更暗', '压暗', '暗黑')) {
    adj.brightness = -12;
    adj.exposure = -10;
    adj.vignette = 10;
  }
  if (has('亮一点', '更亮', '提亮')) {
    adj.brightness = 12;
    adj.exposure = 10;
  }
  if (has('浓重', '浓郁', '重一点', '对比强')) {
    adj.contrast = 12;
    adj.saturate = -8;
  }
  if (has('淡一点')) adj.contrast = -10;
  if (has('暖一点', '暖和')) adj.warm = 12;
  if (has('冷一点', '冷色')) adj.warm = -12;
  if (has('颗粒', '胶片感')) adj.grain = 12;
  if (has('暗角', '氛围感')) adj.vignette = 15;
  if (has('曝光高', '曝光多', '曝光亮', '曝光强')) adj.exposure = 15;
  if (has('曝光低', '曝光少', '曝光暗', '曝光弱')) adj.exposure = -15;
  if (has('锐化', '更清晰', '清楚一点', '清晰一点')) adj.sharpen = 15;
  if (has('磨皮', '美颜', '皮肤好', '柔肤')) adj.soften = 20;
  if (has('下雨', '雨丝', '雨景')) adj.rain = 30;
  if (has('雾气', '起雾', '朦胧')) adj.fog = 30;

  // ───────── 分色微调（颜色词 + 饱和/明暗） ─────────
  for (const [word, band] of COLOR_WORDS) {
    if (!has(word)) continue;
    const exclusions = COLOR_EXCLUSIONS[band];
    if (exclusions !== undefined && has(...exclusions)) continue;
    const delta: { h?: number; s?: number; l?: number } = {};
    if (has('饱和', '鲜艳', '浓')) delta.s = 18;
    if (has('灰', '淡', '褪色')) delta.s = -18;
    if (has('亮', '提亮', '透')) delta.l = 12;
    if (has('暗', '压暗', '沉')) delta.l = -12;
    if (delta.s !== undefined || delta.l !== undefined) {
      intents.push({ k: 'band', band, delta, label: `已调${word}` });
      break;
    }
  }

  if (Object.keys(adj).length > 0) {
    intents.push({ k: 'adjust', delta: adj, label: '已按你的话微调' });
  }

  // ───────── 构图与视图 ─────────
  if (has('镜像', '翻转', '反一下')) intents.push({ k: 'flip', label: '已镜像' });
  if (has('效果弱', '效果轻', '轻一点', '太重了')) {
    intents.push({ k: 'intensity', value: 0.55, label: '效果已调轻' });
  }
  if (has('效果强', '效果重')) {
    intents.push({ k: 'intensity', value: 1, label: '效果已拉满' });
  }
  if (has('旋转') || (has('转一下') && !has('翻转', '镜像'))) {
    intents.push({ k: 'rotate', label: '已旋转 90°' });
  }
  if (has('适应窗口', '适应一下', '显示全图')) {
    intents.push({ k: 'zoom', mode: 'fit', label: '已适应窗口' });
  } else if (has('100%', '原大小', '实际像素')) {
    intents.push({ k: 'zoom', mode: 'one', label: '已按 100% 显示' });
  } else {
    if (has('放大')) intents.push({ k: 'zoom', mode: 'in', label: '已放大' });
    if (has('缩小', '小一点')) intents.push({ k: 'zoom', mode: 'out', label: '已缩小' });
  }
  if (has('自动增强', '一键增强', '救一下', '救废片')) {
    intents.push({ k: 'autoEnhance', label: '已自动增强' });
  }
  if (has('裁剪', '裁一下', '构图')) {
    intents.push({ k: 'crop', label: '已进入裁剪，在图上框选' });
  }
  if (has('对比', '原图看看', '看看原图')) {
    intents.push({ k: 'compare', label: '按住「看原图」可对比' });
  }
  if (has('撤销', '后悔', '上一步')) intents.push({ k: 'undo', label: '已撤销' });
  if (has('删除这张', '删掉这张', '删除当前')) {
    intents.push({ k: 'deleteCurrent', label: '已删除当前' });
  }

  // ───────── 拼图底 ─────────
  if (has('背景虚化', '虚化背景', '虚化底')) {
    intents.push({ k: 'collageBg', bg: 'blur', label: '拼图底已切虚化' });
  } else if (has('纯色背景', '纯色底')) {
    intents.push({ k: 'collageBg', bg: 'color', label: '拼图底已切纯色' });
  }

  // ───────── 视频 ─────────
  if (has('视频模式', '打开视频', '切到视频', '视频页')) {
    intents.push({ k: 'tab', tab: 'vid', label: '已切到视频' });
  } else if (has('回到图片', '图片模式', '切到图片')) {
    intents.push({ k: 'tab', tab: 'img', label: '已切回图片' });
  }
  const trim = /(\d+(?:\.\d+)?)\s*秒?\s*(?:到|[-~～])\s*(\d+(?:\.\d+)?)\s*秒/.exec(t);
  if (trim !== null) {
    const start = Number(trim[1]);
    const end = Number(trim[2]);
    intents.push({ k: 'videoTrim', start, end, label: `已定段 ${start}-${end} 秒` });
  }
  if (has('设起点', '起点设', '从这里开始')) {
    intents.push({ k: 'videoMark', which: 'start', label: '起点=当前' });
  }
  if (has('设终点', '终点设', '到这里结束')) {
    intents.push({ k: 'videoMark', which: 'end', label: '终点=当前' });
  }

  // ───────── 导出 ─────────
  const hasBatch = has('批量', '全部导出', '一张张导', '打包', 'zip', 'ZIP');
  if (has('视频封面', '封面导出', '存封面')) {
    intents.push({ k: 'export', target: 'cover', label: '正在存视频封面' });
  }
  if (hasBatch) {
    intents.push({ k: 'export', target: 'batch', label: '开始批量导出' });
  }
  // 视频导出走视频通道；批量已含导出，避免「批量导出」触发两次
  if (has('视频') && has('导出', '保存', '存')) {
    intents.push({ k: 'export', target: 'video', label: '开始导出视频' });
  } else if (!hasBatch && has('导出', '保存', '下载')) {
    intents.push({ k: 'export', target: 'image', label: '已导出' });
  }
  if (has('朋友圈')) {
    intents.push({ k: 'exportPreset', use: 'moment', label: '已切朋友圈设置' });
  } else if (has('清晰小图', '小图', '压缩一下', '压小一点')) {
    intents.push({ k: 'exportPreset', use: 'small', label: '已切小图设置' });
  } else if (has('打印', '无损', '原图尺寸')) {
    intents.push({ k: 'exportPreset', use: 'print', label: '已切打印存档设置' });
  }

  return { text: t, intents, empty: intents.length === 0 };
}

/** 便利：只关心命中的意图类型时使用。 */
export function intentKinds(result: ParseResult): readonly string[] {
  return result.intents.map((i) => i.k);
}

/** 便利：合并后的中文回显，直接给 UI 用。 */
export function describeIntents(result: ParseResult): string {
  return result.intents.map((i) => i.label).join(' · ');
}
