/**
 * 命令行解析。
 *
 * 两条纪律：
 *   1. **未知选项直接报错**，不静默忽略。打错一个旗帜却"跑成功了"，
 *      是批处理里最难查的一类事故。
 *   2. 每个命令只接受自己支持的选项（`photo info --format png` 会报错），
 *      避免"设了但没生效"的困惑。
 */

/** CLI 承诺支持的输出格式。PNG 由 Node 壳基于 zlib 提供。 */
export const SUPPORTED_FORMATS: readonly string[] = ['png', 'bmp', 'ppm'];

export const DEFAULTS = {
  longEdge: 1920,
  outDir: '.',
  format: 'png',
  quality: 85,
  suffix: '',
} as const;

export interface RenderCommand {
  readonly command: 'render';
  readonly inputs: readonly string[];
  readonly recipePath: string | null;
  readonly longEdge: number;
  readonly withText: boolean;
  readonly outDir: string;
  readonly format: string;
  readonly quality: number;
  readonly suffix: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  /** 内存门：允许在超出内存预算时仍按当前尺寸执行（把 confirm 分支放行）。 */
  readonly allowOversize: boolean;
  /** 把整批成品打成一个 ZIP（`outDir/photos.zip`），而不是散文件。 */
  readonly zip: boolean;
}

export interface PlanCommand {
  readonly command: 'plan';
  readonly inputs: readonly string[];
  readonly recipePath: string | null;
  readonly longEdge: number;
  readonly withText: boolean;
  readonly json: boolean;
}

export interface InfoCommand {
  readonly command: 'info';
  readonly inputs: readonly string[];
  readonly json: boolean;
}

export interface PresetCommand {
  readonly command: 'preset';
  readonly subcommand: 'validate' | 'apply';
  /** 预设文件路径（.json，分享格式 photo.preset/v1）。 */
  readonly presetPath: string;
  /** apply 时的输入图片（validate 为空）。 */
  readonly inputs: readonly string[];
  readonly longEdge: number;
  readonly withText: boolean;
  readonly outDir: string;
  readonly format: string;
  readonly quality: number;
  readonly json: boolean;
  readonly allowOversize: boolean;
}

export interface HelpCommand {
  readonly command: 'help';
}

export interface VersionCommand {
  readonly command: 'version';
}

export type CliCommand =
  | RenderCommand
  | PlanCommand
  | InfoCommand
  | PresetCommand
  | HelpCommand
  | VersionCommand;

export type ParseResult =
  | { readonly ok: true; readonly command: CliCommand }
  | { readonly ok: false; readonly error: string };

const VALUED_FLAGS: readonly string[] = [
  '--recipe',
  '--out',
  '--long-edge',
  '--format',
  '--quality',
  '--suffix',
];
const BOOLEAN_FLAGS: readonly string[] = [
  '--no-text',
  '--json',
  '--dry-run',
  '--allow-oversize',
  '--zip',
];
const HELP_FLAGS: readonly string[] = ['--help', '-h'];

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  render: [...VALUED_FLAGS, ...BOOLEAN_FLAGS, ...HELP_FLAGS],
  plan: ['--recipe', '--long-edge', '--no-text', '--json', ...HELP_FLAGS],
  info: ['--json', ...HELP_FLAGS],
  preset: [
    '--out',
    '--long-edge',
    '--format',
    '--quality',
    '--no-text',
    '--json',
    '--allow-oversize',
    ...HELP_FLAGS,
  ],
};

interface NumberResult {
  readonly ok: boolean;
  readonly value: number;
  readonly error: string;
}

function readInteger(
  values: ReadonlyMap<string, string>,
  flag: string,
  fallback: number,
  min: number,
  max: number,
): NumberResult {
  const raw = values.get(flag);
  if (raw === undefined) return { ok: true, value: fallback, error: '' };
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, value: fallback, error: `选项 ${flag} 需要整数，实际为 "${raw}"。` };
  }
  const value = Number.parseInt(trimmed, 10);
  if (value < min || value > max) {
    return {
      ok: false,
      value,
      error: `选项 ${flag} 需在 ${min}..${max} 之间，实际为 ${value}。`,
    };
  }
  return { ok: true, value, error: '' };
}

/**
 * 解析 `preset` 命令。`preset <validate|apply> <预设.json> [输入图片...] [选项]`。
 * validate 只需预设文件；apply 还需至少一个输入图片。
 */
