# 桌面壳打包（electron-builder）

> `package.json` 是 JSON，写不了注释；而打包配置里**每一条都是"踩过才知道"的取舍**。
> 因此把理由集中在这里 —— 改 `build` 段之前请先读这一页。

## 产物

```bash
npm run dist -w @photo/desktop      # = electron-builder --win portable nsis
```

| 产物 | 路径 | 用途 |
|---|---|---|
| 免安装单文件 | `release/照片加工 <version>.exe` | 双击即用，给"先试试"的人 |
| NSIS 安装器 | `release/照片加工 Setup <version>.exe` | 装机、进开始菜单 |
| 解包目录 | `release/win-unpacked/照片加工.exe` | 就是打进安装器的**同一份 payload** |

`<version>` 取自 `apps/desktop/package.json` 的 `version`，它**必须等于 root 的版本** ——
`npm run check:version` 已在 `verify` 里拦住漂移（见仓库根 `README.md` 开发约定）。

打包后跑一次自检（**产物**冒烟，不是开发机冒烟）：

```bash
npm run smoke:dist -w @photo/desktop
```

## 逐条取舍

### `appId: com.zhaopian.jiagong` / `productName: 照片加工`

沿用 legacy 的标识：老用户升级时能对上同一款应用，不必出现两个"照片加工"。
主进程里的 `app.setAppUserModelId` 也写成同一个值（任务栏/通知的身份由此决定）。

### `directories.output: release` —— 只此一个输出目录，发货必打 tag

**调试期不要另开 `release2` / `release3` …**（`--config.directories.output` 临时改一下就分叉了）。

踩过的现场：P6-d 期间盘上攒出 6 个目录、**2.3 GB** 产物，全部标着同一个 `0.1.0`；
而其中最新的一份（09-16 17:08）**早于其后的三次提交** —— 于是"已发货的 exe 到底对应哪个 commit"
**没有任何东西能回答**，只能从头重构建。版本号、目录名、时间戳三者都不可信时，唯一可信的是 tag。

规矩由此定死：产物只写 `release/`；**每出一个交到用户手上的版本，立刻 `git tag v<version>`**
（产物本身不进 git —— `.gitignore` 已排除 `dist/` 与 `release*/`）。

### `signAndEditExecutable: false`

两件事被这条一起关掉，理由不同：

1. **代码签名必然失败** —— 本项目没有代码签名证书。开着它，打包会在签名步骤报错，
   而报错信息指向证书而不是配置，排查很绕。
2. **"编辑 exe"（写图标 / 版本元数据）需要额外工具链** —— electron-builder 会去取
   `winCodeSign` / `rcedit`。在受限环境（无外网、沙箱限制）里这一步会挂，
   表现为"打包失败但原因不明"。

关掉之后：产物仍可正常运行，只是**没有数字签名**（Windows SmartScreen 会提示
"未知发布者"）且**用 Electron 默认图标**（legacy 也没有自定义 icon，一致）。
将来拿到证书，把这条删掉即可。

### `electronVersion` 与 `devDependencies.electron` **必须一致且写死**

```jsonc
"devDependencies": { "electron": "33.4.11" },     // 精确版本，不带 ^
"build":           { "electronVersion": "33.4.11" }
```

两个坑叠在一起：

1. **npm workspaces 会把 `electron` 提升到仓库根** `node_modules`。
   electron-builder 在 `apps/desktop` 下找不到它，就无法推断版本，直接报
   `Cannot compute electron version from installed node modules ... is not fixed in project`。
   —— 写上 `electronVersion` 就是**绕过这个推断**，不依赖目录布局。
2. **不许用 `^`**：一旦写成 `^33.4.11`，某次 `npm install` 可能升到 33.4.12，
   而 `electronVersion` 还是 33.4.11 —— 于是"打包进去的 Electron"与
   "`npm run smoke` 跑的那个 Electron"不是同一份，冒烟绿的也不代表产物是绿的。

> 改动其中一处，必须同步另一处。这条没法用 JSON 强制，只能靠这份说明。

### `author`

electron-builder 在没有 `author` 时会告警（NSIS 安装器的发布者字段取自它）。
补一个即可，避免每次打包都刷一条无意义的警告。

### `files`：白名单，且**显式排除 `node_modules`**

```jsonc
"files": ["electron/**/*", "dist/**/*", "index.html", "smoke.html", "styles.css", "!node_modules/**/*"]
```

- 只放**运行时真的会读**的东西：主进程/preload（`electron/`）、渲染进程产物（`dist/`）、
  两个页面与样式。
- **内核不走 `node_modules`**：`@photo/core` / `@photo/io` 在
  `devDependencies`（不是 `dependencies`）—— 因为打包后的应用**不通过 npm 解析内核**，
  而是经 `extraResources` 把构建产物放在 `resources/` 下、由 `app://` 协议挂载
  （见下一节）。放在 `dependencies` 只会让 electron-builder 去复制 workspace 软链，
  把 `src/`、`tsconfig` 一并塞进 asar，既臃肿又容易在"软链 vs 实体"上翻车。

### `extraResources`：把内核产物放到 `resources/core`、`resources/io`

页面用**裸模块名**导入内核（`import { pipeline } from '@photo/core'`），
由 `index.html` / `smoke.html` 的 **import map** 映射到 `app://core/index.js`、
`app://io/index.js`。主进程的 `app://` 处理器必须把 `core` / `io` 两个 host
解析到**产物里真实存在**的目录。

源码树里那是 `packages/<pkg>/dist`；打包后自然不存在（`__dirname` 已在 `resources/app.asar` 内）。
所以用 `extraResources` 落成 `resources/core`、`resources/io`，
主进程按 `app.isPackaged` 二选一（`electron/main.cjs` 的 `CORE_DIST` / `IO_DIST`）。

> **这就是"装完白屏"的病根**：挂载点算错 → `app://core/index.js` 404 →
> 页面在 import 阶段整体失败，而窗口本身是建起来了的，所以只看得到一片空白。
> `npm run smoke:dist` 专门用来在**产物**上复验这条链路。

## 与 legacy 的关键差别

legacy 是"平铺在根目录的一堆 `.js`"，`files: ["*.js", "*.html", "*.css", ...]` 就够了。
新壳是 **TypeScript 编译产物 + 两个独立 ESM 包**，所以 `files` 与挂载路径都必须显式写清楚
—— 不能照抄 legacy 的平铺写法。
