# 浮生图梦 · 目标架构与重构路线图

> 状态：**RFC（待确认）** · 起草于 2026-09-14 · 基线 commit `8d308e6`（v0.11.0）
> 目标：对标并超越商业级修图软件；同一内核适配桌面 / Web / 移动 / 无头批处理。

---

## 0. 一句话结论

当前 v0.11 的 5 个缺陷（含 2 个 P0）**不是独立失误，而是同一套架构在按规律批量生产它们**。
只打补丁，下个版本会长出同类的新 bug。本方案要把生产 bug 的那台机器换掉。

---

## 1. 病根诊断：为什么这些 bug 是"必然"的

### 病根 1 — 同一套语义，四套独立实现（← P1-1 的根因）

| 场景 | 实现位置 | 手段 |
|---|---|---|
| 图片预览 | `renderer.js drawOne()` | Canvas2D 逐段绘制 |
| 图片导出 | `renderer.js paintSingleTo()` | Canvas2D 另一套绘制 |
| 视频预览 | `video.js applyVidFilters()` | CSS `filter` + overlay `div` |
| 视频导出 | `video.js drawVFrame()` | Canvas2D `filter` + `globalCompositeOperation` |

同一句"亮度对比饱和色温暗角"，被写了四遍。
**四份实现必然漂移** —— P1-1（横图旋转预览变形、导出却正确）就是这个病的第一个临床症状。

> 商业软件的做法：**一条渲染管线，多个输出分辨率**（proxy / preview / full / thumbnail）。
> 不控制在一个管线里，就永远无法承诺"所见即所得"。

### 病根 2 — 状态散落，且 UI 控件本身就是状态存储（← P1-2 的根因）

```js
const S = { brightness:100, ... };   // 参数散在全局
let rotation=0, straighten=0, flipH=false, flipV=false;  // 几何散在全局
let GRADE = defaultGrade();          // 调色散在 grade.js
let images=[], cur=0;                // 资产散在全局
// 并且：滑杆 DOM 的 value 才是真值，S 只是它的影子
```

撤销靠手工 `snap()` 打快照，于是同一份撤销栈上出现了**两套语义**：
- 旋转/预设：先 `snap()` 再改 → 快照是旧值 → 撤销正确
- 滑杆：先改再 `snap()` → 快照是新值 → **撤销无效**

代码里那句注释「撤销语义可接受」，是架构欠债的自白。

### 病根 3 — 操作是即时副作用，不可序列化（← P0-2 的根因）

裁剪和自动增强**直接改写** `images[cur].img.src`，撤销只能靠"把整张图再存一份"。
→ 于是 `snapWith({ imgSnap:{ src } })` 把 20–50MB 的 base64 字符串压进 30 条栈。
→ 内存必然爆。

根子在于：**项目没有"文档"这个概念，只有"当前像素"**。

### 病根 4 — 像素计算在主线程，且是全量命令式流水线（← P1-4 / P1-5 的根因）

- 所有 `getImageData` / `boxBlur` 跑在 UI 线程 → 卡顿
- 只为了显示一个"预估文件大小"，就调 `paintSingleTo` 把整条管线重跑一遍
- 没有节点级缓存：改一个"亮度"，曲线 / HSV 互转 / 卷积全部无差别重算
- `boxBlur` 无尺寸守卫，`enhanceCanvas` 超限静默 `return`

### 病根 5 — 没有内核／外壳边界（← 多端无法落地的根因）

`renderer.js` 一个文件里同时装着：状态管理、Canvas 绘制、DOM 事件绑定、文件 IO、EXIF 解析、ZIP 打包、撤销栈。

要出 Web 版 / 移动版，等于把这 1038 行重写 N 遍。

### 病根 6 — 零类型、零测试、零契约（← P1-1 能"活着"的根因）

- 几何计算传的是裸数字 `drawOne(img, border, border, h, w)`，宽高互换靠人脑记
- 模块间靠 `window.xxx` + `typeof` 守卫互调，没有显式接口
- README 宣称"单测已验数学"，仓库里**没有任何测试文件**

> 如果 P1-1 那种 bug 有测试，`1600×900 + rotate90` 一个用例就抓出来了。
> 之所以活了 5 个版本，是因为**没有任何东西在替人记这件事**。

---

## 2. 目标架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────────┐
│  apps/    外壳层：只负责平台能力与窗口生命周期              │
│            desktop(Electron) · web · mobile(Capacitor) · cli │
├──────────────────────────────────────────────────────────┤
│  packages/ui        跨端 UI 组件 + 设计令牌 + 键盘/手势映射  │
├──────────────────────────────────────────────────────────┤
│  packages/render    渲染后端：Canvas2D / WebGL2 / WebGPU /  │
│                     Node-Skia  +  Worker 调度 + 节点缓存     │
├──────────────────────────────────────────────────────────┤
│  packages/io        解码 · 编码 · EXIF · 批量 · ZIP          │
├──────────────────────────────────────────────────────────┤
│  packages/core      ★ 纯 TS，零平台依赖 ★                    │
│    document/  文档模型与操作栈（单一真相源）                 │
│    pipeline/  RenderPlan DAG + 脏节点传播                    │
│    ops/       每个操作一个纯函数（ImageData → ImageData）     │
│    color/     色彩空间 · 曲线 LUT · HSL · 直方图             │
│    geometry/  旋转 · 裁剪 · 拼图 · 切图 的坐标数学            │
│    presets/   预设（纯数据）                                 │
│    nlp/       口语解析（本地规则，可插 AI）                   │
│    schema/    文档 / 预设 / 插件的 zod 校验                  │
└──────────────────────────────────────────────────────────┘
          ▲ core 不 import 任何 DOM / Electron / Node API
          ▲ core 可以原样跑在：浏览器 · Worker · Electron · Node · 移动端 WebView
```

### 2.2 四大支柱

#### 支柱 A — Document：单一真相源

```ts
// packages/core/src/document/schema.ts
export interface PhotoDocument {
  readonly version: 1;
  sources: SourceRef[];        // 只存引用（file handle / blob id / path），不存像素
  ops: Op[];                   // 有序操作栈，完全可序列化
  cursor: number;              // 撤销 = 移动指针，不是丢弃数据
  view: ViewState;             // 缩放、页签等非破坏性状态
}

export type Op =
  | { k: 'adjust';   params: AdjustParams }
  | { k: 'curve';    chan: Chan;  points: readonly Point[] }
  | { k: 'hsl';      band: Band;  h: number; s: number; l: number }
  | { k: 'geometry'; rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; straighten: number }
  | { k: 'crop';     rect: Rect }
  | { k: 'collage';  mode: CollageMode; gap: number; bg: BgMode }
  | { k: 'watermark'; text: string; pos: WmPos; ... }
  | { k: 'sticker';  text: string; style: StickerStyle; ... };