function finishPresetCommand(
  positionals: readonly string[],
  values: ReadonlyMap<string, string>,
  flags: ReadonlySet<string>,
): ParseResult {
  const sub = positionals[0];
  if (sub !== 'validate' && sub !== 'apply') {
    return { ok: false, error: `preset 子命令只能是 validate / apply，实际为 "${sub ?? ''}"。` };
  }
  const presetPath = positionals[1];
  if (presetPath === undefined || presetPath === '') {
    return { ok: false, error: `preset ${sub} 需要一个预设文件路径（.json）。` };
  }

  const longEdge = readInteger(values, '--long-edge', DEFAULTS.longEdge, 0, 100000);
  if (!longEdge.ok) return { ok: false, error: longEdge.error };

  const withText = !flags.has('--no-text');
  const json = flags.has('--json');
  const outDir = values.get('--out') ?? DEFAULTS.outDir;

  if (sub === 'validate') {
    return {
      ok: true,
      command: {
        command: 'preset',
        subcommand: 'validate',
        presetPath,
        inputs: [],
        longEdge: longEdge.value,
        withText,
        outDir,
        format: DEFAULTS.format,
        quality: DEFAULTS.quality,
        json,
        allowOversize: flags.has('--allow-oversize'),
      },
    };
  }

  const inputs = positionals.slice(2);
  if (inputs.length === 0) {
    return { ok: false, error: `preset apply 至少需要一个输入图片。` };
  }
  const formatRaw = values.get('--format') ?? DEFAULTS.format;
  const format = formatRaw.trim().toLowerCase();
  if (!SUPPORTED_FORMATS.includes(format)) {
    return {
      ok: false,
      error: `选项 --format 只支持 ${SUPPORTED_FORMATS.join(' / ')}，实际为 "${formatRaw}"。`,
    };
  }
  const quality = readInteger(values, '--quality', DEFAULTS.quality, 10, 100);
  if (!quality.ok) return { ok: false, error: quality.error };

  return {
    ok: true,
    command: {
      command: 'preset',
      subcommand: 'apply',
      presetPath,
      inputs,
      longEdge: longEdge.value,
      withText,
      outDir,
      format,
      quality: quality.value,
      json,
      allowOversize: flags.has('--allow-oversize'),
    },
  };
}

/** 解析 `process.argv.slice(2)`。 */
export function parseArgv(argv: readonly string[]): ParseResult {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  let command: string | null = null;
  let helpRequested = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--version' || token === '-v') {
      return { ok: true, command: { command: 'version' } };
    }

    if (token.startsWith('-') && token !== '-') {
      const equals = token.indexOf('=');
      const name = equals > 0 ? token.slice(0, equals) : token;
      const inline = equals > 0 ? token.slice(equals + 1) : null;

      if (HELP_FLAGS.includes(name)) {
        helpRequested = true;
        continue;
      }
      if (!VALUED_FLAGS.includes(name) && !BOOLEAN_FLAGS.includes(name)) {
        return { ok: false, error: `未知选项：${name}。` };
      }
      if (BOOLEAN_FLAGS.includes(name)) {
        if (inline !== null) return { ok: false, error: `选项 ${name} 不接受取值。` };
        flags.add(name);
        continue;
      }
      if (values.has(name)) return { ok: false, error: `选项 ${name} 重复出现。` };

      let value: string;
      if (inline !== null) {
        value = inline;
      } else {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('-') && next !== '-')) {
          return { ok: false, error: `选项 ${name} 需要一个取值。` };
        }
        value = next;
        i += 1;
      }
      values.set(name, value);
      continue;
    }

    if (command === null) command = token;
    else positionals.push(token);
  }

  if (command === null || command === 'help' || helpRequested) {
    return { ok: true, command: { command: 'help' } };
  }
  if (command === 'version') return { ok: true, command: { command: 'version' } };
  if (command === 'preset') {
    return finishPresetCommand(positionals, values, flags);
  }
  if (command !== 'render' && command !== 'plan' && command !== 'info') {
    return {
      ok: false,
      error: `未知命令：${command}。可用：render / plan / info / preset / help。`,
    };
  }

  const allowed = ALLOWED[command] ?? [];
  for (const name of [...values.keys(), ...flags]) {
    if (!allowed.includes(name)) {
      const usable = allowed.filter((n) => n.startsWith('--')).join(' ');
      return { ok: false, error: `命令 ${command} 不支持选项 ${name}。可用选项：${usable}` };
    }
  }

  if (positionals.length === 0) {
    return { ok: false, error: `命令 ${command} 至少需要一个输入文件。` };
  }

  const longEdge = readInteger(values, '--long-edge', DEFAULTS.longEdge, 0, 100000);
  if (!longEdge.ok) return { ok: false, error: longEdge.error };

  const withText = !flags.has('--no-text');
  const json = flags.has('--json');
  const recipePath = values.get('--recipe') ?? null;

  if (command === 'info') {
    return { ok: true, command: { command: 'info', inputs: positionals, json } };
  }
  if (command === 'plan') {
    return {
      ok: true,
      command: {
        command: 'plan',
        inputs: positionals,
        recipePath,
        longEdge: longEdge.value,
        withText,
        json,
      },
    };
  }

  const formatRaw = values.get('--format') ?? DEFAULTS.format;
  const format = formatRaw.trim().toLowerCase();
  if (!SUPPORTED_FORMATS.includes(format)) {
    return {
      ok: false,
      error: `选项 --format 只支持 ${SUPPORTED_FORMATS.join(' / ')}，实际为 "${formatRaw}"。`,
    };
  }

  const quality = readInteger(values, '--quality', DEFAULTS.quality, 10, 100);
  if (!quality.ok) return { ok: false, error: quality.error };

  return {
    ok: true,
    command: {
      command: 'render',
      inputs: positionals,
      recipePath,
      longEdge: longEdge.value,
      withText,
      outDir: values.get('--out') ?? DEFAULTS.outDir,
      format,
      quality: quality.value,
      suffix: values.get('--suffix') ?? DEFAULTS.suffix,
      dryRun: flags.has('--dry-run'),
      json,
      allowOversize: flags.has('--allow-oversize'),
      zip: flags.has('--zip'),
    },
  };
}
