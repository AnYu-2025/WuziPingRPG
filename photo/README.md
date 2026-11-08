# 浮生图梦 · Photo Studio

本地优先的跨端修图工具。**同一内核**，适配桌面 / Web / 移动 / 无头批处理。

> 目标：对标并超越商业级修图软件。
> 详细架构决策与路线图见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 当前状态

**架构重构进行中。** 内核（`@photo/core`）已落地并通过测试，旧版应用原样保留在 `legacy/`。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | git 仓库 + 基线 + 工程规范 | ✅ 完成 |
| P1 | TypeScript strict + Vitest + CI | ✅ 完成 |
| P2 | `packages/core` 内核抽取 | ✅ 完成 |
| P3 | 文档模型 + 操作栈 + undo/redo | ✅ 完成 |
| P4 | RenderPlan 统一渲染（预览 / 导出 / 封面同源） | ✅ 完成 |
| P5 | 执行层：阶段缓存 + Worker 池 + 内存预算 | ✅ 完成 |
| P6 | 多端铺开 | 🔄 进行中 |
| P6-a | `packages/io`：零依赖编解码 + 格式探测 + 注册表 | ✅ 完成 |
| P6-b | `apps/cli`：Node 无头批处理（含 PNG 编解码器） | ✅ 完成 |
| P6-c | **最小桌面壳**（Electron 薄壳 + 内核渲染：打开 → 导入 → 预设 → 导出） | ✅ 完成 |
| P6-d | 收尾（ESLint）→ 内存门 → 桌面打包（P0）→ 壳功能对齐 → 真实 Worker / auto 增强 / 预设分享格式 | 🔄 序 0–6、4.5、9 ✅；剩 序7 多端 / 序8 分块调研 → **转入 P6-e** |
| **P6-e** | **真实照片可用性收口**：EXIF 与朝向进内核 → 工程文件 `photo.doc/v1` → CLI 吃 JPEG → 缓存自适应 → 多端 | 📋 计划已定，未开工（`docs/P6E-PLAN.md`） |
| P7 | 插件宿主 + 开放文档格式 | 待开始 |

`legacy/` 是重构基线（v0.11.0 Electron 版）。它需要单独安装依赖才能运行：

```bash
cd legacy && npm install && npm start
```

> **`legacy/` 已进入冻结状态**：只接受致命 bug 修复（崩溃 / 数据丢失 / 静默错图），
> **不加功能、不重构、不升级依赖**。P6-c 的首个"可双击版本"产出后，它降级为历史版本。
> 判据与流程见 [`docs/P6C-PLAN.md`](docs/P6C-PLAN.md) §2。

---

## 快速开始

```bash
npm install        # 安装全部 workspace 依赖
npm run verify     # 交付纪律门（版本一致）+ 规范（ESLint）+ 构建（core → io → cli → desktop）+ 类型检查 + 全部单元测试
npm run check:version  # 仅核对五处 version 与 electron 锁定版本
npm run lint       # 仅代码规范检查（ESLint，正确性优先，不含格式化）
npm run test       # 仅跑测试（不需要先构建）
npm run build      # 构建全部包产物
```

### 桌面壳（P6-c）

```bash
npm run start -w @photo/desktop    # 启动桌面应用
npm run smoke                      # 冒烟自检：真实 Electron 渲染进程里跑完整链路（21 项）
npm run shot  -w @photo/desktop -- tmp/ui.png   # 截一张界面图，开发时"眼看一次"
```

> 冒烟与截图在受限环境（容器 / 无 GPU / 沙箱无法初始化）里会自动加
> `--disable-gpu --no-sandbox`，**只影响自检，不影响正式运行**。
> 想要严格模式设 `PHOTO_SMOKE_STRICT_SANDBOX=1`。
> 注意：自检里 `sandbox` 一项核对的是 Electron 的渲染沙箱**偏好**，
> 与 OS 级沙箱不是一回事 —— 别把绿报告读成"OS 沙箱已启用"。

