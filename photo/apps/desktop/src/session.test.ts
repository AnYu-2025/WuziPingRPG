/**
 * EditSession 的回归测试 —— 把 P6C-PLAN 里"要求自动化"的验收条件
 * 变成可重复执行的断言，而不是上手点窗口。
 *
 * 覆盖：
 *   F  导出与预览同源（阶段序列一致 + 尺寸不生效时**逐字节**相同）
 *   H  改末端参数时缓存复用 > 0（且复用结果 === 全量重算）
 *   真尺寸导入 / 旋转宽高互换 / 撤销重做对称 / 连续拖动合并为一步 /
 *   无操作导出逐字节等于源 / 文字阶段真的落到像素上 /
 *   没有 TextRenderer 时含水印渲染明确失败（C4，不再静默退化成 noop）
 *   序1（D12/D13）：EXIF 朝向在导入那一次置换、信息条三态、留痕字段不进像素
 *   序2（D14/#4）：工程文件存了再开逐字节一致、源图对不上整次失败并指名、
 *                 projectNeeds 只读、自定义预设文本往返后套用一致、
 *                 套用走参数 op 而不查内置表
 */
import { describe, expect, it } from 'vitest';
import { doc as docApi, metadata, pipeline, presets, type PixelBuffer } from '@photo/core';
import { firstByteDiff } from './bytes.js';
import {
  createFakeImageIo,
  createFakeSurfaceFactory,
  patternBuffer,
} from './canvas-fakes.js';
import { EditSession, type ImportResult, type SourceFacts } from './session.js';
import type { ShellImageIo } from './image-io.js';
import { SurfacePool } from './surface.js';
import { createCanvasTextRenderer } from './text-renderer.js';

interface MakeOptions {
  readonly width?: number;
  readonly height?: number;
  readonly withText?: boolean;
  readonly buffer?: PixelBuffer;
}

function makeSession(options: MakeOptions = {}): EditSession {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const pool = new SurfacePool(createFakeSurfaceFactory());
  const session = new EditSession({
    imageIo: createFakeImageIo(),
    textRenderer: options.withText === true ? createCanvasTextRenderer(pool) : undefined,
    previewTarget: pipeline.PREVIEW_TARGET,
  });
  session.importPixels(options.buffer ?? patternBuffer(width, height), 'sample.png');
  return session;
}

/**
 * 首个不同字节的下标：完全相同返回 -1，长度不同返回 -2。
 *
 * 刻意不用 `expect(a.data).toEqual(b.data)` —— 对 1.92 MB 的类型化数组，
 * 深比较会去构建 diff，单条断言能跑到数秒；而且失败时打印的是几十万个数。
 * 早退的逐字节比较既快，失败时给出的下标本身就是最好的线索。
 * 实现在 `bytes.ts`：这个断言形态在冒烟脚本里也要用，因此不留在测试文件里。
 */

/** 两张同尺寸缓冲里"被改动过"的像素范围。用于断言改动**只**发生在该发生的地方。 */
function changedBox(a: PixelBuffer, b: PixelBuffer): {
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let count = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const o = (y * a.width + x) * 4;
      const differs =
        a.data[o] !== b.data[o] ||
        a.data[o + 1] !== b.data[o + 1] ||
        a.data[o + 2] !== b.data[o + 2] ||
        a.data[o + 3] !== b.data[o + 3];
      if (!differs) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, minY, maxX, maxY };
}

/** 一次导入对外报出的**全部**字段（加字段时必须在这里表态，不许悄悄漏进信息条）。 */
const imported = (over: Partial<ImportResult>): ImportResult => ({
  name: '',
  width: 0,
  height: 0,
  stored: null,
  bytes: null,
  orientation: null,
  exifLine: null,
  ...over,
});

describe('EditSession · 导入', () => {
  it('把**真实尺寸**写进源引用，而不是 1×1 占位', () => {
    const session = makeSession({ width: 640, height: 480 });
    expect(session.hasSource).toBe(true);
    /* 直接喂像素的路径没有容器字节可考：四个来源字段全为 null，而不是"无 EXIF"。 */
    expect(session.sourceInfo).toEqual(imported({ name: 'sample.png', width: 640, height: 480 }));

    const sources = session.state.sources;
    expect(sources).toHaveLength(1);
    /* 这条不是废话：真尺寸错成 1×1 会让旋转后的宽高、边框内缩全算错，
     * 属于 legacy P1-1 的同类坑。 */
    expect(sources[0]?.width).toBe(640);
    expect(sources[0]?.height).toBe(480);
  });

  it('未导入就渲染会明确报错，而不是悄悄出一张 1×1 黑图', () => {
    const session = new EditSession({ imageIo: createFakeImageIo() });
    expect(() => session.renderPreview()).toThrow(/尚未导入/);
    expect(() => session.renderExport()).toThrow(/尚未导入/);
  });

  it('importBytes 走外壳解码通道后得到与源逐字节一致的像素', async () => {
    const io = createFakeImageIo();
    const src = patternBuffer(64, 48);
    const bytes = await io.encode(src, 'jpeg', 80);

    const session = new EditSession({ imageIo: io });
    /* mime 显式传入：替身容器不是真实 PNG/JPEG，magic 探测认不出来。
     * 真实路径里这一步由扩展名 / 文件类型提供，属于调用方的已知信息。 */
    const info = await session.importBytes(bytes, 'from-disk.jpg', 'image/jpeg');

    expect(info).toEqual(
      imported({
        name: 'from-disk.jpg',
        width: 64,
        height: 48,
        stored: { width: 64, height: 48 },
        bytes: bytes.length,
        /* 这条走的是"读过容器字节、里面没有 EXIF"，与上一条的 null 不同态（X4）。 */
        exifLine: '无 EXIF',
      }),
    );
    expect(firstByteDiff((await session.renderExport()).data, src.data)).toBe(-1);
  });
});

/* ─────────────────── 序1 · EXIF 朝向（D12 / D13 / X3 / X4） ─────────────────── */

/**
 * 手写的最小 TIFF：IFD0 里只有一条 `Orientation = 6`（小端，26 字节）。
 *
 * 为什么手写字节而不是调某个 builder：这里要证的正是"会话自己去读容器字节"，
 * 用内核测试里那套 builder 会把两件事捆在一起 —— 一旦解析器改了口径，
 * 这条测试会跟着一起变绿，就失去意义了。
 */
