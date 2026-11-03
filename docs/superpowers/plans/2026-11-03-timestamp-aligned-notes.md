# 时间码对齐笔记 — 实现规格书

> **执行 agent 注意：** 本文档是完整的实现规格。你需要在 WuziPingRPG 项目的 Studio 编辑器基座（v0.1.12）上新增「上课」模式，实现录音 + 笔记 + 时间轴同步。所有文件路径相对于 `D:\大学生软件创新大赛\WuziPingRPG`。

---

## 1. 项目概述

**目标：** 在手机上上课时，同时录音频、记笔记、拍 PPT 照片，三者按时间轴自动对齐。复习时点笔记任意一行 → 音频跳到对应位置 + 显示对应 PPT 页。

**30 秒演示剧本：**
1. 打开天工 → 选「上课」→ 点录音
2. 边录音边记笔记（每行笔记自动带时间戳）
3. 导入一张 PPT 照片，手动标记锚点
4. 停止录音 → 点笔记第二行 → 音频跳到对应位置，右侧显示 PPT

**评分对应：**
- 题材创新：笔记 + 录音 + PPT 三合一，市面上没有
- 技术深度：端侧音频分析 + 锚点检测 + 时间轴同步
- 应用价值：大学生上课刚需

---

## 2. 基座现状（Studio v0.1.12）

执行前需要了解的现有架构：

### 2.1 启动页与模式系统
- **文件：** `studio/web/src/app.js` 行 160-188
- **现有模式：** `python` / `notepad` / `game`
- **模式选择器：** `#modeWheel` 内的 `.wheel-item` 按钮，`data-mode` 属性
- **模式应用：** `applyMode(mode)` 函数（行 174），通过 `workspaceMode` 变量 + `body.notepad` 类名切换
- **模式持久化：** `localStorage` 的 `ember-studio-mode` 键

### 2.2 编辑器与文件管理
- **编辑器：** CodeMirror 6，实例在 `view` 变量
- **文件列表：** `state.files` 数组，每个文件 `{path, text, uri, encoding, savedText}`
- **工作区保存：** `flush()` → `snapshot()` → `StudioBridge.postMessage({type:'snapshot', data})`
- **工作区恢复：** `restore(data)` → `loadState(data)` → `createEditor()`

### 2.3 Android 宿主
- **文件：** `studio/src/main/java/cn/wuziping/studio/EditorActivity.java`
- **权限：** 已有 `INTERNET`，**需要新增 `RECORD_AUDIO`**
- **WebView 设置：** `setJavaScriptEnabled(true)`, `setDomStorageEnabled(true)`
- **资源服务：** `AssetServer` + `PackedAssets`，CSP 策略在 `loadPackagedPage()` 中内联

### 2.4 构建流程
- **前端构建：** `studio/web/build.mjs` — esbuild 打包 `src/app.js` → `../src/main/assets/studio/app.js`，复制静态文件
- **APK 构建：** `tools/build-studio.ps1` — aapt2 打包 + normalize-apk-assets.py + zipalign + apksigner
- **验证：** `tools/verify-studio-release.py`

### 2.5 关键约束
- **APK 大小：** 当前 ~15.8MB，新增功能需控制增量
- **离线优先：** 所有功能必须在无网络下工作
- **CSP 策略：** `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`
- **目标浏览器：** Chrome 64+（Android WebView）

---

## 3. 功能需求

### 3.1 核心功能（MVP）

| ID | 功能 | 描述 |
|----|------|------|
| F1 | 录音 | 开始/暂停/停止录音，显示录音时长，波形可视化 |
| F2 | 锚点检测 | 录音中自动检测语音段（能量 VAD），生成锚点列表 |
| F3 | 时间戳笔记 | 笔记每行自动记录创建时的录音时间戳 |
| F4 | 同步回放 | 点笔记行 → 音频跳到对应时间；播放中笔记自动高亮当前行 |
| F5 | PPT 照片 | 导入照片，手动标记锚点（"这张 PPT 从这个时间开始"） |
| F6 | 三栏布局 | 左：笔记编辑；中：时间轴 + 锚点；右：PPT 照片 |

### 3.2 增强功能（MVP 后）

| ID | 功能 | 描述 |
|----|------|------|
| F7 | 锚点编辑 | 拖拽调整锚点时间，合并/拆分锚点 |
| F8 | 导出 | 导出笔记为 Markdown（含时间戳链接），导出音频为 WAV |
| F9 | 多节课管理 | 课程列表，切换不同录音会话 |

