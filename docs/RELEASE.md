# 发行门槛与兼容

这里只说明怎么核对**已经提交的安装包**。这些命令不编译、不签名、不覆盖 `dist/`，也不改版本号。

纪念版游戏的版本从 `app/build.gradle` 读取，天工的版本从 `studio/build.gradle` 读取。游戏脚本选取 `dist/星火远征-纪念版-<版本>.apk`，天工脚本选取 `dist/Ember-Studio-<版本>.apk`。

## 两条命令

开发检查。缺 Android SDK 或已发布包里仍有已知缺口时，退出码是 0，最后一行是 `EXIT: INCOMPLETE`。它不表示发行完成。

```bash
python3 tools/test_verify_support.py
python3 tools/verify-release.py
python3 tools/verify-studio-release.py
node tools/test-merged-ui.js
```

严格发行门槛。缺 `java`，或缺一套完整的 build-tools（`zipalign`、`aapt`、`lib/apksigner.jar`），或已发布包相对源码仍有记录在案的资源缺口时，退出码非零，最后一行是 `EXIT: FAIL`。Java 和 SDK 分开记：没有 JDK 不会被写成 apksigner 缺失，反过来也一样。

Build-tools 不必是 34.0.0。`--build-tools` 或环境变量 `ANDROID_BUILD_TOOLS` 指定版本，并且只使用该版本，不会改去找另一个已安装版本。两者都没写时，在 `--sdk-root`、否则 `ANDROID_HOME`、再否则 `ANDROID_SDK_ROOT` 下面，选用最高的完整版本。例如本机只有 `build-tools/36.1.0` 时就会用 36.1.0。

```bash
export ANDROID_HOME=/home/box/opt/android-sdk
python3 tools/verify-release.py --strict
python3 tools/verify-studio-release.py --strict
# 或者写死版本
python3 tools/verify-studio-release.py --sdk-root /home/box/opt/android-sdk --build-tools 36.1.0 --strict
```

工具齐全时，两个当前包都应通过严格检查，摘要中 `FAIL`、`SKIP` 和 `KNOWN` 均为 0。纪念版检查包名、启动 Activity、包版本、签名、ZIP 完整性与对齐、源码资源、历史剧情及开放世界和学科试炼的 DEX 类。天工另核对首页源码、已构建页面和包内两份回退页。游戏摘要收在 `dist/SHA256SUMS.txt`，工作室摘要收在 `dist/STUDIO-SHA256SUMS.txt` 及根目录的同名文件。构建纪念版使用 `tools/build-memorial.sh`。

逻辑回归是另一条命令，不计入上面的发行摘要：

```bash
export JAVA_HOME=/path/to/jdk-17
bash tools/verify-studio.sh
```

`tools/verify-desktop.sh` 还会重写截图和桌面 jar，跑之前先留出工作区。

网页测试需要依赖。接口临时构建也依赖它：

```bash
cd studio/web && npm ci && npm test && cd ../..
python3 tools/verify-interface-fix.py
python3 tools/verify-interface-fix.py --strict
```

没有 `studio/web/node_modules` 时，接口脚本的 bundle 同步是 SKIP。开发模式写 `EXIT: INCOMPLETE`；`--strict` 失败。

CI 分别运行安装包严格校验和网页测试。即使版本或安装包检查失败，仍能看到网页回归结果。最终检查要求两项任务都成功。

## 兼容矩阵

| 包 | 包名 | 和谁占同一个安装位 |
| --- | --- | --- |
| 星火远征纪念版 | `cn.wuziping.ember.memorial` | 独立安装并保存游戏进度，可与天工同机运行。 |
| 历史游戏标准包 `WuziPing-Emberbound-0.7.1-debug.apk` | `cn.wuziping.ember` | 天工标准包。覆盖安装需要证书相同且系统允许该版本升级。 |
| 历史游戏共存包 `WuziPing-Emberbound-0.7.1-parallel-debug.apk` | `cn.wuziping.ember.preview07` | 历史天工共存包。 |
| 天工标准包 `Ember-Studio-<版本>.apk` | `cn.wuziping.ember` | 历史游戏标准包。 |

标准包和共存包使用同一张开发证书时才能各自覆盖自己的旧包。外部 0.6 是另一张证书，标准包盖不上去。

## 模拟器与 ABI

`studio/build.gradle` 去掉了 `lib/x86` 和 `lib/x86_64`。扫描模块的 ML Kit 原生库只留 ARM，用来减小真机包。已提交的天工 APK 沿用这个选择。

x86 或 x86_64 模拟器若没有 ARM 翻译，扫描相关的原生库加载不了。Gradle 注释写了：要在 x86 模拟器上试扫描，得临时去掉那段排除再重新构建。这条核对不负责重新构建。WebView 里的其他页面是否能打开，以实际模拟器结果为准。

## 历史发行记录

以下记录对应指定的旧版 APK。

- 游戏 `dist/WuziPing-Emberbound-0.7.1-debug.apk` 与共存包的 `classes.dex` 没有 `HistoryJourney`。源码和 `tools/tests/HistoryTests.java` 里有这个类。
- 同一对游戏包没有这五张图：`history_bandit.png`、`history_commander.png`、`history_ford.png`、`history_road.png`、`history_soldier.png`。它们在 `app/src/main/assets/`。包内已有的资源与源码一致；缺口是源码多出来的文件。
- 天工 `dist/Ember-Studio-0.3.18.apk` 的 `assets/studio/editor.page` 是当时的旧页。`PackedAssets` 优先读取的 `assets/studio/index.html` 与该版源码一致。