const TIFF_ORIENTATION_6 = Uint8Array.from([
  0x49, 0x49, 0x2a, 0x00, // "II" + 42
  0x08, 0x00, 0x00, 0x00, // IFD0 在偏移 8
  0x01, 0x00, // 1 条目录项
  0x12, 0x01, // tag 0x0112 = Orientation
  0x03, 0x00, // type SHORT
  0x01, 0x00, 0x00, 0x00, // count 1
  0x06, 0x00, 0x00, 0x00, // value = 6（目录项内联）
  0x00, 0x00, 0x00, 0x00, // 无后续 IFD
]);

/** 只关心"字节里的 EXIF 有没有被读到"，像素由这个替身按给定尺寸给出。 */
function stubImageIo(width: number, height: number): ShellImageIo {
  return {
    formats: ['png'],
    decode: async () => patternBuffer(width, height),
    encode: async () => {
      throw new Error('本替身不编码');
    },
  };
}

/** 造一份"从字节导入"的来源事实（容器解析本身由 `metadata/exif.test.ts` 覆盖）。 */
function factsWith(
  orientation: metadata.ExifOrientation | null,
  bytes = 4096,
): SourceFacts {
  return {
    bytes,
    read: {
      found: true,
      valid: true,
      exif: {
        orientation,
        make: 'SONY',
        model: 'ILCE-7M4',
        dateTimeOriginal: '2024:05:01 12:33:20',
        exposureTime: null,
        fNumber: null,
        iso: null,
        focalLength: null,
      },
    },
  };
}

describe('EditSession · EXIF 朝向', () => {
  it('朝向在导入那一次置换进像素，渲染不会再转第二次', async () => {
    const stored = patternBuffer(64, 48); // 存储态：横图
    const once = metadata.applyOrientation(stored, 6); // 期望：顺时针 90° 后的竖图

    const viaExif = new EditSession({ imageIo: createFakeImageIo() });
    const info = viaExif.importPixels(stored, 'a.jpg', factsWith(6));
    const viaPermuted = new EditSession({ imageIo: createFakeImageIo() });
    viaPermuted.importPixels(once, 'a.jpg'); // 已经转正、不带朝向信息

    expect(info.width).toBe(48);
    expect(info.height).toBe(64);
    expect(info.stored).toEqual({ width: 64, height: 48 });
    expect(info.bytes).toBe(4096);
    expect(viaExif.sourceInfo?.orientation).toBe(6);
    /* 逐字节：两条路径必须给出同一张图。多转一次（180°）或少转一次都会在这里露出来。 */
    const rotatedOnce = await viaExif.renderExport();
    const asPermuted = await viaPermuted.renderExport();
    expect(firstByteDiff(rotatedOnce.data, asPermuted.data)).toBe(-1);
  });

  it('容器字节里的朝向会被会话自己读到（不只依赖外壳解码）', async () => {
    const session = new EditSession({ imageIo: stubImageIo(64, 48) });
    const info = await session.importBytes(TIFF_ORIENTATION_6, 'from-camera.jpg');
    expect(info.orientation).toBe(6);
    expect(info.width).toBe(48);
    expect(info.height).toBe(64);
    expect(info.bytes).toBe(TIFF_ORIENTATION_6.length);
    /* 这份字节里只有朝向一条，所以参数行如实说"有 EXIF，无拍摄参数" ——
     * 它必须与"没 EXIF"区分开，否则三态里前两态就白分了。 */
    expect(info.exifLine).toBe('有 EXIF，无拍摄参数');
  });

  it('朝向只留痕不进计算：ref 带 exifOrientation，宽高已是显示态', () => {
    const session = new EditSession({ imageIo: createFakeImageIo() });
    session.importPixels(patternBuffer(64, 48), 'a.jpg', factsWith(8));
    const ref = session.state.sources[0];
    expect(ref?.width).toBe(48);
    expect(ref?.height).toBe(64);
    expect(ref?.exifOrientation).toBe(8);
  });

  it('信息条三态分得开：没读字节 / 有段读不动 / 读到参数', () => {
    const noBytes = new EditSession({ imageIo: createFakeImageIo() });
    noBytes.importPixels(patternBuffer(8, 8), 'p.png');
    expect(noBytes.sourceInfo?.exifLine).toBeNull();

    const broken = new EditSession({ imageIo: createFakeImageIo() });
    broken.importPixels(patternBuffer(8, 8), 'p.png', {
      bytes: 128,
      read: { found: true, valid: false, reason: 'IFD0 条目越界' },
    });
    expect(broken.sourceInfo?.exifLine).toBe('EXIF 无法解析（IFD0 条目越界）');
    expect(broken.sourceInfo?.orientation).toBeNull();

    const withExif = new EditSession({ imageIo: createFakeImageIo() });
    withExif.importPixels(patternBuffer(8, 8), 'p.png', factsWith(1));
    expect(withExif.sourceInfo?.exifLine).toBe('SONY ILCE-7M4 · 2024-05-01');
  });

  it('朝向 1（正常）不产生额外拷贝：源引用原样留在会话里', () => {
    const src = patternBuffer(16, 8);
    const session = new EditSession({ imageIo: createFakeImageIo() });
    session.importPixels(src, 'a.jpg', factsWith(1));
    expect(session.state.sources[0]?.width).toBe(16);
    expect(session.sourceInfo?.stored).toEqual({ width: 16, height: 8 });
  });
});

describe('EditSession · 几何', () => {
  it('顺时针 90° 使导出宽高互换（宽高顺序由内核唯一裁决）', () => {
    const session = makeSession({ width: 800, height: 600 });
    expect(session.exportPlanSummary()).toMatchObject({ width: 800, height: 600 });

    session.rotateClockwise();
    expect(session.exportPlanSummary()).toMatchObject({ width: 600, height: 800 });

    session.rotateClockwise();
    session.rotateClockwise();
    session.rotateClockwise();
    expect(session.exportPlanSummary()).toMatchObject({ width: 800, height: 600 });
  });

  it('导出尺寸等于源尺寸（maxEdge=0，不做长边压缩）', async () => {
    const session = makeSession({ width: 933, height: 411 });
    expect(session.exportPlanSummary()).toMatchObject({ width: 933, height: 411 });
    expect(await session.renderExport()).toMatchObject({ width: 933, height: 411 });
  });
});