### 3.3 非功能需求

- **录音质量：** 44.1kHz / 16bit / mono（语音足够）
- **锚点精度：** ±1 秒
- **最大录音时长：** 2 小时（受限于内存，base64 存储）
- **启动时间：** 从点录音到可录音 < 500ms
- **APK 增量：** < 2MB（不引入大型 ML 模型）

---

## 4. 技术方案

### 4.1 音频录制

```
MediaRecorder API (getUserMedia → MediaRecorder → webm/opus blob)
```

**为什么选 MediaRecorder：**
- Android Chrome 64+ 原生支持
- 输出 webm/opus，体积小（~1MB/小时）
- 不需要额外编解码库

**权限：** Android `RECORD_AUDIO`（危险权限，需要运行时请求）

**录音流程：**
```
用户点录音 → 请求麦克风权限 → getUserMedia({audio:true})
  → MediaRecorder.start() → 每 1s 收集 chunk → 同时送 AudioContext 分析
  → 用户点停止 → MediaRecorder.stop() → 合并 blob → 转 base64 存工作区
```

### 4.2 锚点检测（能量 VAD）

**算法：** 基于 RMS 能量的简单语音活动检测

```javascript
// 每 500ms 计算一次 RMS
function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

// 动态阈值：过去 10 秒的平均能量 * 1.5
// RMS > 阈值 → 语音段开始
// RMS < 阈值 * 0.5 持续 2 秒 → 语音段结束（沉默）
// 语音段中点 → 锚点
```

**锚点类型：**
- `speech`：语音段中点（自动）
- `silence`：长沉默段起点（自动，>3 秒沉默）
- `manual`：用户手动标记（PPT 切换等）

**参数：**
| 参数 | 值 | 说明 |
|------|-----|------|
| 分析窗口 | 500ms | RMS 计算间隔 |
| 阈值倍数 | 1.5x | 相对滚动平均 |
| 沉默判定 | 2s | 低于阈值 0.5x 持续 2 秒 |
| 最小语音段 | 1s | 过滤噪声 |

### 4.3 时间轴同步

**数据结构：**
```
录音 blob (base64) → 创建 URL.createObjectURL(blob) → <audio> 元素
锚点数组 [{time, type, label}] → 时间轴渲染
笔记数组 [{time, text, anchorId, slideId}] → 笔记列表
```

**同步逻辑：**
```
播放中：audio.ontimeupdate → 找当前时间对应的笔记行 → 高亮
点击笔记：note.time → audio.currentTime = note.time → audio.play()
点击锚点：anchor.time → audio.currentTime = anchor.time
```

### 4.4 存储方案

**录音存储：** base64 编码存工作区 JSON（`lecture.audio.data`）
- 优点：随工作区自动保存/恢复
- 缺点：2 小时录音 ~7MB base64，工作区 JSON 变大
- 缓解：限制最大录音时长 2 小时，超出提示导出

**PPT 照片存储：** base64 存工作区 JSON（`lecture.slides[].data`）
- 压缩：导入时 resize 到最大宽度 1024px，JPEG quality 0.8
- 限制：最多 50 张

---

## 5. UI/UX 设计

### 5.1 启动页改动

**文件：** `studio/web/src/index.html` + `studio/web/src/app.js`

在 `#modeWheel` 中新增第四个选项：
```html
<button class="wheel-item" data-mode="lecture" role="option" aria-selected="false">
  <span class="wheel-icon">🎙</span>
  <span class="wheel-text">
    <strong>上课</strong>
    <small>录音 · 笔记 · 时间轴</small>
  </span>
</button>
```

**配色：** 琥珀色（`#b45309` 背景 `#fff6e6`），与 Python(青绿)、Notepad(湖蓝)、Game(琥珀) 区分

**模式索引更新：** `01/04` → `04/04`

### 5.2 上课模式布局

```
┌─────────────────────────────────────────┐
│ ☰  录音中 · 00:12:34    🎙 ⏸ ⏹  ⋯     │  ← 录音控制栏
├──────────┬──────────────────┬───────────┤
│          │  ▌  ▌     ▌  ▌   │           │
│  笔记    │  时间轴波形       │  PPT      │
│  编辑区  │  ─●────●──●────  │  照片     │
│          │  00:00  05:23    │  列表     │
│  第1行   │                  │           │
│  第2行 ← │  [+标记锚点]     │  [+导入]  │
│  第3行   │                  │           │
├──────────┴──────────────────┴───────────┤
│ 草稿已保存  第 2 行  ·  3 个锚点          │  ← 状态栏
└─────────────────────────────────────────┘
```

