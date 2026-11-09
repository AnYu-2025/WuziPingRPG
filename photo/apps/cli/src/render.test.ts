import {
  createRaster,
  createRegistry,
  encodeBmp,
  setPixel,
  type CodecRegistry,
  type ImageCodec,
  type RasterImage,
} from '@photo/io';
import { doc as docApi, metadata, pipeline } from '@photo/core';
import { describe, expect, it } from 'vitest';
import { createNodeRegistry } from './node-registry.js';
import { crc32, encodePng } from './node-png.js';
import { emptyRecipe, validateRecipe, type Recipe } from './recipe.js';
import {
  describeStages,
  infoOne,
  planOne,
  planPaths,
  renderOne,
  runBatch,
  type RenderInput,
  type RenderOutcome,
  type ScratchState,
} from './render.js';

const registry = createNodeRegistry();
const FULL: pipeline.RenderTarget = { kind: 'export', maxEdge: 0, withText: true };

function recipeFrom(raw: unknown): Recipe {
  const parsed = validateRecipe(raw);
  if (!parsed.ok) throw new Error(`配方本应通过：${parsed.error}`);
  return parsed.recipe;
}

function solidRaster(width: number, height: number, r: number, g: number, b: number, a = 255): RasterImage {
  const image = createRaster(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(image, x, y, r, g, b, a);
  }
  return image;
}

/** 左半红 + 右半绿，**全不透明**的 4×2 图。
 * 之所以刻意不透明：内核的 raster 阶段会先铺边框色再按 alpha 合成，
 * 半透明像素会被压到边框色上（见本文档末尾的"已知语义"一组测试）。
 * 要断言"逐字节相等"就必须用不透明样本。 */
function quadRaster(): RasterImage {
  const image = createRaster(4, 2);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x < 2) setPixel(image, x, y, 255, 0, 0, 255);
      else setPixel(image, x, y, 0, 255, 0, 255);
    }
  }
  return image;
}

/** 左半不透明红 + 右半半透明蓝，用于钉住"透明被压到相纸色"的语义。 */
function semiRaster(): RasterImage {
  const image = createRaster(4, 2);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      if (x < 2) setPixel(image, x, y, 255, 0, 0, 255);
      else setPixel(image, x, y, 0, 0, 255, 128);
    }
  }
  return image;
}

function inputFrom(image: RasterImage, name = 'a.bmp'): RenderInput {
  return { name, baseName: name.replace(/\.[^.]+$/, ''), bytes: encodeBmp(image) };
}

