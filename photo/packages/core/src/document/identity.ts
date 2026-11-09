/**
 * 源图身份 —— 工程文件的"这张文件还是当初那张吗"。
 *
 * ── 为什么必须有这一层 ────────────────────────────────────────────────
 * 工程文件**只存引用不存像素**（D14），于是"打开工程"必然要重新拿到那些图。
 * 而引用会漂移：文件被覆盖、被移走、用户在多选对话框里挑错了顺序、
 * 或者干脆挑了同名但内容不同的另一张。任何一种情况下，若照原样渲染，
 * 用户看到的是一张**用错图拼出来的成品**，而且没有任何提示。
 *
 * 这与本仓历来最忌讳的"静默碎图"是同一类失败，只是更隐蔽：图是真的、
 * 参数是对的、观感却来自另一张照片。所以 D4 的口径是
 * **「不符就指名道姓地报，宁可开不了，也不静默用错的图渲染」**。
 *
 * ── 指纹不是密码学哈希 ────────────────────────────────────────────────
 * FNV-1a（两个不同 offset basis 拼成 64 bit）足以区分"同一台机器上被换过的
 * 文件"，成本是一趟线性扫描、零依赖、三端（Node / 浏览器 / Worker）逐位一致。
 * 它**不**防恶意伪造 —— 这里要防的是拿错图，不是防攻击者，别把它当完整性凭证用。
 */
import type { SourceRef } from './types.js';

function fnv1a32(bytes: Uint8Array, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * 算一份容器字节的指纹。
 *
 * 长度**参与**哈希（把 length 的字节混进初始状态）：只按内容哈希会让
 * "追加了尾巴的同前缀文件"与"截断了的文件"更容易撞在一起，长度是最便宜的一层区分。
 */
export function sourceFingerprint(bytes: Uint8Array): string {
  const mixed = [
    (bytes.length & 0xff) ^ 0xa5,
    (bytes.length >>> 8) & 0xff,
    (bytes.length >>> 16) & 0xff,
    (bytes.length >>> 24) & 0xff,
  ];
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const m of mixed) {
    a = Math.imul(a ^ m, 0x01000193) >>> 0;
    b = Math.imul(b ^ m, 0x811c9dc5) >>> 0;
  }
  return hex32(fnv1a32(bytes, a)) + hex32(fnv1a32(bytes, b));
}

/** 指纹（含"没算过"）：null = 这份来源压根没读过容器字节。 */
export type SourceFingerprint = string | null;

/**
 * 外壳实测到的源图事实。
 *
 * `width/height` 必须是**显示态**（朝向已置换进像素，D13），与 `SourceRef` 同口径 ——
 * 否则每一次核对都会把带 EXIF 旋转的照片误报成漂移。
 */
export interface SourceProbe {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly fingerprint: SourceFingerprint;
}

export type SourceVerdictStatus = 'ok' | 'drifted' | 'missing';

/** 核对时**依据什么**判定：指纹 > 字节数 > 尺寸。写进报告，别说假话。 */
export type VerificationBasis = 'fingerprint' | 'bytes' | 'size';

export interface SourceVerdict {
  /** 工程文件里记的名字。 */
  readonly expected: string;
  /** 实际拿到的名字；缺图为 null。 */
  readonly observed: string | null;
  readonly status: SourceVerdictStatus;
  readonly basis: VerificationBasis | null;
  readonly detail: string;
}

export interface IdentityReport {
  readonly ok: boolean;
  readonly verdicts: readonly SourceVerdict[];
  /** 人话问题清单（只含有问题的条目），可直接进状态条或错误提示。 */
  readonly problems: readonly string[];
}

function sizeOf(s: { readonly width: number; readonly height: number }): string {
  return `${s.width}×${s.height}`;
}

function sameSize(a: SourceRef, b: SourceProbe): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * 按**顺序**逐张核对工程记录的源图与外壳实测到的源图。
 *
 * 为什么按顺序而不是按名字或指纹配对：配对规则一旦"聪明"起来，就会出现
 * "第 3 张其实匹配到了第 5 个文件"这种用户完全看不出来的错位。按顺序 + 逐张验身，
 * 挑错顺序会立刻表现为指纹不符并指名两张，这是能自我纠错的行为。
 */
export function verifySourceIdentity(
  expected: readonly SourceRef[],
  observed: readonly SourceProbe[],
): IdentityReport {
  const verdicts: SourceVerdict[] = [];
  const problems: string[] = [];

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const act = observed[i];
    const where = `第 ${i + 1} 张`;

    if (act === undefined) {
      verdicts.push({
        expected: exp.name,
        observed: null,
        status: 'missing',
        basis: null,
        detail: `${where}「${exp.name}」没有对应的文件`,
      });
      problems.push(verdicts[verdicts.length - 1].detail);
      continue;
    }

    const notes: string[] = [];
    if (exp.name !== act.name) notes.push(`工程里叫「${exp.name}」`);

    let basis: VerificationBasis | null;
    let mismatch: string | null = null;
    if (exp.fingerprint !== undefined) {
      basis = 'fingerprint';
      if (act.fingerprint === null) {
        mismatch = '这份文件没算出指纹，无从核对';
      } else if (act.fingerprint.toLowerCase() !== exp.fingerprint.toLowerCase()) {
        mismatch = `内容已变（指纹 ${exp.fingerprint} → ${act.fingerprint}）`;
      }
    } else if (exp.bytes !== undefined) {
      basis = 'bytes';
      if (act.bytes !== exp.bytes) mismatch = `字节数已变（${exp.bytes} → ${act.bytes}）`;
    } else {
      basis = 'size';
    }
    /* 尺寸这层无论如何都要比：它既是指纹缺失时的兜底，也是"内容没变但朝向处理变了"
     * 的唯一线索（同一份字节、显示态宽高不同 => 解码链路不一致）。 */
    if (mismatch === null && !sameSize(exp, act)) {
      mismatch = `尺寸已变（${sizeOf(exp)} → ${sizeOf(act)}）`;
    }

    const detail = [notes.join('、'), mismatch].filter((s) => s !== '').join(' ');
    const status: SourceVerdictStatus = mismatch === null ? 'ok' : 'drifted';
    verdicts.push({
      expected: exp.name,
      observed: act.name,
      status,
      basis,
      detail: status === 'ok' ? detail : `${where}「${act.name}」${detail}`,
    });
    if (status === 'drifted') problems.push(verdicts[verdicts.length - 1].detail);
  }

  if (observed.length > expected.length) {
    const extra = observed
      .slice(expected.length)
      .map((p) => `「${p.name}」`)
      .join('、');
    problems.push(`多出的文件没有归属：${extra}（工程只记录 ${expected.length} 张）`);
  }

  return { ok: problems.length === 0, verdicts, problems };
}
