import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseArgv, type CliCommand } from './args.js';

/** 返回窄化后的成功结果，否则强制失败 —— 于是测试里不必到处写 ok 判断。 */
function expectOk(argv: readonly string[]): { readonly ok: true; readonly command: CliCommand } {
  const result = parseArgv(argv);
  if (!result.ok) throw new Error(`本应解析成功，却报错：${result.error}`);
  return result;
}

function expectError(argv: readonly string[]): string {
  const result = parseArgv(argv);
  if (result.ok) throw new Error('本应报错，却解析成功了。');
  return result.error;
}

describe('parseArgv 命令识别', () => {
  it('无参数时为帮助', () => {
    expect(expectOk([]).command.command).toBe('help');
    expect(expectOk(['--help']).command.command).toBe('help');
    expect(expectOk(['-h']).command.command).toBe('help');
  });

  it('--version / -v 直接返回版本', () => {
    expect(expectOk(['--version']).command.command).toBe('version');
    expect(expectOk(['-v']).command.command).toBe('version');
    expect(expectOk(['render', 'a.png', '--version']).command.command).toBe('version');
  });

  it('未知命令报错并列出可用命令', () => {
    const error = expectError(['frobnicate', 'a.png']);
    expect(error).toContain('未知命令');
    expect(error).toContain('render');
  });

  it('命令后可跟 --help', () => {
    expect(expectOk(['render', '--help']).command.command).toBe('help');
  });
});

describe('parseArgv render 选项', () => {
  it('默认值来自 DEFAULTS', () => {
    const command = expectOk(['render', 'a.bmp']).command;
    if (command.command !== 'render') throw new Error('命令类型不符');
    expect(command.longEdge).toBe(DEFAULTS.longEdge);
    expect(command.format).toBe(DEFAULTS.format);
    expect(command.quality).toBe(DEFAULTS.quality);
    expect(command.outDir).toBe(DEFAULTS.outDir);
    expect(command.suffix).toBe('');
    expect(command.withText).toBe(true);
    expect(command.json).toBe(false);
    expect(command.dryRun).toBe(false);
    expect(command.recipePath).toBeNull();
    expect(command.zip).toBe(false);
    expect(command.inputs).toEqual(['a.bmp']);
  });

  it('解析全部选项（空格分隔）', () => {
    const command = expectOk([
      'render',
      'a.bmp',
      'b.bmp',
      '--recipe',
      'film.json',
      '--out',
      'out',
      '--long-edge',
      '1080',
      '--format',
      'PPM',
      '--quality',
      '60',
      '--suffix',
      'gray',
      '--no-text',
      '--json',
      '--dry-run',
    ]).command;
    if (command.command !== 'render') throw new Error('命令类型不符');
    expect(command.inputs).toEqual(['a.bmp', 'b.bmp']);
    expect(command.recipePath).toBe('film.json');
    expect(command.outDir).toBe('out');
    expect(command.longEdge).toBe(1080);
    expect(command.format).toBe('ppm');
    expect(command.quality).toBe(60);
    expect(command.suffix).toBe('gray');
    expect(command.withText).toBe(false);
    expect(command.json).toBe(true);
    expect(command.dryRun).toBe(true);
  });

  it('支持 --flag=value 形式', () => {
    const command = expectOk(['render', 'a.bmp', '--long-edge=640', '--format=bmp']).command;
    if (command.command !== 'render') throw new Error('命令类型不符');
    expect(command.longEdge).toBe(640);
    expect(command.format).toBe('bmp');
  });

  it('--zip 是布尔开关，且不接受取值', () => {
    const command = expectOk(['render', 'a.bmp', '--zip']).command;
    if (command.command !== 'render') throw new Error('命令类型不符');
    expect(command.zip).toBe(true);
    expect(() => expectOk(['render', 'a.bmp', '--zip=1'])).toThrow();
  });

  it('plan 不支持 --zip（只算计划，不写文件）', () => {
    expect(expectError(['plan', 'a.bmp', '--zip'])).toContain('--zip');
  });

  it('--long-edge 0 表示保持原尺寸（合法）', () => {
    const command = expectOk(['render', 'a.bmp', '--long-edge', '0']).command;
    if (command.command !== 'render') throw new Error('命令类型不符');
    expect(command.longEdge).toBe(0);
  });
});

