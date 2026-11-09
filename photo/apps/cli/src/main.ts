/**
 * CLI 入口 —— 只做接线。
 *
 * 这一层薄到什么程度：解析参数 → 读文件 → 交给纯逻辑 → 写文件 → 打印报告。
 * 所有判断逻辑都在 args / recipe / render / report 里，那些模块不引用任何
 * Node API，因此可以被离线测试。这一层负责的只有"真实世界"的部分。
 *
 * 副作用提示：本模块在被 import 时就会执行 `main()`。
 * 包的对外入口是 `render.ts`（纯函数），所以外部 import `@photo/cli`
 * 不会触发命令行行为。
 */

import { doc, type pipeline } from '@photo/core';
import { zipStore, type CodecRegistry } from '@photo/io';
import {
  parseArgv,
  type InfoCommand,
  type PlanCommand,
  type PresetCommand,
  type RenderCommand,
} from './args.js';
import { errorMessage } from './errors.js';
import { HELP_TEXT, USAGE_HINT } from './help.js';
import { readInput, readTextFile, writeOutput } from './node-io.js';
import { createNodeRegistry } from './node-registry.js';
import {
  baseName,
  findOutputCollisions,
  joinOutput,
  outputFileName,
  stripExtension,
} from './paths.js';
import { emptyRecipe, parseRecipe, type Recipe } from './recipe.js';
import {
  infoOne,
  planOne,
  planPaths,
  runBatch,
  zipEntriesOf,
  type BatchJob,
  type ExportGateOptions,
  type InfoOutcome,
  type PlanOutcome,
  type PlanRequest,
} from './render.js';
import {
  formatInfoReport,
  formatPlanReport,
  formatPresetReport,
  formatRenderReport,
  type PlanMeta,
  type RenderMeta,
} from './report.js';
import { CLI_NAME, CLI_VERSION } from './version.js';

function emit(text: string): void {
  process.stdout.write(`${text}\n`);
}

function emitError(text: string): void {
  process.stderr.write(`${text}\n`);
  process.exitCode = 1;
}

function targetOf(longEdge: number, withText: boolean): pipeline.RenderTarget {
  return { kind: 'export', maxEdge: longEdge, withText };
}

/**
 * 内存预算（字节）。内核**不读** `process.env` —— 由这里（外壳）注入。
 *
 * 非法值**不静默**：写一行警告到 stderr 后回落到内核默认预算。
 */
function memoryBudgetOf(): number | undefined {
  const raw = process.env.PHOTO_MEMORY_BUDGET_MB?.trim();
  if (raw === undefined || raw === '') return undefined;
  const mb = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(mb) || mb <= 0) {
    process.stderr.write(
      `[警告] PHOTO_MEMORY_BUDGET_MB="${raw}" 非法，已忽略（应为正整数 MB，如 2048）。\n`,
    );
    return undefined;
  }
  return mb * 1024 * 1024;
}

/** 内存门参数（预算 + 是否放行超预算原尺寸）。 */
function gateOptionsOf(allowOversize: boolean): ExportGateOptions {
  return { budgetBytes: memoryBudgetOf(), allowFullSize: allowOversize };
}

function loadRecipe(recipePath: string | null): Recipe {
  if (recipePath === null) return emptyRecipe();
  const parsed = parseRecipe(readTextFile(recipePath), stripExtension(baseName(recipePath)));
  if (!parsed.ok) {
    throw new Error(`配方 ${recipePath} 校验未通过：${parsed.error}`);
  }
  return parsed.recipe;
}

/** 读取失败不抛异常，而是变成一条带原因的批处理条目。 */
function readJob(path: string, outputName: string): BatchJob {
  try {
    return { name: baseName(path), input: readInput(path), error: null, outputName };
  } catch (e) {
    return { name: baseName(path), input: null, error: errorMessage(e), outputName };
  }
}

/* ────────────────────────────── info ────────────────────────────── */

