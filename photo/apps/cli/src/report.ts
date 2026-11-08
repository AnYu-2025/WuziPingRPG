/**
 * 报告层：把结果写成"人看"或"机器看"两种形态。
 *
 * 纯函数，零平台依赖 —— 因此格式稳定性可以被测试钉住。
 * CI 靠 `--json` 解析，人靠文本；两者共用同一份结果对象，
 * 不会出现"文本说成功、JSON 说失败"这种分裂。
 */

import { doc, pipeline, presets } from '@photo/core';
import type { BatchResult, InfoOutcome, PlanOutcome, PlanReport } from './render.js';

/** 计划报告所需的元信息。 */
export interface PlanMeta {
  readonly recipeName: string;
  readonly target: pipeline.RenderTarget;
  /** 仅 dry-run（预演一次渲染）时才提供。 */
  readonly format?: string;
  readonly quality?: number;
}

/** 渲染报告所需的元信息 —— 输出格式与质量在渲染里必有。 */
export interface RenderMeta extends PlanMeta {
  readonly format: string;
  readonly quality: number;
}

const NAME_COLUMN = 26;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;
}

function formatSize(size: { readonly w: number; readonly h: number }): string {
  return `${size.w}×${size.h}`;
}

function describeTarget(target: pipeline.RenderTarget): string {
  const edge = target.maxEdge > 0 ? `长边 ${target.maxEdge}` : '保持原尺寸';
  return `${target.kind} / ${edge} / ${target.withText ? '含水印' : '无水印'}`;
}

function describeWarnings(warnings: readonly pipeline.PlanWarning[]): readonly string[] {
  return warnings.map((w) => `${w.code}：${w.message}`);
}

/** 内存门 → 机器可读（决策 + 预算 + 预测；降采样另带目标长边）。 */
function describeGate(gate: pipeline.ExportGate): Record<string, unknown> {
  return {
    decision: gate.decision,
    budgetBytes: gate.budgetBytes,
    projectedBytes: gate.projectedBytes,
    message: gate.message,
    ...(gate.decision === 'downscale'
      ? { maxEdge: gate.maxEdge, projectedBytesAfter: gate.projectedBytesAfter }
      : {}),
    ...(gate.decision === 'reject' ? { reason: gate.reason } : {}),
  };
}

/** 内存门 → 人看的一行（决策 + 内核给的文案，报告层不再自己拼）。 */
function gateLine(gate: pipeline.ExportGate): string {
  return `       内存门[${gate.decision}]：${gate.message}`;
}

function summaryLine(total: number, ok: number): string {
  return `合计 ${total} 个：${ok} 成功，${total - ok} 失败`;
}

/* ─────────────────────────── render ─────────────────────────── */

export function formatRenderReport(result: BatchResult, meta: RenderMeta, json: boolean): string {
  if (json) {
    return JSON.stringify(
      {
        command: 'render',
        recipe: meta.recipeName,
        target: { ...meta.target },
        format: meta.format,
        quality: meta.quality,
        results: result.outcomes.map((outcome) =>
          outcome.ok
            ? {
                name: outcome.report.name,
                ok: true,
                sourceSize: outcome.report.sourceSize,
                outputSize: outcome.report.outputSize,
                stages: outcome.report.stages,
                warnings: describeWarnings(outcome.report.warnings),
                outputName: outcome.outputName,
                bytes: outcome.bytes.length,
                estimatedPeakBytes: outcome.report.memory.peakBytes,
                gate: describeGate(outcome.report.gate),
              }
            : { name: outcome.name, ok: false, error: outcome.error },
        ),
        summary: {
          total: result.outcomes.length,
          ok: result.okCount,
          fail: result.failCount,
        },
        scratchBytes: result.scratchBytes,
      },
      null,
      2,
    );
  }

  const lines: string[] = [
    '浮生图梦 · 无头批处理',
    `配方 ${meta.recipeName} · 目标 ${describeTarget(meta.target)} · 输出 ${meta.format} 质量 ${meta.quality}`,
    '',
  ];

  for (const outcome of result.outcomes) {
    if (!outcome.ok) {
      lines.push(`[FAIL] ${outcome.name.padEnd(NAME_COLUMN)}${outcome.error}`);
      continue;
    }
    const { report, outputName, bytes } = outcome;
    lines.push(
      `[OK]   ${outcome.report.name.padEnd(NAME_COLUMN)}` +
        `${formatSize(report.sourceSize)} → ${formatSize(report.outputSize)}   ` +
        `${outputName}  ${formatBytes(bytes.length)}`,
    );
    if (report.stages.length > 0) {
      lines.push(`       阶段：${report.stages.join(' → ')}`);
    }
    lines.push(gateLine(report.gate));
    for (const warning of describeWarnings(report.warnings)) {
      lines.push(`       [警告] ${warning}`);
    }
  }

  lines.push('', summaryLine(result.outcomes.length, result.okCount));
  if (result.scratchBytes > 0) {
    lines.push(`卷积缓冲整批复用一份：${formatBytes(result.scratchBytes)}`);
  }
  return lines.join('\n');
}

/* ──────────────────────────── plan ──────────────────────────── */