> 跨包 `import` 一律解析到 workspace 软链指向的**构建产物**，
> 因此 typecheck / build CLI 之前必须先构建 core 与 io —— `verify` 已按此顺序编排。

---

## 目录结构

```
packages/
  core/                  纯 TypeScript 内核，零平台依赖
    src/
      geometry/          几何与布局数学（宽高互换的唯一入口）
      color/             色彩空间 · 曲线 LUT · HSL 分色 · 直方图
      presets/           参数模型与预设（纯数据）
      nlp/               中文口语指令 → 结构化意图
      document/          文档模型与操作栈（单一真相源）
      pixels/            纯像素原语（采样 / 仿射 / 光栅化 / 模糊 / 色彩 / 效果）
      ops/               每个渲染阶段一个纯函数执行器
      pipeline/          RenderPlan 与唯一执行引擎
        plan / execute     要做什么 + 怎么做
        cache              阶段缓存 + 前缀复用（只重算变化的下游）
        scheduler          Worker 池端口抽象（平台无关，可测）
        memory             执行前的峰值内存预判
        shell              外壳契约（含 backgroundThrottling 等强制项）
      types.ts           共享基础类型（PixelBuffer 等）
  io/                    图片编解码层，同样零平台依赖
    src/
      bmp / ppm          内置的零依赖格式（任何端都能跑）
      detect             按 magic bytes 探测格式 + 平台编解码器注册表
apps/
  cli/                   Node 无头批处理外壳（批处理 / CI / 服务端）
    src/
      args               命令行解析（未知选项直接报错）
      recipe             配方 = 可序列化的操作日志（补全 + 强校验）
      render             批处理引擎（纯逻辑，零 Node 依赖）
      report             人读 / 机读两种输出
      node-png           基于 node:zlib 的 PNG 编解码器（注册进 io 的注册表）
      node-io / main     真实文件读写与接线
    examples/            示例配方（含性能实测用的 bench-heavy.json）
    scripts/             端到端冒烟样例生成器 + 真实性能实测（make-photo / bench）
  desktop/               Electron 桌面壳（P6-c：薄壳 + 内核渲染）
    electron/
      main.cjs           主进程：窗口生命周期 + 文件对话框 + 冒烟收口（**不含内核代码**）
      preload.cjs        contextBridge 白名单（四个方法，最小面）
    src/
      session.ts         EditSession：外壳侧唯一状态持有者（**零 DOM**，可单测）
      surface.ts         画布能力窄接口（刻意结构化，不用 DOM 类型）
      shell-adapter.ts   **唯一**碰 Canvas/OffscreenCanvas/createImageBitmap 的文件
      text-renderer.ts   文字栅格化（内核排版 + 外壳画字）
      image-io.ts        外壳侧 PNG/JPEG 编解码（异步，与 io 同步注册表并列）
      bytes.ts           逐字节比较（"逐字节一致"是本项目的核心断言形态）
      renderer/app.ts    DOM 接线（控件 → session → canvas）
      smoke.ts           渲染进程内的冒烟自检
      canvas-fakes.ts    假画布测试替身（**不进产物**）
    index.html           正式页面（含 import map）
    smoke.html           冒烟页面
legacy/                  重构基线：v0.11.0 Electron 版（已冻结，见 docs/P6C-PLAN.md）
docs/                    架构文档
  ARCHITECTURE.md        架构与路线图（含决策记录 D1–D11）
  P6C-PLAN.md            P6-c 桌面壳里程碑（含"冒烟发现了什么"）
  P6D-PLAN.md            P6-d 里程碑：多端铺开 + 桌面壳对齐 + 大图内存策略
  P6E-PLAN.md            P6-e 里程碑：真实照片可用性收口（EXIF/朝向 · 工程文件 · CLI JPEG · 缓存自适应）
  DESKTOP-PARITY.md      内核能力 ↔ 壳接线 对齐台账（逐项打勾）
```

