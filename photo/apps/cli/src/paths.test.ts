import { describe, expect, it } from 'vitest';
import {
  baseName,
  extensionOf,
  findOutputCollisions,
  joinOutput,
  outputFileName,
  sameFilePath,
  stripExtension,
} from './paths.js';

describe('baseName', () => {
  it('取最后一段，两种分隔符都认', () => {
    expect(baseName('a/b/c.png')).toBe('c.png');
    expect(baseName('a\\b\\c.png')).toBe('c.png');
    expect(baseName('c.png')).toBe('c.png');
    expect(baseName('/x/y/')).toBe('');
  });
});

describe('stripExtension', () => {
  it('去掉最后一个扩展名', () => {
    expect(stripExtension('a.bmp')).toBe('a');
    expect(stripExtension('a.tar.gz')).toBe('a.tar');
    expect(stripExtension('noext')).toBe('noext');
  });

  it('以点开头的隐藏文件不被截断', () => {
    expect(stripExtension('.gitignore')).toBe('.gitignore');
  });
});

describe('extensionOf', () => {
  it('小写返回扩展名', () => {
    expect(extensionOf('A.PNG')).toBe('png');
    expect(extensionOf('a')).toBe('');
  });
});

describe('outputFileName', () => {
  it('无后缀时只换扩展名', () => {
    expect(outputFileName('a', '', 'png')).toBe('a.png');
  });

  it('有后缀时插在下划线后', () => {
    expect(outputFileName('a', 'gray', 'png')).toBe('a_gray.png');
  });

  it('后缀两侧空白被裁掉，纯空白视为无后缀', () => {
    expect(outputFileName('a', '  gray  ', 'png')).toBe('a_gray.png');
    expect(outputFileName('a', '   ', 'png')).toBe('a.png');
  });
});

describe('joinOutput', () => {
  it('目录为空或 . 时只返回文件名', () => {
    expect(joinOutput('', 'a.png')).toBe('a.png');
    expect(joinOutput('.', 'a.png')).toBe('a.png');
  });

  it('保留目录原有的分隔符风格', () => {
    expect(joinOutput('out/sub', 'a.png')).toBe('out/sub/a.png');
    expect(joinOutput('out\\sub', 'a.png')).toBe('out\\sub\\a.png');
  });

  it('尾部多余分隔符被归一', () => {
    expect(joinOutput('out/', 'a.png')).toBe('out/a.png');
    expect(joinOutput('out\\\\', 'a.png')).toBe('out\\a.png');
  });
});

describe('sameFilePath', () => {
  it('忽略分隔符与大小写差异', () => {
    expect(sameFilePath('Out\\A.PNG', 'out/a.png')).toBe(true);
    expect(sameFilePath('out/a.png', 'out/b.png')).toBe(false);
  });
});

describe('findOutputCollisions', () => {
  it('找出会覆盖输入的输出', () => {
    expect(findOutputCollisions(['a.png', 'b.png'], ['out/a.png', 'out/b.png'])).toEqual([]);
    expect(findOutputCollisions(['a.png'], ['a.png'])).toEqual(['a.png']);
    expect(findOutputCollisions(['A.PNG'], ['a.png'])).toEqual(['a.png']);
  });
});
