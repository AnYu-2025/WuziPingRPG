# 天工

一个可安装的 Android 手机代码编辑器原型，优先支持离线 Python，并将《伍子平 · 星火远征》0.7 放入娱乐区。不是微软 VS Code 的移植，界面使用 CodeMirror 6，Python 使用随 APK 打包的 Pyodide 0.27.7 / CPython 3.12.7。

## 安装与原游戏进度

| 安装包 | 包名 | 对应旧版 |
| --- | --- | --- |
| `dist/Ember-Studio-0.1.2-debug.apk` | `cn.wuziping.ember` | 本地原签名的 0.5 / 0.7 标准版 |
| `dist/Ember-Studio-0.1.2-parallel-debug.apk` | `cn.wuziping.ember.preview07` | 0.7 共存试玩版 |

版本代码均为 10。选择与手机上 0.7、星火代码 0.1.0 或天工 0.1.1 相同的版本直接覆盖安装，编辑器成为应用首页，原 `journey-v1.bin` 游戏存档沿用；**不要先卸载旧版**。签名和包名的一致性已检查，实际 Android 覆盖安装尚未实机验收。外部构建的 0.6 采用另一张证书，不能被标准包覆盖；试玩包可以共存，但不能直接读取外部 0.6 的私有存档。

娱乐区点击「进入游戏」，仍是原生 Canvas 游戏。游戏中按 Android 返回键可选择「保存并返回编辑器」，标题界面按返回键直接回到编辑器。进入后选择「继续旅程」续玩。娱乐区也提供 `.wzpsave` 存档导出、导入；导入先验证格式，再确认替换，并在私有目录保留一份原进度备份。

## 已实现

- 手机横竖屏代码编辑、多文件标签与文件列表、行号、语法高亮、缩进、括号配对、撤销重做、查找替换和快捷符号行。
- Python、JavaScript、HTML/CSS、JSON、C/C++、Java、Markdown、TypeScript 的高亮；其他文本可编辑。C/C++、Java、TypeScript 这一版没有编译器。
- Android 系统文件选择器打开多个文件、导入文件夹，原文件授权后可写回；新文件使用系统「另存为」。不申请整个手机存储访问权限。
- UTF-8、带 BOM 的 UTF-16、GB18030 文本导入，写回时保留记录的编码；另存统一为 UTF-8。二进制文件不进入文本编辑器。
- 编辑草稿自动写入应用私有工作区，与原手机文件的「保存」分开。文件授权失效或写回失败时保留草稿。
- 导入文件夹保留顶层目录，避免不同项目混名；导入同名文件保留原模块名，原稿移入 `_草稿备份`，不会默默丢弃旧稿。
- Python 离线执行、预填多行标准输入、输出与异常堆栈、文件名和行号、项目模块导入，以及工作区文本文件读写。
- JavaScript 独立工作线程运行；异步代码应使用 `await`。HTML 在独立原生预览页面运行，本地 CSS / JS 可相对引用。
- 手动停止、15/30/60 秒运行上限、约 6.5 万字符输出上限与输出分批，防止死循环和连续打印拖住编辑页面。
- 字号、长行换行、深浅色设置自动保存。娱乐区与编辑区使用不同的存档文件。

## 使用方法

首次启动有 `main.py`、`geometry.py`、`data.json` 和 `index.html` 示例。默认标准输入是「伍子平」，直接点击运行可看到真实 Python 输出。

1. 点击左上角文件按钮，打开文件或导入项目文件夹。
2. 选中要运行的 `.py` 入口文件。运行时工作目录设为入口文件所在目录；同目录模块和数据可使用相对路径。
3. 有 `input()` 的程序先在「标准输入」填写，每行对应一项；内容用完后返回 EOF，不会无限等候。
4. 点击运行，查看输出、报错。运行期间文件只读，可立即停止；停止后继续编辑。
5. 草稿自动保留。点击保存才会写回已授权的原文件；新文件先选择手机上的保存位置。

