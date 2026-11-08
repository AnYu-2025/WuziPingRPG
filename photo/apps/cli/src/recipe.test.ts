import { describe, expect, it } from 'vitest';
import { emptyRecipe, parseRecipe, validateRecipe, type Op, type Recipe } from './recipe.js';

function parseOk(raw: unknown): Recipe {
  const result = validateRecipe(raw);
  if (!result.ok) throw new Error(`本应通过校验，却报错：${result.error}`);
  return result.recipe;
}

function parseFail(raw: unknown): string {
  const result = validateRecipe(raw);
  if (result.ok) throw new Error('本应校验失败，却通过了。');
  return result.error;
}

function firstOp(recipe: Recipe): Op {
  const op = recipe.ops[0];
  if (op === undefined) throw new Error('配方里没有操作。');
  return op;
}

describe('validateRecipe 基础形态', () => {
  it('空配方合法', () => {
    expect(parseOk({ ops: [] }).ops).toEqual([]);
    expect(emptyRecipe().ops).toEqual([]);
  });

  it('根节点必须是对象', () => {
    expect(parseFail([])).toContain('根节点必须是对象');
    expect(parseFail('x')).toContain('根节点必须是对象');
    expect(parseFail(null)).toContain('根节点必须是对象');
  });

  it('必须有 ops 数组', () => {
    expect(parseFail({})).toContain('缺少 "ops"');
    expect(parseFail({ ops: {} })).toContain('必须是数组');
  });

  it('name 缺省时用回退名', () => {
    expect(parseOk({ ops: [] }).name).toBe('recipe');
    const result = validateRecipe({ ops: [] }, 'film');
    expect(result.ok && result.recipe.name).toBe('film');
    expect(parseOk({ name: '  ', ops: [] }).name).toBe('recipe');
    expect(parseOk({ name: ' 我的配方 ', ops: [] }).name).toBe('我的配方');
  });

  it('未知操作报错并列出可用操作', () => {
    const error = parseFail({ ops: [{ k: 'setBlur', value: 3 }] });
    expect(error).toContain('setBlur');
    expect(error).toContain('setAdjust');
  });

  it('操作缺少 k 报错', () => {
    expect(parseFail({ ops: [{}] })).toContain('缺少字符串字段 "k"');
  });

  it('操作不是对象时带下标报错', () => {
    expect(parseFail({ ops: [1] })).toContain('ops[0]');
  });
});

describe('setAdjust 归一化：稀疏写法不得退化成"发黑"', () => {
  it('只写 vignette 时其余参数补成中性值', () => {
    const recipe = parseOk({ ops: [{ k: 'setAdjust', value: { vignette: 40 } }] });
    const op = firstOp(recipe);
    if (op.k !== 'setAdjust') throw new Error('操作类型不符');
    expect(op.value.vignette).toBe(40);
    // 这是本模块存在的核心理由：缺键若落到范围最小值，亮度会变成 50（发黑）。
    expect(op.value.brightness).toBe(100);
    expect(op.value.contrast).toBe(100);
    expect(op.value.saturate).toBe(100);
    expect(op.value.exposure).toBe(0);
  });

  it('拼错的字段名被明确拒绝（而非静默无效）', () => {
    const error = parseFail({ ops: [{ k: 'setAdjust', value: { brightnes: 120 } }] });
    expect(error).toContain('未知字段');
    expect(error).toContain('brightnes');
  });

  it('数值类型错误被拒绝', () => {
    expect(parseFail({ ops: [{ k: 'setAdjust', value: { brightness: '高' } }] })).toContain(
      '必须是有限数值',
    );
    expect(parseFail({ ops: [{ k: 'setAdjust', value: { brightness: NaN } }] })).toContain(
      '必须是有限数值',
    );
  });

  it('越界值被钳制而不是报错', () => {
    const recipe = parseOk({ ops: [{ k: 'setAdjust', value: { brightness: 999 } }] });
    const op = firstOp(recipe);
    if (op.k !== 'setAdjust') throw new Error('操作类型不符');
    expect(op.value.brightness).toBe(150);
  });
});

describe('applyPreset 校验：未知名必须报错', () => {
  it('未知名报错并列出可用预设（内核会静默 no-op）', () => {
    const error = parseFail({ ops: [{ k: 'applyPreset', key: 'filmm', intensity: 1 }] });
    expect(error).toContain('不是内置预设');
    expect(error).toContain('film');
  });

  it('缺少 intensity 报错', () => {
    expect(parseFail({ ops: [{ k: 'applyPreset', key: 'film' }] })).toContain('intensity');
  });

  it('强度越界报错', () => {
    expect(parseFail({ ops: [{ k: 'applyPreset', key: 'film', intensity: 1.5 }] })).toContain(
      '0..1',
    );
  });

  it('合法预设通过', () => {
    const recipe = parseOk({ ops: [{ k: 'applyPreset', key: 'bw', intensity: 0.5 }] });
    const op = firstOp(recipe);
    if (op.k !== 'applyPreset') throw new Error('操作类型不符');
    expect(op.key).toBe('bw');
    expect(op.intensity).toBe(0.5);
  });
});