---

## 内核设计要点

### 1. 零平台依赖，编译期强制

`packages/core` 的 `tsconfig` 里 `lib` 只有 `ES2022`，没有 DOM，也没有 Node 类型。
**一旦核心里出现 `document` / `window` / `ImageData` / `process`，编译立即失败。**

像素数据用自定义的 `PixelBuffer`——它与 DOM 的 `ImageData` 结构完全一致，
因此浏览器侧的 `ImageData` 可以直接传入，不需要任何转换。

### 2. 几何量不靠人脑记顺序

历史缺陷 P1-1：横图旋转 90° 时，绘制尺寸被算成 `788×1400`（宽高比 0.563）
而原图是 `1600×900`（1.778），画面横向压扁 3.16 倍。根因是
`drawOne(img, x, y, h, w)` 这样的签名要用脑记住"第四第五个参数是宽还是高"。

现在所有几何 API 只接受 `Size` / `Rect` / `Point` 结构体，
宽高互换只有一个合法入口：

```ts
rotatedSize(src: Size, rotate: Rotate): Size
drawSizeFor(canvasSize: Size, rotate: Rotate): Size
```

并且测试不是"挑几个用例"，而是**枚举所有宽高比 × 所有角度的不变量**：
绘制尺寸必须恰好铺满画布，且宽高比必须等于原图。

### 3. 文档是单一真相源，撤销 = 移动指针

```ts
interface PhotoDocument {
  baseline: EditState;      // 基线状态
  ops: readonly Op[];       // 操作序列，每个 op 只是「把某类状态设为某值」
  cursor: number;           // 生效操作数；撤销/重做只改这个数字
  settings: DocumentSettings;
  view: ViewState;
}
```

- **不存像素**：一条 `{ k:'setCrop', value:{ x,y,w,h } }` 是几十字节，
  而 legacy 存的是整张图的 base64（4000×3000 PNG 约 20–50 MB / 条）。
- **撤销语义天然对称**：不存在 legacy 那种"旋转能撤销、滑杆撤销无效"的不一致。
- **白送的能力**：项目文件、预设分享、批处理脚本、JSON diff、版本控制。

渲染状态由 `deriveEdit(doc)` 从 `ops` 投影得出，**不做第二份存储**，
因此不存在"状态与历史不一致"的可能。

### 4. 一条渲染管线，多个分辨率

`pipeline` 把「要做什么」（`RenderPlan`，纯数据）与「怎么做」（`executePlan`，唯一实现）
彻底分开。预览、导出、缩略图、视频封面**全部走同一个 `buildPlan`**，
唯一差别是 `maxEdge`：

```ts
const plan = buildPlan(doc, { kind: 'export', maxEdge: 1920, withText: true });
const pixels = executePlan([sourceBuffer], plan);   // 与预览用的是同一个函数
```

- **预览怎么画的，导出就怎么画的**——这是架构保证，不是纪律要求。legacy 曾有
  四套独立绘制实现（图片预览 / 图片导出 / 视频预览 / 视频导出），必然漂移。
- **几何没有特例分支**：旋转 / 镜像 / 校正 / 缩放全部由一个逆仿射变换
  在一次重采样中完成，不存在 `if (odd) { min/max }` 那种会算错宽高的分支。
- **超尺寸不再静默**：计划在构建时产出 `PlanWarning`（如超过 3000 万像素），
  由上层展示，而不是各处 `if (w*h>上限) return`（这正是 legacy P1-3）。

### 5. 测试守护不变量，而不是守护实现