describe('EditSession · 对比原图（#29）', () => {
  it('对比图与编辑图**同尺寸** —— 按住不跳，才谈得上前后比较', async () => {
    const session = makeSession({ width: 1200, height: 800 });
    session.setParams({ brightness: 140, contrast: 130 });

    const edited = await session.renderPreview();
    const original = await session.renderPreviewOriginal();

    expect(original.width).toBe(edited.pixels.width);
    expect(original.height).toBe(edited.pixels.height);
    /* 同尺寸但内容必须不同 —— 否则"对比"就是一张图。 */
    expect(firstByteDiff(original.data, edited.pixels.data)).not.toBe(-1);
  });

  it('未做编辑时，对比图与预览**逐字节相同**（对比不该多改一笔）', async () => {
    const session = makeSession({ width: 1200, height: 800 });
    const edited = await session.renderPreview();
    const original = await session.renderPreviewOriginal();
    expect(firstByteDiff(original.data, edited.pixels.data)).toBe(-1);
  });

  it('观感**全部**归零：加了预设 / 水印 / 贴纸后，对比图 === 干净会话的预览', async () => {
    /* 这条是全组最硬的：它不逐项查 `params`/`curves`/`bands` 有没有清零，
     * 而是直接要求"最终像素严格等于一张从没编辑过的图" ——
     * 漏掉任何一类观感 op，这条都会红。比逐项断言更难被绕过。 */
    const session = makeSession({ width: 1200, height: 800, withText: true });
    session.applyPreset('nightblue');
    session.setWatermarkText('琉璃');
    session.setStickerText('样品');
    const original = await session.renderPreviewOriginal();

    const clean = makeSession({ width: 1200, height: 800, withText: true });
    const pristine = await clean.renderPreview();

    expect(firstByteDiff(original.data, pristine.pixels.data)).toBe(-1);
  });

  it('取景**全部**保留：旋转后对比图仍是旋转后的方向（宽高互换）', async () => {
    const session = makeSession({ width: 1200, height: 800 });
    session.rotateClockwise();
    const original = await session.renderPreviewOriginal();
    expect(original.width).toBe(800);
    expect(original.height).toBe(1200);
  });

  it('对比是**读操作**：不落历史、不改当前状态', async () => {
    const session = makeSession({ width: 1200, height: 800 });
    session.setParams({ brightness: 140 });
    const before = session.document.ops.length;
    await session.renderPreviewOriginal();
    expect(session.document.ops.length).toBe(before);
  });
});

describe('EditSession · 导出体积预估（#26）', () => {
  it('预览与导出同尺寸时，预估值 **===** 实际导出的字节数（比例因子为 1 时退化为恒等）', async () => {
    /* 800×600 长边 800 < 预览上限 1400 —— 预览没有缩放，与导出同尺寸。
     * 这是唯一能让"估算"与"实测"严格相等的情形，因此它是最好的定标用例：
     * 它锁死了`estimateExportSize` 不会在数据上偷偷做别的什么事。 */
    const session = makeSession({ width: 800, height: 600 });
    session.setParams({ contrast: 118 });

    expect(session.exportOutputSize).toMatchObject({ width: 800, height: 600 });

    const preview = await session.renderPreview();
    const est = await session.estimateExportSize(preview.pixels, 'png', 92);
    const actual = await session.exportBytes('png', 92);

    expect(est.bytes).toBe(actual.bytes.byteLength);
  });

  it('长边上限减半时，预估体积按面积降到约 1/4（不是随长边线性下降）', async () => {
    const session = makeSession({ width: 1200, height: 800 });
    const preview = await session.renderPreview();

    const full = await session.estimateExportSize(preview.pixels, 'png', 92);
    session.setExportMaxEdge(600);
    const half = await session.estimateExportSize(preview.pixels, 'png', 92);

    /* 面积比 1:4，故 half.bytes 落在 full 的 0.2~0.3 之间。
     * 取区间而不是等值：容器头部不随像素缩放，估算不可能恰好是 1/4。 */
    expect(half.bytes).toBeGreaterThan(full.bytes * 0.2);
    expect(half.bytes).toBeLessThan(full.bytes * 0.3);
    expect(half.width).toBe(600);
  });

  it('估算尺寸跟着内核走：旋转使宽高互换（壳不自算尺寸）', async () => {
    const session = makeSession({ width: 900, height: 500 });
    const preview = await session.renderPreview();

    const before = await session.estimateExportSize(preview.pixels, 'png', 92);
    expect(before.width).toBe(900);
    expect(before.height).toBe(500);

    session.rotateClockwise();
    const after = await session.estimateExportSize(preview.pixels, 'png', 92);
    expect(after.width).toBe(500);
    expect(after.height).toBe(900);
    expect(after).toMatchObject(session.exportOutputSize);
  });

  it('退化输入不产生 NaN / Infinity：零面积返回 0 而不是除零', async () => {
    const session = makeSession({ width: 400, height: 300 });
    const empty: PixelBuffer = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const est = await session.estimateExportSize(empty, 'png', 92);

    expect(est.bytes).toBe(0);
    expect(Number.isFinite(est.bytes)).toBe(true);
  });
});

describe('EditSession · 验收 F：预览与导出同源', () => {
  it('阶段序列完全一致，且尺寸不变时像素逐字节相同', async () => {
    const session = makeSession({ width: 800, height: 600, withText: true });
    session.setParams({ brightness: 112, contrast: 118, saturate: 130, exposure: 5, vignette: 40 });
    session.setWatermarkText('琉璃');
    session.setStickerText('样品');

    const previewKinds = session.previewPlanSummary().kinds;
    const exportKinds = session.exportPlanSummary().kinds;
    expect(previewKinds).toEqual(exportKinds);
    /* 阶段序列里确实有内容 —— 否则"两边都是空"也能让上一条通过。 */
    expect(previewKinds.length).toBeGreaterThan(3);

    /* 源图 800×600 长边 < 预览上限 1400，因此预览没有缩放：
     * 两条路径的输出**必须**逐字节相同。这是"同源"最硬的一条断言。 */
    const preview = await session.renderPreviewUncached();
    const exported = await session.renderExport();
    expect(exported.width).toBe(preview.width);
    expect(exported.height).toBe(preview.height);
    expect(firstByteDiff(exported.data, preview.data)).toBe(-1);
  }, 30_000);

  it('导出编码出的字节确实是被编码的那张图（尺寸随原图）', async () => {
    const session = makeSession({ width: 320, height: 200 });
    const result = await session.exportBytes('png', 90);
    expect(result).toMatchObject({ width: 320, height: 200 });
    expect(result.bytes.length).toBeGreaterThan(0);
  });
});