```

**一次解决三件事**：
- **P0-2 内存**：撤销栈里存的是 `{k:'crop', rect}` 这样几十字节的数据，不是 30MB 的 base64
- **P1-2 撤销语义**：不再需要手工 `snap()`，`pushOp` 天然带"改前状态"语义
- **白送的能力**：项目文件可保存/可分享/可 diff/可版本控制、预设可导出、批处理可脚本化、未来可协作

#### 支柱 B — RenderPlan：一条管线，多个分辨率

```ts
// 预览、导出、视频封面、批处理 —— 全部走这一个入口
export function buildPlan(doc: PhotoDocument, target: RenderTarget): PlanGraph;
export interface RenderTarget {
  kind: 'preview' | 'export' | 'thumbnail' | 'video-frame';
  maxEdge: number;      // 预览 1400 / 导出按设置 / 缩略图 256
  backend: 'canvas2d' | 'webgl2' | 'webgpu' | 'node';
}
```

预览与导出**共用同一个 PlanGraph**，唯一差别是 `maxEdge`。
→ **P1-1 从根上不可能再发生**：预览怎么画的，导出就是怎么画的，只是尺寸不同。
→ **P1-3 也消失**：超尺寸限制在 Plan 层统一裁决，并给出可见提示，而不是各处 `return`。

#### 支柱 C — 执行层：Worker + 节点缓存 + GPU

```ts
// 每个操作节点带缓存键（输入指纹 + 参数哈希）
interface PlanNode {
  id: string;
  op: Op;
  deps: string[];
  cacheKey(inputHash: string): string;
}
```

- **脏节点传播**：改"亮度"只重算亮度及其下游，曲线 / HSV / 卷积复用缓存
- **Worker 池（P6-d 序 5 已落地）**：像素计算离开 UI 线程。内核 `PixelWorkerPort`
  端口 + 外壳真 Worker（`apps/desktop/src/worker-port.ts` / `worker/render-worker.ts`）。
  24MP 源、连续 6 帧调参实测：**主线程最长停顿 16.8ms，内联执行 300.0ms**。
- **同一通道也载导入解码（P6-e 序 3.5）**：协议多一条 `decode` 请求，JPEG 字节交给
  这条已在跑的 Worker 解，解完的像素走 transfer list 零拷贝送回。"走不走 Worker"
  收敛成端口的一个方法，外壳其余部分不知道有线程这回事；失败只降级不失败（D17 代价②）。
- **后端可换**：WebGPU/WebGL2 做着色器实时预览，Canvas2D 兜底，Node 做无头批处理
- **能力探测**：启动时探测并自动降级，同一份 UI 代码跑在弱机与强机上

→ 一并解决 **P1-4 / P1-5 / P1-6**，并且这是"超越商业软件"的性能位。

#### 支柱 D — 类型 + 测试 + CI：让 bug 不可能活过 5 个版本

```ts
// packages/core/src/geometry/types.ts —— 用类型把"宽高互换"这类错误拦在编译期
export type Px = number & { readonly __unit: 'px' };
export type Deg = number & { readonly __unit: 'deg' };
export type Percent = number & { readonly __unit: '%' };

export interface Size { readonly w: Px; readonly h: Px }
export interface Rect { readonly x: Px; readonly y: Px; readonly w: Px; readonly h: Px }

/** 旋转后画布尺寸：奇数直角旋转交换宽高 —— 唯一入口，别处不许手写 */
export function rotatedSize(size: Size, rotate: 0|90|180|270): Size;
```

测试矩阵（Vitest）：

| 目标 | 用例 |
|---|---|
| 色彩数学 | 曲线单调性 / 恒等保真 / 端点；rgb2hsv↔hsv2rgb 往返误差 < 1e-6 |
| 几何 | **`1600×900 + rotate90` 断言输出尺寸与宽高比**（正是 P1-1 漏掉的那个用例） |
| 文档模型 | undo/redo 不变量：任意操作序列后 `apply(doc) === apply(undo(doc))` |
| 管线 | 预览与导出在同尺寸下像素级一致（写死"一致性"这条契约） |
| 快照 | 固定样例图的渲染结果哈希，防回归 |

CI（GitHub Actions）：`typecheck → lint → test → build(desktop/web/mobile) → release`。

---

## 3. 多端策略

**关键判断：把"能在多端跑"这件事，变成一个编译目标的问题，而不是重写的问题。**

| 端 | 方案 | 复用什么 | 备注 |
|---|---|---|---|
| 桌面 | Electron（保留现状内核技术） | core + render + ui | 主进程改 async、补安全加固 |
| Web | Vite 静态站 | core + render + ui | 同一份代码，File System Access API 拿本地文件 |
| 移动 | Capacitor 包装 Web 版 → Android / iOS | 同上 | UI 走响应式 + 触摸手势映射 |
| 无头/服务端 | Node CLI | **仅 core + render(node 后端)** | 批量处理、自动化，商业软件多半拿这个收费 |

因为 `core` 零平台依赖、`ui` 只依赖 DOM 抽象，移动端不是"重写一个阉割版"，而是**同一内核换壳**。

> 未来若要原生移动体验（RN），`core` 可无损迁移 —— 这是把核心抽干净换来的期权。

---

## 4. 对标商业软件的落点（拒绝口号，逐项给机制）

| 维度 | 商业软件常见短板 | 本项目的超越机制 |
|---|---|---|
| 实时性能 | 4K 实时调色吃 GPU，低端机卡 | GPU 后端 + 节点缓存 + 自动降级 |
| 批处理 | 桌面端要装、云端要订阅 | 同一 core 跑 Node CLI，可 CI / 可服务化 |
| 自动化 | 脚本语言门槛高 | 口语指令层 + 完全可序列化 ops（一句 JSON 或一句话） |
| 项目文件 | 私有二进制格式 | 开放 JSON 文档：可 diff、可 review、可进 git |
| 跨端一致性 | 移动端是阉割版 | 同 core，能力对齐 |
| 安装体量 | 安装包数百 MB | 核心零依赖，后端按需加载 |
| 可扩展 | 插件生态封闭 | 插件宿主 + 开放预设/导出格式 |
| 撤销语义 | 各家不一 | 契约化 + 测试锁死 |

---

## 5. 路线图（每阶段结束都可运行、可回滚）

| 阶段 | 交付物 | 验证方式 | 解决的病根 |
|---|---|---|---|
| **P0 ✅ 已完成** | git 仓库 + 基线提交 `8d308e6`（v0.11.0 入 `legacy/`）+ .gitignore/.gitattributes + .editorconfig | `git log` 可识别为重命名 / working tree clean | — |
| **P1 ✅ 已完成** | npm workspaces + TS strict（7.0）+ Vitest（5.0）+ GitHub Actions CI + `npm run verify` | typecheck 零错误；构建产物完整 | 病根 6 |
| **P2 ✅ 已完成** | `packages/core`：`geometry` / `color` / `presets` / `nlp` 四层落地并补单测 | 内核脱离 DOM 全测通过（**含 P1-1 的旋转维度不变量用例**） | 病根 5、6 |
| **P3 ✅ 已完成** | `document` 层：PhotoDocument + Op 栈 + undo/redo + 合并语义 | undo/redo 不变量测试；**P0-2、P1-2 已在模型层关闭** | 病根 2、3 |
| **P4 ✅ 已完成** | `pixels` 纯像素原语 + `ops` 每阶段执行器 + `pipeline`（RenderPlan 构建 + 唯一执行引擎），预览/导出/封面/缩略图同源；超尺寸改为显式 `PlanWarning` | 预览与导出同尺寸像素级一致；**P1-1、P1-3 端到端关闭** | 病根 1 |
| **P5 ✅ 已完成** | 执行层：`cache`（阶段缓存 + 前缀复用）· `scheduler`（Worker 池端口抽象）· `memory`（执行前峰值预判）· `shell`（外壳契约）· `pixels` 卷积 scratch 复用 | 改动越靠管线末端复用越多；**P1-4、P1-5、P1-6 关闭** | 病根 4 |
| **P6 🔄 进行中** | **已交付：**`packages/io`（零依赖 BMP/PPM + magic 探测 + 平台编解码器注册表）· `apps/cli`（Node 无头批处理：参数解析 / 配方校验 / 批处理引擎 / 报告 / 基于 zlib 的 PNG 编解码器 / 端到端整链测试 / 冒烟样例 / 真实性能实测）· 内核 `document/sanitize` 安全网（**D7 静默碎图关闭**）· **`apps/desktop` 最小桌面壳**（Electron 薄壳 + 内核渲染，含 21 项真实渲染进程冒烟）<br>**待交付：** **P6-d**（定义见 `docs/P6D-PLAN.md`，推进顺序 序 0–9）—— **序 0** 收尾（tag ✅ / ESLint）· **序 1 g1 内存门** · **序 2 桌面打包（P0：当前唯一"用户拿不到东西"的缺口 —— 能双击的还只是 legacy 旧 exe）** · **序 3–4** 桌面壳功能对齐（台账 `docs/DESKTOP-PARITY.md`）· **序 5–7** web / mobile(Capacitor) + 真实 Worker / Canvas2D / WebGPU 适配器 · **序 8** 分块导出调研 · **序 9** 预设分享格式（24MP 导出实测 1.28 GB，50MP 会破 3 GB 安全线，须由准入策略回答） | **341 个测试全绿**（core 181 + io 17 + cli 106 + desktop 37）；桌面壳**冒烟 21/21**（含 PNG 编码→解码往返逐字节还原、正式页面加载与上屏、窗口配置逐条核对）；CLI 报告的阶段序列由测试与内核独立重算结果逐项比对；**BMP → 内核 → PNG → 解码 整链像素级等价**；**稀疏 `setGeometry` 与显式完整写法渲染逐字节相同**；24MP 真实照片实测见 §5.4 | 病根 5 |
| **P6-e 🔄 进行中**（序0–3 已交付，序4–5 待开） | **真实照片可用性收口**（定义见 `docs/P6E-PLAN.md`）：**序0** 交付纪律（版本单一真相源 + 门）· **序1** EXIF/朝向进内核（D12/D13）· **序2** 工程文件 `photo.doc/v1` + #4 自定义预设（D14）· **序3** 手写零依赖 JPEG 解码 + CLI 文字诚实化（D15）· **序4** 缓存自适应 + 分块调研结论 · **序5** web → Capacitor（承接 P6-d 序7） | 各序验收 X1–X5 / D1–D4 / C1–C4 / M1–M3 / A4 见 `P6E-PLAN.md` §3 | 病根 5 的剩余面（**真实输入**：EXIF 朝向、JPEG、跨会话） |
| **P7 生态** | 插件宿主 + 开放文档格式 + 预设分享 | 第三方插件示例跑通 | — |

### 5.1 已完成部分的实际交付（截至 2026-09-14）

```
packages/core/src/
  types.ts              PixelBuffer（与 ImageData 结构兼容，但不依赖 DOM）
  geometry/             types · transform（旋转/缩放/裁剪坐标）
                        → 20 个测试
  color/                curve（Fritsch–Carlson 单调三次）· hsv · hsl · histogram
                        → 35 个测试
  presets/              params（范围/中性值/强度插值）· builtin（11 个预设）
  nlp/                  types（结构化 Intent）· parse（中文本地规则）
                        → 33 个测试
  document/             types（Op 联合类型）· defaults · reducer · history
                        sanitize（无类型输入安全网：补全 + 有限性 + 白名单，
                                  内核出口统一收敛，消灭"静默碎图"）
                        identity（源图指纹）· doc-share（工程文件 photo.doc/v1）
                        preset-share（自定义预设文本）
                        → 89 个测试（document 24 + preset-share 24 + sanitize 18
                                    + identity 12 + doc-share 11）
  metadata/             exif（零依赖 EXIF/APP1 解析）· orientation（朝向折进逆仿射）
                        → 39 个测试（exif 19 + orientation 20）
  pixels/               sampling（双线性，越界透明）· affine（矩阵）
                        raster（几何光栅化：旋转/镜像/校正/缩放/边框/露边模糊底，
                                单一逆映射重采样）· resize（面积平均 + 双线性）
                        blur（滑动窗口 O(n)）· compose（填充/混合/线段）
                        color（亮度对比饱和曝光/色温/曲线/HSL 分调）
                        effects（磨皮/锐化去雾/暗角/颗粒/雨雾）
                        → 41 个测试（pixels 17 + slice 12 + auto 12）
  ops/                  stages（每阶段一个纯函数执行器）· collage（拼图合成）
                        text（排版数学 + TextRenderer 能力接口，零字体依赖）
  pipeline/             types（RenderTarget/RenderStage/RenderPlan/PlanWarning）
                        plan（buildPlan：EditState → 阶段序列）
                        execute（executePlan：唯一执行引擎，无状态）
                        cache（RenderCache：阶段缓存 + 前缀复用 + 源指纹 + 快照张数按预算推导）
                        scheduler（PixelWorkerPort + WorkerPool + InlinePort）
                        memory（estimateMemory：执行前峰值预判；gateExport：四分支准入决策；
                               cacheBudgetFor：由同一个预算推导"留几张阶段快照"）
                        shell（SHELL_REQUIREMENTS：外壳契约，含 P1-6）
                        → 71 个测试（pipeline 23 + cache 21 + scheduler 11 + memory 16）
