/**
 * 序 2 回归 —— D4 源图身份核验（工程文件的"这张还是那张吗"）。
 *
 * 这条能力存在的唯一理由：**不静默用错的图渲染**。所以断言的重心不在
 * "能不能算出指纹"，而在**不符时是否指名道姓**——报不出是哪张，等于没报。
 */

import { describe, expect, it } from 'vitest';

import { sourceFingerprint, verifySourceIdentity, type SourceProbe } from './identity.js';
import type { SourceRef } from './types.js';

const FP_A = sourceFingerprint(new Uint8Array([1, 2, 3, 4]));
const FP_B = sourceFingerprint(new Uint8Array([1, 2, 3, 5]));

function ref(over: Partial<SourceRef> & { name: string }): SourceRef {
  return {
    id: `src-${over.name}`,
    width: 48,
    height: 64,
    bytes: 4096,
    fingerprint: FP_A,
    ...over,
  };
}

function probe(over: Partial<SourceProbe> & { name: string }): SourceProbe {
  return { width: 48, height: 64, bytes: 4096, fingerprint: FP_A, ...over };
}

describe('identity · 指纹', () => {
  it('同字节同指纹，改一个字节就不一样', () => {
    expect(sourceFingerprint(new Uint8Array([9, 8, 7]))).toBe(sourceFingerprint(new Uint8Array([9, 8, 7])));
    expect(FP_A).not.toBe(FP_B);
  });

  it('截断与追加都能看出来（长度参与哈希）', () => {
    const full = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const short = full.slice(0, 3);
    const longer = new Uint8Array([...full, 7]);
    const fps = new Set([
      sourceFingerprint(full),
      sourceFingerprint(short),
      sourceFingerprint(longer),
      sourceFingerprint(new Uint8Array(0)),
    ]);
    expect(fps.size).toBe(4);
  });

  it('指纹是 16 位十六进制串（与 sanitizeSources 的形状校验同口径）', () => {
    expect(FP_A).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('identity · D4 漂移要报得出是哪张', () => {
  it('顺序与内容都对：ok，problems 为空', () => {
    const report = verifySourceIdentity([ref({ name: 'a.jpg' })], [probe({ name: 'a.jpg' })]);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.verdicts[0]?.basis).toBe('fingerprint');
  });

  it('文件被覆盖过：drifted，两条指纹都写进话里', () => {
    const report = verifySourceIdentity(
      [ref({ name: 'a.jpg' }), ref({ name: 'b.jpg' })],
      [probe({ name: 'a.jpg' }), probe({ name: 'b.jpg', fingerprint: FP_B })],
    );
    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('第 2 张');
    expect(report.problems[0]).toContain('b.jpg');
    expect(report.problems[0]).toContain(FP_A);
    expect(report.problems[0]).toContain(FP_B);
    expect(report.verdicts[0]?.status).toBe('ok'); // 第 1 张没问题，不冤枉
  });

  it('挑错顺序：两张一起报，不静默错位', () => {
    const report = verifySourceIdentity(
      [ref({ name: 'a.jpg', fingerprint: FP_A }), ref({ name: 'b.jpg', fingerprint: FP_B })],
      [probe({ name: 'b.jpg', fingerprint: FP_B }), probe({ name: 'a.jpg', fingerprint: FP_A })],
    );
    expect(report.ok).toBe(false);
    expect(report.problems).toHaveLength(2);
    expect(report.problems[0]).toContain('第 1 张');
    expect(report.problems[0]).toContain('内容已变');
  });

  it('少选一张：missing 指名缺的是谁', () => {
    const report = verifySourceIdentity(
      [ref({ name: 'a.jpg' }), ref({ name: 'c.jpg' })],
      [probe({ name: 'a.jpg' })],
    );
    expect(report.ok).toBe(false);
    expect(report.verdicts[1]?.status).toBe('missing');
    expect(report.problems[0]).toContain('c.jpg');
  });

  it('多选：多出来的文件要说，不能默默丢掉', () => {
    const report = verifySourceIdentity(
      [ref({ name: 'a.jpg' })],
      [probe({ name: 'a.jpg' }), probe({ name: 'extra.jpg' })],
    );
    expect(report.ok).toBe(false);
    expect(report.problems.at(-1)).toContain('extra.jpg');
  });

  it('工程里没记指纹：退化为按字节数核对，并如实标出依据', () => {
    const noFp = verifySourceIdentity(
      [{ id: 'a', name: 'a.jpg', width: 48, height: 64, bytes: 4096 }],
      [probe({ name: 'a.jpg', bytes: 4096 })],
    );
    expect(noFp.ok).toBe(true);
    expect(noFp.verdicts[0]?.basis).toBe('bytes');

    const drift = verifySourceIdentity(
      [{ id: 'a', name: 'a.jpg', width: 48, height: 64, bytes: 4096 }],
      [probe({ name: 'a.jpg', bytes: 2048 })],
    );
    expect(drift.ok).toBe(false);
    expect(drift.problems[0]).toContain('字节数已变');
  });

  it('连字节数都没有：只按尺寸核对（指纹缺失时"朝向处理变了"的唯一线索）', () => {
    const onlySize = verifySourceIdentity(
      [{ id: 'a', name: 'a.jpg', width: 48, height: 64 }],
      [probe({ name: 'a.jpg', width: 64, height: 48 })],
    );
    expect(onlySize.verdicts[0]?.basis).toBe('size');
    expect(onlySize.problems[0]).toContain('尺寸已变（48×64 → 64×48）');
  });

  it('实测方没算出指纹：说"无从核对"，而不是当作通过', () => {
    const report = verifySourceIdentity([ref({ name: 'a.jpg' })], [probe({ name: 'a.jpg', fingerprint: null })]);
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toContain('没算出指纹');
  });

  it('改名不算漂移，但要在 detail 里说清楚', () => {
    const report = verifySourceIdentity([ref({ name: 'a.jpg' })], [probe({ name: 'a(1).jpg' })]);
    expect(report.ok).toBe(true);
    expect(report.verdicts[0]?.detail).toContain('工程里叫「a.jpg」');
  });
});