function colorCounts(image: { width: number; height: number; data: Uint8ClampedArray }): Map<string, number> {
  const counts = new Map<string, number>();
  const total = image.width * image.height;
  for (let i = 0; i < total; i += 1) {
    const key = `${image.data[i * 4]},${image.data[i * 4 + 1]},${image.data[i * 4 + 2]},${image.data[i * 4 + 3]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function meanLuma(image: { width: number; height: number; data: Uint8ClampedArray }): number {
  let sum = 0;
  const total = image.width * image.height;
  for (let i = 0; i < total; i += 1) {
    sum += 0.2126 * image.data[i * 4] + 0.7152 * image.data[i * 4 + 1] + 0.0722 * image.data[i * 4 + 2];
  }
  return sum / total;
}

function renderOk(
  input: RenderInput,
  recipe: Recipe,
  format: string,
  target: pipeline.RenderTarget = FULL,
  scratch: ScratchState = {},
): RenderOutcome & { ok: true } {
  const outcome = renderOne(
    input,
    { recipe, target, format, quality: 85, outputName: `out.${format}` },
    registry,
    scratch,
  );
  if (!outcome.ok) throw new Error(`渲染失败：${outcome.error}`);
  return outcome;
}

/* ──────────────────────────── 计划 ──────────────────────────── */

describe('planOne：计划层', () => {
  it('空配方只做尺寸归一，阶段里只有 raster', () => {
    const outcome = planOne(inputFrom(quadRaster()), { recipe: emptyRecipe(), target: FULL }, registry);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.sourceSize).toEqual({ w: 4, h: 2 });
    expect(outcome.report.outputSize).toEqual({ w: 4, h: 2 });
    expect(outcome.report.stages).toEqual(['raster(4×2)']);
    expect(outcome.report.warnings).toEqual([]);
  });

  it('旋转 90° 让宽高互换（P1-1 的结构性防线）', () => {
    const recipe = recipeFrom({ ops: [{ k: 'setGeometry', value: { rotate: 90 } }] });
    const outcome = planOne(inputFrom(quadRaster()), { recipe, target: FULL }, registry);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.outputSize).toEqual({ w: 2, h: 4 });
    expect(outcome.report.stages[0]).toContain('旋转90°');
  });

  it('长边上限决定输出尺寸', () => {
    const outcome = planOne(
      inputFrom(quadRaster()),
      { recipe: emptyRecipe(), target: { kind: 'export', maxEdge: 2, withText: true } },
      registry,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.outputSize).toEqual({ w: 2, h: 1 });
  });

  it('预设的阶段顺序固定：色彩 → 色温 → 暗角 → 颗粒 → 锐化', () => {
    const recipe = recipeFrom({ ops: [{ k: 'applyPreset', key: 'film', intensity: 1 }] });
    const outcome = planOne(inputFrom(quadRaster()), { recipe, target: FULL }, registry);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.stages).toEqual([
      'raster(4×2)',
      'color(亮度102 对比108 饱和125 曝光5)',
      'warm(22)',
      'vignette(30)',
      'grain(18)',
      'enhance(锐化5 去雾0)',
    ]);
  });

  it('报告里的阶段与内核独立算出的计划严格一致', () => {
    const recipe = recipeFrom({
      ops: [{ k: 'setAdjust', value: { vignette: 40, grain: 5 } }],
    });
    const input = inputFrom(quadRaster());
    const outcome = planOne(input, { recipe, target: FULL }, registry);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    /* 用内核 API 从零重算一遍计划：
     * 若 CLI 偷偷增删了阶段（比如自己叠了一层"导出专用"处理），这里就会不等。
     * 这是"同一份内核换壳"最直接的证据。 */
    let document = docApi.createDocument();
    document = docApi.pushOp(document, {
      k: 'setSources',
      value: [{ id: 'src-0', name: input.name, width: 4, height: 2 }],
      current: 0,
    });
    for (const op of recipe.ops) document = docApi.pushOp(document, op);
    const plan = pipeline.buildPlan(document, FULL);

    expect(outcome.report.stages).toEqual(describeStages(plan));
    expect(outcome.report.outputSize).toEqual(plan.outputSize);
    expect(outcome.report.stages).toEqual(['raster(4×2)', 'vignette(40)', 'grain(5)']);
  });

  it('解码失败是一条带原因的失败，不是异常', () => {
    const bad: RenderInput = { name: 'bad.bin', baseName: 'bad', bytes: new Uint8Array([1, 2, 3, 4]) };
    const outcome = planOne(bad, { recipe: emptyRecipe(), target: FULL }, registry);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.name).toBe('bad.bin');
    expect(outcome.error).toContain('没有可用的解码器');
  });
});

describe('planPaths：读取失败也是一条结果', () => {
  it('中间一项读取失败不影响其它项', () => {
    const reader = (path: string): RenderInput => {
      if (path === 'missing.bmp') throw new Error('文件不存在。');
      return inputFrom(quadRaster(), path);
    };
    const outcomes = planPaths(
      ['a.bmp', 'missing.bmp', 'c.bmp'],
      reader,
      { recipe: emptyRecipe(), target: FULL },
      registry,
    );
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    const failed = outcomes[1];
    expect(failed).toMatchObject({ name: 'missing.bmp', error: '文件不存在。' });
  });
});

/* ──────────────────────────── 渲染 ──────────────────────────── */

describe('renderOne：像素正确性', () => {
  it('恒等渲染逐字节等于源图（原尺寸导出无插值损失）', () => {
    const source = quadRaster();
    const outcome = renderOk(inputFrom(source), emptyRecipe(), 'bmp');
    const decoded = registry.decode(outcome.bytes);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...source.data]);
  });

  it('旋转 90° 只重排像素，不引入新颜色', () => {
    const source = quadRaster();
    const recipe = recipeFrom({ ops: [{ k: 'setGeometry', value: { rotate: 90 } }] });
    const outcome = renderOk(inputFrom(source), recipe, 'bmp');
    const decoded = registry.decode(outcome.bytes);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(4);
    // 1:1 映射下双线性采样应完全落回原像素中心：颜色多重集必须严格不变。
    expect([...colorCounts(decoded).entries()].sort()).toEqual(
      [...colorCounts(source).entries()].sort(),
    );
  });

  it('四种旋转角度都保持像素总数与颜色多重集', () => {
    const source = quadRaster();
    const expected = [...colorCounts(source).entries()].sort();
    for (const rotate of [90, 180, 270]) {
      const recipe = recipeFrom({ ops: [{ k: 'setGeometry', value: { rotate } }] });
      const decoded = registry.decode(renderOk(inputFrom(source), recipe, 'bmp').bytes);
      expect([...colorCounts(decoded).entries()].sort(), `旋转 ${rotate}°`).toEqual(expected);
    }
  });

  it('水平镜像同样不引入新颜色', () => {
    const source = quadRaster();
    const recipe = recipeFrom({ ops: [{ k: 'setGeometry', value: { flipH: true } }] });
    const decoded = registry.decode(renderOk(inputFrom(source), recipe, 'bmp').bytes);
    expect([...colorCounts(decoded).entries()].sort()).toEqual(
      [...colorCounts(source).entries()].sort(),
    );
  });

  it('调色确实改变像素（亮度提升）', () => {
    const source = solidRaster(4, 2, 100, 100, 100);
    const before = meanLuma(source);
    const recipe = recipeFrom({ ops: [{ k: 'setAdjust', value: { brightness: 150 } }] });
    const outcome = renderOk(inputFrom(source), recipe, 'bmp');
    const decoded = registry.decode(outcome.bytes);
    expect(meanLuma(decoded)).toBeGreaterThan(before);
  });
});

/**
 * 已知语义（钉住而非"修好"）：`rasterize` 会先用**边框色**填满整块画布，
 * 再按 alpha 把图合成上去。因此透明区域会露出边框色（默认 `#ffffff` 相纸），
 * 导出结果不留透明通道。
 *
 * 快路径与慢路径都走 `blit`，所以预览与导出行为一致 —— 不存在 P1-1 式的漂移。
 * 但"导出丢透明"本身是一个待决的产品问题（见 README「已知限制」）。
 * 这几条测试把这个行为写死：将来若有意改动，测试会明确告诉你改了什么。
 */
describe('已知语义：透明像素被压到边框色（相纸）上', () => {
  it('alpha=128 的蓝像素与白色相纸各半 → (127,127,255,255)', () => {
    const decoded = registry.decode(renderOk(inputFrom(semiRaster()), emptyRecipe(), 'bmp').bytes);
    // 255 + (0 - 255) * (128/255) = 127（红、绿通道）；蓝通道 255 与相纸相同
    expect([...decoded.data.slice(8, 12)]).toEqual([127, 127, 255, 255]);
  });

  it('alpha=0 的像素完全露出相纸色', () => {
    const image = createRaster(2, 1);
    setPixel(image, 0, 0, 200, 100, 50, 0);
    setPixel(image, 1, 0, 200, 100, 50, 255);
    const decoded = registry.decode(renderOk(inputFrom(image), emptyRecipe(), 'bmp').bytes);
    expect([...decoded.data]).toEqual([255, 255, 255, 255, 200, 100, 50, 255]);
  });

  it('不透明像素不受影响（合成是无损的）', () => {
    const decoded = registry.decode(
      renderOk(inputFrom(quadRaster()), emptyRecipe(), 'bmp').bytes,
    );
    expect([...decoded.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('换成 PNG 输出同样被压平（不是编码器的问题，是 raster 阶段的语义）', () => {
    const outcome = renderOk(
      inputFrom(semiRaster()),
      recipeFrom({ ops: [{ k: 'setCollage', value: { borderColor: '#000000' } }] }),
      'png',
    );
    const decoded = registry.decode(outcome.bytes);
    // 黑相纸：0 + (255 - 0) * (128/255) = 128 → 蓝像素变成 (0,0,128,255)
    expect([...decoded.data.slice(8, 12)]).toEqual([0, 0, 128, 255]);
  });
});

describe('renderOne：与输出格式无关', () => {
  it('同一计划输出 BMP 与 PNG，解码后像素完全一致', () => {
    const recipe = recipeFrom({
      ops: [
        { k: 'setGeometry', value: { rotate: 90, flipH: true } },
        { k: 'setAdjust', value: { vignette: 30 } },
      ],
    });
    const input = inputFrom(quadRaster());
    const bmp = registry.decode(renderOk(input, recipe, 'bmp').bytes);
    const png = registry.decode(renderOk(input, recipe, 'png').bytes);
    expect(png.width).toBe(bmp.width);
    expect(png.height).toBe(bmp.height);
    expect([...png.data]).toEqual([...bmp.data]);
  });

  it('PNG 输出可被注册表识别为 png', () => {
    const outcome = renderOk(inputFrom(quadRaster()), emptyRecipe(), 'png');
    const info = infoOne({ name: 'out.png', baseName: 'out', bytes: outcome.bytes }, registry);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.info.format).toBe('png');
    expect(info.info.width).toBe(4);
  });
});

/* ──────────────────────────── 批处理 ──────────────────────────── */

describe('runBatch', () => {
  it('一张失败不拖垮整批，且各自带原因', () => {
    const good = inputFrom(quadRaster(), 'good.bmp');
    const result = runBatch(
      [
        { name: 'good.bmp', input: good, error: null, outputName: 'out/good.bmp' },
        { name: 'broken.bin', input: null, error: '文件不存在。', outputName: 'out/broken.bmp' },
        { name: 'bad.bin', input: { name: 'bad.bin', baseName: 'bad', bytes: new Uint8Array([9, 9]) }, error: null, outputName: 'out/bad.bmp' },
      ],
      { recipe: emptyRecipe(), target: FULL, format: 'bmp', quality: 85 },
      registry,
    );

    expect(result.okCount).toBe(1);
    expect(result.failCount).toBe(2);
    expect(result.outcomes[0]?.ok).toBe(true);
    expect(result.outcomes[1]).toMatchObject({ ok: false, name: 'broken.bin', error: '文件不存在。' });
    const third = result.outcomes[2];
    expect(third?.ok).toBe(false);
    if (third === undefined || third.ok) throw new Error('第三条本应是失败');
    expect(third.error).toContain('没有可用的解码器');
  });

  it('无卷积阶段时不申请 scratch（不为 24MP 白吃 288MB）', () => {
    const result = runBatch(
      [{ name: 'a.bmp', input: inputFrom(quadRaster()), error: null, outputName: 'a.bmp' }],
      { recipe: emptyRecipe(), target: FULL, format: 'bmp', quality: 85 },
      registry,
    );
    expect(result.scratchBytes).toBe(0);
  });
});

describe('ScratchState：整批复用一份卷积缓冲（P1-4）', () => {
  const softenRecipe = recipeFrom({ ops: [{ k: 'setAdjust', value: { soften: 30 } }] });

  it('有磨皮阶段时申请一次，后续同尺寸图复用同一块内存', () => {
    const scratch: ScratchState = {};
    const first = renderOk(inputFrom(solidRaster(8, 6, 120, 130, 140)), softenRecipe, 'bmp', FULL, scratch);
    expect(first.report.stages).toContain('soften(30)');
    const allocated = scratch.buffer;
    expect(allocated).toBeDefined();
    expect(allocated?.byteLength ?? 0).toBeGreaterThan(0);

    renderOk(inputFrom(solidRaster(8, 6, 60, 70, 80)), softenRecipe, 'bmp', FULL, scratch);
    expect(scratch.buffer).toBe(allocated);
  });

  it('批处理报告的 scratch 字节数大于 0', () => {
    const result = runBatch(
      [{ name: 'a.bmp', input: inputFrom(solidRaster(8, 6, 120, 130, 140)), error: null, outputName: 'a.bmp' }],
      { recipe: softenRecipe, target: FULL, format: 'bmp', quality: 85 },
      registry,
    );
    expect(result.okCount).toBe(1);
    expect(result.scratchBytes).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── info ───────────────────────────── */

describe('infoOne', () => {
  it('读出 BMP 的格式与尺寸', () => {
    const info = infoOne(inputFrom(quadRaster()), registry);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.info).toMatchObject({ format: 'bmp', width: 4, height: 2 });
    expect(info.info.bytes).toBeGreaterThan(0);
  });

  it('无法识别时列出已注册的解码器', () => {
    const info = infoOne(
      { name: 'x.dat', baseName: 'x', bytes: new Uint8Array([0, 1, 2]) },
      registry,
    );
    expect(info.ok).toBe(false);
    if (info.ok) return;
    expect(info.error).toContain('unknown');
    expect(info.error).toContain('bmp');
    expect(info.error).toContain('png');
  });
});

/* ──────────── 序1 · EXIF 朝向进 CLI（X1 的 CLI 半 / D13） ──────────── */

/** 最小 TIFF：IFD0 只有一条 `Orientation = 6`（小端，26 字节）。 */
const TIFF_ORIENT_6 = Uint8Array.from([
  0x49, 0x49, 0x2a, 0x00, // "II" + 42
  0x08, 0x00, 0x00, 0x00, // IFD0 在偏移 8
  0x01, 0x00, // 1 条目录项
  0x12, 0x01, // tag 0x0112 = Orientation
  0x03, 0x00, // type SHORT
  0x01, 0x00, 0x00, 0x00, // count 1
  0x06, 0x00, 0x00, 0x00, // value = 6（目录项内联）
  0x00, 0x00, 0x00, 0x00, // 无后续 IFD
]);

/**
 * 造一张带 `eXIf` 分块的 PNG（插在 IHDR 之后）。
 *
 * 手搓分块而**不给** `assemblePng` 加"额外分块"入参：生产路径不需要写 EXIF，
 * 为测试给生产 API 开一个用不上的口子，是拿实现换便利。CRC 用现成的 `crc32` 算，
 * 于是这张样本走的是解码器**真实**的校验路径。
 */
function pngWithExif(image: RasterImage): Uint8Array {
  const png = encodePng(image);
  const chunk = new Uint8Array(8 + TIFF_ORIENT_6.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, TIFF_ORIENT_6.length, false);
  chunk[4] = 0x65; // e
  chunk[5] = 0x58; // X
  chunk[6] = 0x49; // I
  chunk[7] = 0x66; // f
  chunk.set(TIFF_ORIENT_6, 8);
  view.setUint32(8 + TIFF_ORIENT_6.length, crc32(chunk, 4, 8 + TIFF_ORIENT_6.length), false);

  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // 签名 + 长度 + 类型 + IHDR 数据 + CRC
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function bytesOf(outcome: RenderOutcome): Uint8Array {
  if (!outcome.ok) throw new Error(`渲染本应成功：${outcome.error}`);
  return outcome.bytes;
}

describe('EXIF 朝向进 CLI', () => {
  const stored = quadRaster(); // 4×2 横图
  const once = metadata.applyOrientation(stored, 6); // 顺时针 90° → 2×4
  const exifRequest = {
    recipe: emptyRecipe(),
    target: { kind: 'export' as const, maxEdge: 0, withText: true },
    format: 'png',
    quality: 85,
    outputName: 'out.png',
  };

  it('带 eXIf 的 PNG 渲染产物 == 预置换那张的产物（逐字节）', () => {
    const viaExif = renderOne(
      { name: 'a.png', baseName: 'a', bytes: pngWithExif(stored) },
      exifRequest,
      registry,
    );
    const viaPermuted = renderOne(
      { name: 'a.png', baseName: 'a', bytes: encodePng(once) },
      exifRequest,
      registry,
    );
    expect(bytesOf(viaExif)).toEqual(bytesOf(viaPermuted));
  });

  it('计划里的源尺寸是显示态（宽高已换轴），与桌面 session 同一口径', () => {
    const outcome = planOne(
      { name: 'a.png', baseName: 'a', bytes: pngWithExif(stored) },
      { recipe: emptyRecipe(), target: FULL },
      registry,
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.report.sourceSize).toEqual({ w: 2, h: 4 });
  });

  it('infoOne 同时报显示态与存储态，朝向与参数行取自内核', () => {
    const info = infoOne({ name: 'a.png', baseName: 'a', bytes: pngWithExif(stored) }, registry);
    if (!info.ok) throw new Error(info.error);
    expect(info.info).toMatchObject({
      format: 'png',
      width: 2,
      height: 4,
      storedWidth: 4,
      storedHeight: 2,
      orientation: '6 · 顺时针90°',
    });
    expect(info.info.exif).toBe('有 EXIF，无拍摄参数');
  });

  it('无 eXIf 的 PNG 不被改动（朝向缺省 = 不置换）', () => {
    const plain = renderOne(
      { name: 'a.png', baseName: 'a', bytes: encodePng(stored) },
      exifRequest,
      registry,
    );
    const outcome = planOne(
      { name: 'a.png', baseName: 'a', bytes: encodePng(stored) },
      { recipe: emptyRecipe(), target: FULL },
      registry,
    );
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.report.sourceSize).toEqual({ w: 4, h: 2 });
    expect(bytesOf(plain).length).toBeGreaterThan(0);
  });
});

describe('配方里的 exifOrientation', () => {
  it('透传：归一化不会把朝向留痕悄悄丢掉', () => {
    const parsed = validateRecipe({
      ops: [
        {
          k: 'setSources',
          current: 0,
          value: [{ id: 's', name: 'a.jpg', width: 2, height: 4, exifOrientation: 6 }],
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.recipe.ops[0]).toMatchObject({ value: [{ exifOrientation: 6 }] });
  });

  it('非法朝向码报错，而不是回落成"没有朝向"', () => {
    const parsed = validateRecipe({
      ops: [
        {
          k: 'setSources',
          current: 0,
          value: [{ id: 's', name: 'a.jpg', width: 2, height: 4, exifOrientation: 9 }],
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('exifOrientation');
  });
});

/* ──────────────────── 内存门接入（P6-d 序 1 · 验收 L）──────────────────── */

describe('内存门：CLI 作为内核门的第一个消费者', () => {
  /** 开满重负载阶段（锐化/去雾）⇒ estimateMemory 计入卷积 scratch。 */
  const heavyRecipe = (): Recipe =>
    recipeFrom({ ops: [{ k: 'setAdjust', value: { sharpen: 30, dehaze: 20 } }] });

  /** 只声明尺寸、**不分配像素**的假解码器：用于在"执行前"就触发巨大计划。 */
  function giantRegistry(width: number, height: number): CodecRegistry {
    const codec: ImageCodec = {
      format: 'bmp',
      extensions: ['.bmp'],
      lossless: true,
      canDecode: () => true,
      decode: () => ({ width, height, data: new Uint8ClampedArray(0) }),
      encode: () => new Uint8Array(0),
    };
    return createRegistry([codec]);
  }

  it('计划层：超预算自动降长边，报告里的输出尺寸 = 降采样后尺寸', () => {
    const outcome = planOne(
      inputFrom(solidRaster(1000, 800, 200, 100, 50), 'big.bmp'),
      { recipe: heavyRecipe(), target: FULL, gate: { budgetBytes: 20 * 1024 * 1024 } },
      registry,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const gate = outcome.report.gate;
    expect(gate.decision).toBe('downscale');
    if (gate.decision !== 'downscale') return;
    // 预演与真跑必须同源：报告尺寸就是降采样后的尺寸
    expect(outcome.report.outputSize).toEqual(gate.outputSize);
    expect(outcome.report.outputSize.w).toBeLessThan(1000);
    expect(gate.projectedBytesAfter).toBeLessThanOrEqual(gate.budgetBytes);
    // 文案里写明动作与目标尺寸（验收 L）
    expect(gate.message).toContain(String(gate.maxEdge));
  });

  it('渲染层：按门的建议降长边，产出确实变小', () => {
    const outcome = renderOne(
      inputFrom(solidRaster(1000, 800, 10, 20, 30), 'big.bmp'),
      {
        recipe: heavyRecipe(),
        target: FULL,
        format: 'bmp',
        quality: 85,
        outputName: 'out.bmp',
        gate: { budgetBytes: 20 * 1024 * 1024 },
      },
      registry,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.gate.decision).toBe('downscale');
    expect(outcome.report.outputSize.w).toBeLessThan(1000);
  });

  it('降采样不可行且未授权 → 拒绝执行并给出可操作提示', () => {
    // 长边 100 < 下限 640：没有降采样空间；预算压到 1 字节 ⇒ 必超预算
    const outcome = renderOne(
      inputFrom(solidRaster(100, 80, 1, 2, 3), 'tiny.bmp'),
      {
        recipe: heavyRecipe(),
        target: FULL,
        format: 'bmp',
        quality: 85,
        outputName: 'out.bmp',
        gate: { budgetBytes: 1 },
      },
      registry,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('--allow-oversize');
  });

  it('带授权后放行（confirm 分支由用户承担风险）', () => {
    const outcome = renderOne(
      inputFrom(solidRaster(100, 80, 1, 2, 3), 'tiny.bmp'),
      {
        recipe: heavyRecipe(),
        target: FULL,
        format: 'bmp',
        quality: 85,
        outputName: 'out.bmp',
        gate: { budgetBytes: 1, allowFullSize: true },
      },
      registry,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.gate.decision).toBe('confirm');
  });

  it('巨大计划 + 授权原尺寸 → 触到硬上限，明确拒绝（且不执行）', () => {
    // 80MP：预计峰值 ≈ 4.3 GB，越过 4 GB 硬天花板
    const outcome = planOne(
      { name: 'huge.bmp', baseName: 'huge', bytes: new Uint8Array([1]) },
      { recipe: heavyRecipe(), target: FULL, gate: { allowFullSize: true } },
      giantRegistry(10000, 8000),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('硬上限');
  });
});

/* ───────────────── C4（P6-e 序 3）：CLI 没有文字栅格化 ─────────────────
 * CLI 端从来没有 `TextRenderer`（Node 侧字体光栅化是序 3 第二步的事）。
 * 以前"没能力"表现为**水印静默消失**，现在必须表现为一次可报告的失败。
 * 主进程退出码由 `main.ts` 的 `failCount > 0 → exitCode = 1` 保证，
 * 所以这里钉的是"失败要成为一条结果，并且说清原因"。 */

describe('C4 文字诚实化：无 TextRenderer 时含文案配方必失败', () => {
  const wmRecipe = recipeFrom({
    ops: [{ k: 'setWatermark', value: { text: '© 尤利乌斯', pos: 'br', size: 3 } }],
  });

  function render(input: RenderInput, recipe: Recipe, target = FULL) {
    return renderOne(
      input,
      { recipe, target, format: 'bmp', quality: 85, outputName: 'out.bmp' },
      registry,
    );
  }

  it('renderOne：失败收敛成结果对象，原因点名缺的能力', () => {
    const outcome = render(inputFrom(quadRaster()), wmRecipe);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('TextRenderer');
    expect(outcome.error).toContain('水印');
  });

  it('--no-text（withText=false）是合法逃生口：同一配方照样出图', () => {
    const outcome = render(inputFrom(quadRaster()), wmRecipe, {
      kind: 'export',
      maxEdge: 0,
      withText: false,
    });
    expect(outcome.ok).toBe(true);
  });

  it('失败按张计数、不抛断整批，且报告里名字与输入同序', () => {
    const result = runBatch(
      [
        { name: 'a.bmp', input: inputFrom(quadRaster()), error: null, outputName: 'a.bmp' },
        { name: 'b.bmp', input: inputFrom(quadRaster(), 'b.bmp'), error: null, outputName: 'b.bmp' },
      ],
      { recipe: wmRecipe, target: FULL, format: 'bmp', quality: 85 },
      registry,
    );
    expect(result.outcomes.map((o) => (o.ok ? o.report.name : o.name))).toEqual(['a.bmp', 'b.bmp']);
    expect(result.okCount).toBe(0);
    expect(result.failCount).toBe(2);
    expect(result.outcomes.every((o) => !o.ok && o.error.includes('TextRenderer'))).toBe(true);
  });
});
