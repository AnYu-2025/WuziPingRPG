/**
 * 交付纪律门 —— 版本与打包口径漂移即红。
 *
 * 为什么要有这个门：P6-d 交付时四个包各自写着 `0.1.0`，而磁盘上的产物标着别的版本号，
 * `npm run dist` 出来的 exe 版本与仓库里任何声明都对不上，**已发货的产物无法追认到提交**。
 * 版本号这类东西靠人记住"改一处要改五处"必然失败（与 legacy 的四套绘制实现同一种病）。
 *
 * 顺带用代码钉住 `PACKAGING.md` 里那条"没法用 JSON 强制，只能靠说明"的规矩：
 * `build.electronVersion` 与 `devDependencies.electron` 必须一致且不带 `^`。
 * 一旦两者分家，"打包进去的 Electron"与"冒烟跑的 Electron"就不是同一份 —— 冒烟绿了也不代表产物是绿的。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_PACKAGES = ['packages/core', 'packages/io', 'apps/cli', 'apps/desktop'];

function readPackage(dir) {
  return JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
}

const root = readPackage('.');
const problems = [];

for (const dir of WORKSPACE_PACKAGES) {
  const pkg = readPackage(dir);
  if (pkg.version !== root.version) {
    problems.push(`${dir}/package.json 的 version 是 ${pkg.version}，root 是 ${root.version}`);
  }
}

/* CLI 的 `--version` 打给用户看的那个字符串。
 * 它是这份清单上**唯一不在 package.json 里**的版本号 —— 正因如此它漂移过：
 * 四个包都跟着 root 升到 0.7.0，而 `photo --version` 还在报 0.1.0。
 * 用正则从源码里读，不 import 构建产物：这个门要在 `npm run build` 之前就能跑。 */
const versionTs = readFileSync(join(ROOT, 'apps/cli/src/version.ts'), 'utf8');
const cliVersion = /CLI_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(versionTs)?.[1];
if (cliVersion === undefined) {
  problems.push('apps/cli/src/version.ts 里找不到 CLI_VERSION 常量（改名了？那这个门就白名单失效了）');
} else if (cliVersion !== root.version) {
  problems.push(`photo --version 会报 ${cliVersion}，root 是 ${root.version}`);
}

const desktop = readPackage('apps/desktop');
const pinnedElectron = desktop.devDependencies?.electron;
const builtElectron = desktop.build?.electronVersion;
if (typeof pinnedElectron !== 'string' || typeof builtElectron !== 'string') {
  problems.push('apps/desktop 缺 devDependencies.electron 或 build.electronVersion');
} else {
  if (pinnedElectron !== builtElectron) {
    problems.push(
      `electron 版本两处不一致：devDependencies=${pinnedElectron} build.electronVersion=${builtElectron}`,
    );
  }
  if (/^[~^]/.test(pinnedElectron)) {
    problems.push(`devDependencies.electron 必须写死精确版本，当前 ${pinnedElectron}（^ 会让某次 install 悄悄升版）`);
  }
}

if (problems.length > 0) {
  console.error('交付纪律门未通过：');
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`交付纪律门通过：六处 version = ${root.version}，electron 锁定 ${builtElectron}`);
