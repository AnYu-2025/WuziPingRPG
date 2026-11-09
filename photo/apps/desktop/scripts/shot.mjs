#!/usr/bin/env node
/**
 * 截图启动器 —— 把正式页面加载起来截一张 PNG，用于人工查看界面效果。
 *
 * 与 smoke.mjs 同样要清掉 `ELECTRON_RUN_AS_NODE`：那个环境变量会让 electron
 * 退化成纯 Node，窗口不建、截图无从谈起，而且失败方式毫无指向性。
 *
 * 用法：`npm run shot -w @photo/desktop -- tmp/ui.png`
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const outPath = path.resolve(appRoot, process.argv[2] ?? 'tmp/ui.png');
mkdirSync(path.dirname(outPath), { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(require('electron'), [appRoot, '--shot', outPath], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.on('close', (code) => {
  console.log(code === 0 ? `已保存截图：${outPath}` : `截图失败（退出码 ${code}）`);
  process.exit(code ?? 1);
});