**响应式：**
- **手机竖屏（<600px）：** 单栏，底部 Tab 切换「笔记/时间轴/PPT」
- **手机横屏/平板（≥600px）：** 三栏布局
- **桌面（≥900px）：** 三栏，时间轴固定高度 120px

### 5.3 录音控制栏

**元素：**
- `#recordTimer`：录音时长 `MM:SS` 或 `HH:MM:SS`
- `#recordBtn`：录音按钮（圆，红色脉冲动画）
- `#pauseBtn`：暂停/继续
- `#stopBtn`：停止（隐藏，录音中显示）
- `#anchorBtn`：手动标记锚点（录音中可点）

**状态：**
| 状态 | 按钮显示 |
|------|---------|
| 未录音 | 🎙 开始录音 |
| 录音中 | ⏸ 暂停 + ⏹ 停止 + 📌 标记 |
| 暂停中 | ▶ 继续 + ⏹ 停止 + 📌 标记 |
| 已停止 | ▶ 播放 + 🎙 新录音 |

### 5.4 时间轴可视化

**Canvas 绘制：**
- 宽度：容器宽度
- 高度：80px（手机）/ 120px（桌面）
- 波形：从 AudioBuffer 绘制 RMS 包络线
- 锚点标记：竖线 + 小圆点，颜色区分类型
  - `speech`：青绿色 `#0f766e`
  - `silence`：灰色 `#9ca3af`
  - `manual`：琥珀色 `#b45309`
- 播放头：红色竖线，随播放移动
- 点击时间轴：跳到对应时间

### 5.5 笔记区

**改动：** 在 CodeMirror 编辑器基础上，每行左侧显示时间戳徽章

```
00:03  老师讲了傅里叶变换的定义
00:15  公式：F(ω) = ∫f(t)e^(-iωt)dt
00:42  应用场景：信号处理、图像压缩
```

**实现方式：** CodeMirror `decorations` 或行号区域扩展
- 简单方案：在行号 gutter 显示时间戳（复用 gutter 机制）
- 时间戳格式：`MM:SS`，超过 1 小时用 `HH:MM:SS`

### 5.6 PPT 照片区

**布局：** 右侧栏，照片列表（缩略图 + 时间标签）
- 点击照片 → 放大查看
- 点击锚点 → 跳到对应时间
- 导入按钮：触发文件选择器（图片）

---

## 6. 数据模型

### 6.1 工作区扩展

在现有 `state` 中新增 `lecture` 字段：

```javascript
state.lecture = {
  active: false,           // 是否在上课模式
  recording: false,        // 是否正在录音
  paused: false,           // 是否暂停
  startTime: 0,            // 录音开始时间戳 (Date.now())
  elapsed: 0,              // 已录音时长 (ms)，含暂停
  audio: {
    data: null,            // base64 音频数据 (webm/opus)
    duration: 0,           // 总时长 (秒)
    blobUrl: null          // ObjectURL (运行时，不保存)
  },
  anchors: [],             // 锚点列表
  slides: [],              // PPT 照片列表
  notes: []                // 时间戳笔记（可选，也可用 CodeMirror 行装饰）
};
```

### 6.2 锚点结构

```javascript
{
  id: "a1",                // 唯一 ID
  time: 15.3,              // 时间 (秒)
  type: "speech",          // "speech" | "silence" | "manual"
  label: "傅里叶定义",      // 用户可编辑标签
  slideId: null            // 关联的 PPT 照片 ID
}
```

### 6.3 PPT 照片结构

```javascript
{
  id: "s1",
  name: "slide_001.jpg",
  data: "data:image/jpeg;base64,...",  // 压缩后的 base64
  width: 1024,
  height: 768,
  anchorTime: 23.5,        // 关联的锚点时间
  createdAt: 1700000000000
}
```

### 6.4 工作区 JSON 示例

