#!/usr/bin/env node
/**
 * 单次性能实测 —— **一个独立进程只测一次**。
 *
 * ── 为什么必须一进程一测 ─────────────────────────────────────────
 * `process.resourceUsage().maxRSS` 是**进程级高水位**，只增不减。
 * 在同一进程里连测多次场景，第二次的读数会被第一次的峰值污染 ——
 * 那正是"合成小图测出来的漂亮数字"的另一副面孔。
 * 一次一进程，读数才可信。本机实测 maxRSS 单位是 **KB**。
 *
 * ── 两种模式 ────────────────────────────────────────────────────
 *   cold  ：走 CLI 的完整单张路径（解码 → 计划 → 执行 → 编码），
 *           回答"导出这一张要几秒、峰值几 MB"。
 *   cache ：走内核的 `RenderCache`，改一个末端参数再渲染一次，
 *           回答"交互式调参到底省了多少阶段、省了多少时间"，
 *           并暴露快照预算对复用率的影响（24MP 一张快照就是 96MB）。
 *
 * 用法：
 *   node scripts/bench-one.mjs <输入> <配方|-> <长边> <格式> [--mode cold|cache] [--budget-mb N]
 * 输出：一行 JSON 到 stdout。
 */
import { basename } from 'node:path';
import { doc as docApi, pipeline } from '@photo/core';
import { readInput, readTextFile } from '../dist/node-io.js';
import { createNodeRegistry } from '../dist/node-registry.js';
import { parseRecipe, emptyRecipe } from '../dist/recipe.js';
import { renderOne } from '../dist/render.js';
import { stripExtension } from '../dist/paths.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [inputPath, recipeArg, longEdgeArg, formatArg] = positional;

const longEdge = Number(longEdgeArg ?? 0);
const format = formatArg ?? 'png';
const mode = flag('--mode', 'cold');
/* 不给 `--budget-mb` 就用**内核默认**（= 导出准入那个 2 GB 预算）。
 * 快照留几张现在由计划规模推导，所以 bench 里显式传这个数只有一种用途：
 * 模拟"小内存机器"，看自适应会不会把复用率打回 0。 */
const budgetMb = argv.includes('--budget-mb') ? Number(flag('--budget-mb', '0')) : undefined;

const registry = createNodeRegistry();

function loadRecipe() {
  if (recipeArg === undefined || recipeArg === '-' || recipeArg === '') return emptyRecipe();
  const parsed = parseRecipe(readTextFile(recipeArg), stripExtension(basename(recipeArg)));
  if (!parsed.ok) throw new Error(`配方校验未通过：${parsed.error}`);
  return parsed.recipe;
}

function timed(fn) {
  const t = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t };
}