describe('其余操作的补全与校验', () => {
  it('setGeometry 稀疏补全，角度受白名单约束', () => {
    const recipe = parseOk({ ops: [{ k: 'setGeometry', value: { rotate: 90 } }] });
    const op = firstOp(recipe);
    if (op.k !== 'setGeometry') throw new Error('操作类型不符');
    expect(op.value).toEqual({ rotate: 90, flipH: false, flipV: false, straighten: 0 });

    expect(parseFail({ ops: [{ k: 'setGeometry', value: { rotate: 45 } }] })).toContain('270');
    expect(parseFail({ ops: [{ k: 'setGeometry', value: { flipH: 1 } }] })).toContain('true / false');
  });

  it('setCollage 校验枚举与默认值', () => {
    const recipe = parseOk({
      ops: [{ k: 'setCollage', value: { mode: 'grid', borderWidth: 16 } }],
    });
    const op = firstOp(recipe);
    if (op.k !== 'setCollage') throw new Error('操作类型不符');
    expect(op.value.mode).toBe('grid');
    expect(op.value.borderWidth).toBe(16);
    expect(op.value.gap).toBe(8);
    expect(op.value.bg).toBe('color');

    expect(parseFail({ ops: [{ k: 'setCollage', value: { mode: 'mosaic' } }] })).toContain('single');
    expect(parseFail({ ops: [{ k: 'setCollage', value: { borderColor: '#ff0000' } }] })).toContain(
      '#ffffff',
    );
  });

  it('setWatermark 稀疏补全并校验位置', () => {
    const recipe = parseOk({ ops: [{ k: 'setWatermark', value: { text: '© 尤利乌斯' } }] });
    const op = firstOp(recipe);
    if (op.k !== 'setWatermark') throw new Error('操作类型不符');
    expect(op.value.text).toBe('© 尤利乌斯');
    expect(op.value.pos).toBe('br');
    expect(op.value.stroke).toBe(true);

    expect(parseFail({ ops: [{ k: 'setWatermark', value: { text: 'x', pos: 'middle' } }] })).toContain(
      'br',
    );
  });

  it('setSticker 校验风格与位置', () => {
    const recipe = parseOk({
      ops: [{ k: 'setSticker', value: { text: '明清易代', style: 'gold', pos: 'top' } }],
    });
    const op = firstOp(recipe);
    if (op.k !== 'setSticker') throw new Error('操作类型不符');
    expect(op.value.size).toBe(6);
    expect(parseFail({ ops: [{ k: 'setSticker', value: { text: 'x', style: 'rainbow' } }] })).toContain(
      'white',
    );
  });

  it('setCrop 允许 null，也允许部分矩形', () => {
    const cleared = parseOk({ ops: [{ k: 'setCrop', value: null }] });
    expect(firstOp(cleared).k).toBe('setCrop');

    const recipe = parseOk({ ops: [{ k: 'setCrop', value: { w: 100, h: 50 } }] });
    const op = firstOp(recipe);
    if (op.k !== 'setCrop' || op.value === null) throw new Error('操作类型不符');
    expect(op.value).toEqual({ x: 0, y: 0, w: 100, h: 50 });

    expect(parseFail({ ops: [{ k: 'setCrop', value: { w: 'x' } }] })).toContain('必须是有限数值');
  });

  it('setBands：色带是 {h,s,l} 对象，逐轴补全', () => {
    const bands = parseOk({ ops: [{ k: 'setBands', value: { red: { s: 20 } } }] });
    const bandOp = firstOp(bands);
    if (bandOp.k !== 'setBands') throw new Error('操作类型不符');
    expect(bandOp.value.red).toEqual({ h: 0, s: 20, l: 0 });
    // 未提及的色带补零，而不是缺键。
    expect(bandOp.value.orange).toEqual({ h: 0, s: 0, l: 0 });
    expect(bandOp.value.magenta).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('setBands：把色带写成数字必须被拒绝', () => {
    // 数字若被透传，内核 accumulateBandAdjust 会算出 NaN 且不报错 —— 整图颜色静默烂掉。
    const error = parseFail({ ops: [{ k: 'setBands', value: { red: 20 } }] });
    expect(error).toContain('red');
    expect(error).toContain('必须是对象');
    expect(parseFail({ ops: [{ k: 'setBands', value: { pink: { s: 1 } } }] })).toContain('未知色带');
    expect(parseFail({ ops: [{ k: 'setBands', value: { red: { s: 'x' } } }] })).toContain(
      '必须是有限数值',
    );
  });

  it('setCurves：控制点形状错误必须被拒绝', () => {
    const curves = parseOk({ ops: [{ k: 'setCurves', value: { rgb: [[0, 0], [128, 200], [255, 255]] } }] });
    const curveOp = firstOp(curves);
    if (curveOp.k !== 'setCurves') throw new Error('操作类型不符');
    expect(curveOp.value.rgb).toHaveLength(3);
    // 缺省通道补成恒等曲线。
    expect(curveOp.value.r).toEqual([[0, 0], [255, 255]]);

    expect(parseFail({ ops: [{ k: 'setCurves', value: { rgb: 'S 型' } }] })).toContain(
      '控制点数组',
    );
    expect(parseFail({ ops: [{ k: 'setCurves', value: { rgb: [[0, 0], [255]] } }] })).toContain(
      '[x, y]',
    );
    expect(parseFail({ ops: [{ k: 'setCurves', value: { rgb: [[0, 0], ['a', 1]] } }] })).toContain(
      '必须是有限数值',
    );
  });

  it('setLevels：稀疏通道补成中性，且 lo/hi/gain 越界必须报错', () => {
    const recipe = parseOk({
      ops: [{ k: 'setLevels', value: { r: { lo: 12, hi: 238, gain: 1.05 } } }],
    });
    const op = firstOp(recipe);
    if (op.k !== 'setLevels') throw new Error('操作类型不符');
    expect(op.value.r).toEqual({ lo: 12, hi: 238, gain: 1.05 });
    /* 未写的通道补成中性（lo=0 / hi=255 / gain=1），而不是 undefined。 */
    expect(op.value.g).toEqual({ lo: 0, hi: 255, gain: 1 });

    /* 未知通道名拼错 → 报错，不静默忽略。 */
    expect(parseFail({ ops: [{ k: 'setLevels', value: { red: { lo: 0, hi: 255, gain: 1 } } }] })).toContain(
      '未知通道',
    );
    /* hi 必须大于 lo：hi == lo 会让色阶退化成"阈值"，是静默改变语义。 */
    expect(
      parseFail({ ops: [{ k: 'setLevels', value: { r: { lo: 200, hi: 200, gain: 1 } } }] }),
    ).toContain('必须大于 lo');
    expect(
      parseFail({ ops: [{ k: 'setLevels', value: { r: { lo: 0, hi: 256, gain: 1 } } }] }),
    ).toContain('必须大于 lo');
    expect(
      parseFail({ ops: [{ k: 'setLevels', value: { r: { lo: 0, hi: 255, gain: 0 } } }] }),
    ).toContain('gain');
  });

  it('setSources 校验每一张源图', () => {
    const recipe = parseOk({
      ops: [
        {
          k: 'setSources',
          value: [{ id: 'a', name: 'a.png', width: 10, height: 20 }],
          current: 0,
        },
      ],
    });
    const op = firstOp(recipe);
    if (op.k !== 'setSources') throw new Error('操作类型不符');
    expect(op.value).toHaveLength(1);
    expect(op.value[0]?.width).toBe(10);

    expect(
      parseFail({
        ops: [{ k: 'setSources', value: [{ id: 'a', name: 'a.png', width: 'x', height: 1 }], current: 0 }],
      }),
    ).toContain('width');
  });

  it('多个操作按顺序保留', () => {
    const recipe = parseOk({
      ops: [
        { k: 'applyPreset', key: 'film', intensity: 1 },
        { k: 'setGeometry', value: { rotate: 180 } },
        { k: 'setAdjust', value: { grain: 5 } },
      ],
    });
    expect(recipe.ops.map((op) => op.k)).toEqual(['applyPreset', 'setGeometry', 'setAdjust']);
  });
});

describe('parseRecipe 文本入口', () => {
  it('非法 JSON 报错并带出原因', () => {
    const result = parseRecipe('{ oops }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('不是合法 JSON');
  });

  it('合法 JSON 走同一套校验', () => {
    const result = parseRecipe('{"name":"x","ops":[{"k":"setGeometry","value":{"flipV":true}}]}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.name).toBe('x');
    const op = firstOp(result.recipe);
    if (op.k !== 'setGeometry') throw new Error('操作类型不符');
    expect(op.value.flipV).toBe(true);
  });

  it('回退名可从文件名推导', () => {
    const result = parseRecipe('{"ops":[]}', 'legacy-basic');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.name).toBe('legacy-basic');
  });
});
