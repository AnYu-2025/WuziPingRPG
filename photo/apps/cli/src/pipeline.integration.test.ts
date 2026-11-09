/**
 * 端到端整链测试 —— 「同一份内核，换一个壳」的像素级证据。
 *
 * 断的不是某个函数，而是**一整条链路**：
 *
 *   配方 JSON → validateRecipe 归一化 → BMP 解码 → 内核 buildPlan / executePlan
 *            → PNG 编码 → PNG 解码
 *
 * 两端是两套毫不相干的编解码实现：BMP 是 @photo/io 手写的零依赖实现，
 * PNG 是 Node 壳基于 zlib 的实现；夹在中间的内核，与桌面端是同一份代码。
 * 这条链跑通，才真正说明「壳可以换，像素不能变」。
 *
 * 为什么必须经由 validateRecipe 而不能自己拼 Op 对象：
 *   内核的 op 语义是**整值设置**，缺失字段不会报错、会直接变成 NaN
 *   （例如稀疏的 setGeometry 少一个 straighten，仿射角就成了 NaN，
 *     整张图碎成一片）。防线只有两处：TS 类型（挡住类型化调用方）
 *   与**无类型输入边界处的归一化**（JSON 就从这儿进来）。
 *   所以测试从 JSON 进，才是用户真正走的那条路。
 */
import { describe, expect, it } from 'vitest';
import { decodeJpeg, encodeBmp, zipStore } from '@photo/io';
import { flatColorJpeg, flatGray, synthJpeg } from '@photo/io/testing';
import { createNodeRegistry } from './node-registry.js';
import { SUPPORTED_FORMATS } from './args.js';
import {
  infoOne,
  renderOne,
  runBatch,
  zipEntriesOf,
  type BatchJob,
  type RenderInput,
  type RenderRequest,
  type RenderOutcome,
} from './render.js';
import { validateRecipe, type Recipe } from './recipe.js';

const registry = createNodeRegistry();

interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** 手写 JSON 配方 → 走真实归一化路径。写错一个字这里就会抛。 */
function recipeFrom(ops: unknown): Recipe {
  const parsed = validateRecipe({ name: 'integration', ops });
  if (!parsed.ok) throw new Error(`配方归一化失败：${parsed.error}`);
  return parsed.recipe;
}

/**
 * 造源图：每个像素的颜色由坐标唯一决定（r = x+1，g = y+1），
 * 于是"某个像素跑到哪去了"可以逐点核对，而不是只能看统计量。
 */