describe('EditSession · 验收 H：缓存复用', () => {
  it('首帧冷启动，随后同文档重渲染全部复用；改末端参数后前缀仍被复用', async () => {
    const session = makeSession({ width: 400, height: 300 });
    session.setParams({ brightness: 110, contrast: 108, saturate: 120, vignette: 40 });

    const cold = await session.renderPreview();
    expect(cold.stats.reused).toBe(0);
    expect(cold.stats.computed).toBeGreaterThan(0);

    /* 同一份文档再渲染一次：应当**一个阶段都不重算**。 */
    const warm = await session.renderPreview();
    expect(warm.stats.reused).toBe(cold.stats.computed);
    expect(warm.stats.computed).toBe(0);
    expect(firstByteDiff(warm.pixels.data, cold.pixels.data)).toBe(-1);

    /* 只动暗角（管线末端）—— 几何/调色前缀必须整段复用。 */
    session.setParam('vignette', 70);
    const tweaked = await session.renderPreview();
    expect(tweaked.stats.reused).toBeGreaterThan(0);
    expect(tweaked.stats.computed).toBeLessThan(cold.stats.computed);

    /* 复用路径的结果必须与全量重算**逐字节一致** —— 否则缓存没意义。 */
    expect(firstByteDiff(tweaked.pixels.data, (await session.renderPreviewUncached()).data)).toBe(-1);
  });

  it('换源图后缓存被显式清空（不会"看起来命中"）', async () => {
    const session = makeSession({ width: 200, height: 150 });
    await session.renderPreview();
    expect((await session.renderPreview()).stats.reused).toBeGreaterThan(0);

    session.importPixels(patternBuffer(200, 150), 'another.png');
    const afterImport = await session.renderPreview();
    expect(afterImport.stats.reused).toBe(0);
  });
});

describe('EditSession · 历史', () => {
  it('撤销 / 重做对称：调参可撤销，重做回到同一状态', () => {
    const session = makeSession({ width: 200, height: 150 });
    const before = session.state.params.vignette;

    session.setParam('vignette', 88);
    expect(session.state.params.vignette).toBe(88);
    expect(session.canUndo).toBe(true);

    session.undo();
    expect(session.state.params.vignette).toBe(before);
    expect(session.canRedo).toBe(true);

    session.redo();
    expect(session.state.params.vignette).toBe(88);
    expect(session.canRedo).toBe(false);
  });

  it('连续拖动滑杆合并为一步历史（一次拖拽 = 一步撤销）', () => {
    const session = makeSession({ width: 200, height: 150 });
    const base = docApi.historyLength(session.document);

    for (const v of [10, 20, 30, 40, 50]) session.setParam('vignette', v);
    expect(docApi.historyLength(session.document)).toBe(base + 1);

    session.undo();
    expect(session.state.params.vignette).toBe(0);
  });

  it('未知预设被明确拒绝，而不是静默无效果', () => {
    const session = makeSession({ width: 200, height: 150 });
    expect(() => session.applyPreset('no-such-preset')).toThrow(/未知预设/);
  });

  it('套用内置预设会把参数推向预设立场', () => {
    const session = makeSession({ width: 200, height: 150 });
    session.applyPreset('rainy_dark', 1);
    expect(session.state.presetKey).toBe('rainy_dark');
    /* 该预设是"暗"的：亮度低于中性 100。 */
    expect(session.state.params.brightness).toBeLessThan(100);
  });

  it('预设强度与参数同源，且连续拖动不产生 N 步历史', () => {
    const session = makeSession({ width: 200, height: 150 });
    session.applyPreset('film', 1);
    const base = docApi.historyLength(session.document);
    const filmWarm = presets.findPreset('film')?.params.warm ?? 0;

    /* 模拟滑杆连发几十个 input 事件 —— 历史**最多**增长一步。
     * 内核的 merge 语义是"与栈顶同类即替换"，因此这一次拖拽会并进刚推入的
     * applyPreset（选预设 + 定强度本就是一次编辑决定），而不是另起一步。 */
    for (const k of [0.9, 0.8, 0.7, 0.6, 0.55]) session.setPresetIntensity(k);
    const afterFirstDrag = docApi.historyLength(session.document);
    expect(afterFirstDrag).toBeLessThanOrEqual(base + 1);
    expect(session.state.presetIntensity).toBeCloseTo(0.55, 6);
    /* 强度不是"另一个数字"：参数必须跟着强度走。 */
    expect(session.state.params.warm).toBeLessThan(filmWarm);

    /* 再拖一批也不新建历史 —— 这正是要消灭的"撤销一下只退 1%"形态。 */
    for (const k of [0.5, 0.4, 0.3]) session.setPresetIntensity(k);
    expect(docApi.historyLength(session.document)).toBe(afterFirstDrag);

    /* 撤销一步退回满强度 —— 壳读 EditState 就能让滑杆跟对位置。 */
    session.undo();
    expect(session.state.presetIntensity).toBe(1);
  });

  it('无当前预设时调强度是合法空操作（不臆造预设）', () => {
    const session = makeSession({ width: 200, height: 150 });
    const base = docApi.historyLength(session.document);
    session.setPresetIntensity(0.3);
    expect(docApi.historyLength(session.document)).toBe(base);
    expect(session.state.presetKey).toBeNull();
  });
});

describe('EditSession · 恒等与文字', () => {
  it('未做任何编辑时，导出像素逐字节等于源（恒等快路径不引入插值损失）', async () => {
    const src = patternBuffer(320, 240);
    const session = makeSession({ buffer: src, width: 320, height: 240 });

    const out = await session.renderExport();
    expect(out.width).toBe(src.width);
    expect(out.height).toBe(src.height);
    expect(firstByteDiff(out.data, src.data)).toBe(-1);
  });

  it('水印经画布栅格化后真的落到像素上，且只落在右下角', async () => {
    const session = makeSession({ width: 600, height: 400, withText: true });
    const plain = await session.renderExport();

    session.setWatermarkText('琉璃');
    const marked = await session.renderExport();

    const box = changedBox(plain, marked);
    expect(box.count).toBeGreaterThan(0);
    /* 默认水印位置是右下角（pos: 'br'）。若整图被涂，说明坐标或对齐算错了。 */
    expect(box.minX).toBeGreaterThan(600 / 2);
    expect(box.minY).toBeGreaterThan(400 / 2);
    expect(box.maxX).toBeLessThan(600);
    expect(box.maxY).toBeLessThan(400);
  });

  it('没有注入文字能力时，含水印的渲染明确失败（不再静默退化成 noop）', async () => {
    const session = makeSession({ width: 300, height: 200 });
    const plain = await session.renderExport();
    session.setWatermarkText('琉璃');
    /* C4 的桌面一侧：与其交回一张"报告说成功、图里却没有水印"的产物，
     * 不如把原因抛给调用方。内核只在真的没有文案时才省略文字阶段。 */
    await expect(session.renderExport()).rejects.toThrow(/未注入文字渲染能力/);
    /* 清空文案 → 阶段消失 → 同一条链路照常出图，且与失败之前逐字节一致。 */
    session.setWatermarkText('');
    const clean = await session.renderExport();
    expect(firstByteDiff(clean.data, plain.data)).toBe(-1);
  });
});