桌面键盘支持 Ctrl+S 保存、Ctrl+Shift+S 另存、Ctrl+F 查找替换、Ctrl+Enter / F5 运行、Ctrl+O 打开、Ctrl+N 新建。

## 当前范围

Python 是 WebAssembly 环境，支持常用标准库，不是手机系统级 CPython 或完整终端。没有 pip 安装、任意本机扩展包、系统 shell、VS Code 插件、LSP、Git 面板或调试断点。工作区传入运行环境的文本统一为 UTF-8。程序正常结束或报错时回收新增/修改的 UTF-8 文本文件；强制停止不回收未完成的文件变化，文件删除仅作用于本次运行。

单个导入文件最多 2 MB，工作区最多 160 个文件，一次导入最多 12 MB，目录深度最多 10 层；缓存目录和二进制文件跳过并提示。不是 PDF、Office 文档或所有二进制格式的查看器。项目中的图片附件暂不导入。

运行资源全部在 APK 内，代码无需上传服务器。应用的 INTERNET 权限用于只监听 `127.0.0.1` 的本机资源服务；编辑器与预览使用不同页面，预览没有原生文件接口，运行线程也没有原生文件接口。界面与工作区草稿通过受控消息连接到 Android。预览默认阻止外部网络请求。

## 验证与剩余验收

游戏核心 354 项回归、文件/资源服务 30 项 Java 检查、30 项浏览器集成检查。浏览器中执行的是随 APK 打包的真实 Python WASM，包含中文输入、语法/运行错误、项目导入、文件回收、重启恢复、停止与超时、打印上限和四组屏幕尺寸。原生桥的浏览器检查使用协议模拟；不等于 Android 文件选择器实测。

`artifacts/studio-v0.1/` 保存检查结果、构建日志与 APK 验证记录。**尚未进行 Android 真机安装、覆盖升级、输入法、多点触控、SAF 文件提供器、游戏返回及音频的设备验收。** 需要系统 WebView 支持现代 JavaScript、Web Worker 与 WebAssembly。

## 构建

```powershell
# 已检入离线 Web bundle 和 Python 运行文件时，不需要 npm 或网络
.\tools\build-studio.ps1 -SkipWebBuild
.\tools\build-studio.ps1 -SkipWebBuild -ParallelInstall

# 修改编辑器前端后
npm --prefix studio/web ci --no-audit --no-fund
npm --prefix studio/web run build
.\tools\build-studio.ps1 -SkipWebBuild

.\tools\verify-studio.ps1
python .\tools\verify-studio-release.py
python .\tools\package-studio-source.py
```

需要 JDK 17、Android SDK Platform 34 / Build Tools 34.0.0。构建默认复用 `build/manual/debug.keystore`，也可通过 `-SigningKey` 指向自己的 Android 调试密钥。私钥不进入 Git 或源码压缩包；使用新密钥的 APK 不能覆盖旧签名应用。首次重新获取 Python 文件使用 `tools/fetch-python-runtime.ps1`，许可证使用 `tools/fetch-studio-licenses.ps1`。

前端源文件在 `studio/web/src`，Android 宿主在 `studio/src/main/java`。`app` 仍可独立构建原游戏；`studio` 复用原游戏 Java 代码与素材，未替换已有 0.7 安装包。原生入口仅在带 `editorHost` 参数时显示返回编辑器选项。

运行环境来源：[Pyodide 固定版本部署文档](https://pyodide.org/en/0.27.7/usage/downloading-and-deploying.html)、[Worker 执行文档](https://pyodide.org/en/0.27.7/usage/webworker.html)。第三方许可证和上游源代码地址随 APK 收录在 `assets/studio/licenses/`；npm 精确依赖在 `studio/web/package-lock.json`。游戏中的奶龙角色沿用用户指定素材，并非项目原创形象。
