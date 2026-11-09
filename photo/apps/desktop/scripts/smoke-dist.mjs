#!/usr/bin/env node
/**
 * 打包产物冒烟 —— 用**打包后的可执行文件**跑同一条自检。
 *
 * ── 为什么不能只跑 `npm run smoke` ────────────────────────────────
 * `npm run smoke` 跑的是**源码树**里的 Electron（`electron .`），
 * 它读的是各包的构建产物、走的是源码的目录结构。
 * 而打包产物把内核挪到了 `resources/core` / `resources/io`、页面被塞进 asar ——
 * **挂载路径完全换了一套**。这段差异恰恰是"开发机能跑、装完白屏"的高发区，
 * 只有拿**真的产物**跑一遍才能验到（P6-d §2.4 的 P2）。
 *
 * ── 报告从哪里读（两条路，缺一不可）──────────────────────────────
 *   1. `win-unpacked/<productName>.exe`（产品名从 package.json 读）：stdout 正常，按 `SMOKE_REPORT ` 前缀切。
 *   2. 免安装单文件 `<productName> <ver>.exe`：NSIS 包装器**不透传子进程 stdout**
 *      （包装器自己立刻以 0 退出），stdout 那条路是死的。
 *      故让应用额外把同一份 JSON 写进 `PHOTO_SMOKE_REPORT_FILE` 指定的文件，
 *      这里轮询该文件 —— 与包装器是否等待子进程无关。
 *
 * 用法：
 *   npm run smoke:dist -w @photo/desktop
 *   npm run smoke:dist -w @photo/desktop -- "<某条 exe 的路径>"
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const releaseDir = path.join(appRoot, 'release');

/* 产物文件名是 electron-builder 按 `build.productName` 生成的 —— 这里**必须**从同一处
 * 读，不能另写一份：改了产品名而忘改这里，`smoke:dist` 就找不到 exe。
 * （找不到会明着报错而不是静默跳过，所以不会假绿，但会白跑一次。） */
const PRODUCT = JSON.parse(
  readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
).build.productName;
const TIMEOUT_MS = 180_000;
const MARKER = 'SMOKE_REPORT ';

/** 找打包产物：优先解包目录里的主程序（stdout 可用，确定性最好）。 */
function findExecutable() {
  const explicit = process.argv[2];
  if (typeof explicit === 'string' && explicit !== '') {
    return existsSync(explicit) ? path.resolve(explicit) : null;
  }

  const unpacked = path.join(releaseDir, 'win-unpacked', `${PRODUCT}.exe`);
  if (existsSync(unpacked)) return unpacked;

  if (!existsSync(releaseDir)) return null;
  const portable = readdirSync(releaseDir).find(
    (name) =>
      name.toLowerCase().endsWith('.exe') &&
      name.startsWith(PRODUCT) &&
      !name.includes('Setup'),
  );
  return portable === undefined ? null : path.join(releaseDir, portable);
}

const exe = findExecutable();
if (exe === null) {
  console.error('找不到打包产物。请先跑：npm run dist -w @photo/desktop');
  console.error(`（预期位置：${path.join(releaseDir, 'win-unpacked', `${PRODUCT}.exe`)}）`);
  process.exit(2);
}

console.log(`产物冒烟：${exe}`);

const reportFile = path.join(os.tmpdir(), `photo-smoke-${process.pid}.json`);
/* 清掉可能存在的旧报告。删不掉也不影响（沙箱可能拦删除），写的时候会覆盖。 */
try {
  rmSync(reportFile, { force: true });
} catch { /* ignore */ }

const env = { ...process.env, PHOTO_SMOKE_REPORT_FILE: reportFile };
/* 与源码冒烟同理：有些机器/CI 镜像会设 ELECTRON_RUN_AS_NODE，
 * 设了之后 Electron 退化成纯 Node —— 不建窗口、不跑 preload。 */
delete env.ELECTRON_RUN_AS_NODE;
/* 打包应用不支持 NODE_OPTIONS，留着只会刷一条 ERROR 噪声。 */
delete env.NODE_OPTIONS;

const child = spawn(exe, ['--smoke'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let stdout = '';
let done = false;

child.stdout.on('data', (chunk) => {
  stdout += String(chunk);
  tryStdout();
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function finish(rawJson) {
  if (done) return;
  done = true;
  clearInterval(poll);
  clearTimeout(killer);
  try {
    rmSync(reportFile, { force: true });
  } catch { /* ignore */ }
  if (!child.killed) child.kill();

  let report;
  try {
    report = JSON.parse(rawJson);
  } catch {
    console.error('冒烟报告不是合法 JSON。');
    process.exit(1);
  }

  const failed = report.checks.filter((check) => !check.ok);
  console.log('');
  console.log(`产物冒烟：${report.checks.length - failed.length}/${report.checks.length} 通过`);
  for (const check of failed) {
    console.log(`  ✗ ${check.name}${check.detail === undefined ? '' : ` — ${check.detail}`}`);
  }
  console.log(report.ok ? '结果：全部通过' : '结果：存在失败项');
  process.exit(report.ok ? 0 : 1);
}

function tryStdout() {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(MARKER));
  if (line !== undefined) finish(line.slice(MARKER.length));
}

/* 单文件产物不吐 stdout：轮询报告文件，直到超时。 */
const poll = setInterval(() => {
  if (done) return;
  tryStdout();
  if (existsSync(reportFile)) {
    try {
      finish(readFileSync(reportFile, 'utf8'));
    } catch {
      /* 正在写，下一轮再读。 */
    }
  }
}, 300);

const killer = setTimeout(() => {
  if (done) return;
  done = true;
  clearInterval(poll);
  console.error(`产物冒烟超时（${TIMEOUT_MS} ms）—— 未收到报告。`);
  if (!child.killed) child.kill();
  process.exit(1);
}, TIMEOUT_MS);
killer.unref();

child.on('error', (error) => {
  console.error(`无法启动产物：${error.message}`);
  process.exit(1);
});
