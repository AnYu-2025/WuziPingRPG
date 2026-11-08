#!/usr/bin/env node
/**
 * 真实性能实测编排器 —— 一张 2400 万像素的"照片感"大图，跑完整管线。
 *
 * 存在的理由：此前所有性能结论都建立在合成小图上（128×128、320×240），
 * 而"24MP 导出要几秒、峰值几 MB"是商业级产品**必须能回答**的问题。
 * 本脚本把答案变成可复现的数字，而不是感觉。
 *
 * 每个场景都是一个独立子进程（见 bench-one.mjs 里对 maxRSS 的说明）。
 *
 * 用法：
 *   node scripts/bench.mjs [--width 6000] [--height 4000]
 */
import { existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const tmp = fileURLToPath(new URL('../tmp/', import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1] ?? fallback) : fallback;
};
const WIDTH = flag('--width', 6000);
const HEIGHT = flag('--height', 4000);

const PHOTO = `${tmp}photo-${WIDTH}x${HEIGHT}.ppm`;
const HEAVY_RECIPE = `${cliRoot}examples/bench-heavy.json`;
const RESULT_JSON = `${tmp}bench-result.json`;

/* ─────────────────────── 1. 准备素材 ─────────────────────── */

/* PPM P6 的头只有十几个字节（"P6\n6000 4000\n255\n"），所以下界取纯像素字节数即可。 */
const wantBytes = WIDTH * HEIGHT * 3;
if (!existsSync(PHOTO) || statSync(PHOTO).size < wantBytes) {
  process.stderr.write(`生成 ${WIDTH}×${HEIGHT} 测试图…\n`);
  const made = spawnSync(process.execPath, [`${here}make-photo.mjs`, String(WIDTH), String(HEIGHT), PHOTO], {
    stdio: 'inherit',
  });
  if (made.status !== 0) process.exit(made.status ?? 1);
}

/* ─────────────────────── 2. 场景表 ─────────────────────── */

const COLD_SCENARIOS = [
  { label: 'A 原尺寸 · 无配方', recipe: null, longEdge: 0, format: 'png' },
  { label: 'B 长边1920 · 无配方', recipe: null, longEdge: 1920, format: 'png' },
  { label: 'C 原尺寸 · 重配方', recipe: HEAVY_RECIPE, longEdge: 0, format: 'png' },
  { label: 'D 长边1920 · 重配方', recipe: HEAVY_RECIPE, longEdge: 1920, format: 'png' },
  { label: 'E 原尺寸 · 重配方 · BMP', recipe: HEAVY_RECIPE, longEdge: 0, format: 'bmp' },
];

const CACHE_SCENARIOS = [
  /* F/G 现在测的是"小内存机器"：给的是**内存预算**（与导出准入同一个数），
   * 快照张数由它推导 —— 预算吃紧时自适应会把缓存降级成"不缓存"，
   * 那是**故意的**：宁可慢，也不越线（M2）。 */
  { label: 'F 内存预算 128MB', budgetMb: 128 },
  { label: 'G 内存预算 1024MB', budgetMb: 1024 },
  /* H = 真实默认路径（不传预算，内核用准入那个 2 GB）。这一条受复用门管。 */
  { label: 'H 默认预算（自适应）', budgetMb: null },
];

const CODEC_FORMATS = ['png', 'bmp', 'ppm'];

function runOne(args) {
  const run = spawnSync(process.execPath, [`${here}bench-one.mjs`, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`子进程失败（${run.status}）：${run.stderr || run.stdout}`);
  }
  const line = run.stdout.trim().split('\n').pop();
  return JSON.parse(line);
}

/* 进度走 stderr：整套场景在 24MP 下要跑几分钟，把报告攒到最后会让人
 * 误以为卡死。这里每完成一个场景就报一行。 */
const progress = (text) => process.stderr.write(`${text}\n`);

/* ─────────────────────── 3. 执行 ─────────────────────── */