```

```
packages/io/src/
  types.ts              RasterImage（与 PixelBuffer 结构完全一致，刻意不 import core）
  bmp.ts                零依赖 BMP（24/32 位、行 4 字节对齐、正负高度），
                        调色板 / RLE 明确报错
  ppm.ts                零依赖 PPM（P6 / P5，跳注释头）
  detect.ts             按 magic bytes 探测（不看扩展名）+ createRegistry 平台能力注册表
                        → 68 个测试（含 jpeg 28）
```

```
apps/cli/src/
  args.ts               命令行解析（未知选项/非法取值/越界一律报错，不静默忽略）
  paths.ts              输出命名与"覆盖输入"护栏（纯字符串，跨平台可测）
  recipe.ts             配方 = 可序列化的操作日志；稀疏补全 + 强校验
  render.ts             批处理引擎（零 Node 依赖，可离线测试）
  report.ts             人读 / 机读两种输出
  node-png.ts           基于 node:zlib 的 PNG 编解码器（注册进 io 的注册表）
  node-registry.ts      Node 端能力装配
  node-io.ts / main.ts  真实文件读写与接线（唯一的副作用层）
  pipeline.integration.test.ts
                        整链像素级测试：配方 JSON → 归一化 → BMP 解码 → 内核
                        → PNG 编码 → PNG 解码，断言逐字节/多重集等价
  examples/             示例配方（film-90 / bench-heavy）
  scripts/make-sample.mjs
                        端到端冒烟样例生成器（四象限+渐变 BMP，输出到 tmp/ 不入库）
  scripts/make-photo.mjs
                        高熵"照片感"大图生成器（实测性能用，纯色图会让编码耗时失真）
  scripts/bench.mjs     真实性能实测编排（一场景一进程，冷启动 + 缓存复用两组数据）
  scripts/bench-one.mjs 单场景测量（峰值 RSS 取进程高水位，故必须独立进程）
  scripts/bench-compare.mjs
                        跨周性能基线对比（CI 周跑，回退只发 `::warning::` 不红）
                        → 136 个测试（含行为契约测试与整链像素级测试，见下）

apps/desktop/src/
  session.ts            EditSession：外壳侧唯一状态持有者（**零 DOM**，故可单测）
  surface.ts            画布能力窄接口（结构化，不用 DOM 类型）
  shell-adapter.ts      **唯一**碰 Canvas / OffscreenCanvas / createImageBitmap 的文件
  text-renderer.ts      文字栅格化（排版在内核，画字在外壳）
  image-io.ts           外壳侧 PNG/JPEG 编解码（异步，与 io 的同步注册表并列）
  bytes.ts              逐字节比较（"逐字节一致"是本项目的核心断言形态）
  renderer/app.ts       DOM 接线（控件 → session → canvas）
  smoke.ts              渲染进程内的冒烟自检（真实 Electron 里跑）
  canvas-fakes.ts       假画布测试替身（**不进产物**）
  worker-port.ts        真 Worker 端口：握手 · 源图按 key 复用 · 运行期**永久**降级回内联
                        "JPEG 走不走 Worker"的唯一决策点也在这里（序3.5）
                        内存预算从这里一根线传到底：Worker 侧与降级后的内联侧必须是同一个数（序4）
  worker/protocol.ts    端口 ↔ 引擎的消息形状（渲染任务 + `decode` 请求；
                        解码失败是 `decode-error`，**不与"通道坏了"混用**）
  worker/engine.ts      纯 `handle(request) → response | null`：边界以内零平台调用，
                        文字栅格器与 JPEG 解码器都是**注入**进来的
  worker/render-worker.ts
                        唯一持有 `self` 的文件；结果与解码像素都走 transfer list
  worker-graph.test.ts  Worker 模块图闸门：图里出现**值级别的裸说明符**即判红
                        （import map 不作用于 Worker，序3 的回归就出在这条上）
  icon.test.ts          图标容器闸门：**另起炉灶**写一份 ICO/PNG 解析与 CRC32，
                        不与生成器共享代码 —— 共享就会一起错、永远绿
                        → 本目录合计 127 个测试：session 68（F 同源 / H 缓存复用 /
                          撤销重做 / 文字落像素）· worker-port 25 · image-io 18
                          · text-renderer 8 · icon 5 · worker-graph 3