function runInfo(command: InfoCommand, registry: CodecRegistry): void {
  const outcomes: InfoOutcome[] = command.inputs.map((path) => {
    try {
      return infoOne(readInput(path), registry);
    } catch (e) {
      return { ok: false, name: baseName(path), error: errorMessage(e) };
    }
  });
  emit(formatInfoReport(outcomes, command.json));
  if (outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
}

/* ────────────────────────────── plan ────────────────────────────── */

function runPlan(command: PlanCommand, registry: CodecRegistry): void {
  const recipe = loadRecipe(command.recipePath);
  const target = targetOf(command.longEdge, command.withText);
  const request: PlanRequest = { recipe, target, gate: gateOptionsOf(false) };
  const outcomes = planPaths(command.inputs, readInput, request, registry);

  const meta: PlanMeta = { recipeName: recipe.name, target };
  emit(formatPlanReport(outcomes, meta, command.json));
  if (outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
}

/* ───────────────────────────── render ───────────────────────────── */

/**
 * `--zip` 时的归档文件名（落在 `--out` 目录里）。
 *
 * 固定名是刻意的：`--out` 已经承担了"放哪儿"，再让归档名也可配就多一个
 * 需要记住的参数。名字取自"一批照片"这个最贴切的语义。
 */
const ZIP_NAME = 'photos.zip';

function runRender(command: RenderCommand, registry: CodecRegistry): void {
  const recipe = loadRecipe(command.recipePath);
  const target = targetOf(command.longEdge, command.withText);
  const gate = gateOptionsOf(command.allowOversize);
  /* 这里用 RenderMeta（format / quality 必有）：dry-run 走计划报告、
   * 正式执行走渲染报告，两者共用同一份 meta，不会出现"报告里格式对不上"。 */
  const meta: RenderMeta = {
    recipeName: recipe.name,
    target,
    format: command.format,
    quality: command.quality,
  };

  const jobs: BatchJob[] = command.inputs.map((path) =>
    readJob(
      path,
      joinOutput(
        command.outDir,
        outputFileName(stripExtension(baseName(path)), command.suffix, command.format),
      ),
    ),
  );

  /* 护栏：输出会覆盖输入时整体拒绝。
   * 批处理里覆盖源图是不可逆事故，宁可整体不做，也不"部分成功"。 */
  const collisions = findOutputCollisions(
    command.inputs,
    jobs.map((job) => job.outputName),
  );
  if (collisions.length > 0) {
    emitError(
      `拒绝执行：以下输出会覆盖输入文件。\n  ${collisions.join('\n  ')}\n` +
        '请改用 --suffix 或 --out 指向其它目录。',
    );
    return;
  }

  if (command.dryRun) {
    const outcomes: PlanOutcome[] = jobs.map((job) => {
      if (job.input === null) {
        return { ok: false, name: job.name, error: job.error ?? '读取失败。' };
      }
      return planOne(job.input, { recipe, target, gate }, registry);
    });
    emit(formatPlanReport(outcomes, meta, command.json, true));
    if (outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
    return;
  }

  const result = runBatch(
    jobs,
    { recipe, target, format: command.format, quality: command.quality, gate },
    registry,
  );

  let writeFailures = 0;
  let reportSource = result;
  if (command.zip) {
    const entries = zipEntriesOf(result.outcomes);
    if (entries.length === 0) {
      emitError(`没有可打包的成品（${result.failCount} 个输入全部失败）。`);
    } else {
      const archive = joinOutput(command.outDir, ZIP_NAME);
      try {
        writeOutput(archive, zipStore(entries));
      } catch (e) {
        writeFailures += 1;
        emitError(`写出失败：${archive} —— ${errorMessage(e)}`);
      }

      /* 报告里的「输出」列在打包模式下应当写**归档内条目名**。
       * 否则两张同名输入会各显示一行 `out/photo.png`，看起来像后一张覆盖了
       * 前一张 —— 而归档里其实是 `photo.png` / `photo-2.png`。
       * 报告与实际产物对不上，是比缺陷本身更难查的那种问题。 */
      let i = 0;
      reportSource = {
        ...result,
        outcomes: result.outcomes.map((outcome) =>
          outcome.ok ? { ...outcome, outputName: entries[i++].name } : outcome,
        ),
      };

      /* JSON 模式必须只输出一段可解析的 JSON，因此这行人话只进文本模式。 */
      if (!command.json) {
        emit(
          `已打包 ${entries.length} 个成品 → ${archive}\n` +
            `归档内：${entries.map((e) => e.name).join(', ')}`,
        );
      }
    }
  } else {
    for (const outcome of result.outcomes) {
      if (!outcome.ok) continue;
      try {
        writeOutput(outcome.outputName, outcome.bytes);
      } catch (e) {
        writeFailures += 1;
        emitError(`写出失败：${outcome.outputName} —— ${errorMessage(e)}`);
      }
    }
  }

  emit(formatRenderReport(reportSource, meta, command.json));
  if (result.failCount > 0 || writeFailures > 0) process.exitCode = 1;
}

/* ────────────────────────────── preset ───────────────────────────── */

/**
 * `preset validate`：解析预设文件并打印（跨机导入前先确认它是合法分享格式）。
 * `preset apply`：把预设观感经 sharedPresetToOps 落成 Recipe，复用 runBatch 渲染
 * —— 不写任何像素算法，与 render 共用同一份内核执行引擎。
 */
function runPreset(command: PresetCommand, registry: CodecRegistry): void {
  let preset: doc.SharedPreset;
  try {
    preset = doc.parseSharedPreset(readTextFile(command.presetPath));
  } catch (e) {
    emitError(`预设解析失败：${errorMessage(e)}`);
    return;
  }

  if (command.subcommand === 'validate') {
    emit(formatPresetReport(preset, command.json));
    return;
  }

  const recipe = { name: preset.name, ops: doc.sharedPresetToOps(preset) };
  const target = targetOf(command.longEdge, command.withText);
  const gate = gateOptionsOf(command.allowOversize);
  const meta: RenderMeta = {
    recipeName: recipe.name,
    target,
    format: command.format,
    quality: command.quality,
  };

  const jobs: BatchJob[] = command.inputs.map((path) =>
    readJob(
      path,
      joinOutput(
        command.outDir,
        outputFileName(stripExtension(baseName(path)), '', command.format),
      ),
    ),
  );

  const collisions = findOutputCollisions(
    command.inputs,
    jobs.map((job) => job.outputName),
  );
  if (collisions.length > 0) {
    emitError(
      `拒绝执行：以下输出会覆盖输入文件。\n  ${collisions.join('\n  ')}\n` +
        '请改用 --out 指向其它目录。',
    );
    return;
  }

  const result = runBatch(
    jobs,
    { recipe, target, format: command.format, quality: command.quality, gate },
    registry,
  );

  let writeFailures = 0;
  for (const outcome of result.outcomes) {
    if (!outcome.ok) continue;
    try {
      writeOutput(outcome.outputName, outcome.bytes);
    } catch (e) {
      writeFailures += 1;
      emitError(`写出失败：${outcome.outputName} —— ${errorMessage(e)}`);
    }
  }

  emit(formatRenderReport(result, meta, command.json));
  if (result.failCount > 0 || writeFailures > 0) process.exitCode = 1;
}

/* ────────────────────────────── main ────────────────────────────── */

function main(): void {
  const parsed = parseArgv(process.argv.slice(2));
  if (!parsed.ok) {
    emitError(`错误：${parsed.error}`);
    emit(USAGE_HINT);
    return;
  }

  const command = parsed.command;
  if (command.command === 'help') {
    emit(HELP_TEXT);
    return;
  }
  if (command.command === 'version') {
    emit(`${CLI_NAME} ${CLI_VERSION}`);
    return;
  }

  try {
    const registry = createNodeRegistry();
    if (command.command === 'info') {
      runInfo(command, registry);
      return;
    }
    if (command.command === 'plan') {
      runPlan(command, registry);
      return;
    }
    if (command.command === 'preset') {
      runPreset(command, registry);
      return;
    }
    runRender(command, registry);
  } catch (e) {
    emitError(`错误：${errorMessage(e)}`);
  }
}

main();
