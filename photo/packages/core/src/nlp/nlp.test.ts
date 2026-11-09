import { describe, expect, it } from 'vitest';
import { describeIntents, intentKinds, parseKouyu } from './parse.js';
import type { Intent } from './types.js';

type BandIntent = Extract<Intent, { k: 'band' }>;
type ModeIntent = Extract<Intent, { k: 'mode' }>;
type ExportIntent = Extract<Intent, { k: 'export' }>;
type PresetIntent = Extract<Intent, { k: 'preset' }>;

function bands(text: string): readonly BandIntent[] {
  return parseKouyu(text).intents.filter((i): i is BandIntent => i.k === 'band');
}
function modes(text: string): readonly ModeIntent[] {
  return parseKouyu(text).intents.filter((i): i is ModeIntent => i.k === 'mode');
}
function exportsOf(text: string): readonly ExportIntent[] {
  return parseKouyu(text).intents.filter((i): i is ExportIntent => i.k === 'export');
}
function presets(text: string): readonly PresetIntent[] {
  return parseKouyu(text).intents.filter((i): i is PresetIntent => i.k === 'preset');
}

describe('parseKouyu 基础', () => {
  it('空文本不产生意图', () => {
    expect(parseKouyu('').empty).toBe(true);
    expect(parseKouyu('   ').empty).toBe(true);
    expect(parseKouyu('随便说点什么').empty).toBe(true);
  });

  it('回显文案可直接展示', () => {
    const r = parseKouyu('横着拼');
    expect(describeIntents(r)).toContain('横着拼');
  });
});

describe('模式识别与冲突排除', () => {
  it('横拼 / 竖拼', () => {
    expect(modes('横着拼').map((m) => m.mode)).toEqual(['h']);
    expect(modes('竖着拼').map((m) => m.mode)).toEqual(['v']);
  });

  it('「横着拼起来」不会被网格覆盖', () => {
    expect(modes('横着拼起来').map((m) => m.mode)).toEqual(['h']);
  });

  it('「拼起来」在无方向时按网格处理', () => {
    expect(modes('拼起来').map((m) => m.mode)).toEqual(['grid']);
  });

  it('「切四宫格」走切图通道，不串到网格拼接', () => {
    const m = modes('切四宫格');
    expect(m).toHaveLength(1);
    expect(m[0].mode).toBe('cut');
    expect(m[0].cols).toBe(2);
    expect(m[0].rows).toBe(2);
  });

  it('「九宫格」默认 3×3 切图', () => {
    const m = modes('切九宫格');
    expect(m[0].mode).toBe('cut');
    expect(m[0].cols).toBe(3);
    expect(m[0].rows).toBe(3);
  });

  it('「切四宫格」不再额外产生网格模式', () => {
    expect(modes('切四宫格').filter((x) => x.mode === 'grid')).toHaveLength(0);
  });
});

describe('色彩词识别与 legacy bug 回归', () => {
  it('「品红饱和一点」命中 magenta，而不是被「红」抢走', () => {
    const b = bands('品红饱和一点');
    expect(b).toHaveLength(1);
    expect(b[0].band).toBe('magenta');
    expect(b[0].delta.s).toBe(18);
  });

  it('「玫红压暗」也命中 magenta', () => {
    const b = bands('玫红压暗');
    expect(b[0].band).toBe('magenta');
    expect(b[0].delta.l).toBe(-12);
  });

  it('单独说「红色压暗」仍命中 red', () => {
    const b = bands('红色压暗');
    expect(b[0].band).toBe('red');
    expect(b[0].delta.l).toBe(-12);
  });

  it('「蓝调」只套预设，不触发蓝色带调整', () => {
    expect(bands('蓝调')).toHaveLength(0);
    expect(presets('蓝调').map((p) => p.preset)).toEqual(['nightblue']);
  });

  it('「蓝色饱和一点」触发蓝色带', () => {
    expect(bands('蓝色饱和一点')[0].band).toBe('blue');
  });

  it('「黄昏」不触发黄色带（避免与落日预设串味）', () => {
    expect(bands('黄昏一点')).toHaveLength(0);
    expect(presets('黄昏')).toHaveLength(1);
  });

  it('「印章」不触发红色带', () => {
    expect(bands('加个印章')).toHaveLength(0);
  });

  it('一次只说一个色带（命中即止）', () => {
    expect(bands('红色和蓝色都饱和一点')).toHaveLength(1);
  });
});

describe('预设识别', () => {
  it('「雨天暗黑」命中雨天暗黑', () => {
    expect(presets('雨天暗黑').map((p) => p.preset)).toContain('rainy_dark');
  });

  it('「雨天」+「再暗一点」也能命中雨天暗黑', () => {
    expect(presets('雨天再暗一点，要浓重感').map((p) => p.preset)).toContain('rainy_dark');
  });

  it('「还原」命中 none', () => {
    expect(presets('还原一下').map((p) => p.preset)).toEqual(['none']);
  });
});