apps/desktop/assets/
  icon.ico              应用图标「月相」，8 档尺寸（16/20/24/32/40/48/64/256）
  icon.png              256px 母图
                        ↑ 两者都由 scripts/make-icon.mjs 从**一份归一化参数**光栅化，
                        不是"画一张大图再缩放"—— 后者在 16px 上必糊。
                        verify 不跑生成器，跑的是**已提交的那份 .ico**
```

**合计 659 个测试，32 个测试文件，全部通过**（core 328 + io 68 + cli 136 + desktop 127），
外加桌面壳的**真实渲染进程冒烟**（`npm run smoke`，项数以实机跑出来的为准 —— 清单在
`smoke.ts` 的 `checks.push`，离线闸门数不到它）。
**P6-e 序1–4 往冒烟里加的断言全部还没实机跑过** —— 清单见 `P6E-PLAN.md` 各序的"实机待办"。
上面那张图的分模块计数已在 P6-e 序4 重算过一遍（此前是序3.5 的快照）。
**还有一类数字只能由 `npm run bench -w @photo/cli` 给**：24MP 的耗时与内存（§5.4），
以及"默认预算下缓存到底复用了几个阶段" —— bench 里那条**复用门**红了就说明缓存又形同不存在。

CLI 这一层的测试里有四条值得一提：

1. **`renderOne` 与内核逐项比对**：测试用内核 API（`createDocument` + `pushOp` +
   `buildPlan`）从零独立重算一遍计划，断言 CLI 报告的阶段序列与之严格一致。
   若有人在 CLI 里偷加一层"导出专用处理"，这条测试立刻变红。
2. **透明语义被显式钉住**：见下节"已知语义"。
3. **整链像素级等价**：`pipeline.integration.test.ts` 从**配方 JSON** 进，
   经真实归一化边界、两套独立编解码器（io 手写 BMP / Node zlib PNG）与同一份内核，
   断言"无操作时逐字节等于源""旋转 90° 时像素多重集完全守恒且朝向自洽"
   "加边框时尺寸外扩、四角为边框色、内部内容不受影响"。
   它验证的是**接起来还对**，这是单元测试给不了的。
4. **内存门的 CLI 侧全覆盖**：用**假解码器**（只声明尺寸、不分配像素）构造 80MP 计划，
   从而在不吃内存的前提下验到 `reject`；`downscale` 则断言"报告尺寸 == 真去重建的计划尺寸"。


已建立的机制：
- 编译期架构边界：`core` 的 `lib` 不含 DOM，写了 `document`/`window` 即编译失败。
- 几何量以 `Size`/`Rect` 结构体传递，`rotatedSize()` 是宽高互换的唯一入口。
- **统一渲染管线**：预览/导出/缩略图/视频封面共用 `buildPlan` + `executePlan`，
  同尺寸下像素级一致（已由测试逐字节锁定）。
- **几何只有一条代码路径**：旋转/镜像/校正/缩放合并为一次逆仿射重采样，
  从结构上消灭 legacy `if (odd) { min/max }` 那类特例分支（P1-1）。
  另加**恒等快路径**：无变换且尺寸不变时直接拷贝，不引入插值损失（P5）。
- **超尺寸显式化**：`buildPlan` 产出 `PlanWarning`，`executePlan` 经 `onWarning`
  交给上层；不再有各处静默 `return`（P1-3）。
- **阶段缓存 + 前缀复用**：管线是有序线性序列，故"脏节点传播"退化为
  "找到第一个键变化的阶段，之前的全部复用"。改动越靠末端省得越多，
  而交互调参恰好全在末端（P1-5）。复用正确性由"与全量重算逐字节一致"锁定。
- **内存可预判**：`estimateMemory` 在执行前给出峰值（像素缓冲 + 卷积 scratch +
  快照），替代 legacy「先分配了才知道大」（P1-4）；卷积 scratch 现在整次渲染复用一份。
  `gateExport` 把预估**升级成决策**（`run` / `downscale` / `confirm` / `reject`，
  **绝不静默**）—— 策略在内核、交互在外壳，于是 CLI / web / 移动端共用同一条规则。
- **调度与平台解耦**：`PixelWorkerPort` 端口抽象让并发/排队/错误隔离成为纯逻辑，
  真实 Worker 构造在外壳（**P6-d 序 5 已交付**，见 `apps/desktop/src/worker-port.ts`）。
  三条不可省的实现细节：源图按 buffer 引用身份**只上传一次**（每帧重传 24MP 就是 96 MB，
  离线程的收益会被传输开销整个吃掉）；结果 buffer 走 transfer list **零拷贝**回传；
  任何一步失败都**降级**到内联端口而不是失败 —— 慢，但对。
  另有一条 Worker 专属硬约束：**import map 只作用于文档、不作用于 Worker**，
  因此 Worker 侧必须用绝对 URL 导入内核（`app://core/index.js`，类型由
  `apps/desktop/src/app-url.d.ts` 的环境模块声明兜底），不能沿用页面上的裸模块名。
- 测试守护的是**不变量**而非实现细节（任意尺寸×任意角度铺满画布、
  undo/redo 逐步回退等于对应历史节点、预览=导出逐字节一致、复用=重算）。
- legacy 的四条真实缺陷（P1-1 旋转变形、P1-2 滑杆撤销无效、P1-3 静默失效、
  P1-6 后台节流）已各自固化为回归用例或外壳契约；移植期间另发现并修正
  legacy 的色彩词顺序缺陷（「品红」被「红」抢走）与 enhance 中 dehaze 被 sharpen 覆盖的缺陷。

### 5.2 CLI 端暴露出的内核语义问题（**待决**，未擅自改动内核）

`apps/cli` 的端到端测试在做"恒等渲染应逐字节等于源图"的断言时失败，
追查后发现是内核既有语义，不是 CLI 引入的：

**`rasterize` 会先用边框色填满整块画布，再按 alpha 把图合成上去。**

```ts
// packages/core/src/pixels/raster.ts
const [br, bg, bb] = parseHexColor(spec.borderColor);
fill(out, br, bg, bb, 255);        // ← 用不透明的边框色铺底（默认 #ffffff）
...
blit(out, src, border, border, 1); // ← blit 是 alpha 合成，不是拷贝
```

后果：**任何 alpha < 255 的像素都会被压到边框色上，导出结果不留透明通道。**

| 输入像素 | 输出（白相纸） | 输出（黑相纸） |
|---|---|---|
| `(0, 0, 255, 128)` | `(127, 127, 255, 255)` | `(0, 0, 128, 255)` |
| `(200, 100, 50, 0)` | `(255, 255, 255, 255)` | `(0, 0, 0, 255)` |

需要澄清的是：**这不是"预览/导出不一致"**。快路径与慢路径都走 `blit`，
行为完全一致，所以不存在 P1-1 式漂移。它是一个**产品语义选择**：