describe('EditSession · 多图 / 拼图 / 切图', () => {
  it('多图：切换当前源图会改变渲染尺寸（不是只改了个数字）', async () => {
    const session = makeSession({ width: 600, height: 400 });
    session.addPixels(patternBuffer(400, 600), 'b.png');
    expect(session.sourceCount).toBe(2);
    expect(session.currentIndex).toBe(1);
    expect(await session.renderExport()).toMatchObject({ width: 400, height: 600 });

    session.setCurrentSource(0);
    expect(session.currentIndex).toBe(0);
    expect(await session.renderExport()).toMatchObject({ width: 600, height: 400 });
  });

  it('多图：删除当前源图后 index 收拢到合法范围', async () => {
    const session = makeSession({ width: 300, height: 200 });
    session.addPixels(patternBuffer(200, 300), 'b.png');
    session.removeCurrentSource();
    expect(session.sourceCount).toBe(1);
    expect(session.currentIndex).toBe(0);
    expect(await session.renderExport()).toMatchObject({ width: 300, height: 200 });

    session.clearSources();
    expect(session.hasSource).toBe(false);
    expect(() => session.renderPreview()).toThrow(/尚未导入/);
  });

  it('拼图：横向拼接首步为 collage，输出为各源图等比横向合成', async () => {
    const session = makeSession({ width: 600, height: 400 });
    session.addPixels(patternBuffer(400, 600), 'b.png');
    session.setCollage({ mode: 'h', gap: 0 });

    expect(session.exportPlanSummary().kinds[0]).toBe('collage');
    const out = await session.renderExport();
    /* 基准高 800：a 宽 (600/400)*800=1200，b 宽 (400/600)*800≈533.33 → 合计 1733。 */
    expect(out.height).toBe(800);
    expect(out.width).toBe(1200 + Math.round((400 / 600) * 800));
  });

  it('切图：忽略旋转，底图保持源尺寸（与 legacy 一致）', async () => {
    const session = makeSession({ width: 600, height: 400 });
    session.setGeometry({ ...session.state.geometry, rotate: 90 });
    expect(await session.renderExport()).toMatchObject({ width: 400, height: 600 });

    session.setCollage({ mode: 'cut', cutCols: 3, cutRows: 3 });
    expect(await session.renderExport()).toMatchObject({ width: 600, height: 400 });
  });

  it('切图：水印不进底图（分片要干净底图）', async () => {
    const session = makeSession({ width: 300, height: 200, withText: true });
    session.setCollage({ mode: 'cut', cutCols: 2, cutRows: 2 });
    const plain = await session.renderExport();
    session.setWatermarkText('不该出现的水印');
    const marked = await session.renderExport();
    expect(firstByteDiff(marked.data, plain.data)).toBe(-1);
  });

  it('边框：单图加边框使输出宽高各增加 2×边框宽', async () => {
    const session = makeSession({ width: 300, height: 200 });
    session.setCollage({ mode: 'single', borderWidth: 20, borderColor: '#000000' });
    expect(await session.renderExport()).toMatchObject({ width: 340, height: 240 });
  });

  it('缩略图：经内核重采样到长边上限，且源图换了缩略图跟着换', () => {
    const session = makeSession({ width: 1200, height: 800 });
    const first = session.thumbnailAt(0);
    expect(first).not.toBeNull();
    expect(Math.max(first?.width ?? 0, first?.height ?? 0)).toBeLessThanOrEqual(256);

    session.addPixels(patternBuffer(400, 900), 'b.png');
    const second = session.thumbnailAt(1);
    expect(second).not.toBeNull();
    expect(Math.max(second?.width ?? 0, second?.height ?? 0)).toBeLessThanOrEqual(256);
    /* 不同长宽方向 → 缩略图长边方向也不同。 */
    expect(second?.height).toBeGreaterThan(second?.width ?? Number.POSITIVE_INFINITY);
    expect(session.thumbnailAt(9)).toBeNull();
  });
});

