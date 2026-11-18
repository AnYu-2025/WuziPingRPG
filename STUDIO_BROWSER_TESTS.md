# 工作室首页浏览器回归

`node tools/test-merged-ui.js` 检查网页卡片与模块登记表。`--browser` 在 412 × 800 的 Chromium 窗口里打开实际打包用的网页。测试使用临时浏览器配置，退出后会关闭浏览器，结果输出到终端。

测试覆盖以下操作。

- 在学习区和编程区间切换，刷新后保留选择。
- 从编程区新建独立 Python 草稿，运行 `print(6 * 7)` 并检查终端输出 42。返回首页并刷新后，检查草稿正文。
- 从学习区打开记忆卡片，按返回键回到学习区。
- 从医学刷题错题生成复习卡，再次打开错题时检查制卡状态。
- 在全部工具里切换列表和星穹，从列表下方进入 AI 再返回，检查滚动位置。
- 分别用关闭按钮、Esc 和系统返回的网页入口关闭收纳弹层，检查焦点是否回到收纳按钮。
- 关闭 WebGL 后，确认卡片目录仍能打开，按钮和返回键均可回工作区。

## 在本地运行

从仓库根目录打开两个终端。第一个终端只在本机提供已打包的网页资源。

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory studio/src/main/assets/studio
```

在另一个 PowerShell 终端运行以下命令。网页依赖已经安装时，修改前端源码后可先运行 `npm --prefix studio/web run build` 更新预览。

```powershell
$browserDir = Join-Path ([IO.Path]::GetTempPath()) 'ember-studio-browser'
npm install --prefix $browserDir --no-save playwright@1.63.0
& "$browserDir/node_modules/.bin/playwright.cmd" install chromium
$env:NODE_PATH = "$browserDir/node_modules"
$env:STUDIO_PREVIEW_URL = 'http://127.0.0.1:8765/index.html'
node tools/test-merged-ui.js --browser
```

测试成功时输出包含 `browser: true`、新建文件名、返回前后的滚动位置和捕获的网页错误。用 Ctrl+C 关闭预览。Linux CI 对应命令见 `.github/workflows/verify-entrypoints.yml` 的 `web` 任务。

浏览器用 `Studio.back()` 调用 Android 宿主使用的网页路由，并用测试桥模拟草稿保存。物理返回键、输入法及 Android 进程回收后的恢复仍需设备验证。

早期接口场景脚本 `studio/tests/interface-fix-checks.js` 使用外部注入的 `page`、`context`、`assert` 和 `expect`，从 `STUDIO_ROOT` 和 `STUDIO_URL` 读取项目和预览地址。省略 `STUDIO_URL` 时使用 `build/studio/preview-url.txt`。