- 若"照片放在相纸/画框上"是刻意设计，那么压平是正确行为，只需补一个
  `PlanWarning` 或文档说明；
- 若"导出 PNG 应保留透明"是预期，那么应当改为：
  **只在边框环（`border > 0` 的区域）填边框色，内容区保持图像自身的 alpha**，
  然后 `blit` 用纯拷贝而非合成。这会改动 `rasterize` 的输出语义，
  需要与桌面外壳一起确认，故本轮**只钉住行为、不改内核**。

已固化为 `render.test.ts` 的「已知语义」一组测试（4 条），
将来若有意改动，测试会明确指出改了什么。

尚未纳入（有意延后，避免一次引入过多变量）：
- ESLint —— **已于 P6-d 序 0 接入**（`npm run lint`，实扫 105 个文件，已进 `verify` 与 CI）。
  定位**正确性优先、不承担格式化**（格式交给 `.editorconfig`；要格式化另接 Prettier）。
  `legacy/` 已冻结故排除；`.cjs` 关闭 `no-require-imports`（CJS 里 `require` 才是对的）；
  另加一道**内核边界守门**：`packages/core` / `packages/io` 禁止引用平台全局。
  配置见 `eslint.config.mjs`，口径见 `docs/P6D-PLAN.md` §2.1。
- **真实平台适配器**：Web Worker 的 `PixelWorkerPort` **已交付**（P6-d 序 5，
  见 `apps/desktop/src/worker-port.ts`）。剩下的是 **web / mobile 端**的
  Canvas2D / WebGPU 后端接壳 —— 内核已把接口备好（`DrawableSurface` / `EncodableSurface`）。
- **CLI 的文字绘制**：Node 侧**栅格化仍未做**，但"静默不画"已于 P6-e 序3 关掉 ——
  未注入 `TextRenderer` 时含 `text(...)` 阶段的配方**明确失败并说明原因**
  （`ops/text.ts` 抛错，CLI 非零退出），不再有 `noopTextRenderer` 这条路。
- **CLI 的 JPEG**：**解码已交付**（P6-e 序3，`packages/io/src/jpeg.ts` 手写零依赖
  baseline 解码器，已进内置注册表）。**编码仍不做**（要 JPEG 输出需单列决策）；
  **WebP 明确不做**。桌面自序3 起也用同一个解码器解 JPEG，见 D17。
- **CLI 的并行**：批处理目前顺序执行；内核已有 `WorkerPool`，
  接 `worker_threads` 适配器即可并行。
- **CLI 的依赖类型**：`apps/cli` 需要用 Node API，故声明了 `@types/node`。
  这在 core / io 是**被编译器禁止**的（`types: []`），而在外壳是合理的 ——
  这条边界是单向的：内核只依赖语言，外壳可以依赖平台。

### 5.3 跨包解析规则 + "无类型输入边界"契约（2026-09-14 决策）

#### (a) 跨包引用**一律解析到已构建产物**，不搞双轨

P6 收尾时 `apps/cli` 构建失败（`TS6059: file is not under rootDir`）。根因不是配置写错，
而是三包里有**两种解析规则**：

| 包 | 跨包解析 | 后果 |
|---|---|---|
| `packages/io` | 无 `paths` → node_modules → `core/dist/index.d.ts` | 正常（build 通过） |
| `apps/cli` | `paths` → `core/io/src/index.ts`（源码） | build 时源码落在 rootDir 外 → TS6059 |

试过用 **TypeScript project references** 修（给 core/io 加 `composite: true`，
cli 加 `references`）。**无效**，值得记下原因：TS 只在解析结果落到「被引用项目的**产物**」时
才把该文件归属给那个项目；`paths` 直接指到 `.ts` 源码就绕开了这套归属判定，
文件仍被当成消费方自己的输入 → TS6059 照旧。

最终收口为**一条规则**：

> 跨包 `import` 一律解析到 `node_modules` 里 workspace 软链指向的**构建产物**（`packages/*/dist`）。
> typecheck / build / 运行时三者行为完全一致。

代价是 typecheck 前必须先 build —— 已由根脚本钉死顺序与前置构建，全新 clone 也能一路绿灯：

```json
"build":  "npm run build -w @photo/core && npm run build -w @photo/io && npm run build -w @photo/cli",
"verify": "npm run build && npm run typecheck && npm run test"
```

测试不受影响：vitest 用 alias 直接吃源码，`npm test` 无需先构建。

> 代价权衡：放弃了 `paths` 带来的"改内核立刻反映到 CLI 类型检查"。
> 换来的是三包同构、无隐藏双轨 —— **"检查看源码、运行看产物"这类偏差，
> 将来只会在最难查的时候暴露**，不值得为一点便利留下。

#### (b) 内核信任类型化调用方；**无类型输入必须在边界归一化**

这条契约是本轮"端到端测试为什么写不出来"逼出来的，值得单独记一笔。

内核 op 语义是**整值设置**：`{ k:'setGeometry', value: GeometryState }`，
而 `GeometryState` 的四个字段**全部必填**。于是两条路径命运不同：

- **TS 调用方**：传稀疏对象是**编译错误** —— TS 类型确实挡住了（测试里
  `value:{ rotate: 90 }` 会被 tsc 拒绝）。
- **无类型输入（JSON）**：类型管不到。稀疏值会被 reducer 原样
  `{ ...state, geometry: op.value }` 落库，字段缺失无人察觉。

本轮实测到的失败现场（一次真实的碎图）：

```
stages: ["raster(旋转90° 校正undefined° 4×8)"]
输出：整张图碎成 (0,0,158) / (1,0,158) 两种颜色
```

追因链：`geometry.straighten === undefined` → 恒等快路径判定 `spec.straighten === 0` 为假 →
`angle = (90 + undefined) × π/180 = NaN` → 逆仿射矩阵全 NaN → 采样坐标作废。
**全程不抛一个字，输出一张"看起来渲染成功了"的废图。**

因此防线只有两处，缺一不可：

| 防线 | 覆盖对象 | 机制 |
|---|---|---|
| TS 类型 | 类型化调用方（桌面 UI、内核自身） | 缺字段 = 编译失败 |
| **边界归一化** | JSON / 项目文件 / 第三方输入 | `apps/cli/src/recipe.ts#normalizeOp`：逐字段从默认值合并、拒绝未知字段、逐个类型校验、枚举白名单 |

`normalizeOp` 已逐条审计为**穷尽且完备**（10 种 op 全覆盖，未知 `k` 明确报错），
故当前 CLI 路径是安全的 —— 这也是整链测试必须从**配方 JSON** 进入而非自己拼 Op 对象的原因：
那才是用户真正走的路。

**内核侧的安全网（2026-09-14 实施）：** 上述"绕过归一化的入口"已经不会再碎图。
做法是在 reducer 出口统一收敛，而不是在每个调用方各自设防：

| 位置 | 机制 |
|---|---|
| `document/sanitize.ts` | 逐字段收敛：缺失 → 按 `defaults.ts` 补全；类型不符 → 默认值；数值非有限 → 默认值；联合类型字段走**白名单**；被当作除数/尺寸的量强制正整数；**不可用的源图条目整条丢弃**（不伪造 1×1 幻影） |
| `document/reducer.ts#applyOp` | `sanitizeEditState(reduceOnce(state, op))` —— 「applyOp 的输出恒为『类型为真且数值有限』」成为**内核不变量**，下游 `buildPlan` / `executePlan` / UI 都不必各自设防 |
| `document/reducer.ts#deriveEditWith` | 出口再收敛一次。覆盖 `cursor === 0` 时 baseline **原样返回**的情形 —— 那正是"加载工程文件"的落点，于是「读出来的状态一定干净」也成立 |