| 模块 | 覆盖重点 |
|---|---|
| geometry | 任意尺寸 × 任意角度铺满画布；宽高比不变；legacy 错误显式对照 |
| color | 曲线恒等保真、严格单调不过冲、HSV 往返误差 ≤ 1 级、色带权重连续性 |
| nlp | 冲突词排除（蓝调 / 黄昏 / 印章 / 品红 vs 红）、导出去重 |
| document | undo/redo 不变量、合并语义、预设幂等、JSON 往返、无 base64 |
| pixels | 采样越界透明、缩放保均值、模糊边缘钳制、颗粒确定性、90° 映射精确 |
| pipeline | **预览与导出同尺寸像素级一致**、旋转宽高比不变量（P1-1）、超尺寸告警（P1-3） |
| cache | **复用结果与全量重算逐字节一致**、只改末端参数则前端复用、换图全量重算、A→B→A 不污染缓存 |
| scheduler | 池并发上限、结果同序、端口抛错不挂起、dispose 后安全返回 |

### 6. 只重算变化的那一段

管线是**有序线性序列**，每个阶段只依赖「前一阶段输出 + 自己的参数」。于是
"脏节点传播"退化成一个极干净的形态：**找到第一个缓存键变化的阶段，
之前的全部复用，之后的才重算**。

```ts
const cache = new RenderCache();
cache.execute([source], plan);          // 首次：全量
// 用户只把暗角从 30 拖到 70
const { pixels, stats } = cache.execute([source], plan2);
stats.reused;   // > 0 —— 几何 / 色彩 / 调色阶段原样复用，没重算
```

改动越靠管线末端省得越多，而交互调参（滑杆 / 曲线）恰好全在末端。
缓存的正确性由 `cache.test.ts` 的**「复用结果 === 全量重算结果」**逐字节锁定——
这条不变量保证了缓存永远不会"快但画错"。

配套的 `memory.estimateMemory(plan)` 让你在**执行之前**就知道峰值内存，
而不是像 legacy 那样先 `new Float32Array(w*h*3)` 分配了才发现是 288 MB。

而 `memory.gateExport(input)` 把这份预估**升级成决策**（绝不静默）：

| 决策 | 条件 | 动作 |
|---|---|---|
| `run` | 预计峰值 ≤ 预算 | 直接导出 |
| `downscale` | 超预算、降采样可行 | 降到**预算内最大长边**并告知实际尺寸 |
| `confirm` | 超预算、用户锁原尺寸或降不下来 | 风险摊到台面上，知情后执行 |
| `reject` | 超过硬上限（默认 4 GB） | 明确拒绝，不让它崩 |

预算默认 2 GB（`PHOTO_MEMORY_BUDGET_MB` 可覆盖）。判定是**纯函数**，因此 CLI / 桌面 / web /
移动端共用**同一条规则**——壳只负责把 `ExportGate` 翻译成对话框或命令行行为。

---

## 开发约定

- 行尾统一 LF（见 `.gitattributes`），跨平台协作不产生整文件 diff 噪音。
- **版本号只在 root `package.json` 一处**（其余四个 workspace 包必须与之一致），`npm run check:version`
  是 `verify` 的第一道门，漂移即红。**交到用户手上的每个版本必须打 tag** —— P6-d 那批安装包没有 tag，
  于是"已发货的 exe 对应哪个提交"至今无法追认。教训见 `docs/P6E-PLAN.md` 序0。
- 提交信息使用中文，遵循 `type: 摘要` 形式（feat / fix / refactor / docs / chore / test）。
- `packages/core` 内不得引入任何平台 API——CI 会拦住。
- 跨包引用只走一条规则：解析到 `node_modules` 里的构建产物。
  不要用 `paths` 指向别包源码（会让构建报 TS6059），也不要用 project references。
- **JSON / 项目文件这类无类型输入走双防线**：边界（`apps/cli/src/recipe.ts#normalizeOp`）
  负责补全 + 强校验，写错了要吵；内核（`packages/core/src/document/sanitize.ts`）负责兜底，
  绝不静默碎图（缺失字段会让仿射角变 `NaN`，整张图碎掉且不报错）。
  新增任何读 JSON 的入口，都必须复用前者。参见 `docs/ARCHITECTURE.md` §5.3(b)。
- 每个修复真实缺陷的改动，都要在测试里留下对应的**回归用例**。
