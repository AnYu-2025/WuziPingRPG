// 大白话预设：名字 -> 参数。以后可无限加，口语解析器也复用这里。
window.PRESETS = [
  { name: '🌧 雨天暗黑浓重', key: 'rainy_dark', params: { brightness: 78, contrast: 128, saturate: 65, exposure: -15, warm: -18, vignette: 65, grain: 8, sharpen: 25, dehaze: 30, soften: 0, rain: 30, fog: 18 } },
  { name: '🌫 雨天去灰通透', key: 'rainy_clear', params: { brightness: 105, contrast: 118, saturate: 90, exposure: 8, warm: -8, vignette: 20, grain: 0, sharpen: 20, dehaze: 35, soften: 0, rain: 0, fog: 12 } },
  { name: '🎞 胶片暖', key: 'film', params: { brightness: 102, contrast: 108, saturate: 125, exposure: 5, warm: 22, vignette: 30, grain: 18, sharpen: 5, dehaze: 0, soften: 0, rain: 0, fog: 0 } },
  { name: '⬛ 白黑高级', key: 'bw', params: { brightness: 100, contrast: 125, saturate: 0, exposure: 0, warm: 0, vignette: 35, grain: 10, sharpen: 15, dehaze: 10, soften: 0, rain: 0, fog: 0 } },
  { name: '🌃 夜景霓虹', key: 'neon', params: { brightness: 88, contrast: 135, saturate: 150, exposure: -8, warm: 5, vignette: 55, grain: 5, sharpen: 20, dehaze: 10, soften: 0, rain: 0, fog: 0 } },
  { name: '🍵 日系清新', key: 'fresh', params: { brightness: 112, contrast: 95, saturate: 105, exposure: 12, warm: 8, vignette: 0, grain: 0, sharpen: 10, dehaze: 15, soften: 0, rain: 0, fog: 0 } },
  { name: '🌃 雨夜蓝调', key: 'nightblue', params: { brightness: 85, contrast: 130, saturate: 120, exposure: -10, warm: -25, vignette: 60, grain: 12, sharpen: 20, dehaze: 15, soften: 0, rain: 25, fog: 15 } },
  { name: '👤 人像柔光', key: 'portrait', params: { brightness: 108, contrast: 92, saturate: 105, exposure: 10, warm: 12, vignette: 15, grain: 0, sharpen: 5, dehaze: 0, soften: 35, rain: 0, fog: 0 } },
  { name: '🍜 美食鲜艳', key: 'food', params: { brightness: 105, contrast: 115, saturate: 140, exposure: 5, warm: 15, vignette: 10, grain: 0, sharpen: 25, dehaze: 10, soften: 0, rain: 0, fog: 0 } },
  { name: '🌅 落日金', key: 'sunset', params: { brightness: 100, contrast: 120, saturate: 135, exposure: 0, warm: 30, vignette: 40, grain: 8, sharpen: 10, dehaze: 20, soften: 0, rain: 0, fog: 0 } },
  { name: '🧹 还原(无滤镜)', key: 'none', params: { brightness: 100, contrast: 100, saturate: 100, exposure: 0, warm: 0, vignette: 0, grain: 0, sharpen: 0, dehaze: 0, soften: 0, rain: 0, fog: 0 } },
];
// 各参数合法范围（修口语叠加bug用）
window.PARAM_RANGE = {
  brightness: [50, 150], contrast: [50, 150], saturate: [0, 200],
  exposure: [-100, 100], warm: [-50, 50], vignette: [0, 100], grain: [0, 50],
  sharpen: [0, 100], dehaze: [0, 100], soften: [0, 100], rain: [0, 100], fog: [0, 100]
};
// 无滤镜中性值（预设强度插值用）
window.NEUTRAL = { brightness: 100, contrast: 100, saturate: 100, exposure: 0, warm: 0, vignette: 0, grain: 0, sharpen: 0, dehaze: 0, soften: 0, rain: 0, fog: 0 };