function makeSource(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = x + 1;
      data[i + 1] = y + 1;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** 走完整条链：BMP 字节进，渲染结果 PNG 字节出，再解码成像素。 */
function runPipeline(source: Raster, ops: unknown): { outcome: RenderOutcome; decoded: Raster } {
  const input: RenderInput = { name: 'src.bmp', baseName: 'src', bytes: encodeBmp(source) };
  const request: RenderRequest = {
    recipe: recipeFrom(ops),
    /* maxEdge 0 = 保持原尺寸；withText false = 不画水印，
     * 免得文字栅格化把"几何是否无损"这个问题搅浑。 */
    target: { kind: 'export', maxEdge: 0, withText: false },
    format: 'png',
    quality: 90,
    outputName: 'out.png',
  };

  const outcome = renderOne(input, request, registry);
  if (!outcome.ok) return { outcome, decoded: { width: 0, height: 0, data: new Uint8ClampedArray(0) } };
  return { outcome, decoded: registry.decode(outcome.bytes) };
}

/** 像素多重集（直方图）—— 无损几何变换下必须逐项守恒。 */
function histogram(image: Raster): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < image.data.length; i += 4) {
    const key = `${image.data[i]},${image.data[i + 1]},${image.data[i + 2]},${image.data[i + 3]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function pixelAt(image: Raster, x: number, y: number): readonly number[] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

describe('整链：配方 JSON → 内核 → PNG → 解码', () => {
  it('边界契约：稀疏 setGeometry 会被补全成完整结构（少一个字段就会碎图）', () => {
    const recipe = recipeFrom([{ k: 'setGeometry', value: { rotate: 90 } }]);
    const op = recipe.ops[0];

    expect(op?.k).toBe('setGeometry');
    if (op?.k !== 'setGeometry') return;
    /* 这四个字段必须全部落地为具体值。缺 straighten 时
     * plan.ts 会算出 NaN 仿射角 —— 静默碎图，且不抛任何错。 */
    expect(op.value).toEqual({ rotate: 90, flipH: false, flipV: false, straighten: 0 });
  });

  it('无操作时逐字节等于源（两套编解码都是无损的）', () => {
    const source = makeSource(9, 5);
    const { outcome, decoded } = runPipeline(source, []);

    expect(outcome.ok).toBe(true);
    expect(decoded.width).toBe(9);
    expect(decoded.height).toBe(5);

    /* 源全不透明 → PNG 走 RGB（colorType 2）省掉 alpha 通道，
     * 解码时补回 255。除这一点外必须逐字节相同。 */
    expect([...decoded.data]).toEqual([...source.data]);
  });

  it('旋转 90°：尺寸互换，像素多重集完全守恒', () => {
    const source = makeSource(8, 4);
    const { outcome, decoded } = runPipeline(source, [{ k: 'setGeometry', value: { rotate: 90 } }]);

    expect(outcome.ok).toBe(true);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(8);
    /* 多重集守恒 = 没有任何像素被重采样污染（双线性插值会引入新颜色）。 */
    expect(histogram(decoded)).toEqual(histogram(source));
  });

  it('旋转 90° 的像素映射，恰好吻合顺时针 / 逆时针中的一种', () => {
    const source = makeSource(8, 4);
    const { decoded } = runPipeline(source, [{ k: 'setGeometry', value: { rotate: 90 } }]);
    const { width: w, height: h } = source;

    /* 两种可能的朝向（不预设内核用哪种，只要求它自洽）：
     *   顺时针：out(x, y) = src(y, h-1-x)
     *   逆时针：out(x, y) = src(w-1-y, x)  */
    const matches = (map: (x: number, y: number) => readonly number[]): boolean => {
      for (let y = 0; y < decoded.height; y += 1) {
        for (let x = 0; x < decoded.width; x += 1) {
          const expected = map(x, y);
          const actual = pixelAt(decoded, x, y);
          if (actual[0] !== expected[0] || actual[1] !== expected[1]) return false;
        }
      }
      return true;
    };

    const clockwise = matches((x, y) => pixelAt(source, y, h - 1 - x));
    const counterClockwise = matches((x, y) => pixelAt(source, w - 1 - y, x));

    expect(clockwise !== counterClockwise).toBe(true);
  });

  it('加白边：尺寸外扩，四角是边框色，内部像素多重集不受影响', () => {
    const source = makeSource(8, 4);
    const border = 3;
    const { outcome, decoded } = runPipeline(source, [
      {
        k: 'setCollage',
        value: { mode: 'single', borderWidth: border, borderColor: '#ffffff' },
      },
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.outputSize).toEqual({ w: 8 + border * 2, h: 4 + border * 2 });

    expect(pixelAt(decoded, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(decoded, decoded.width - 1, decoded.height - 1)).toEqual([255, 255, 255, 255]);

    /* 内部区域（去掉边框）的直方图必须与源一致 —— 边框只"加"像素，不改内容。 */
    const inner: Raster = {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.width * source.height * 4),
    };
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const from = ((y + border) * decoded.width + (x + border)) * 4;
        const to = (y * source.width + x) * 4;
        for (let c = 0; c < 4; c += 1) inner.data[to + c] = decoded.data[from + c];
      }
    }
    expect(histogram(inner)).toEqual(histogram(source));
  });
});

/* ────────────────── 批量渲染 → ZIP 归档（对应 CLI --zip） ────────────────── */

interface ZipMember {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * 极简 ZIP 回读（只认 store 模式）。
 *
 * 与 io 的写手走**相反**的推导方向：从文件尾部 EOCD 倒推中央目录，
 * 再按相对偏移找 local header —— 于是"偏移算错"这类 bug 不会两边互相抵消。
 */
function parseZipMembers(zip: Uint8Array): ZipMember[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const members: ZipMember[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const name = Array.from(zip.slice(at + 46, at + 46 + nameLen))
      .map((c) => String.fromCharCode(c))
      .join('');
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    members.push({ name, bytes: zip.slice(dataStart, dataStart + size) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

describe('批量渲染 → ZIP 归档（对应 CLI --zip）', () => {
  const ops = [{ k: 'setAdjust', value: { contrast: 130 } }];

  const batchOptions = () => ({
    recipe: recipeFrom(ops),
    target: { kind: 'export' as const, maxEdge: 0, withText: false },
    format: 'png',
    quality: 90,
  });

  /** 每个作业都渲染同一张 40×30 源图，输出路径刻意**同名**以验证去重。 */
  function job(displayName: string, outputName: string): BatchJob {
    return {
      name: displayName,
      input: { name: 'src.bmp', baseName: 'src', bytes: encodeBmp(makeSource(40, 30)) },
      error: null,
      outputName,
    };
  }

  it('归档内只留文件名（不带 out/ 前缀），重名自动去重', () => {
    const result = runBatch(
      [job('a/src.bmp', 'out/src.png'), job('b/src.bmp', 'out/src.png')],
      batchOptions(),
      registry,
    );
    expect(result.okCount).toBe(2);

    const entries = zipEntriesOf(result.outcomes);
    expect(entries.map((e) => e.name)).toEqual(['src.png', 'src-2.png']);

    const members = parseZipMembers(zipStore(entries));
    expect(members.map((m) => m.name)).toEqual(['src.png', 'src-2.png']);
  });

  it('归档里的字节与渲染结果完全一致，且每条都能重新解码成 PNG', () => {
    const result = runBatch([job('a/src.bmp', 'out/src.png')], batchOptions(), registry);
    const entries = zipEntriesOf(result.outcomes);
    const members = parseZipMembers(zipStore(entries));

    expect(sameBytes(members[0].bytes, entries[0].bytes)).toBe(true);
    const decoded = registry.decode(members[0].bytes);
    expect([decoded.width, decoded.height]).toEqual([40, 30]);
  });

  it('失败项不进归档（归档里不该出现空条目）', () => {
    const broken: BatchJob = {
      name: 'broken.bmp',
      input: null,
      error: '文件不是普通文件。',
      outputName: 'out/broken.png',
    };
    const result = runBatch([job('a/src.bmp', 'out/src.png'), broken], batchOptions(), registry);
    expect(result.failCount).toBe(1);

    const entries = zipEntriesOf(result.outcomes);
    expect(entries.map((e) => e.name)).toEqual(['src.png']);
    expect(parseZipMembers(zipStore(entries))).toHaveLength(1);
  });
});

/* ────────────── 真 JPEG 进无头链路（P6E-PLAN §3.4 条件 C1 / C3） ──────────────
 *
 * 输入字节由 `@photo/io/testing` 的夹具写出（仓库里没有 JPEG 样本）。
 * 因此这一组断言证的是"**CLI 这条链路吃得下 baseline JPEG 且不改像素**"，
 * 不证"我们的解码器与真相机一致" —— 后者要跟浏览器解码器比对，在桌面冒烟里（序3-e）。
 */

describe('整链：baseline JPEG 进 → PNG 出（C1）', () => {
  const photo = flatColorJpeg(20, 20);

  const input = (name: string, bytes: Uint8Array): RenderInput => ({
    name,
    baseName: name.replace(/\.[^.]+$/, ''),
    bytes,
  });

  const request = (outputName: string, format = 'png'): RenderRequest => ({
    recipe: recipeFrom([]),
    target: { kind: 'export', maxEdge: 0, withText: false },
    format,
    quality: 90,
    outputName,
  });

  it('注册表清单与实际能力一致：jpeg 读得进，但不在导出格式里', () => {
    expect(registry.list().map((c) => c.format)).toEqual(['bmp', 'ppm', 'jpeg', 'png']);
    expect(registry.resolve(photo)?.format).toBe('jpeg');
    expect(registry.decode(photo).width).toBe(20);
    /* 导出侧必须仍然只承诺 png / bmp / ppm —— 注册了 JPEG 解码不等于能写 JPEG。 */
    expect(SUPPORTED_FORMATS).toEqual(['png', 'bmp', 'ppm']);
    expect(() => registry.encode('jpeg', { width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow(
      /不支持 JPEG 编码/,
    );
  });

  it('JPEG → 内核 → PNG：像素与"直接解码"逐字节一致，常数色三元组对上手算值', () => {
    const direct = decodeJpeg(photo);
    const outcome = renderOne(input('photo.jpg', photo), request('photo.png'), registry);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const decoded = registry.decode(outcome.bytes);
    expect([decoded.width, decoded.height]).toEqual([20, 20]);
    expect([...decoded.data]).toEqual([...direct.data]);
    /* (90,124,255) 是 Y129/Cb200/Cr100 手算出来的结果（含 B 通道截幅）：
     * 从码流到 PNG 一路都保持它，说明色彩变换与上采样没在链路某处被换掉。 */
    expect(pixelAt(decoded, 0, 0)).toEqual([90, 124, 255, 255]);
    expect(pixelAt(decoded, 19, 19)).toEqual([90, 124, 255, 255]);
  });

  it('info 报的是真格式与真尺寸，不再"探测到 jpeg 却没有解码器"', () => {
    const info = infoOne(input('photo.jpg', photo), registry);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.info.format).toBe('jpeg');
    expect([info.info.width, info.info.height]).toEqual([20, 20]);
    expect([info.info.storedWidth, info.info.storedHeight]).toEqual([20, 20]);
  });

  it('渐进式 JPEG 在 CLI 出口给人话原因，不产出半张图', () => {
    const progressive = synthJpeg({ ...flatGray(8, 8, 8), sofMarker: 0xc2 });
    const outcome = renderOne(input('p.jpg', progressive), request('p.png'), registry);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/渐进式/);
  });
});
