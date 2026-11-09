import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { baseName, stripExtension } from './paths.js';
import type { RenderInput } from './render.js';

/** 唯一的真实文件读写处。命名规则在 paths.ts，落盘只在这里。 */

export function readTextFile(filePath: string): string {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) throw new Error(`文件不存在：${filePath}`);
  return readFileSync(absolute, 'utf8');
}

export function readInput(filePath: string): RenderInput {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) throw new Error('文件不存在。');
  const stats = statSync(absolute);
  if (!stats.isFile()) throw new Error('不是普通文件。');
  const name = baseName(absolute);
  return {
    name,
    baseName: stripExtension(name),
    bytes: new Uint8Array(readFileSync(absolute)),
  };
}

/** 写出结果，返回绝对路径。父目录不存在会自动创建。 */
export function writeOutput(filePath: string, bytes: Uint8Array): string {
  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return absolute;
}