为什么源图条目是**丢弃**而不是补默认值：区别在"实体"与"设置"。切图行列数是**设置**
（必须有值，退化为中性 1）；源图是**实体**（可以不存在）。伪造一条 1×1 的幻影源
会改变 `sources.length`，连带影响拼图布局与 `current` 语义 —— 那不是"退化为中性"，
而是**悄悄改变了用户看到的东西**。缺图是看得见的，1×1 是看不见的。

刻意**不做**的事：数值**范围**校验。`straighten` 是否在 ±15 内、`alpha` 是否 10..100，
那是**输入边界**的职责（`normalizeOp` 会明确报错并列出可用字段与取值，
用户写错了应当被吵醒，而不是被内核悄悄改掉）。一句话分工：

> 内核安全网：**绝不静默碎图**（退化为中性效果，且可被断言）
> 输入边界：**写错了要吵**（明确报错，指出错在哪）
> 两者互不替代，缺一不可。

顺带修掉一个**同族陷阱**：`setAdjust` 原先在 reducer 里走 `clampParams(op.value)`，
而 `clampParams` 对**缺失**键会落到**区间最小值**（亮度缺失 → 50 → 整图发黑）。
现在 reducer 不再钳制，统一交给 `sanitizeParams` —— 它先按 `NEUTRAL` 补齐、再钳制。
顺序反过来就是一个"静默变黑"的陷阱。

回归用例：`packages/core/src/document/sanitize.test.ts`（16 例）。其中最强的一条断言是
**「稀疏 `setGeometry { rotate: 90 }` 与显式完整写法的渲染结果逐字节相同」** ——
碎图时这条必红，不碎图时它同时钉住了"补全后的语义恰好等于中性补齐"。

---

### 5.4 真实性能实测（24MP 高熵图，2026-09-14）

> **为什么不测小图：** 纯色小图的熵极低，deflate 几乎不花时间 —— 那样量出来的
> "导出耗时"是假的。`apps/cli/scripts/make-photo.mjs` 生成一张 6000×4000（24 MP）的
> **高熵"照片感"图**（天空/地面渐变 + 太阳光晕 + 细密纹理 + 逐像素噪声，PPM 69 MB），
> 用 `npm run bench -w @photo/cli` 一次跑完。

硬件：本机（Windows，Node 22.22.2）。
**一场景一进程** —— `process.resourceUsage().maxRSS` 是进程级高水位、只增不减
（本机实测单位是 **KB**），同进程连测会让后面的读数被前面的峰值污染。

#### 冷启动单张导出（CLI 完整路径）

| 场景 | 输出尺寸 | 阶段 | 总耗时 | 峰值 RSS | 估算峰值 | 输出 |
|---|---|---:|---:|---:|---:|---:|
| A 原尺寸 · 无配方 | 6000×4000 | 1 | **2.2 s** | 556 MB | 92 MB | 46.9 MB |
| B 长边 1920 · 无配方 | 1920×1280 | 1 | **0.42 s** | 273 MB | 9 MB | 4.5 MB |
| C 原尺寸 · 重配方 | 4048×6048 | 8 | **19.7 s** | 1280 MB | 654 MB | 58.9 MB |
| D 长边 1920 · 重配方 | 1328×1968 | 8 | **1.5 s** | 403 MB | 70 MB | 6.3 MB |
| E 原尺寸 · 重配方 · BMP | 4048×6048 | 8 | **15.9 s** | 1280 MB | 654 MB | 93.4 MB |

重配方 = 旋转 90° + 校正 3° + 边框 24px + 亮度/对比/饱和 + 色温 + **磨皮 25**
+ 曲线/HSL 分调 + 暗角 40 + 颗粒 12 + **锐化 35 + 去雾 20**（共 8 个阶段，含两处卷积）。

#### 编解码微测（独立进程、内存低位）

| 格式 | 解码 | 编码 | 每百万像素编码 | 输出 | 每像素字节 | 峰值 RSS |
|---|---:|---:|---:|---:|---:|---:|
| PNG | 113 ms | **1520 ms** | 63 ms | 46.9 MB | 2.05 | 417 MB |
| BMP | 109 ms | **73 ms** | 3 ms | 91.6 MB | 4.00 | 366 MB |
| PPM | 124 ms | **53 ms** | 2 ms | 68.7 MB | 3.00 | 275 MB |

#### 交互式调参：缓存复用（同一进程内改"颗粒"再渲染一次）

**首测（P6-d 序 8，2026-09-14 —— 那时快照预算是外壳里写死的一个字节数）**

| 快照预算 | 阶段数 | 第一次 | 第二次 | 复用阶段 | 快照保留 | 峰值 RSS |
|---|---:|---:|---:|---:|---:|---:|
| 128 MB（默认） | 8 | 16.0 s | 16.3 s | **0** | 1 | ~1.8 GB |
| 1024 MB | 8 | 14.0 s | **2.0 s** | **6** | 8 | ~1.9 GB |

**复测（P6-e 序 4，2026-09-24 —— 快照张数改为按内存预算推导，"快照预算"这个参数已不存在）**

| 内存预算 | 阶段数 | 第一次 | 第二次 | 复用阶段 | 快照保留 | 峰值 RSS |
|---|---:|---:|---:|---:|---:|---:|
| 128 MB | 8 | 12.2 s | 16.5 s | **0** | **0** | 1525 MB |
| 1024 MB | 8 | 11.8 s | 14.3 s | **0** | **0** | 1525 MB |
| **2048 MB（内核默认 = 真实路径）** | 8 | 12.8 s | **1.92 s** | **6** | 7 | 1804 MB |

> 绝对耗时本机抖动很大（同一档两次跑出 15.1 s / 9.0 s），所以上表只用于看**比例与张数**；
> 复用是否成立由 bench 的**复用门**（复用阶段数 == 0 即红）判定，那个判据与机器快慢无关。

#### 读出来的四件事

1. **常规导出路径是快的。** 长边 1920（覆盖绝大多数实际用途）无论轻重配方都在
   **0.4–1.5 秒**、峰值 273–403 MB。这是能对用户说出口的数。
2. **24MP 原尺寸 + 重负载 = 19.7 秒 / 1.28 GB**，而且**瓶颈不在内核**：
   微测显示 **PNG 编码比 BMP 慢约 21 倍**（1520 ms vs 73 ms），
   而整条像素管线（8 阶段含两处卷积）只占其中一部分。
   所以这条路径该优化的是"把大图编码挪出主线程 / 给进度反馈"，不是去调卷积。
3. **`estimateMemory` 是像素管线的下界，不是内存全貌。** 它只算
   `输出 + 卷积 scratch + 快照`，不含 Node 运行时基线、输入字节与编解码中间缓冲；
   因此实测 RSS 恒高于估算 —— 重负载下约 **2 倍**（654 → 1280 MB），
   小管线则由固定开销主导（92 → 556 MB）。
   用它做**准入判断**（"这张图该不该直接全尺寸导出"）是对的 ——
   `gateExport` 正是取它 `× SAFETY(2.0)` 与预算比较，在**执行前**给出决策；
   把它当"内存占用"报给用户是错的。
   **但"下界"这个性质决定了它不能反过来用**（P6-e 序 4 踩到过的口径）：
   重配方 24 MP 的 `峰值 × 2 = 1308 MB`，于是 1024 MB 预算下准入会**拒绝原尺寸导出**，
   自适应缓存也因此**一张都不留**。同一个数在两条路上必须给同样的答复 ——
   宁可两处都保守，也不要一处放行、另一处越线。
