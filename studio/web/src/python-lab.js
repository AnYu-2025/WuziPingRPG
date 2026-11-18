export const PYTHON_LABS = [
  {
    id: 'paper-folds',
    title: '折纸会叠出多少层？',
    prompt: '一张纸起初只有一层，每次对折都把已有的层数翻倍。对折 5 次，程序会打印几层？',
    starter: `folds = 5
layers = 1

for fold in range(folds):
    layers = layers * 2

print(layers)
`,
    expectedOutput: '32',
    explanation: '五次对折后依次有 2、4、8、16、32 层。循环每次都把上一次的结果再乘 2。',
    challenge: '只改 folds，让纸层数第一次超过 100。你能在运行前找出最少要折几次吗？'
  },
  {
    id: 'dry-spell',
    title: '花园最久几天没下雨？',
    prompt: '花园记录了七天的雨量，0 代表当天没有下雨。哪一段连续无雨的日子最长？预测程序打印的天数。',
    starter: `rain = [0, 0, 2, 0, 0, 0, 1]
streak = 0
longest = 0

for amount in rain:
    if amount == 0:
        streak += 1
    else:
        streak = 0
    longest = max(longest, streak)

print(longest)
`,
    expectedOutput: '3',
    explanation: '第 3 天的雨让连续天数归零。第 4 至第 6 天连着无雨，longest 把这段 3 天的纪录保留到了最后。',
    challenge: '把第 3 天的雨量从 2 改成 0。只改了一个数，原来的两段无雨期会怎样？'
  },
  {
    id: 'hall-lights',
    title: '走廊里还亮着哪几盏灯？',
    prompt: '六盏灯起初都关着。第 1 轮切换所有灯，第 2 轮切换灯号为 2 的倍数的灯，依此做到第 6 轮。最后亮着哪些灯号？用空格分隔。',
    starter: `count = 6
lights = [False] * (count + 1)

for step in range(1, count + 1):
    for lamp in range(step, count + 1, step):
        lights[lamp] = not lights[lamp]

lit = []
for lamp in range(1, count + 1):
    if lights[lamp]:
        lit.append(lamp)
print(*lit)
`,
    expectedOutput: '1 4',
    explanation: '4 号灯在第 1、2、4 轮被切换，三次后亮着。灯号的约数通常成对出现，平方数有一个和自己配对的约数，所以 1 号和 4 号灯被切换了奇数次。',
    challenge: '把 count 改成 10，先猜新亮起的灯号。再换成 16，看看你的规律是否仍然成立。'
  }
];

function text(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function labPath(value) {
  if (typeof value !== 'string' || value.length > 200) return '';
  if (/[\x00-\x1f\\:*?"<>|]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) return '';
  return value;
}

export function normalizeLabProgress(raw) {
  const progress = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return progress;
  for (const {id} of PYTHON_LABS) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const entry = raw[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const path = labPath(entry.path);
    const prediction = text(entry.prediction, 500);
    const hasRun = entry.hasRun === true;
    if (!path && !prediction && !hasRun) continue;
    progress[id] = {
      path, prediction, hasRun,
      output: hasRun ? text(entry.output, 2048) : '',
      runSource: hasRun ? text(entry.runSource, 2 * 1024 * 1024) : ''
    };
  }
  return progress;
}
