/**
 * 路径与输出命名的**纯字符串**处理。
 *
 * 为什么不直接用 node:path：命名规则是 CLI 的**业务逻辑**（要测、要跨平台稳定），
 * 而真正的文件读写只有 node-io.ts 一处。把"叫什么名字"与"落到哪块磁盘"分开，
 * 命名逻辑就变成可离线测试的纯函数。
 *
 * 同时兼容 `\` 与 `/` 两种分隔符 —— Windows 上两条路都可能出现。
 */

const SEPARATORS = /[\\/]/;

/** 取路径最后一段（文件名）。 */
export function baseName(filePath: string): string {
  const parts = filePath.split(SEPARATORS);
  return parts[parts.length - 1] ?? filePath;
}

/** 去掉最后一个扩展名（含点）。`.gitignore` 这类以点开头的名字保持原样。 */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** 取扩展名（小写、不含点）。无扩展名返回空串。 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** 生成输出文件名：`base.ext` 或 `base_suffix.ext`。 */
export function outputFileName(base: string, suffix: string, format: string): string {
  const trimmed = suffix.trim();
  return trimmed === '' ? `${base}.${format}` : `${base}_${trimmed}.${format}`;
}

/** 把输出文件名拼到目录后面。保留目录原本使用的分隔符风格。 */
export function joinOutput(dir: string, fileName: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  /* '.' 与 '' 都表示"就是当前目录"，此时不加前缀 ——
   * 否则报告里会出现 "./a.png" 这种噪音。 */
  if (trimmed === '' || trimmed === '.') return fileName;
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${trimmed}${separator}${fileName}`;
}

/**
 * 判断两个路径是否指向同一文件（用于"会不会覆盖输入"的护栏）。
 * Windows 文件名不区分大小写，这里统一小写比较。
 */
export function sameFilePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

/**
 * 找出"输出会覆盖输入"的冲突项。
 *
 * 这是一道**上线前的护栏**：`photo render a.png` 在不给 `--suffix` / `--out`
 * 的情况下会把 a.png 覆盖掉。批处理里这种事故是不可逆的，
 * 所以宁可整体拒绝执行（逐条报告冲突），也不做"部分成功"。
 */
export function findOutputCollisions(
  inputs: readonly string[],
  outputs: readonly string[],
): readonly string[] {
  const inputSet = new Set(inputs.map((p) => p.replace(/\\/g, '/').toLowerCase()));
  return outputs.filter((out) => inputSet.has(out.replace(/\\/g, '/').toLowerCase()));
}