export function formatPlanReport(
  outcomes: readonly PlanOutcome[],
  meta: PlanMeta,
  json: boolean,
  dryRun = false,
): string {
  const okCount = outcomes.filter((o) => o.ok).length;

  if (json) {
    return JSON.stringify(
      {
        command: dryRun ? 'render:dry-run' : 'plan',
        recipe: meta.recipeName,
        target: { ...meta.target },
        ...(meta.format !== undefined
          ? { format: meta.format, quality: meta.quality }
          : {}),
        results: outcomes.map((outcome) =>
          outcome.ok
            ? {
                name: outcome.report.name,
                ok: true,
                sourceSize: outcome.report.sourceSize,
                outputSize: outcome.report.outputSize,
                stages: outcome.report.stages,
                warnings: describeWarnings(outcome.report.warnings),
                estimatedPeakBytes: outcome.report.memory.peakBytes,
                gate: describeGate(outcome.report.gate),
              }
            : { name: outcome.name, ok: false, error: outcome.error },
        ),
        summary: { total: outcomes.length, ok: okCount, fail: outcomes.length - okCount },
      },
      null,
      2,
    );
  }

  const lines: string[] = [
    dryRun ? '浮生图梦 · 预演（不写文件）' : '浮生图梦 · 渲染计划（不写文件）',
    `配方 ${meta.recipeName} · 目标 ${describeTarget(meta.target)}`,
    '',
  ];

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      lines.push(`[FAIL] ${outcome.name.padEnd(NAME_COLUMN)}${outcome.error}`);
      continue;
    }
    lines.push(describePlanReport(outcome.report));
  }

  lines.push('', summaryLine(outcomes.length, okCount));
  return lines.join('\n');
}

function describePlanReport(report: PlanReport): string {
  const lines: string[] = [
    `[OK]   ${report.name.padEnd(NAME_COLUMN)}` +
      `源 ${formatSize(report.sourceSize)} → 输出 ${formatSize(report.outputSize)}`,
  ];
  lines.push(
    report.stages.length === 0
      ? '       阶段 0：无（仅尺寸归一）'
      : `       阶段 ${report.stages.length}：${report.stages.join(' → ')}`,
  );
  lines.push(`       内存：${pipeline.describeMemory(report.memory)}`);
  lines.push(gateLine(report.gate));
  for (const warning of describeWarnings(report.warnings)) {
    lines.push(`       [警告] ${warning}`);
  }
  return lines.join('\n');
}

/* ──────────────────────────── info ──────────────────────────── */

export function formatInfoReport(outcomes: readonly InfoOutcome[], json: boolean): string {
  const okCount = outcomes.filter((o) => o.ok).length;

  if (json) {
    return JSON.stringify(
      {
        command: 'info',
        results: outcomes.map((outcome) =>
          outcome.ok
            ? {
                name: outcome.info.name,
                ok: true,
                format: outcome.info.format,
                width: outcome.info.width,
                height: outcome.info.height,
                storedWidth: outcome.info.storedWidth,
                storedHeight: outcome.info.storedHeight,
                orientation: outcome.info.orientation,
                exif: outcome.info.exif,
                bytes: outcome.info.bytes,
              }
            : { name: outcome.name, ok: false, error: outcome.error },
        ),
        summary: { total: outcomes.length, ok: okCount, fail: outcomes.length - okCount },
      },
      null,
      2,
    );
  }

  const lines: string[] = ['浮生图梦 · 头信息', ''];
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      lines.push(`[FAIL] ${outcome.name.padEnd(NAME_COLUMN)}${outcome.error}`);
      continue;
    }
    const { name, format, width, height, bytes, storedWidth, storedHeight, orientation, exif } =
      outcome.info;
    /* 朝向换了轴时才追加"存储 …"：否则每一行都多一段噪声，而这条信息只对
     * "为什么尺寸和我想的不一样"有用（判据与桌面信息条一致）。 */
    const size =
      storedWidth === width && storedHeight === height
        ? `${width}×${height}`
        : `${width}×${height}（存储 ${storedWidth}×${storedHeight}）`;
    lines.push(
      `[OK]   ${name.padEnd(NAME_COLUMN)}` +
        `${format.padEnd(6)}${size}   ${formatBytes(bytes)}   ${orientation} · ${exif}`,
    );
  }
  lines.push('', summaryLine(outcomes.length, okCount));
  return lines.join('\n');
}

/**
 * 预设分享报告（preset validate）。
 * 机器形态给出完整结构（便于 CI 校验）；文本形态给人一眼看清 key / 调色参数。
 */
export function formatPresetReport(preset: doc.SharedPreset, json: boolean): string {
  if (json) {
    return JSON.stringify(
      {
        ok: true,
        key: preset.key,
        name: preset.name,
        format: preset.format,
        params: preset.params,
        ...(preset.curves !== undefined ? { curves: preset.curves } : {}),
        ...(preset.levels !== undefined ? { levels: preset.levels } : {}),
        ...(preset.bands !== undefined ? { bands: preset.bands } : {}),
      },
      null,
      2,
    );
  }

  const lines: string[] = [
    `预设「${preset.name}」`,
    `  key:    ${preset.key}`,
    `  format: ${preset.format}`,
    '  调色参数（12 项）：',
    ...presets.ADJUST_KEYS.map((k) => `    ${k.padEnd(11)}${preset.params[k]}`),
  ];
  if (preset.curves !== undefined) lines.push('  观感扩展：曲线');
  if (preset.levels !== undefined) lines.push('  观感扩展：色阶');
  if (preset.bands !== undefined) lines.push('  观感扩展：HSL 分色带');
  return lines.join('\n');
}
