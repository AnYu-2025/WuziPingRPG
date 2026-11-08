/**
 * 图片编解码外壳的测试。
 *
 * 重点不在"能不能编码"（那由 Electron 冒烟里的真实 Canvas 覆盖），
 * 而在**坏输入必须吵、不能静默出错图**这一原则是否真的落地：
 * 不认识的 magic、刻意不支持的格式、非法 quality，都要有明确行为。
 *
 * 另一条同等重要的边界（序3）：**JPEG 归内核解，一次都不许落到平台解码器上**，
 * 否则桌面与 CLI 对同一份字节就不可能逐字节同源。光看像素分不出"谁解的"，
 * 所以这里用 `createRecordingImageIo` 把"问没问过平台"也记下来。
 */
import { describe, expect, it } from 'vitest';
import { decodeJpeg } from '@photo/io';
import { flatColorJpeg } from '@photo/io/testing';
import {
  createFakeImageIo,
  createRecordingImageIo,
  patternBuffer,
  readFakeHeader,
  solidBuffer,
} from './canvas-fakes.js';
import { firstByteDiff } from './bytes.js';
import { rejectReason, sniffImageMime, type ImageFormatName } from './image-io.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00]);
const BMP = new Uint8Array([0x42, 0x4d, 0x36, 0x00]);
const UNKNOWN = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

describe('格式探测只看 magic bytes，不看扩展名', () => {
  it('PNG / JPEG / BMP 被正确识别', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(BMP)).toBe('image/bmp');
  });

  it('认不出来时返回 null，而不是猜一个', () => {
    expect(sniffImageMime(UNKNOWN)).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });
});

describe('刻意不支持的格式必须给出人话原因', () => {
  it('GIF 与 WebP 被拒，且原因里带上格式名与出路', () => {
    const gif = rejectReason(GIF);
    expect(gif).not.toBeNull();
    expect(gif).toContain('GIF');
    expect(gif).toContain('PNG');

    const webp = rejectReason(WEBP);
    expect(webp).not.toBeNull();
    expect(webp).toContain('WebP');
  });

  it('PNG / JPEG 不在拒绝名单里', () => {
    expect(rejectReason(PNG)).toBeNull();
    expect(rejectReason(JPEG)).toBeNull();
  });
});

describe('decode 的坏输入处理', () => {
  it('magic 不认识时报错，不返回黑图', async () => {
    const io = createFakeImageIo();
    await expect(io.decode(UNKNOWN)).rejects.toThrow(/无法识别/);
  });

  it('认得出 magic 但不在支持清单内时，报错说明收到的是什么', async () => {
    const io = createFakeImageIo();
    await expect(io.decode(BMP)).rejects.toThrow(/只解 PNG \/ JPEG.*image\/bmp/);
  });

  it('GIF 走拒绝名单，报的是中文原因而不是"不支持"三个字', async () => {
    const io = createFakeImageIo();
    await expect(io.decode(GIF)).rejects.toThrow(/GIF.*PNG 或 JPEG/);
  });

  it('显式传入的 mime 优先于 sniff（调用方已知信息来源）', async () => {
    const io = createFakeImageIo();
    const src = solidBuffer(4, 4, 10, 20, 30);
    const bytes = await io.encode(src, 'png', 90);
    /* 容器 magic 是替身自己的 'PFAK'，sniff 认不出来 —— 因此必须靠 mime。 */
    await expect(io.decode(bytes)).rejects.toThrow(/无法识别/);
    const decoded = await io.decode(bytes, 'image/png');
    expect(decoded).toMatchObject({ width: 4, height: 4 });
    expect(decoded.data).toEqual(src.data);
  });
});