const cold = COLD_SCENARIOS.map((s) => {
  progress(`[冷启动] ${s.label} …`);
  const result = { label: s.label, ...runOne([PHOTO, s.recipe ?? '-', String(s.longEdge), s.format]) };
  progress(
    `          → ${result.totalMs.toFixed(0)} ms（峰值 ${result.peakRssMB.toFixed(0)} MB，` +
      `输出 ${(result.outputBytes / 1048576).toFixed(1)} MB）`,
  );
  return result;
});

const cache = CACHE_SCENARIOS.map((s) => {
  progress(`[缓存复用] ${s.label} …`);
  const result = {
    label: s.label,
    ...runOne([
      PHOTO,
      HEAVY_RECIPE,
      '0',
      'png',
      '--mode',
      'cache',
      ...(s.budgetMb === null ? [] : ['--budget-mb', String(s.budgetMb)]),
    ]),
  };
  progress(
    `          → 复用 ${result.secondReused}/${result.stageCount} 阶段，` +
      `${result.firstMs.toFixed(0)} ms → ${result.secondMs.toFixed(0)} ms`,
  );
  return result;
});

/* ── 复用门（P6-e 序 4 · M1）───────────────────────────────────────
 *
 * 默认预算下第二次渲染**必须真的复用前缀**。它复用的是几个阶段，机器快慢都
 * 不影响这个判定，所以这条可以硬红 —— 红了就说明"缓存形同不存在"那个老缺陷
 * 又回来了（要么预算推导退化，要么快照被淘汰到够不着续算点）。
 *
 * 只 gate 默认预算那一档：F/G 是刻意模拟小内存机器，它们复用 0 是**正确答案**。 */
const adaptive = cache.find((r) => r.budgetMB === null);
const reuseGate =
  adaptive === undefined
    ? { ok: false, detail: '没有跑到默认预算那一档（场景表被改了？）' }
    : adaptive.secondReused > 0
      ? { ok: true, detail: `复用 ${adaptive.secondReused}/${adaptive.stageCount} 阶段` }
      : {
          ok: false,
          detail: `默认预算下复用 0/${adaptive.stageCount} —— 第二次 ${adaptive.secondMs.toFixed(0)} ms，` +
            '缓存没起作用（自适应预算退化或被淘汰到够不着续算点）',
        };
if (!reuseGate.ok) {
  progress(`!! 复用门未过：${reuseGate.detail}`);
  process.exitCode = 1;
}

const codec = CODEC_FORMATS.map((f) => {
  progress(`[编解码微测] ${f.toUpperCase()} …`);
  const result = runOne([PHOTO, '-', '0', f, '--mode', 'codec']);
  progress(
    `          → 解码 ${result.decodeMs.toFixed(0)} ms，编码 ${result.encodeMs.toFixed(0)} ms，` +
      `输出 ${(result.encodeBytes / 1048576).toFixed(1)} MB`,
  );
  return result;
});

/* ─────────────────────── 4. 报告 ─────────────────────── */

const padS = (s, n) => String(s).padStart(n);

