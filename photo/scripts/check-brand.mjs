/**
 * 品牌串门 —— 用户看得见的那几处名字，必须与打包用的产品名一字不差。
 *
 * 为什么要有这个门：桌面页面上"照片加工 · 桌面壳"这个标题和"P6-c"角标，
 * 是开发期的内部记号被用户看见了。这类串有三个特点，决定了它靠人记不住：
 *   1. 它散在 HTML、CJS、TS 与 package.json 里（改名那天实测 11 处），而
 *      `build.productName` 是其中一处 —— 装出来的 exe 是一个名字、任务栏是
 *      另一个，只有实机打开才看得见；
 *   2. 冒烟不核对它（`SHELL_REQUIREMENTS` 只管 webPreferences 等六条），
 *      单测也够不着 HTML —— 离线状态下它是**无人看守**的；
 *   3. 它一旦漂移，改回来要靠"下次有人注意到"。
 *
 * 所以这里把源码当数据读，两条一起查：**写死的地方还跟不跟得上基准**（逐字比对），
 * 以及**该消失的串有没有复活**（旧工作标题、里程碑号、开发期叫法）。
 * 窗口标题不进门：主进程那份是 `require('../package.json').build.productName`
 * 派生的，结构上不可能分家 —— 能派生的就不要设门，门只留给派生不了的。
 *
 * 口径与 `check-version.mjs` 一致：红了就改串，不许把门改松。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'apps/desktop/index.html';
const MAIN = 'apps/desktop/electron/main.cjs';
/** 抬头带产品名的用户可见源文件。 */
const USER_FILES = [PAGE, MAIN, 'apps/cli/src/help.ts', 'apps/cli/src/report.ts'];

const productName = JSON.parse(
  readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8'),
).build?.productName;

const problems = [];
if (typeof productName !== 'string' || productName === '') {
  problems.push('apps/desktop/package.json 的 build.productName 缺失 —— 门没有可比对的基准');
}

if (problems.length === 0) {
  const read = (file) => readFileSync(join(ROOT, file), 'utf8');

  const title = /<title>([^<]*)<\/title>/.exec(read(PAGE))?.[1];
  if (title !== productName) {
    problems.push(`${PAGE} 的 <title> 是「${title}」，产品名是「${productName}」`);
  }

  const brand = /<span class="brand">([^<]*)<\/span>/.exec(read(PAGE))?.[1];
  if (brand !== productName) {
    problems.push(`${PAGE} 顶栏品牌区是「${brand}」，产品名是「${productName}」`);
  }

  /* 工程文件对话框的筛子标签：产品名 + 「工程」。下次改名而这里没跟上，
   * 用户看到的还是上一个名字 —— 它不在任何构建产物派生链上。 */
  const filter = /name: '([^']*)工程'/.exec(read(MAIN))?.[1];
  if (filter !== productName) {
    problems.push(`${MAIN} 工程筛子标签是「${filter}工程」，产品名是「${productName}」`);
  }

  /* 该消失的串不许复活：旧工作标题、里程碑号（P6-c 这类）、"桌面壳"这种开发期叫法。
   * 只放行注释行。品牌区那行不需要豁免 —— 上面逐字比对的判据要求它就是纯产品名。 */
  const BANNED = /照片加工|P\d+-[a-z]\b|桌面壳/;
  for (const file of USER_FILES) {
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (!BANNED.test(line)) return;
        const trimmed = line.trim();
        if (/^(\/\/|\/\*|\*|<!--)/.test(trimmed)) return;
        problems.push(`${file}:${i + 1} 用户可见源文件里残留旧标识：${trimmed}`);
      });
  }
}

if (problems.length > 0) {
  console.error('品牌串门未通过：');
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`品牌串门通过：产品名「${productName}」在 ${USER_FILES.length} 个用户可见源文件里逐字一致`);