describe('导出意图去重', () => {
  it('「批量导出」只产生批量意图，不重复产生单图导出', () => {
    const e = exportsOf('批量导出');
    expect(e).toHaveLength(1);
    expect(e[0].target).toBe('batch');
  });

  it('「导出视频」走视频通道，不误触图片导出', () => {
    const e = exportsOf('导出视频');
    expect(e.map((x) => x.target)).toEqual(['video']);
  });

  it('「导出」走图片通道', () => {
    expect(exportsOf('导出').map((x) => x.target)).toEqual(['image']);
  });

  it('「视频封面」走封面通道', () => {
    expect(exportsOf('视频封面').map((x) => x.target)).toEqual(['cover']);
  });
});

describe('视频指令', () => {
  it('解析时间区间', () => {
    const r = parseKouyu('5秒到12秒');
    const trim = r.intents.find((i) => i.k === 'videoTrim');
    expect(trim).toBeDefined();
    expect(trim !== undefined && trim.k === 'videoTrim' && trim.start).toBe(5);
    expect(trim !== undefined && trim.k === 'videoTrim' && trim.end).toBe(12);
  });

  it('支持小数秒与波浪号', () => {
    const r = parseKouyu('2.5秒~8.5秒');
    const trim = r.intents.find((i) => i.k === 'videoTrim');
    expect(trim !== undefined && trim.k === 'videoTrim' && trim.start).toBe(2.5);
    expect(trim !== undefined && trim.k === 'videoTrim' && trim.end).toBe(8.5);
  });

  it('页签切换', () => {
    expect(intentKinds(parseKouyu('视频模式'))).toContain('tab');
    const r = parseKouyu('回到图片');
    const tab = r.intents.find((i) => i.k === 'tab');
    expect(tab !== undefined && tab.k === 'tab' && tab.tab).toBe('img');
  });
});

describe('视图与构图', () => {
  it('缩放互斥：只命中一个', () => {
    expect(parseKouyu('适应窗口').intents.filter((i) => i.k === 'zoom')).toHaveLength(1);
    expect(parseKouyu('放大').intents.filter((i) => i.k === 'zoom')).toHaveLength(1);
    expect(parseKouyu('放大').intents.filter((i) => i.k === 'zoom')[0]).toMatchObject({
      k: 'zoom',
      mode: 'in',
    });
  });

  it('「翻转一下」不触发旋转', () => {
    const kinds = intentKinds(parseKouyu('翻转一下'));
    expect(kinds).toContain('flip');
    expect(kinds).not.toContain('rotate');
  });

  it('「旋转」触发旋转', () => {
    expect(intentKinds(parseKouyu('旋转'))).toContain('rotate');
  });

  it('效果强度', () => {
    const weak = parseKouyu('太重了').intents.find((i) => i.k === 'intensity');
    expect(weak !== undefined && weak.k === 'intensity' && weak.value).toBeCloseTo(0.55, 5);
    const strong = parseKouyu('效果强').intents.find((i) => i.k === 'intensity');
    expect(strong !== undefined && strong.k === 'intensity' && strong.value).toBe(1);
  });
});

describe('参数微调叠加', () => {
  it('「暗一点」同时压亮度与曝光', () => {
    const r = parseKouyu('暗一点');
    const adj = r.intents.find((i) => i.k === 'adjust');
    expect(adj).toBeDefined();
    expect(adj !== undefined && adj.k === 'adjust' && adj.delta.brightness).toBe(-12);
    expect(adj !== undefined && adj.k === 'adjust' && adj.delta.exposure).toBe(-10);
  });

  it('「下雨」加雨丝', () => {
    const adj = parseKouyu('下雨了').intents.find((i) => i.k === 'adjust');
    expect(adj !== undefined && adj.k === 'adjust' && adj.delta.rain).toBe(30);
  });
});

describe('exportPreset', () => {
  it('朋友圈 / 小图 / 打印 互斥', () => {
    const a = parseKouyu('朋友圈').intents.filter((i) => i.k === 'exportPreset');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ k: 'exportPreset', use: 'moment' });

    const b = parseKouyu('压缩一下').intents.filter((i) => i.k === 'exportPreset');
    expect(b[0]).toMatchObject({ k: 'exportPreset', use: 'small' });

    const c = parseKouyu('打印用').intents.filter((i) => i.k === 'exportPreset');
    expect(c[0]).toMatchObject({ k: 'exportPreset', use: 'print' });
  });
});