describe('EditSession · 自动增强（序6）', () => {
  /**
   * 低对比 + 偏色：R 挤在 100..140，G/B 挤在 60..80。
   * 动态范围远未占满、且三通道均值不齐 —— 必然存在可增强空间，
   * 因此可以用它稳定断言"自动增强确实生效"，而不是碰运气。
   */
  function dullBuffer(w: number, h: number): PixelBuffer {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const t = i / Math.max(1, w * h - 1);
      data[i * 4] = 100 + Math.round(40 * t);
      data[i * 4 + 1] = 60 + Math.round(20 * t);
      data[i * 4 + 2] = 60 + Math.round(20 * t);
      data[i * 4 + 3] = 255;
    }
    return { width: w, height: h, data };
  }

  it('把色阶落成 op：排在调色之前、非破坏性、可撤销', async () => {
    const session = makeSession({ buffer: dullBuffer(200, 150), width: 200, height: 150 });
    const before = await session.renderExport();
    expect(session.hasLevels).toBe(false);

    expect(session.autoEnhance()).toBe(true);
    expect(session.hasLevels).toBe(true);
    /* 色阶是"底图之后的第一步"，排在基础调色之前（对齐 legacy 先烘 LUT 再 filter）。 */
    expect(session.exportPlanSummary().kinds).toEqual(['raster', 'levels']);
    expect(firstByteDiff(before.data, (await session.renderExport()).data)).not.toBe(-1);

    /* 非破坏性：撤销一步即回到原样 —— legacy 的自动增强做不到这一点。 */
    session.undo();
    expect(session.hasLevels).toBe(false);
    expect(firstByteDiff(before.data, (await session.renderExport()).data)).toBe(-1);
  });

  it('预览与导出同源：色阶阶段对两条路径一致', async () => {
    const session = makeSession({ buffer: dullBuffer(200, 150), width: 200, height: 150 });
    session.autoEnhance();
    expect(session.previewPlanSummary().kinds).toEqual(session.exportPlanSummary().kinds);
    /* 源图 200×150 小于预览长边 1400，两条路径尺寸相同 → 必须逐字节一致。 */
    const preview = await session.renderPreviewUncached();
    const exported = await session.renderExport();
    expect(firstByteDiff(preview.data, exported.data)).toBe(-1);
  });

  it('幂等：重复点「自动增强」不推重复 op', () => {
    const session = makeSession({ buffer: dullBuffer(200, 150), width: 200, height: 150 });
    expect(session.autoEnhance()).toBe(true);
    const len = docApi.historyLength(session.document);
    expect(session.autoEnhance()).toBe(false);
    expect(docApi.historyLength(session.document)).toBe(len);
  });

  it('resetLevels 后可以再次增强（不是单向开关）', () => {
    const session = makeSession({ buffer: dullBuffer(200, 150), width: 200, height: 150 });
    expect(session.autoEnhance()).toBe(true);
    session.resetLevels();
    expect(session.hasLevels).toBe(false);
    expect(session.autoEnhance()).toBe(true);
  });

  it('满动态范围的图：增强幅度受限（自动增强不会乱改）', () => {
    /* patternBuffer 的 R/G 是铺满 0..255 的斜坡 → 1% 分位只差几级，
     * 因此是"轻微收敛"而不是"硬拉到底"；增益也始终落在 legacy 的钳制区间内。 */
    const session = makeSession({ width: 200, height: 150 });
    session.autoEnhance();
    const l = session.state.levels;
    expect(l.r.lo).toBeLessThanOrEqual(4);
    expect(l.r.hi).toBeGreaterThanOrEqual(251);
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(l[ch].gain).toBeGreaterThanOrEqual(0.8);
      expect(l[ch].gain).toBeLessThanOrEqual(1.25);
    }
  });

  it('口语「自动增强」落地为 applied，而不是像 crop 那样挂 pending', () => {
    const session = makeSession({ buffer: dullBuffer(200, 150), width: 200, height: 150 });
    const out = session.applyKouyu('救废片');
    expect(out.applied.length).toBeGreaterThan(0);
    expect(out.pending).toHaveLength(0);
    expect(session.hasLevels).toBe(true);
  });
});

/* ─────────────────── #23 批量导出 / 切图分片 ZIP ─────────────────── */

/** 归档头部魔数 `PK\x03\x04` —— store 模式第一个 local file header 的签名。 */
function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

describe('EditSession · 批量导出 ZIP（#23）', () => {
  it('空库时明确拒绝，并说明原因（不是抛异常）', async () => {
    const session = new EditSession({ imageIo: createFakeImageIo() });
    expect(session.canBatchExport).toBe(false);
    expect(session.batchExportBlocker).toBe('还没有导入图片。');
    const out = await session.exportBatch('png', 90);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('还没有导入图片');
  });

  it('单图模式：条目数 === 源图数，且每条都等于"单独导出那张"（同一套渲染）', async () => {
    const session = makeSession({ width: 200, height: 150 });
    session.addPixels(patternBuffer(120, 90), 'second.png');

    const batch = await session.exportBatch('png', 90);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;

    expect(batch.sliced).toBe(false);
    expect(batch.entries).toHaveLength(2);
    expect(hasZipMagic(batch.zip)).toBe(true);

    /* 最强的一条：批量不是"另一套渲染"。逐张切到 current 单独导出，
     * 字节必须与归档里那一条完全相同 —— 否则批量导出的图跟用户看到的预览
     * 可能不一样，而这种偏差平时根本发现不了。 */
    const before = session.currentIndex;
    for (let i = 0; i < 2; i += 1) {
      session.setCurrentSource(i);
      const single = await session.exportBytes('png', 90);
      expect(firstByteDiff(single.bytes, batch.entries[i].bytes)).toBe(-1);
    }
    session.setCurrentSource(before);
  });

  it('单图模式：同名源图在归档内被去重（不会只活下来一张）', async () => {
    const session = makeSession({ width: 200, height: 150 });
    session.addPixels(patternBuffer(120, 90), 'sample.png'); // 与第一张同名
    const batch = await session.exportBatch('png', 90);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.entries.map((e) => e.name)).toEqual(['sample.png', 'sample-2.png']);
  });

  it('输出格式决定扩展名，且不沿用源文件扩展名', async () => {
    const session = makeSession({ width: 200, height: 150 });
    const png = await session.exportBatch('png', 90);
    const jpg = await session.exportBatch('jpeg', 90);
    expect(png.ok && png.entries[0].name).toBe('sample.png');
    expect(jpg.ok && jpg.entries[0].name).toBe('sample.jpg');
  });

  it('批量导出**不落历史**，也不改变当前选中张', async () => {
    const session = makeSession({ width: 200, height: 150 });
    session.addPixels(patternBuffer(120, 90), 'second.png');
    session.setCurrentSource(1);
    const len = docApi.historyLength(session.document);
    const cursor = session.document.cursor;

    await session.exportBatch('png', 90);

    expect(docApi.historyLength(session.document)).toBe(len);
    expect(session.document.cursor).toBe(cursor);
    expect(session.currentIndex).toBe(1);
  });

  it('切图模式：条目数 = cutCols × cutRows，命名带行列', async () => {
    const session = makeSession({ width: 300, height: 200 });
    session.setCollage({ mode: 'cut', cutCols: 3, cutRows: 2 });
    expect(session.cutSliceCount).toBe(6);

    const batch = await session.exportBatch('png', 90);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.sliced).toBe(true);
    expect(batch.entries.map((e) => e.name)).toEqual([
      'sample_r1c1.png',
      'sample_r1c2.png',
      'sample_r1c3.png',
      'sample_r2c1.png',
      'sample_r2c2.png',
      'sample_r2c3.png',
    ]);
    /* 300×200 切 3×2 → 每片 100×100。 */
    for (const entry of batch.entries) {
      expect([entry.width, entry.height]).toEqual([100, 100]);
    }
  });

  it('切图分片不落历史（切图模式无需逐张切 current）', async () => {
    const session = makeSession({ width: 300, height: 200 });
    session.setCollage({ mode: 'cut', cutCols: 2, cutRows: 2 });
    const len = docApi.historyLength(session.document);
    await session.exportBatch('png', 90);
    expect(docApi.historyLength(session.document)).toBe(len);
  });

  it('拼接模式（横/纵/网格）明确拒绝 —— 成品只有一张，不给重复图', async () => {
    const session = makeSession({ width: 300, height: 200 });
    session.addPixels(patternBuffer(150, 200), 'b.png');
    for (const mode of ['h', 'v', 'grid'] as const) {
      session.setCollage({ mode });
      expect(session.canBatchExport).toBe(false);
      const out = await session.exportBatch('png', 90);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toContain('拼接');
    }
  });

  it('maxEdge 生效：批量导出也受长边上限约束（与单张导出同源）', async () => {
    const session = makeSession({ width: 400, height: 300 });
    const batch = await session.exportBatch('png', 90, 200);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    // 400×300 长边压到 200 → 200×150
    expect([batch.entries[0].width, batch.entries[0].height]).toEqual([200, 150]);
    const single = await session.exportBytesDownscaled(200, 'png', 90);
    expect(firstByteDiff(single.bytes, batch.entries[0].bytes)).toBe(-1);
  });
});