describe('parseArgv 错误处理', () => {
  it('未知选项报错，而不是被忽略', () => {
    expect(expectError(['render', 'a.bmp', '--crop'])).toContain('未知选项');
  });

  it('缺少取值时报错', () => {
    expect(expectError(['render', 'a.bmp', '--out'])).toContain('需要一个取值');
    expect(expectError(['render', 'a.bmp', '--out', '--json'])).toContain('需要一个取值');
  });

  it('布尔选项不接受取值', () => {
    expect(expectError(['render', 'a.bmp', '--json=1'])).toContain('不接受取值');
  });

  it('重复选项报错', () => {
    expect(expectError(['render', 'a.bmp', '--out', 'x', '--out', 'y'])).toContain('重复出现');
  });

  it('只接受自己支持的选项', () => {
    expect(expectError(['info', 'a.png', '--format', 'png'])).toContain('不支持选项');
    expect(expectError(['plan', 'a.png', '--out', 'x'])).toContain('不支持选项');
  });

  it('长边非整数或越界时报错', () => {
    expect(expectError(['render', 'a.bmp', '--long-edge', 'abc'])).toContain('需要整数');
    expect(expectError(['render', 'a.bmp', '--long-edge', '-5'])).toContain('需要一个取值');
    expect(expectError(['render', 'a.bmp', '--long-edge', '999999'])).toContain('100000');
  });

  it('质量越界时报错', () => {
    expect(expectError(['render', 'a.bmp', '--quality', '5'])).toContain('10..100');
    expect(expectError(['render', 'a.bmp', '--quality', '200'])).toContain('10..100');
  });

  it('不支持的输出格式报错', () => {
    expect(expectError(['render', 'a.bmp', '--format', 'tiff'])).toContain('只支持');
  });

  it('缺少输入文件时报错', () => {
    expect(expectError(['render'])).toContain('至少需要一个输入文件');
    expect(expectError(['info'])).toContain('至少需要一个输入文件');
  });
});

describe('parseArgv plan / info', () => {
  it('plan 支持配方与长边，返回 export 目标参数', () => {
    const command = expectOk([
      'plan',
      'a.png',
      '--recipe',
      'r.json',
      '--long-edge',
      '256',
      '--no-text',
    ]).command;
    if (command.command !== 'plan') throw new Error('命令类型不符');
    expect(command.recipePath).toBe('r.json');
    expect(command.longEdge).toBe(256);
    expect(command.withText).toBe(false);
  });

  it('info 只吃 --json', () => {
    const command = expectOk(['info', 'a.png', 'b.png', '--json']).command;
    if (command.command !== 'info') throw new Error('命令类型不符');
    expect(command.inputs).toEqual(['a.png', 'b.png']);
    expect(command.json).toBe(true);
  });
});

describe('parseArgv preset（序9 预设分享）', () => {
  it('preset validate 解析出 key / 文件路径', () => {
    const command = expectOk(['preset', 'validate', 'film.json']).command;
    if (command.command !== 'preset') throw new Error('命令类型不符');
    expect(command.subcommand).toBe('validate');
    expect(command.presetPath).toBe('film.json');
    expect(command.inputs).toEqual([]);
  });

  it('preset apply 解析出预设路径与输入图片，并继承 render 输出选项', () => {
    const command = expectOk([
      'preset',
      'apply',
      'film.json',
      'a.png',
      'b.png',
      '--out',
      'out',
      '--format',
      'png',
      '--quality',
      '90',
      '--long-edge',
      '800',
    ]).command;
    if (command.command !== 'preset') throw new Error('命令类型不符');
    expect(command.subcommand).toBe('apply');
    expect(command.presetPath).toBe('film.json');
    expect(command.inputs).toEqual(['a.png', 'b.png']);
    expect(command.outDir).toBe('out');
    expect(command.format).toBe('png');
    expect(command.quality).toBe(90);
    expect(command.longEdge).toBe(800);
  });

  it('未知子命令报错', () => {
    expect(expectError(['preset', 'frobnicate', 'film.json'])).toContain('子命令');
  });

  it('缺预设文件路径报错', () => {
    expect(expectError(['preset', 'validate'])).toContain('预设文件路径');
  });

  it('apply 缺输入图片报错', () => {
    expect(expectError(['preset', 'apply', 'film.json'])).toContain('至少需要一个输入图片');
  });

  it('apply 不支持的格式报错', () => {
    expect(expectError(['preset', 'apply', 'film.json', 'a.png', '--format', 'tiff'])).toContain(
      '只支持',
    );
  });
});