const lines = [];
lines.push(`# 浮生图梦 · 真实性能实测（${WIDTH}×${HEIGHT} = ${((WIDTH * HEIGHT) / 1e6).toFixed(1)} MP 高熵图）`);
lines.push('');
lines.push('## 冷启动单张导出（一场景一进程，峰值取进程高水位）');
lines.push('');
lines.push('| 场景 | 输出尺寸 | 阶段 | 总耗时 | 峰值RSS | 估算峰值 | 输出 |');
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
for (const r of cold) {
  lines.push(
    `| ${r.label} | ${r.outputSize.w}×${r.outputSize.h} | ${r.stageCount} | ` +
      `**${r.totalMs.toFixed(0)} ms** | ${r.peakRssMB.toFixed(0)} MB | ` +
      `${r.estimatedPeakMB.toFixed(0)} MB | ${(r.outputBytes / 1048576).toFixed(1)} MB |`,
  );
}
lines.push('');
lines.push(
  '> **总耗时**是用户感知的数：CLI 完整路径（读文件 → 解码 → 计划 → 执行 → 编码）。<br>',
  '> **估算峰值**来自 `estimateMemory(plan)`，只含像素管线（输出 + 卷积 scratch + 快照），',
  '> 不含 Node 运行时基线、输入字节与编解码中间缓冲；因此实测 RSS 恒高于估算 ——',
  '> 重负载下约为估算的 2 倍，小管线则由固定开销主导。',
);
lines.push('');
lines.push('## 编解码微测（独立进程、内存低位，只做"解一次 + 编一次"）');
lines.push('');
lines.push('| 格式 | 解码 | 编码 | 每百万像素编码 | 输出 | 每像素字节 | 峰值RSS |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of codec) {
  lines.push(
    `| ${r.format.toUpperCase()} | ${r.decodeMs.toFixed(0)} ms | **${r.encodeMs.toFixed(0)} ms** | ` +
      `${r.encodeMsPerMP.toFixed(0)} ms | ${(r.encodeBytes / 1048576).toFixed(1)} MB | ` +
      `${r.outputBytesPerPixel.toFixed(2)} | ${r.peakRssMB.toFixed(0)} MB |`,
  );
}
lines.push('');
lines.push(
  '> 想知道"PNG 到底比 BMP 慢多少"，只能看这一组：若把编码耗时混进冷启动表，',
  '> 那是在**内存已在高位**时测的，会虚高到超过总耗时 —— 那种数字不能拿来下结论。',
);
lines.push('');
lines.push('');
lines.push('## 交互式调参：改末端一个参数，缓存复用多少（同一进程内两次渲染）');
lines.push('');
lines.push(
  `| 场景 | 阶段数 | 第一次 | 第二次 | 复用阶段 | 重算阶段 | 快照保留 | 峰值RSS |`,
);
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of cache) {
  lines.push(
    `| ${r.label} | ${r.stageCount} | ${padS(r.firstMs.toFixed(0), 5)} ms | ` +
      `${padS(r.secondMs.toFixed(0), 5)} ms | ${padS(r.secondReused, 2)} | ${padS(r.secondComputed, 2)} | ` +
      `${padS(r.snapshotsKept, 4)} | ${padS(r.peakRssMB.toFixed(0), 4)} MB |`,
  );
}
lines.push('');
lines.push(
  `**复用门（M1）**：${reuseGate.ok ? '过' : '**未过**'} —— ${reuseGate.detail}`,
);
lines.push('');
lines.push(
  '> F/G 给的是**内存预算**（与导出准入同一个数），快照张数由它推导。<br>',
  '> 这条门只管 H（默认预算 = 真实路径）：F/G 复用 0 是**正确答案** ——',
  '> 预算吃不下执行峰值时，自适应会把缓存降到"一张都不留"，宁可慢也不越线（M2）。',
);
lines.push('');
lines.push(
  '> **这一组的来历（P6-d 序 8 的原始发现）**：24MP 输出一张阶段快照就是 **98 MB**（4048×6048×4），',
  '> 而当时外壳里写死的预算只有 128 MB ⇒ 只留得住末端 1 张，前缀快照全被淘汰 →',
  '> `复用 0/8`，第二次反而比第一次慢 —— **缓存形同不存在**；手工提到 1024 MB 才有',
  '> `复用 6/8`、快 8.4 倍。P6-e 序 4 把这个"必须有人记得去调的参数"改成了推导：',
  '> 预算 = 内存预算 −（执行峰值 × 安全系数），与 `gateExport` 同一套数字。',
  '> 于是"留几张"不再需要人知道，而小内存机器中"缓存主动让位"这件事也第一次变得可见。',
);
lines.push('');
lines.push('阶段清单（重配方）：');
lines.push('');
for (const s of cold[2].stages) lines.push(`- ${s}`);
lines.push('');
lines.push('> 文字阶段（水印/贴纸）在 Node 侧走 noopTextRenderer，只占位不绘制。');
lines.push('');

const report = `${lines.join('\n')}\n`;
mkdirSync(dirname(RESULT_JSON), { recursive: true });
writeFileSync(
  RESULT_JSON,
  JSON.stringify({ width: WIDTH, height: HEIGHT, cold, codec, cache, reuseGate }, null, 2),
);
process.stdout.write(`${report}\n原始数据：${basename(RESULT_JSON)}\n`);
