#!/usr/bin/env node
/**
 * 冒烟启动器 —— 拉起 Electron、跑自检、把结果原样转达给 CI。
 *
 * 为什么要包一层 Node，而不是直接写 `"smoke": "electron . --smoke"`：
 *
 *   1. **必须清掉 `ELECTRON_RUN_AS_NODE`**。这台机器（以及不少 CI 镜像）会设这个
 *      环境变量，一旦设了，`electron` 就退化成"纯 Node"，窗口不建、preload 不跑，
 *      冒烟会以"超时未上报"这种毫无指向性的方式失败。这里显式删掉它。
 *   2. 退出码要能从子进程直传到 `npm run smoke`，并且要在**收到报告**的基础上
 *      判定，而不是盲信退出码。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

/** `require('electron')` 在 Node 侧返回的是**二进制路径**，不是模块。 */
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [appRoot, '--smoke'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += String(chunk);
});
/* 渲染进程与主进程的日志（含逐条检查）直接透传，方便排查。 */
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.on('error', (error) => {
  console.error(`无法启动 Electron：${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  const marker = 'SMOKE_REPORT ';
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(marker));

  if (line === undefined) {
    console.error('未收到冒烟报告 —— 进程提前退出或根本无法启动。');
    console.error(`子进程退出码：${code}`);
    process.exit(1);
  }

  const report = JSON.parse(line.slice(marker.length));
  const failed = report.checks.filter((check) => !check.ok);
  console.log('');
  console.log(`冒烟自检：${report.checks.length - failed.length}/${report.checks.length} 通过`);
  for (const check of failed) {
    console.log(`  ✗ ${check.name}${check.detail === undefined ? '' : ` — ${check.detail}`}`);
  }
  console.log(report.ok ? '结果：全部通过' : '结果：存在失败项');
  process.exit(report.ok ? 0 : 1);
});