4. **"缓存有没有用"曾经是外壳里一个写死的字节数，现在是一条推导。**
   24MP 下**一张阶段快照就是 96 MB**：老默认 128 MB 只留得住 1 张（末端），
   前缀快照全被淘汰 → `复用 0/8`，**缓存形同不存在**；当年手工提到 1024 MB 才有 `复用 6/8`。
   P6-e 序 4 把这件事改成内核推导（`cacheBudgetFor`）：**预算 = 内存预算 − 执行峰值 × 2.0**，
   与 `gateExport` 共用同一份预估与同一个安全系数，于是缓存只能吃掉准入判断剩下的那部分。
   默认 2 GB 下 24 MP 留 7 张 → `复用 6/8`、第二次 **1.92 s**（第一次 12.8 s；见上表复测）。
   两个附带收获：① 小内存机器上"缓存主动让位"变成**可见**的（`reason` 会直说"一张都不留"），
   不再是静默的复用为 0；② 推导出 0 张之后，"每阶段先克隆满再丢掉"就成了纯浪费
   （24MP 一次渲染 8 × 98 MB），改成只克隆留得住的末端几张 ⇒ 小预算两档高水位 **1706 → 1525 MB**。
   → 结论与代价记在 `docs/P6E-PLAN.md` §3.5；PNG/JPEG 分块流式编码的调研结论（M3，**不做**）同处。

> **一处测量方法上的自我修正（值得记）：** 最初用「总耗时 − 独立解码 − 独立编码」
> 去推"管线耗时"，推出 **−718 ms / −1403 ms 的负数** —— 因为独立测量时进程内存已在
> 高位，读数虚高（同一次编码，低位 1.5 s、高位 2.9 s）。
> 已删掉那一列，并把编解码拆成**独立进程的专用微测**。
> **能相减的量必须同源同状态**，否则算出来的是"看起来像数据"的东西。

---