```json
{
  "version": 1,
  "files": [...],
  "active": "notes.md",
  "opened": ["notes.md"],
  "stdin": "",
  "settings": {"fontSize": 15, "wrap": true, "timeLimit": 15},
  "lecture": {
    "active": true,
    "recording": false,
    "audio": {
      "data": "base64...",
      "duration": 1834.5
    },
    "anchors": [
      {"id": "a1", "time": 15.3, "type": "speech", "label": "傅里叶定义"},
      {"id": "a2", "time": 120.0, "type": "manual", "label": "PPT 第2页", "slideId": "s1"}
    ],
    "slides": [
      {"id": "s1", "name": "slide_001.jpg", "data": "data:image/jpeg;base64,...", "width": 1024, "height": 768, "anchorTime": 120.0}
    ]
  }
}
```

---

## 7. 文件改动清单

### 7.1 新建文件

| 文件 | 职责 |
|------|------|
| `studio/web/src/lecture.js` | 上课模式主逻辑：录音控制、锚点检测、同步回放 |
| `studio/web/src/audio-engine.js` | 音频引擎：MediaRecorder 封装、AudioContext 分析、波形数据 |
| `studio/web/src/timeline.js` | 时间轴 Canvas 渲染：波形、锚点、播放头 |
| `studio/web/src/lecture.css` | 上课模式专属样式（三栏布局、录音栏、时间轴） |

### 7.2 修改文件

| 文件 | 改动 |
|------|------|
| `studio/web/src/index.html` | 新增第四个 wheel-item（上课），新增录音控制栏 HTML，新增三栏布局容器 |
| `studio/web/src/app.js` | 新增 `lecture` 模式处理，`applyMode` 增加 lecture 分支，启动页索引改为 04/04 |
| `studio/web/src/style.css` | 新增上课模式样式（录音栏、三栏、时间轴、笔记时间戳） |
| `studio/web/build.mjs` | 复制新文件到 assets |
| `studio/src/main/AndroidManifest.xml` | 新增 `<uses-permission android:name="android.permission.RECORD_AUDIO" />` |
| `studio/src/main/java/.../EditorActivity.java` | 运行时请求 RECORD_AUDIO 权限 |
| `tools/verify-studio-release.py` | 新增上课模式相关检查 |

---

## 8. 实现步骤

### Phase 1：录音基础设施（1-2 天）

**目标：** 能录音、能播放、数据能保存恢复

**Step 1.1：Android 权限**
- 文件：`AndroidManifest.xml`
- 添加：`<uses-permission android:name="android.permission.RECORD_AUDIO" />`
- 文件：`EditorActivity.java`
- 添加：运行时权限请求（`requestPermissions`），在 `onCreate` 中检查

**Step 1.2：音频引擎**
- 文件：`studio/web/src/audio-engine.js`
- 实现：
  - `class AudioEngine` — 封装 MediaRecorder + AudioContext
  - `start()` — 请求权限 → getUserMedia → MediaRecorder.start()
  - `stop()` — 停止录制 → 合并 chunk → 返回 blob
  - `getAnalyser()` — 返回 AnalyserNode 供外部读取波形
  - `getRMS()` — 当前 RMS 值
  - `play(blob)` — 创建 audio 元素播放
  - `seek(time)` — 跳到指定时间

**Step 1.3：录音控制栏 UI**
- 文件：`studio/web/src/index.html`
- 添加录音控制栏 HTML（在 appbar 下方）
- 文件：`studio/web/src/lecture.css`
- 录音栏样式（红色脉冲按钮、计时器）

**Step 1.4：集成到 app.js**
- 文件：`studio/web/src/app.js`
- 添加 `lecture` 模式到 `applyMode()`
- 录音按钮事件绑定
- 录音状态管理（recording/paused/stopped）

**Step 1.5：数据持久化**
- 录音停止后 → base64 编码 → 存 `state.lecture.audio.data`
- 恢复时 → base64 解码 → 创建 blob → 可播放

### Phase 2：锚点检测 + 时间轴（2-3 天）

**Step 2.1：能量 VAD**
- 文件：`studio/web/src/audio-engine.js`
- 添加：录音中每 500ms 计算 RMS，维护滚动平均
- 添加：语音段检测逻辑（阈值交叉）
- 添加：锚点生成（语音段中点）

**Step 2.2：锚点数据结构**
- 文件：`studio/web/src/lecture.js`
- 添加：`anchors` 数组管理
- 添加：手动标记锚点功能（`#anchorBtn` 点击）

