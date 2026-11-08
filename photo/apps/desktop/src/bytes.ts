/**
 * 字节级比较 —— 本项目反复出现的断言形态。
 *
 * "逐字节一致"是这个项目的核心不变量之一（预览 = 导出、缓存复用 = 全量重算、
 * 无操作 = 源图）。它出现得太频繁，以至于值得有一个**早退的**实现：
 * `Array.prototype.every` 或深比较在大缓冲上要么慢，要么失败时打印几十万个数。
 * 这里返回首个不同字节的下标 —— 失败信息本身就是最好的线索。
 */

/** 首个不同字节的下标；完全相同返回 -1；长度不同返回 -2。 */
export function firstByteDiff(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** 两个缓冲是否逐字节相同。 */
export function bytesEqual(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): boolean {
  return firstByteDiff(a, b) === -1;
}

/** 检查字节前缀（magic bytes）。 */
export function hasMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}
