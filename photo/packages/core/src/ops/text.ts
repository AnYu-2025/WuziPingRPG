import type { StickerState, WatermarkState } from '../document/types.js';
import type { PixelBuffer } from '../types.js';

/**
 * 文字渲染能力接口。
 *
 * ── 为什么文字要"注入"而不是在 core 里实现 ───────────────────────────
 * 内核是零平台依赖的：它不能调用 Canvas `fillText`，也不能打包字体光栅化器
 * （那会引入几百 KB 且未必跨端一致）。因此把"画字"抽象成能力接口：
 *   - **排版数学（位置/字号/对齐/描边/盖章框）留在 core**，可测、跨端一致；
 *   - **像素落地由外壳注入**（浏览器用 Canvas，Node 可用 canvas-skia 等）。
 * 这样"字画在哪、多大"永远一致，只有"用哪个字体光栅器"随端而异 ——
 * 与商业软件「排版与光栅化分离」的做法一致。
 */

export interface TextStyle {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly weight: string;
  readonly letterSpacing: number;
  readonly align: 'left' | 'right' | 'center';
  readonly baseline: 'alphabetic' | 'middle';
  readonly color: string;
  readonly alpha: number;
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly shadow?: { readonly color: string; readonly blur: number; readonly offsetY: number };
  /** 盖章式底框（贴纸 seal 样式用）。 */
  readonly box?: {
    readonly fill: string;
    readonly padX: number;
    readonly padY: number;
    readonly radius: number;
  };
}

export interface TextDrawItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: TextStyle;
}

export interface TextRenderer {
  /** 测量文本尺寸（用于盖章底框、居中排版）。 */
  measure(text: string, style: TextStyle): { readonly width: number; readonly height: number };
  /** 把文本画到目标像素缓冲上。 */
  draw(dst: PixelBuffer, item: TextDrawItem): void;
}

/**
 * 没有注入 `TextRenderer` 却要求画字时的错误文案。
 *
 * 导出它而不是各写一份：CLI 的失败报告、桌面的 toast 与三处回归断言要指向
 * 同一句话 —— 文案分叉等于"同一件事多处各做一次"，会漂。
 */
export const MISSING_TEXT_RENDERER =
  '本端未注入文字渲染能力（TextRenderer），水印 / 贴纸无处落笔。' +
  '内核宁可让这次渲染失败，也不输出一张"报告说成功、图里却没有水印"的产物。';

/** 水印排版：位置与字号全部由 core 决定。 */
export function layoutWatermark(w: number, h: number, wm: WatermarkState): TextDrawItem | null {
  const text = wm.text.trim();
  if (text === '') return null;
  const px = Math.max(10, Math.round(w * 0.018));
  const py = Math.max(8, Math.round(h * 0.03));
  const fs = Math.max(12, Math.round((w * wm.size) / 100));

  let align: TextStyle['align'] = 'right';
  let x = w - px;
  let y = h - py;
  if (wm.pos === 'tl') {
    align = 'left';
    x = px;
    y = py + fs;
  } else if (wm.pos === 'tr') {
    align = 'right';
    x = w - px;
    y = py + fs;
  } else if (wm.pos === 'bl') {
    align = 'left';
    x = px;
    y = h - py;
  } else if (wm.pos === 'c') {
    align = 'center';
    x = w / 2;
    y = h / 2 + fs / 3;
  }

  return {
    text,
    x,
    y,
    style: {
      fontSize: fs,
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      weight: '400',
      letterSpacing: 0,
      align,
      baseline: 'alphabetic',
      color: wm.color,
      alpha: wm.alpha / 100,
      strokeColor: wm.stroke ? 'rgba(0,0,0,.65)' : undefined,
      strokeWidth: wm.stroke ? Math.max(1, fs * 0.08) : undefined,
    },
  };
}

const STICKER_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  white: ['#ffffff', 'rgba(0,0,0,.7)'],
  black: ['#1a1a1a', 'rgba(255,255,255,.85)'],
  gold: ['#ffd75e', 'rgba(90,50,0,.8)'],
};

/** 贴纸排版：位置/字号/描边/盖章框由 core 决定。 */
export function layoutSticker(w: number, h: number, st: StickerState): TextDrawItem | null {
  const text = st.text.trim();
  if (text === '') return null;
  const fs = Math.max(14, Math.round((w * st.size) / 100));
  const x = w / 2;
  const y = st.pos === 'top' ? h * 0.16 : st.pos === 'center' ? h * 0.5 : h * 0.84;

  if (st.style === 'seal') {
    return {
      text,
      x,
      y: y + fs * 0.03,
      style: {
        fontSize: fs,
        fontFamily: '"SimSun", "Microsoft YaHei", serif',
        weight: '900',
        letterSpacing: 2,
        align: 'center',
        baseline: 'middle',
        color: '#ffffff',
        alpha: 1,
        box: { fill: '#b8322a', padX: fs * 0.45, padY: fs * 0.72, radius: fs * 0.18 },
      },
    };
  }

  const conf = STICKER_COLORS[st.style] ?? STICKER_COLORS.white;
  return {
    text,
    x,
    y,
    style: {
      fontSize: fs,
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      weight: '900',
      letterSpacing: 2,
      align: 'center',
      baseline: 'middle',
      color: conf[0],
      alpha: 1,
      strokeColor: conf[1],
      strokeWidth: Math.max(2, fs * 0.12),
      shadow: { color: 'rgba(0,0,0,.45)', blur: fs * 0.25, offsetY: fs * 0.06 },
    },
  };
}