/* 字节一样、指纹不一样：用来制造"挑错顺序"而不是"挑错文件"。 */
const TIFF_ORIENTATION_6_PADDED = Uint8Array.from([...TIFF_ORIENTATION_6, 0x00]);

describe('EditSession · 工程文件（序 2 · D14）', () => {
  /* 这一组的历史里带一条 setWatermark —— 文字阶段没有 TextRenderer 就渲染不出来
   * （内核明确失败，见上面 C4 那条），而本组要断的是"存了再开逐字节一致"，
   * 所以每个会话都得注入同一套假画布文字能力。 */
  const open = (): EditSession =>
    new EditSession({
      imageIo: stubImageIo(64, 48),
      textRenderer: createCanvasTextRenderer(new SurfacePool(createFakeSurfaceFactory())),
    });

  /** 一份"编辑过、又撤销了一步"的会话 + 它的工程文件文本。 */
  async function editedProject(): Promise<{ readonly from: EditSession; readonly text: string }> {
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'from-camera.jpg');
    from.setParams({ brightness: 60 });
    from.rotateClockwise();
    from.setWatermarkText('样片');
    from.undo(); // 留下一条重做分支：工程文件必须把它一起带走
    return { from, text: from.serializeProject() };
  }

  it('存了再开：观感逐字节一致、朝向不转第二次、历史停在原位', async () => {
    const { from, text } = await editedProject();
    const to = open();
    const res = await to.loadProject(text, [{ name: 'from-camera.jpg', bytes: TIFF_ORIENTATION_6 }]);

    expect(res.history).toBe(from.document.cursor);
    expect(res.total).toBe(from.document.ops.length);
    /* 同一条断言顺带钉住 X3：显示态仍是 48×64（存储态 64×48 + 朝向 6）。
     * 若打开工程时又转了一次，这里会翻回 64×48。 */
    expect(to.sourceInfo).toEqual(from.sourceInfo);
    expect([to.sourceInfo?.width, to.sourceInfo?.height]).toEqual([48, 64]);
    expect(
      firstByteDiff((await from.renderExport()).data, (await to.renderExport()).data),
    ).toBe(-1);

    from.redo();
    to.redo();
    expect(
      firstByteDiff((await from.renderExport()).data, (await to.renderExport()).data),
    ).toBe(-1);
  });

  it('源图对不上：整次打开失败、指名哪张，且不留半份会话', async () => {
    const { text } = await editedProject();
    const to = open();
    await expect(
      to.loadProject(text, [{ name: 'from-camera.jpg', bytes: Uint8Array.from([1, 2, 3]) }]),
    ).rejects.toThrow(/第 1 张[\s\S]*from-camera\.jpg[\s\S]*指纹/);
    /* 失败必须**什么都没改**：半份会话（像素换了、历史还是旧的）比开不了更糟。 */
    expect(to.hasSource).toBe(false);
    expect(to.document.ops).toEqual([]);
  });

  it('两张图挑反顺序不会蒙对：逐张按位置核对', async () => {
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    await from.addBytes(TIFF_ORIENTATION_6_PADDED, 'b.jpg');
    const text = from.serializeProject();

    const to = open();
    await expect(
      to.loadProject(text, [
        { name: 'b.jpg', bytes: TIFF_ORIENTATION_6_PADDED },
        { name: 'a.jpg', bytes: TIFF_ORIENTATION_6 },
      ]),
    ).rejects.toThrow(/第 1 张/);
    expect(to.hasSource).toBe(false); // 抛错前一个字段都没动：不存在"半份会话"
    const ok = open();
    await ok.loadProject(text, [
      { name: 'a.jpg', bytes: TIFF_ORIENTATION_6 },
      { name: 'b.jpg', bytes: TIFF_ORIENTATION_6_PADDED },
    ]);
    expect(ok.state.current).toBe(from.state.current);
    expect(firstByteDiff((await from.renderExport()).data, (await ok.renderExport()).data)).toBe(-1);
  });

  it('指纹与字节数进文档（只用于核对，渲染不读）', async () => {
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'a.jpg', undefined, 'D:/photos/a.jpg');
    const ref = from.state.sources[0];
    expect(ref?.bytes).toBe(TIFF_ORIENTATION_6.length);
    expect(ref?.fingerprint).toBe(docApi.sourceFingerprint(TIFF_ORIENTATION_6));
    expect(ref?.handle).toBe('D:/photos/a.jpg');
  });

  it('工程文件里没有像素：文本小、无 base64 长串、含引用字段', async () => {
    const { text } = await editedProject();
    expect(text).not.toMatch(/[A-Za-z0-9+/]{64,}/);
    expect(text).not.toMatch(/"pixels"/);
    expect(text.length).toBeLessThan(4_000);
    expect(text).toContain('"fingerprint"');
  });

  it('工程侧没记指纹时按尺寸核对：能开，且不说自己"核过指纹"', async () => {
    const from = new EditSession({ imageIo: stubImageIo(16, 8) });
    from.importPixels(patternBuffer(16, 8), 'p.png'); // 直接喂像素：没有字节可考
    const text = from.serializeProject();
    expect(text).not.toContain('"fingerprint"');

    const to = new EditSession({ imageIo: stubImageIo(16, 8) });
    const res = await to.loadProject(text, [{ name: 'p.png', bytes: Uint8Array.from([7, 7, 7]) }]);
    expect(res.sources[0]?.bytes).toBe(3); // 这次是真读了字节的
    expect(res.sources[0]?.exifLine).toBe('无 EXIF');
  });

  /* D4 的对话框顺序：主进程要先知道"要挑几张、什么顺序"，才能弹选择框。 */
  it('projectNeeds 只读地把工程的源图清单报出来，不动当前会话', async () => {
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    await from.addBytes(TIFF_ORIENTATION_6_PADDED, 'b.jpg');
    from.setParams({ brightness: 30 });
    from.undo();
    const text = from.serializeProject();

    const busy = open(); // 一个已经在使用中的会话
    await busy.importBytes(Uint8Array.from([9, 8, 7]), 'busy.jpg');
    const before = busy.serializeProject();

    const needs = busy.projectNeeds(text);
    expect(needs.sources.map((s) => s.name)).toEqual(['a.jpg', 'b.jpg']);
    /* 报的是**显示态**宽高（与 UI 一致），不是容器里的存储态：两张都带朝向 6，
     * 替身给的却是 64×48 —— 记成存储态会在这里露馅。 */
    expect(needs.sources.map((s) => [s.width, s.height])).toEqual([
      [48, 64],
      [48, 64],
    ]);
    expect(needs.history).toBe(from.document.cursor);
    expect(needs.total).toBe(from.document.ops.length);
    expect(busy.serializeProject()).toBe(before); // 只读：问一句不能把会话改了
  });

  it('坏工程文件在 projectNeeds 就抛，不必等到挑完图', () => {
    const busy = open();
    expect(() => busy.projectNeeds('{"format":"photo.doc/v1"}')).toThrow();
    expect(() => busy.projectNeeds('不是 JSON')).toThrow();
    expect(busy.hasSource).toBe(false);
  });
});

