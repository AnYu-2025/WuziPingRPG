import type { AdjustParams } from './params.js';
import { NEUTRAL, clampParams } from './params.js';

/** 一个预设：稳定标识 + 展示名 + 完整参数。 */
export interface Preset {
  readonly key: string;
  readonly name: string;
  readonly params: AdjustParams;
}

function make(key: string, name: string, params: AdjustParams): Preset {
  return { key, name, params: clampParams(params) };
}

/**
 * 内置氛围预设。
 *
 * 纯数据，不含任何行为 —— 因此可以直接序列化、导出分享、
 * 也可以由插件或用户预设包注入，无需改动内核代码。
 */
export const BUILTIN_PRESETS: readonly Preset[] = [
  make('rainy_dark', '🌧 雨天暗黑浓重', {
    brightness: 78, contrast: 128, saturate: 65, exposure: -15, warm: -18,
    vignette: 65, grain: 8, sharpen: 25, dehaze: 30, soften: 0, rain: 30, fog: 18,
  }),
  make('rainy_clear', '🌫 雨天去灰通透', {
    brightness: 105, contrast: 118, saturate: 90, exposure: 8, warm: -8,
    vignette: 20, grain: 0, sharpen: 20, dehaze: 35, soften: 0, rain: 0, fog: 12,
  }),
  make('film', '🎞 胶片暖', {
    brightness: 102, contrast: 108, saturate: 125, exposure: 5, warm: 22,
    vignette: 30, grain: 18, sharpen: 5, dehaze: 0, soften: 0, rain: 0, fog: 0,
  }),
  make('bw', '⬛ 白黑高级', {
    brightness: 100, contrast: 125, saturate: 0, exposure: 0, warm: 0,
    vignette: 35, grain: 10, sharpen: 15, dehaze: 10, soften: 0, rain: 0, fog: 0,
  }),
  make('neon', '🌃 夜景霓虹', {
    brightness: 88, contrast: 135, saturate: 150, exposure: -8, warm: 5,
    vignette: 55, grain: 5, sharpen: 20, dehaze: 10, soften: 0, rain: 0, fog: 0,
  }),
  make('fresh', '🍵 日系清新', {
    brightness: 112, contrast: 95, saturate: 105, exposure: 12, warm: 8,
    vignette: 0, grain: 0, sharpen: 10, dehaze: 15, soften: 0, rain: 0, fog: 0,
  }),
  make('nightblue', '🌃 雨夜蓝调', {
    brightness: 85, contrast: 130, saturate: 120, exposure: -10, warm: -25,
    vignette: 60, grain: 12, sharpen: 20, dehaze: 15, soften: 0, rain: 25, fog: 15,
  }),
  make('portrait', '👤 人像柔光', {
    brightness: 108, contrast: 92, saturate: 105, exposure: 10, warm: 12,
    vignette: 15, grain: 0, sharpen: 5, dehaze: 0, soften: 35, rain: 0, fog: 0,
  }),
  make('food', '🍜 美食鲜艳', {
    brightness: 105, contrast: 115, saturate: 140, exposure: 5, warm: 15,
    vignette: 10, grain: 0, sharpen: 25, dehaze: 10, soften: 0, rain: 0, fog: 0,
  }),
  make('sunset', '🌅 落日金', {
    brightness: 100, contrast: 120, saturate: 135, exposure: 0, warm: 30,
    vignette: 40, grain: 8, sharpen: 10, dehaze: 20, soften: 0, rain: 0, fog: 0,
  }),
  make('none', '🧹 还原(无滤镜)', { ...NEUTRAL }),
];

const PRESET_INDEX = new Map(BUILTIN_PRESETS.map((p) => [p.key, p]));

/** 按 key 查找内置预设。 */
export function findPreset(key: string): Preset | undefined {
  return PRESET_INDEX.get(key);
}