describe('JPEG 解码归内核，平台解码器只在旁边看着（P6E 的 X1 地基）', () => {
  /** 把夹具的帧头从 baseline（SOF0）改成渐进式（SOF2）：只动那一个字节。 */
  function toProgressive(bytes: Uint8Array): Uint8Array {
    const out = Uint8Array.from(bytes);
    for (let i = 1; i < out.length - 1; i += 1) {
      if (out[i] === 0xff && out[i + 1] === 0xc0) {
        out[i + 1] = 0xc2;
        return out;
      }
    }
    throw new Error('夹具里找不到 SOF0 标记，改不出渐进式');
  }

  it('真 baseline JPEG 由内核解出：与 decodeJpeg 逐字节一致，且没问平台', async () => {
    const { io, platformDecodes } = createRecordingImageIo();
    const bytes = flatColorJpeg(24, 24);
    const decoded = await io.decode(bytes);

    expect([decoded.width, decoded.height]).toEqual([24, 24]);
    expect(firstByteDiff(decoded.data, decodeJpeg(bytes).data)).toBe(-1);
    /* "两边一致"单独不够 —— 两边都是同一份代码时，一起错也看不出来。
     * 这四个值是 (Y,Cb,Cr)=(129,576,-224) 走 JFIF 公式手算出来的，
     * 且 B 通道已被 255 削顶：削顶有没有发生，这里也一并钉住。 */
    expect(Array.from(decoded.data.subarray(0, 4))).toEqual([90, 124, 255, 255]);
    expect(platformDecodes).toEqual([]);
  });

  it('接上外置解码器（桌面上的渲染 Worker）后：JPEG 交给它，像素仍逐字节一致', async () => {
    const { io, platformDecodes, offThreadDecodes } = createRecordingImageIo(async (bytes) =>
      decodeJpeg(bytes),
    );
    const bytes = flatColorJpeg(24, 24);
    const decoded = await io.decode(bytes);

    /* 搬的是线程，不是实现 —— 交给外置解码器之后，X1 那条逐字节断言必须照样成立。 */
    expect(offThreadDecodes).toEqual([bytes.byteLength]);
    expect(platformDecodes).toEqual([]);
    expect(firstByteDiff(decoded.data, decodeJpeg(bytes).data)).toBe(-1);
  });

  it('只有 JPEG 走外置解码器：PNG 一次都不许搭车', async () => {
    const { io, offThreadDecodes } = createRecordingImageIo(async (bytes) => decodeJpeg(bytes));
    const bytes = await io.encode(solidBuffer(4, 4, 1, 2, 3), 'png', 90);
    await io.decode(bytes, 'image/png');

    /* PNG 在浏览器里本来就是异步的原生解码，塞给 Worker 只会多一次 96 MB 搬运。
     * 这条断言防的是"整个 decode 都推过去"这种顺手扩面。 */
    expect(offThreadDecodes).toEqual([]);
  });

  it('渐进式 JPEG：明确说是哪一种，并且不许偷偷退回平台解码器', async () => {
    const { io, platformDecodes, offThreadDecodes } = createRecordingImageIo(async (bytes) =>
      decodeJpeg(bytes),
    );
    await expect(io.decode(toProgressive(flatColorJpeg(24, 24)))).rejects.toThrow(/渐进式/);
    /* 退回平台 = 这一张在桌面上"能开"，在 CLI 上报错 —— 跨端同源当场作废，
     * 而且没人会说出来。所以这条断言的重点不是报错，是 `[]`。 */
    expect(platformDecodes).toEqual([]);
    /* 报错也得从**外置那条**传回来：若这里为 0，说明解码悄悄退回主线程做了，
     * 序3.5 要消除的正是那份占用。 */
    expect(offThreadDecodes.length).toBe(1);
  });

  it('PNG 仍然交给平台解码器（内核没有 PNG 解码器，别顺手把这条也改了）', async () => {
    const { io, platformDecodes } = createRecordingImageIo();
    const bytes = await io.encode(solidBuffer(4, 4, 1, 2, 3), 'png', 90);
    await io.decode(bytes, 'image/png');
    expect(platformDecodes).toEqual([bytes.byteLength]);
  });
});

describe('encode', () => {
  it('往返保持尺寸与像素', async () => {
    const io = createFakeImageIo();
    const src = patternBuffer(37, 19);
    const bytes = await io.encode(src, 'png', 100);
    const back = await io.decode(bytes, 'image/png');
    expect(back.width).toBe(37);
    expect(back.height).toBe(19);
    expect(back.data).toEqual(src.data);
  });

  it('quality 是 0..100 的百分比，落到平台编码器时归一化到 0..1', async () => {
    const io = createFakeImageIo();
    const src = solidBuffer(8, 8, 1, 2, 3);

    expect(readFakeHeader(await io.encode(src, 'jpeg', 90))?.quality).toBeCloseTo(0.9, 3);
    /* 越界要被钳住，而不是把 250 原样传下去。 */
    expect(readFakeHeader(await io.encode(src, 'jpeg', 250))?.quality).toBe(1);
    expect(readFakeHeader(await io.encode(src, 'jpeg', -5))?.quality).toBe(0);
    /* 非有限值回落到默认画质 90。 */
    expect(readFakeHeader(await io.encode(src, 'jpeg', Number.NaN))?.quality).toBeCloseTo(0.9, 3);
  });

  it('格式与 mime 一起传给编码器', async () => {
    const io = createFakeImageIo();
    const src = solidBuffer(4, 4, 0, 0, 0);
    expect(readFakeHeader(await io.encode(src, 'png', 90))?.mime).toBe('image/png');
    expect(readFakeHeader(await io.encode(src, 'jpeg', 90))?.mime).toBe('image/jpeg');
  });

  it('外壳声称不支持的格式直接报错', async () => {
    const io = createFakeImageIo();
    const src = solidBuffer(4, 4, 0, 0, 0);
    /* 模拟调用方绕过 UI 直接传了一个不在 formats 里的格式。 */
    const bogus = 'webp' as unknown as ImageFormatName;
    await expect(io.encode(src, bogus)).rejects.toThrow(/未知输出格式.*webp/);
  });

  it('声称支持的格式清单与实际 mime 表一致', () => {
    const io = createFakeImageIo();
    expect([...io.formats]).toEqual(['png', 'jpeg']);
  });
});