/* #4 自定义预设：存 → 列表 → 套 → 逐字节一致，且"重启后仍可用"= 文本往返。 */
describe('EditSession · 自定义预设（序 2 · #4）', () => {
  const open = () => new EditSession({ imageIo: stubImageIo(64, 48) });

  /** 一个带色阶的会话：暖调滑杆 + 自动增强，覆盖 params 与 levels 两条通道。 */
  async function styled() {
    const session = open();
    await session.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    session.setParams({ brightness: 70, contrast: 120, saturate: 140, warm: 25 });
    expect(session.autoEnhance()).toBe(true); // 没产生色阶的话，这条测试就在测空话
    return session;
  }

  it('当前观感落成预设：参数与色阶都带走，没碰过的字段不占位', async () => {
    const session = await styled();
    const preset = session.currentAsPreset('warm', '暖调');
    expect(preset.key).toBe('warm');
    expect(preset.name).toBe('暖调');
    expect(preset.params).toEqual(session.state.params);
    /* 自动增强的色阶是观感的一部分。丢掉它，"套用我的预设"就会把层次塌回去 ——
     * 用户看到的是"预设没生效"，实际是保存时偷了工。 */
    expect(preset.levels).toBeDefined();
    expect(preset.curves).toBeUndefined(); // 没碰曲线就不该在文件里写一份中性副本
    expect(preset.bands).toBeUndefined();
  });

  it('存文本 → 读回 → 套到另一会话：与来源逐字节一致（重启后仍可用）', async () => {
    const from = await styled();
    const text = docApi.serializeSharedPreset(from.currentAsPreset('warm', '暖调'));
    const to = open();
    await to.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    to.applySharedPreset(docApi.parseSharedPreset(text));
    expect(
      firstByteDiff((await from.renderExport()).data, (await to.renderExport()).data),
    ).toBe(-1);
  });

  it('自定义预设不查内置表：与内置 key 撞名也不会借到内置的效果', async () => {
    const builtinKey = presets.BUILTIN_PRESETS[0].key;
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    from.applyPreset(builtinKey); // 内置路径：存的是一个 key，渲染时查表

    const preset = docApi.parseSharedPreset(
      docApi.serializeSharedPreset({
        format: docApi.PRESET_FORMAT,
        key: builtinKey,
        name: '我自己调的',
        params: { ...from.state.params, brightness: 70, warm: 40 },
      }),
    );
    const to = open();
    await to.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    to.applySharedPreset(preset);

    expect(to.state.params).toEqual(preset.params);
    expect(firstByteDiff((await from.renderExport()).data, (await to.renderExport()).data)).not.toBe(
      -1,
    );
    /* 落地的是展开后的 op，而不是一个会被内置表劫持的 applyPreset。 */
    expect(to.document.ops.some((op) => op.k === 'applyPreset')).toBe(false);
  });

  it('套用自定义预设后强度滑杆自动禁用：presetKey 为空，与 #2 同一口径', async () => {
    const from = await styled();
    const preset = docApi.parseSharedPreset(
      docApi.serializeSharedPreset(from.currentAsPreset('warm', '暖调')),
    );
    const to = open();
    await to.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    to.applySharedPreset(preset);
    expect(to.state.presetKey).toBeNull();
    to.setPresetIntensity(0.5); // 没有基准：合法空操作，不许把参数偷偷改一半
    expect(to.state.params).toEqual(preset.params);
  });

  it('纯滑杆预设是一步撤销；带色阶的是两步（复合步骤不存在，不假装）', async () => {
    const from = open();
    await from.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    const before = from.document.cursor;
    from.applySharedPreset(
      docApi.parseSharedPreset(
        docApi.serializeSharedPreset({
          format: docApi.PRESET_FORMAT,
          key: 'k',
          name: 'K',
          params: from.state.params,
        }),
      ),
    );
    expect(from.document.cursor - before).toBe(1); // 只有 setAdjust

    const styledSession = await styled();
    const preset = docApi.parseSharedPreset(
      docApi.serializeSharedPreset(styledSession.currentAsPreset('warm', '暖调')),
    );
    const to = open();
    await to.importBytes(TIFF_ORIENTATION_6, 'a.jpg');
    const cursor = to.document.cursor;
    to.applySharedPreset(preset);
    expect(to.document.cursor - cursor).toBe(2); // setAdjust + setLevels
  });

  it('预设文件名来自展示名，但不能决定写到哪个目录（主进程按同一形状把关）', () => {
    for (const name of ['', '../../evil', 'a"b*c', '   ', '中文 预设', 'x'.repeat(200)]) {
      const file = docApi.presetFileName(name);
      expect(file.endsWith(docApi.PRESET_FILE_SUFFIX)).toBe(true);
      /* 主干里一个分隔符/点也不许剩 —— 剩下的话 `../../evil` 就能写到上级目录。
       * 主进程 `presetTarget()` 用同一套判据再筛一遍：它读不到内核（D11）。 */
      expect(file.slice(0, -docApi.PRESET_FILE_SUFFIX.length)).not.toMatch(/[\\/:*?"<>|.]/);
      expect(file.length).toBeLessThanOrEqual(160); // 与主进程的上限同一口径
    }
  });
});
