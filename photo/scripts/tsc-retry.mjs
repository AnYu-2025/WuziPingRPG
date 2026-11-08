// scripts/tsc-retry.mjs
//
// 为什么需要这个包装：tsc 在 Windows 上会被杀软的实时防护抢文件。
//
// 现象：构建过程中随机有 1~3 个文件报
//     error TS5033: Could not write file '.../foo.js':
//                   open '.../foo.js.map': Access is denied.
// 每次报的文件都不一样，重跑就好 —— 典型的外部进程在 tsc 写盘的瞬间
// 打开了同一个文件（本次定位为 Microsoft Defender 的 MsMpEng.exe 实时扫描）。
// 由于 ANY_FAILURE 都会让构建以非 0 退出，`npm run verify` 几乎必然红灯，
// 但它红的原因跟代码毫无关系。
//
// 选择"重试"而不是"改 system"，原因有三：
//   1. 不需要管理员权限 —— 加 Defender 排除项要提权，且改的是机器级安全配置，
//      不该由一个构建脚本悄悄做掉；
//   2. 对 CI 同样有效 —— GitHub Actions 的 Windows runner 也有实时防护；
//   3. 但只重试 TS5033 —— 真实的类型错误必须立刻失败，绝不重试掩盖。
//
// 用法：`node ../../scripts/tsc-retry.mjs tsconfig.build.json [...tsc 参数]`
// 首个参数若不以 `-` 开头会自动补 `-p`：否则 tsc 会把它当成**文件列表**，
// 报 TS5112 "tsconfig.json is present but will not be loaded"。

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

/** 写盘冲突的重试上限。经验值：抖动率约 1~3 文件/次，3 次内基本必过。 */
const MAX_ATTEMPTS = 5;

/** 只认这一个错误码：写文件失败。它是环境抖动，不是代码问题。 */
const RETRYABLE_CODE = 'TS5033';

const require = createRequire(import.meta.url);

/**
 * 解析 tsc 的真实入口。
 * npm workspaces 会把 typescript 提升到根 node_modules，从本脚本（仓库根）解析即可命中。
 */
function resolveTsc() {
  return require.resolve('typescript/bin/tsc');
}

/**
 * 从 tsc 输出里抽出所有错误码，例如 `error TS5033:` → `'TS5033'`。
 */
function collectErrorCodes(output) {
  const codes = new Set();
  // 同时兼容 `error TS5033:` 与 watch 模式的 `error TS5033 ...`。
  for (const m of output.matchAll(/error\s+TS(\d+)/g)) {
    codes.add(`TS${m[1]}`);
  }
  return codes;
}

/**
 * 是否**只**有可重试错误。
 * 混了其它错误码（真实类型错误）就不重试 —— 重试一百次也不会变成绿色。
 */
function isOnlyRetryable(codes) {
  return codes.size > 0 && [...codes].every((code) => code === RETRYABLE_CODE);
}

function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    process.stderr.write('用法: node scripts/tsc-retry.mjs <tsconfig 路径> [...tsc 参数]\n');
    process.exit(2);
  }
  const args = rawArgs[0].startsWith('-') ? rawArgs : ['-p', ...rawArgs];

  let tscPath;
  try {
    tscPath = resolveTsc();
  } catch (err) {
    process.stderr.write(`找不到 typescript，请先 npm install：${err.message}\n`);
    process.exit(2);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // stdio: 'pipe' —— 必须捕获输出才能判断错误码，不能让它直接打到终端。
    const result = spawnSync(process.execPath, [tscPath, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    if (result.status === 0) {
      // 成功：原样透出输出，保持跟直接调 tsc 一样的观感。
      if (output.trim()) process.stdout.write(output);
      return;
    }

    const codes = collectErrorCodes(output);

    if (isOnlyRetryable(codes) && attempt < MAX_ATTEMPTS) {
      // 反馈要走 stderr：stdout 留给真正的编译器诊断，免得污染 CI 的结构化日志。
      process.stderr.write(
        `[tsc-retry] 第 ${attempt} 次构建遇到 ${codes.size ? 'TS5033 写盘冲突' : '写盘失败'}` +
          `（多为杀软实时扫描抢文件），重试 ${attempt + 1}/${MAX_ATTEMPTS}...\n`,
      );
      continue;
    }

    // 不可重试（真实错误），或已用尽重试次数：原样输出，把失败交回上层。
    process.stderr.write(output);
    process.exit(result.status ?? 1);
  }

  // 理论上到不了这里（上面最后一次会 exit），留个兜底避免静默成功。
  process.stderr.write(`[tsc-retry] 已重试 ${MAX_ATTEMPTS} 次仍未通过，放弃。\n`);
  process.exit(1);
}

main();