function buildDocument(recipe, size, name) {
  let document = docApi.createDocument();
  document = docApi.pushOp(document, {
    k: 'setSources',
    value: [{ id: 'src-0', name, width: size.w, height: size.h }],
    current: 0,
  });
  for (const op of recipe.ops) document = docApi.pushOp(document, op);
  return document;
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(message) {
  emit({ ok: false, error: message });
  process.exit(1);
}

function runCold(input, recipe) {
  const target = { kind: 'export', maxEdge: longEdge, withText: true };
  const request = {
    recipe,
    target,
    format,
    quality: 85,
    outputName: `${stripExtension(basename(inputPath))}_out.${format}`,
  };

  const render = timed(() => renderOne(input, request, registry));
  const outcome = render.value;
  if (!outcome.ok) fail(outcome.error);

  /* 峰值必须在**做任何额外分配之前**读走，否则拆解测量自己会把水位顶上去，
   * 报出来的"渲染峰值"就不诚实了。 */
  const peakRssKB = process.resourceUsage().maxRSS;

  const decoded = registry.decode(input.bytes);
  const decodeOnlyMs = timed(() => registry.decode(input.bytes)).ms;
  const encodeOnlyMs = timed(() => registry.encode(format, decoded, 85)).ms;

  const { report, bytes } = outcome;
  const memory = report.memory;
  return {
    ok: true,
    mode: 'cold',
    input: basename(inputPath),
    recipe: recipe.name,
    format,
    longEdge,
    sourceSize: report.sourceSize,
    outputSize: report.outputSize,
    stages: report.stages,
    stageCount: report.stages.length,
    warnings: report.warnings.map((w) => w.code),
    /* 总耗时 = CLI 完整路径（解码 + 计划 + 执行 + 编码）。这是用户感知的数。 */
    totalMs: render.ms,
    /* 下面两个是**独立单测**：它们与总耗时**不可相减** ——
     * 总耗时里那两段跑在尚未堆积内存的状态下，而单测时进程已在高位，
     * 读数会偏高。曾经用"总 − 解码 − 编码"推过"管线耗时"，结果出现负值，
     * 那正是这类"看起来像数据、其实不成立"的推算 —— 已删。 */
    decodeOnlyMs,
    encodeOnlyMs,
    outputBytes: bytes.length,
    peakRssKB,
    peakRssMB: Number((peakRssKB / 1024).toFixed(1)),
    estimatedPeakMB: Number((memory.peakBytes / 1048576).toFixed(1)),
    estimatedOutputMB: Number((memory.outputBytes / 1048576).toFixed(1)),
    estimatedScratchMB: Number((memory.scratchBytes / 1048576).toFixed(1)),
    heavyStages: memory.heavyStages,
    oversize: memory.oversize,
  };
}

function runCache(input, recipe) {
  const src = registry.decode(input.bytes);
  const size = { w: src.width, h: src.height };
  const target = { kind: 'export', maxEdge: longEdge, withText: true };

  const doc1 = buildDocument(recipe, size, basename(inputPath));
  const plan1 = pipeline.buildPlan(doc1, target);

  /* 只改**末端**一个参数（颗粒在管线靠后处）——
   * 这正是交互式拖滑杆的场景：前缀该被复用，末端才该重算。 */
  const params = docApi.deriveEdit(doc1).params;
  const doc2 = docApi.pushOp(doc1, {
    k: 'setAdjust',
    value: { ...params, grain: Math.min(50, params.grain + 15) },
  });
  const plan2 = pipeline.buildPlan(doc2, target);

  const cache = new pipeline.RenderCache(
    budgetMb === undefined ? {} : { memoryBudgetBytes: budgetMb * 1024 * 1024 },
  );
  const first = timed(() => cache.execute([src], plan1));
  const firstStats = first.value.stats;
  const second = timed(() => cache.execute([src], plan2));
  const secondStats = second.value.stats;
  const peakRssKB = process.resourceUsage().maxRSS;

  return {
    ok: true,
    mode: 'cache',
    input: basename(inputPath),
    recipe: recipe.name,
    longEdge,
    budgetMB: budgetMb ?? null,
    stages: plan1.stages.map((s) => s.kind),
    stageCount: plan1.stages.length,
    firstMs: first.ms,
    secondMs: second.ms,
    firstReused: firstStats.reused,
    firstComputed: firstStats.computed,
    secondReused: secondStats.reused,
    secondComputed: secondStats.computed,
    secondHit: secondStats.hit,
    snapshotsKept: secondStats.snapshots,
    peakRssKB,
    peakRssMB: Number((peakRssKB / 1024).toFixed(1)),
  };
}

/**
 * 编解码微测：只做"读 → 解 → 编"，不跑管线。
 *
 * 为什么单独一个模式：冷启动场景里的"编码耗时"是在**内存已在高位**时测的，
 * 会比真实值虚高（甚至超过总耗时）。这里一个进程只解一次、编一次，
 * 状态最干净 —— 想知道"PNG 到底比 BMP 慢多少"，只能看这一组。
 */
function runCodec(input) {
  const decode = timed(() => registry.decode(input.bytes));
  const img = decode.value;
  const encoded = timed(() => registry.encode(format, img, 85));
  const peakRssKB = process.resourceUsage().maxRSS;
  const dims = img.width * img.height;
  return {
    ok: true,
    mode: 'codec',
    input: basename(inputPath),
    format,
    sourceSize: { w: img.width, h: img.height },
    sourceBytes: input.bytes.length,
    decodeMs: decode.ms,
    encodeMs: encoded.ms,
    encodeBytes: encoded.value.length,
    /* 每百万像素的编码耗时 —— 换尺寸时可以直接按比例外推。 */
    encodeMsPerMP: encoded.ms / (dims / 1e6),
    outputBytesPerPixel: encoded.value.length / dims,
    peakRssKB,
    peakRssMB: Number((peakRssKB / 1024).toFixed(1)),
  };
}

const input = readInput(inputPath);
if (mode === 'codec') {
  emit(runCodec(input));
} else {
  const recipe = loadRecipe();
  emit(mode === 'cache' ? runCache(input, recipe) : runCold(input, recipe));
}