## 6. 已确认的决策（2026-09-14）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 是否引入 TypeScript + 构建工具链 | **采用**（TS strict，品牌/结构类型 + 编译期架构边界） |
| D2 | 包管理器 / workspaces | **npm workspaces**（零新增环境依赖） |
| D3 | 移动端路线 | **Capacitor 复用 Web**（core 已隔离，P6 执行） |
| D4 | 桌面壳是否换 Tauri | **暂不换**，保留 Electron；core 已隔离，随时可换 |
| D5 | 重构节奏 | **分阶段渐进**，但**不做临时补丁**：P0 缺陷在模型层根治，不打热修 |
| D6 | 跨包模块解析 | **一律解析到已构建产物**（放弃 `paths`→源码，也不用 project references）；`verify` 先 build 再 typecheck。见 §5.3(a) |
| D7 | 无类型输入（配方 JSON / 项目文件） | **双防线，均已实施**：边界用 `normalizeOp` 补全 + 强校验（写错了要吵）；内核用 `sanitizeEditState` 兜底（绝不静默碎图）。见 §5.3(b) |
| D8 | `legacy/` 的去向 | **冻结**：只修致命 bug（崩溃 / 数据丢失 / 静默错图），不加功能、不重构。P6-c 首个可双击版本产出后降级为历史版本。见 `docs/P6C-PLAN.md` §2 |
| D9 | 下一个里程碑 | ~~P6-c 最小桌面壳~~ → **已完成**（内核渲染 + Electron 薄壳，打开 → 导入 → 预设 → 导出全链路跑通；F 同源 / H 缓存复用已自动化，另加真实渲染进程冒烟；实施记录与"冒烟发现了什么"见 `docs/P6C-PLAN.md` §6）；~~P6-d~~ → **已完成**（序 0–6、4.5、9 ✅；其序7 多端与序8 分块导出调研**转入 P6-e**）。**下一个里程碑：P6-e 真实照片可用性收口** —— EXIF 与朝向进内核、工程文件 `photo.doc/v1`、CLI 吃 JPEG、缓存自适应，之后才谈多端。定义见 `docs/P6E-PLAN.md`，功能落差台账（含本轮补的 #31/#32 盲区）见 `docs/DESKTOP-PARITY.md`。 |
| D10 | 外壳侧画布抽象 | **结构化窄接口 + 平台转换收在画布层**。`surface.ts` 不依赖 DOM 类型（让全链路能在 Node 里配假画布跑），代价是"结构化对象 ≠ 宿主对象"——`putImageData` 只认真 `ImageData`、`drawImage` 只认真 `ImageBitmap`。因此"像素 ↔ 原生实例"的转换一律落在 `DrawableSurface.putPixels / readPixels` 与 `shell-adapter.ts` 的 `decodeBitmap`，业务层零平台依赖。这类缺陷**单元测试测不出**，只有冒烟能抓。见 `docs/P6C-PLAN.md` §6.2 |
| D11 | 桌面壳的模块边界由模块系统强制 | **内核只能活在渲染进程**。`@photo/core` 是纯 ESM，而 Electron 主进程是 CJS（随附 Node 不支持 `require(esm)`）→ `require('@photo/core')` 必然失败。这不是妥协，与 P6-c 的分层设计正好同向：主进程只管窗口与文件对话框。见 `apps/desktop/electron/main.cjs` 顶部说明 |
| D12 | EXIF 解析放哪（P6-e） | **放内核**：新增 `core/metadata`，纯 TS、零依赖、无 DOM。朝向与拍摄参数是**策略**不是交互 —— 放壳里就会三端各解一遍（这正是病根 1 的复发形态）。只读**白名单 tag**，未知段/缩略图/GPS 一律忽略，忽略 ≠ 谎报 |
| D13 | 朝向在哪应用（P6-e） | **导入端一次精确置换**（序1 实施时对本条原方案的一次修订，理由见下）：像素由内核 `pixels.applyOrientation(buf, o)` 在**导入那一次**置换为显示态，此后 `SourceRef.width/height` 即显示态尺寸；`SourceRef.exifOrientation` 只作**来源记录**，**渲染路径不得读它**（读了就是双重旋转），这条不变量由单测钉住。<br>**原方案**是"由 `buildPlan` 折进已有的那次逆仿射重采样"，被否掉的实际理由是：拼图 / 切图 / 缩略图三条路**不经过 raster 阶段**，折进仿射就得在四处各补一遍朝向 —— 那正是病根 1 的复发形态（同一件事多处各做一次）。置换一次则四条路天然同源，而且索引重排是**纯置换、零插值**（无损），不新增第二条几何路径，宽高互换仍只经 `rotatedSize`（`orientedSize` 内部调它）。**代价提前认**：非 1 朝向多一次全尺寸拷贝，只发生在导入那一次，不进预览循环。<br>配套硬约束：**凡仍由平台解码的格式**（序3 之后只剩 PNG 等）一律 `createImageBitmap(blob, { imageOrientation: 'none' })` —— 否则浏览器转一次、内核再转一次。<br>**序3 之后这条的适用范围缩小了**：桌面的 JPEG 不再问平台解码器（见 D17），所以"双重旋转"在 JPEG 上已经无从发生；`imageOrientation:'none'` 仍是 PNG 路径的必需项，`shell-adapter.ts` 全仓唯一一处。 |
| D14 | 工程文件格式（P6-e） | **`photo.doc/v1`**，与序9 的 `photo.preset/v1` **同构**：结构错 → 抛错（写错了要吵）；数值错 → 复用 `sanitize*` 收敛（绝不静默碎图）。**只存源图引用**（path / 名 / 字节数 / 指纹），不嵌 base64；打开时按指纹核验源图身份，不符必报（沿用 `sanitize` 的立场：源图是**实体**，缺失就诚实报缺，不伪造 1×1 幻影）。<br>**序2 实施时把"双防线的分界线"钉成一句可判的话**：op 的**骨架**（`k` 在不在已知集合、`value` 键在不在、该是数组的地方是不是数组）算结构 → 抛 `DocumentParseError`；`value` **内部**的字段算数值 → 走 `sanitize*`。必填的是 `baseline`/`ops`/`cursor`，可缺省的是 `settings`/`view`（它们不是语义）。<br>**核验按位置配对，刻意不按名字或指纹**：挑错顺序不许"蒙对"，它必须表现为一次指名道姓的不匹配（"第 2 张「b.jpg」内容已变…"）。名字不同只记一句、不判失败。<br>**指纹是 FNV-1a 64 bit（两个独立 32 bit 拼成），不是加密哈希**，用途只到"同一份字节没变"；探针算不出指纹时必须**明说没核过**，不许静默通过。留痕字段（`bytes`/`fingerprint`）沿用序1 `exifOrientation` 的做法挂在 `SourceRef` 上而不另开文件节 —— "工程文件里能有什么"仍只有 `sanitize*` 一个答案，非法值**整键消失**（伪造的指纹会让一次本该报警的漂移看起来"核过了"）。<br>**桥侧配套边界见 D16**（不开通用文件读取，因此 `handle` 只作记录、打开时不自动读盘） |
| D15 | JPEG 编解码路线（P6-e） | **手写零依赖 baseline 解码器**（放 `packages/io`），不引入第三方解码库 —— 保住"核心零依赖"与三端同源（同一份码在三端跑出同一张图）。不支持的子集（算术编码 / 多帧 / 无损 / 分层）**明确拒绝并给人话原因**，照 `image-io.ts` 的 `REJECTED_MAGIC` 先例。**代价提前认**：跨解码器做不到逐字节一致（IDCT 取整与色度上采样在各实现里有合法差异）。<br>**序3 落笔时改写过一次口径**（原文是"尺寸 / 边界 / 像素多重集严格一致 + 逐通道最大误差 ≤ 白名单值"）：① "像素多重集严格一致"在两个独立实现之间**本来就不成立**，已从该断言撤下；② 容差按**差异来源**拆成亮度 / 色度 / 全图均值三条，各自的上限写进 `apps/desktop/src/smoke.ts` 的 `C2_*` 常量与断言名；③ 桌面的 JPEG 解码改归内核（D17），于是"跨端逐字节"这一半从"做不到"变成"两边同一个函数"。见 `P6E-PLAN.md` §5.1 与 §3.4.1 |
| D16 | 外壳文件能力的面（P6-e 序2） | **只给具体动词，不给通用口子**。桥面从"选图 + 写字节"扩到 `saveProject / openProject / savePreset / listPresets` —— 四个都是"一件事一个动词"，**没有** `readFile(path)`。代价明说：工程文件里存了源图的 `handle`，打开时却**不自动去那个路径取图**，要先向用户报"需要 N 张源图、按这个顺序选"再走对话框。这不是偷懒，而是不愿为了省一次点击，把"渲染进程可以读磁盘任意路径"这件事变成常态能力。<br>主进程对渲染进程传来的字符串一律不可信，故设**两道独立防线**：文件名词干过 Unicode 白名单（`\p{L}\p{N}` 与 `-`，堵住 `..`、分隔符、重定向），再加 `path.resolve` 后核验目标仍在授权目录内 —— 任一道单独失效都不该导致写出目录。另有体积上限（工程文本 8 MB / 预设 64 KB / 名字 ≤160 字符）。同理**没有** `deletePreset` 与重命名：预设库的删除目前只能由用户自己去 `userData/presets/`，**少一个动词比多一个口子好** |
| D17 | 桌面 JPEG 由谁解码（P6-e 序3） | **归内核那份解码器，一次都不问平台**（用户裁定，代价当场认下）。<br>**为什么**：只要桌面还用 `createImageBitmap` 解 JPEG，"同一份字节两端解出同一份像素"（X1）就永远做不到 —— 两个独立实现之间只有容差，没有逐字节，而"跨端一致"是这个项目全部的卖点。改完之后：CLI 侧 == `decodeJpeg`、桌面侧 == `decodeJpeg`，两条各自逐字节钉住，跨端经同一个函数传递相等。<br>**付的代价**（不是"风险"，是已经付出去的）：① 渐进式 / 算术 / 多帧 / CMYK 在桌面从"能开"变成明确报错（网页下载的图不少是渐进式，用户会立刻撞到）；② 解码是同步 JS，24 MP 本机实测约 2.9 s（Chromium 是几十毫秒量级），期间占住调用线程 —— 正解是把解码搬进渲染 Worker，**序3.5 已按这条正解做完**（见 `P6E-PLAN.md` §3.4.3）：花的时间一个字节没少，少的是不再占用界面线程。<br>**Worker 起不来时仍退回主线程**：慢，但正确，且 `degraded` 会露出来。<br>**Chromium 的角色变了**：不再是应用路径，只在冒烟里当**独立参照**解一次同一份字节，用来照"手写解码器自洽地错"（单元用例的码流与解码器同源于一个夹具，照不出这种错）。比的是"尺寸严格一致 + 亮度 / 色度 / 全图均值三条白名单容差"，见 D15 与 `P6E-PLAN.md` §5.1。<br>**边界仍然守住**：外壳调的是 `@photo/io` 导出的同一个函数，壳里依旧一像素不算。 |
| D18 | 阶段快照留几张由谁决定（P6-e 序4） | **内核按内存预算推导，外壳不再有"快照预算"这个参数**。`cacheBudgetFor({plan, memoryBudgetBytes})` 取 `reserved = 无缓存执行峰值 × SAFETY(2.0)`、`maxBytes = 预算 − reserved`，于是**缓存只能吃掉准入判断剩下的那部分**；硬不变量 `reserved + maxBytes ≤ 预算`，**0 张是合法结果**并会写进 `reason`。<br>**为什么必须同源**：改之前是三处各写一个 128 MB（外壳 / 端口 / 引擎），而 `gateExport` 用的是另一套数 —— 同一张 24MP 图，准入说"要 1308 MB 才放行"，缓存却另外认领 128 MB，两边都没回答过"到底该留几张"。<br>**为什么方向是保守而不是最大化**：`estimateMemory` 是像素管线的**下界**（§5.4 第三件事），越线一次的代价（进程被杀 / 半张图）比少复用几帧贵得多。代价照认：1 GB 预算的机器跑 24MP 会**一张都不留**，第二次不比第一次省 —— 而旧实现"把快照预算手工提到 1024 MB 才有的 `复用 6/8`"，换算过来是"峰值 654 MB + 快照 784 MB ≈ 1.4 GB"，那个复用率本来就是越过 1 GB 这条线换来的。<br>**配套的两条纪律**：① 端口未注入预算时**显式发出内核默认值**，Worker 侧与运行期降级后的内联侧必须看到同一个数（否则"退回主线程"会顺手改掉缓存策略，把复用差异伪装成线程差异）；② 推导在**执行之前**，因此只克隆真正留得住的末端几张 —— 先克隆满再丢掉在 24MP 上是 8 × 98 MB 的纯浪费。**桌面端至今不注入预算**（全走默认 2 GB），按设备内存自适应是后续项。<br>**同一序的调研结论（M3）**：PNG/JPEG 分块流式编码**不做** —— 编码侧全部可挤掉的水份上限是实测的 166 MB（PNG 档 465 vs BMP 档 299），而渲染侧是 1.5–1.8 GB；要把渲染也条带化就得改算子（去雾的低通半径随图幅变化、颗粒是一条固定种子的全局随机序列），那是另一个数量级的工程。触发条件与若将来做从哪儿起步，见 `docs/P6E-PLAN.md` §3.5 |

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 重构期间功能不可用 | 旧版本完整保留在 `legacy/`（已入 git 基线 `8d308e6`），新架构在 `packages/` 并行生长 |
| 迁移引入新缺陷 | 每阶段配测试；legacy 的真实缺陷全部固化为回归用例 |
| 范围失控 | 每阶段有明确"关闭哪些缺陷"的验收条件，未达标不进入下一阶段 |
| 个人项目维护成本 | 工具链零额外环境依赖（npm workspaces + 官方 TypeScript/Vitest） |
| 测试与实现一起写偏 | 关键模块测**不变量**（枚举全参数空间）而非单点期望 |
