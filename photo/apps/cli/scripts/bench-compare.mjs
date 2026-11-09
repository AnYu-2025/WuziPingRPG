#!/usr/bin/env node
/**
 * 性能基线跨周对比 —— 给 weekly bench 装一个"越优化越慢"的报警器。
 *
 * 为什么需要它：`bench.mjs` 每次都会产出漂亮数字，但**没人会每周去翻 artifacts**。
 * 没有对比，"这周慢了 40%"就永远不会被看见。本脚本把"上周 vs 本周"变成一张
 * 带判定列的表，写进 GitHub Step Summary，并对显著回退发 `::warning::` 注解。
 *
 * 设计取舍：
 *   - **非阻塞**：回退只报警、不让 job 变红。周跑的任务一旦会红，很快就会被
 *     当成噪声无视；真要卡门禁，等基线稳定后再加 `--fail-on-regression`。
 *   - **阈值 30%**：24MP 实测本身有 ±10% 上下抖动（机器噪声、runner 差异），
 *     阈值压到 10% 会天天误报。
 *   - **缓存复用率是越高越好**，判定方向与耗时相反，故 `lowerIsBetter` 逐指标给定。
 *
 * 用法：node scripts/bench-compare.mjs <上周基线.json> <本周结果.json>
 * 退出码：正常路径恒为 0；仅当参数缺失或本周结果读不到时才非 0。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const THRESHOLD = 0.3;

const [baselinePath, currentPath] = process.argv.slice(2);
if (baselinePath === undefined || currentPath === undefined) {
  process.stderr.write('用法：node scripts/bench-compare.mjs <基线.json> <本周.json>\n');
  process.exit(2);
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

const current = readJson(currentPath);
if (current === null) {
  process.stderr.write(`找不到本周结果：${currentPath}\n`);
  process.exit(1);
}
const baseline = readJson(baselinePath);

const pct = (now, before) => (before === 0 ? null : (now - before) / before);
const fmt = (v) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`);
const round = (v) => (typeof v === 'number' ? Math.round(v) : v);

/** 判定一次变化；`lowerIsBetter` 决定"变差"的方向。 */
function verdict(delta, lowerIsBetter) {
  if (delta === null) return '—';
  if (lowerIsBetter ? delta > THRESHOLD : delta < -THRESHOLD) return '⚠️ 回退';
  if (lowerIsBetter ? delta < -THRESHOLD : delta > THRESHOLD) return '✅ 改善';
  return '✅ 持平';
}

const lines = [];
const regressions = [];

function section(title, rows) {
  if (rows.length === 0) return;
  lines.push(
    `### ${title}`,
    '',
    '| 场景 | 指标 | 上周 | 本周 | 变化 | 判定 |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  );
  for (const r of rows) {
    lines.push(
      `| ${r.label} | ${r.metric} | ${r.before} | ${r.after} | ${fmt(r.delta)} | ${r.judgement} |`,
    );
    if (r.judgement === '⚠️ 回退') {
      regressions.push(`${r.label} / ${r.metric}：${r.before} → ${r.after}（${fmt(r.delta)}）`);
    }
  }
  lines.push('');
}

/** 按 key 把本周与上周的记录配对；上周缺少的场景直接跳过。 */
function pair(currentList, baselineList, keyOf) {
  const map = new Map((baselineList ?? []).map((r) => [keyOf(r), r]));
  return (currentList ?? [])
    .map((now) => ({ now, before: map.get(keyOf(now)) }))
    .filter((p) => p.before !== undefined);
}

/** 把配对结果摊平成比较行。metrics 决定"看哪几个指标、方向如何"。 */
function rowsOf(pairs, nameOf, metrics) {
  const out = [];
  for (const { now, before } of pairs) {
    for (const m of metrics) {
      const delta = pct(m.pick(now), m.pick(before));
      out.push({
        label: nameOf(now),
        metric: m.metric,
        before: `${round(m.pick(before))}${m.unit}`,
        after: `${round(m.pick(now))}${m.unit}`,
        delta,
        judgement: verdict(delta, m.lowerIsBetter),
      });
    }
  }
  return out;
}

let headline;
if (baseline === null) {
  headline = '**首次运行，尚无基线。** 本次结果已存为基线，下周开始对比。';
} else {
  section(
    '冷启动单张导出',
    rowsOf(pair(current.cold, baseline.cold, (r) => r.label), (r) => r.label, [
      { metric: '总耗时', pick: (r) => r.totalMs, lowerIsBetter: true, unit: ' ms' },
      { metric: '峰值RSS', pick: (r) => r.peakRssMB, lowerIsBetter: true, unit: ' MB' },
    ]),
  );
  section(
    '编解码微测',
    rowsOf(pair(current.codec, baseline.codec, (r) => r.format), (r) => r.format.toUpperCase(), [
      { metric: '编码耗时', pick: (r) => r.encodeMs, lowerIsBetter: true, unit: ' ms' },
    ]),
  );
  section(
    '缓存复用（复用率越高越好）',
    rowsOf(pair(current.cache, baseline.cache, (r) => r.label), (r) => r.label, [
      { metric: '复用阶段', pick: (r) => r.secondReused, lowerIsBetter: false, unit: '' },
      { metric: '第二次耗时', pick: (r) => r.secondMs, lowerIsBetter: true, unit: ' ms' },
    ]),
  );

  headline =
    regressions.length === 0
      ? '**本周无显著回退**（阈值 ±30%）。'
      : `**发现 ${regressions.length} 项显著回退**（阈值 ±30%）：\n` +
        regressions.map((text) => `- ${text}`).join('\n');
}

const mp = ((current.width * current.height) / 1e6).toFixed(1);
const report = [
  `## 性能基线：${current.width}×${current.height}（${mp} MP）`,
  '',
  headline,
  '',
  ...lines,
].join('\n');

process.stdout.write(`${report}\n`);

/* 写进 Step Summary —— 打开 Actions 页就能直接看到，不用下载 artifact。 */
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath !== undefined && summaryPath !== '') {
  appendFileSync(summaryPath, `${report}\n`);
}

/* 回退用 warning 注解 —— 会出现在 run 页面与通知里，这才是"可见提示"。 */
for (const text of regressions) {
  process.stdout.write(`::warning title=性能回退::${text}\n`);
}

/* 本周结果覆盖为下周的基线。 */
mkdirSync(dirname(baselinePath), { recursive: true });
writeFileSync(baselinePath, JSON.stringify(current, null, 2));
process.stdout.write(`\n基线已更新：${baselinePath}\n`);
