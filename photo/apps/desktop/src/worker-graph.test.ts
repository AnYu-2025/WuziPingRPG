/**
 * Worker 模块图的**裸说明符闸门**。
 *
 * ── 这条测试是为什么写的 ──────────────────────────────────────────
 * import map 只作用于文档，**不作用于 Worker**。所以在 Worker 的模块图里，
 * `@photo/io` 这类裸名会在脚本加载阶段直接解析失败 —— 表现是渲染链
 * 静默退回主线程（窗口里一条红条），而**所有单测全绿**：vitest 用别名把
 * 裸名映射到源码，于是这条错误路径在测试里根本不存在。
 *
 * P6-e 序3 就是这么炸的：`image-io.ts` 新加了一句 `from '@photo/io'`，
 * 而它经 `shell-adapter.ts` 落在 Worker 图里。632 个测试一个都没红。
 *
 * ── 闸门怎么算过 ─────────────────────────────────────────────────
 * 从 `worker/render-worker.ts` 出发沿**静态导入**走完整个图，允许三种说明符：
 *   1. 相对路径（继续在图里走）；
 *   2. `app://...` 绝对 URL（运行期由自定义协议直接给产物，无需映射）；
 *   3. **纯类型**的裸名导入（`import type ... from '@photo/core'`）—— 它会被
 *      tsc 整条擦掉，产物里没有这句，因此不构成运行期解析。
 * 只要出现一条**值级别**的裸名导入，本测试就红。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** 去掉块注释与行注释：本项目的注释里满是 `@photo/core` 这种字样，不能当代码算。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

interface ImportSite {
  readonly specifier: string;
  /** 整条语句是否只导入类型（值层面等于不存在）。 */
  readonly typeOnly: boolean;
  readonly line: number;
}

/** 一条 `import` / `export ... from` 语句的捕获。 */
const IMPORT_RE =
  /(^|\n)[ \t]*(import|export)[ \t]+([^;]*?[ \t]from[ \t])?['"]([^'"]+)['"]/g;

function importsOf(text: string): ImportSite[] {
  const clean = stripComments(text);
  const sites: ImportSite[] = [];
  for (const match of clean.matchAll(IMPORT_RE)) {
    const clause = match[3] ?? '';
    const specifier = match[4];
    const line = clean.slice(0, match.index).split('\n').length;
    /* `import type { ... } from` 或 `export type * from`：整条是类型。 */
    const keyword = match[2];
    const head = `${keyword} ${clause}`.trimStart();
    let typeOnly = /^(?:import|export)\s+type\b/.test(head);
    if (!typeOnly && clause !== '') {
      /* 具名导入里每个绑定都带 `type` 前缀，同样不产生运行时代码。 */
      const braces = /\{([^}]*)\}/.exec(clause);
      if (braces !== null) {
        const parts = braces[1].split(',').map((p) => p.trim()).filter((p) => p !== '');
        typeOnly = parts.length > 0 && parts.every((p) => p.startsWith('type '));
      }
    }
    sites.push({ specifier, typeOnly, line });
  }
  return sites;
}

/** `./surface.js` 这类写法在源码里指向 `surface.ts`。 */
function resolveRelative(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const asTs = base.replace(/\.js$/, '.ts');
  if (existsSync(asTs)) return asTs;
  const indexDir = path.join(base, 'index.ts');
  return existsSync(indexDir) ? indexDir : asTs;
}

function walk(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const site of importsOf(readFileSync(file, 'utf8'))) {
      if (!site.specifier.startsWith('.')) continue;
      queue.push(resolveRelative(file, site.specifier));
    }
  }
  return seen;
}

const ENTRY = path.join(SRC_ROOT, 'worker', 'render-worker.ts');

describe('Worker 模块图里不许出现值级别的裸说明符（import map 进不了 Worker）', () => {
  const graph = walk(ENTRY);
  const files = [...graph].map((f) => path.relative(SRC_ROOT, f).replace(/\\/g, '/'));

  it('图确实走起来了（防止测试退化成"什么都没扫到"的假绿）', () => {
    expect(files).toContain('worker/render-worker.ts');
    expect(files).toContain('worker/engine.ts');
    /* 序3 炸的那条链：render-worker → shell-adapter → image-io。 */
    expect(files).toContain('shell-adapter.ts');
    expect(files).toContain('image-io.ts');
    expect(files.length).toBeGreaterThan(4);
  });

  it('每个裸名导入都必须是纯类型；值导入只能走 app:// 或相对路径', () => {
    const offenders: string[] = [];
    for (const file of graph) {
      for (const site of importsOf(readFileSync(file, 'utf8'))) {
        const bare =
          !site.specifier.startsWith('.') &&
          !site.specifier.startsWith('app://') &&
          !site.specifier.startsWith('node:');
        if (bare && !site.typeOnly) {
          offenders.push(`${path.relative(SRC_ROOT, file)}:${site.line} → '${site.specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('注释里提到的裸名不会被误判为导入（闸门自身的正确性）', () => {
    /* image-io.ts 的注释正文明确写着 `@photo/io`，而它的导入已改成 app://。
     * 若注释剥离失效，这一条会连带上一条一起红 —— 两向都钉住。 */
    const sites = importsOf(readFileSync(path.join(SRC_ROOT, 'image-io.ts'), 'utf8'));
    expect(sites.some((s) => s.specifier === 'app://io/index.js')).toBe(true);
    expect(sites.some((s) => s.specifier === '@photo/io')).toBe(false);
  });
});