**Step 2.3：时间轴渲染**
- 文件：`studio/web/src/timeline.js`
- 实现：Canvas 绘制波形包络线
- 实现：锚点标记（竖线 + 圆点）
- 实现：播放头（随 audio.ontimeupdate 移动）
- 实现：点击时间轴跳转

**Step 2.4：集成**
- 文件：`studio/web/src/lecture.js`
- 录音中实时更新波形
- 录音停止后渲染完整波形 + 锚点

### Phase 3：笔记同步 + PPT（2-3 天）

**Step 3.1：笔记时间戳**
- 文件：`studio/web/src/lecture.js`
- 录音中，笔记每行创建时记录 `Date.now() - startTime`
- 在 CodeMirror gutter 或行装饰中显示时间戳

**Step 3.2：同步回放**
- 文件：`studio/web/src/lecture.js`
- `audio.ontimeupdate` → 找当前时间对应的笔记行 → 高亮
- 点击笔记行 → `audio.currentTime = noteTime` → `audio.play()`

**Step 3.3：PPT 照片**
- 文件：`studio/web/src/lecture.js`
- 导入图片 → resize 压缩 → base64 存 `state.lecture.slides`
- 手动标记锚点时关联当前照片
- 右侧栏显示照片列表

**Step 3.4：三栏布局**
- 文件：`studio/web/src/lecture.css`
- 响应式三栏（手机单栏 + Tab 切换，桌面三栏）

### Phase 4：打磨 + 验证（1-2 天）

**Step 4.1：UI 打磨**
- 录音按钮脉冲动画
- 时间轴缩放（长录音时）
- 笔记时间戳样式

**Step 4.2：边界情况**
- 录音中切换模式 → 提示先停止录音
- 工作区恢复时音频 blob 重建
- 录音超过 2 小时 → 提示导出

**Step 4.3：验证脚本**
- 文件：`tools/verify-studio-release.py`
- 新增：上课模式基础检查（录音按钮存在、时间轴渲染、锚点点击）

---

## 9. 验收标准

### 9.1 功能验收

| ID | 验收项 | 通过条件 |
|----|--------|---------|
| V1 | 录音启动 | 点录音 → 请求权限 → 计时器开始走动 |
| V2 | 录音停止 | 点停止 → 音频可播放 |
| V3 | 锚点自动生成 | 录音 30 秒 → 至少 3 个 speech 锚点 |
| V4 | 手动锚点 | 录音中点标记 → 锚点列表新增 manual 锚点 |
| V5 | 笔记时间戳 | 录音中记笔记 → 每行显示 MM:SS |
| V6 | 同步回放 | 点笔记行 → 音频跳到对应时间 |
| V7 | 播放高亮 | 播放中 → 当前笔记行高亮 |
| V8 | PPT 导入 | 导入照片 → 右侧显示缩略图 |
| V9 | 数据持久化 | 关闭重开 → 录音和锚点恢复 |
| V10 | 响应式 | 360×640 无横向溢出 |

### 9.2 性能验收

| 指标 | 目标 |
|------|------|
| 录音启动延迟 | < 500ms |
| 波形渲染（1 小时） | < 200ms |
| 锚点检测延迟 | < 100ms |
| APK 增量 | < 2MB |

### 9.3 兼容性验收

- Android 8.0+ (API 26+)
- Chrome 64+ / WebView 64+
- 离线可用（不依赖网络 API）

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| MediaRecorder 在旧 WebView 不可用 | 录音功能失效 | 检测 API 可用性，降级提示 |
| base64 存储导致工作区过大 | 保存/恢复慢 | 限制录音 2 小时，提示导出 |
| 能量 VAD 误检（噪声环境） | 锚点不准 | 提供手动调整锚点功能 |
| Android 权限被拒绝 | 无法录音 | 友好提示 + 设置引导 |
| 长时间录音内存不足 | 崩溃 | 分 chunk 存储，限制时长 |

---

## 11. 后续迭代方向

- **自动转录：** 集成端侧 Whisper tiny（~75MB，可选下载）
- **PPT 自动检测：** 音量突变 + 画面变化检测自动标记 PPT 切换
- **导出 Markdown：** 笔记 + 时间戳 + 音频链接导出
- **多节课管理：** 课程列表 + 搜索

---

## 12. 参考资源

- MediaRecorder API: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- CodeMirror 6 Decorations: https://codemirror.net/docs/ref/#view.Decoration
- Android 运行时权限: https://developer.android.com/training/permissions/requesting
