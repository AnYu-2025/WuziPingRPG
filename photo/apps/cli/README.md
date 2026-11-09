# @photo/cli —— 无头批处理外壳

同一份内核（`@photo/core`），换一个壳跑在 Node 上。

这个包存在的意义不是"多一个命令行工具"，而是**证明内核真的与平台无关**：
桌面端、Web 端、无头批处理端，三者的渲染结果由同一个 `buildPlan` + `executePlan`
产出，差别只在"像素从哪来、往哪去"。两条测试守着这条结论：

- `render.test.ts` 用内核 API 独立重算一遍计划，断言 CLI 报告的阶段与之严格一致 ——
  谁在 CLI 里偷加一层"导出专用处理"，它立刻变红。
- `pipeline.integration.test.ts` 走**整链**：配方 JSON → 归一化 → BMP 解码 →
  内核 → PNG 编码 → PNG 解码，断言"无操作时逐字节等于源""旋转 90° 时像素多重集守恒"。
  它验证的是**接起来还对**，这是单元测试给不了的。

## 构建与验证

跨包 `import` 一律解析到 `node_modules` 里 workspace 软链指向的**构建产物**
（`packages/*/dist`），因此**在 typecheck / build CLI 之前必须先构建 core 与 io**。
根脚本已经把顺序钉死，正常做法是：

```bash
npm run verify     # = build（core → io → cli） → typecheck → test
```

单独跑 `npm test` 则**不需要**先构建：vitest 用 alias 直接吃源码。

```bash
npm run build -w @photo/core && npm run build -w @photo/io && npm run build -w @photo/cli
node apps/cli/bin/photo.js --help
```

## 依赖边界（单向）

```
内核 packages/core      零平台依赖（types: []）   ← 编译期强制
编解码 packages/io      零平台依赖（types: []）
外壳 apps/cli          允许用 node:fs / node:zlib  ← 只有这里
```

## 用法

```bash
photo render <输入...> [选项]
photo plan   <输入...> [选项]
photo info   <输入...> [选项]
```

```bash
# 批量套用配方，长边 1920，输出到 out/
photo render *.bmp --recipe examples/film-90.json --long-edge 1920 --out out

# 只看计划不写文件（调配方用）
photo plan cover.png --recipe examples/film-90.json --long-edge 256

# 读头信息，给 CI 解析
photo info *.png --json
```

### 选项

| 选项 | 适用 | 说明 |
| --- | --- | --- |
| `--recipe <文件>` | render / plan | 配方 JSON；省略则只做尺寸归一 |
| `--long-edge <n>` | render / plan | 输出长边上限，`0` = 保持原尺寸（默认 1920） |
| `--no-text` | render / plan | 不绘制水印与贴纸 |
| `--out <目录>` | render | 输出目录（默认当前目录） |
| `--format <f>` | render | `png` / `bmp` / `ppm`（默认 png） |
| `--quality <n>` | render | 10..100（默认 85；PNG 映射为 deflate 级别） |
| `--suffix <s>` | render | `a.bmp --suffix gray` → `a_gray.png` |
| `--dry-run` | render | 只计算并报告，不写文件 |
| `--json` | 全部 | 机器可读输出 |

退出码：有任何一项失败（含写出失败、覆盖冲突）即为 `1`。

## 配方就是一份操作日志

与桌面端共用同一套文档模型（`PhotoDocument`），因此"批处理脚本"不需要另造 DSL：
它就是把桌面端记录的 `Op[]` 换个地方重放。

```json
{
  "name": "film-90",
  "ops": [
    { "k": "applyPreset", "key": "film", "intensity": 0.8 },
    { "k": "setAdjust", "value": { "vignette": 40, "grain": 12 } },
    { "k": "setGeometry", "value": { "rotate": 90 } },
    { "k": "setCollage", "value": { "mode": "single", "borderWidth": 24 } },
    { "k": "setWatermark", "value": { "text": "© 尤利乌斯", "pos": "br", "size": 3 } }
  ]
}
```

可用操作：`setSources` / `setAdjust` / `applyPreset` / `setCurves` / `setBands` /
`setGeometry` / `setCrop` / `setCollage` / `setWatermark` / `setSticker`。

### 稀疏写法是安全的，写错是会被骂的

内核的 op 语义是**整值设置**，这带来两个在 UI 里无害、在手写 JSON 里致命的陷阱：

| 陷阱 | 内核行为 | 本包的处理 |
| --- | --- | --- |
| `setAdjust` 只写 `vignette` | `clampParams` 把缺失键落到**范围最小值** → 亮度变 50，图发黑 | 按 `NEUTRAL` 补全成完整参数 |
| `setGeometry` 只写 `rotate` | 缺 `straighten` → 仿射角变成 `NaN` → **整张图碎掉，且不报任何错** | 按 `defaultGeometry()` 补全四个字段 |
| `applyPreset` 键名拼错 | 静默 `return state`，毫无提示 | 校验必须是内置预设，报错时列出全部可用名 |
| `setBands.red` 写成数字 | `accumulateBandAdjust` 算出 `NaN`，整图颜色静默烂掉 | 逐带逐轴校验，必须是 `{h,s,l}` |
| 曲线控制点写成 `[[255]]` | LUT 里填进 `NaN` | 校验必须是 `[x, y]` 两点数组 |
| 字段名拼错（`brightnes`） | 被当未知字段忽略，效果凭空消失 | 明确报错并列出可用字段 |

一句话：**写得少是可以的，写得错是不行的。**

> 为什么会碎图：内核的 op 语义是**整值设置**，而 TS 类型只挡得住
> *类型化调用方*（传稀疏对象会编译失败）。JSON 是**无类型输入**，类型管不到 ——
> 边界这道归一化就是唯一防线。详见 `docs/ARCHITECTURE.md` §5.3(b)。

**内核侧还有第二道网（2026-09-14 起）。** 上面的归一化只管得住"从我这儿进的"输入；
任何绕过它的入口（例如桌面端将来直接加载工程文件）本来会复现同一张废图。
现在 `packages/core/src/document/sanitize.ts` 会把 `applyOp` / `deriveEdit` 的
**出口**统一收敛一次 —— 于是"D7 静默碎图"在内核层也不再可能，
且这条性质有回归用例守着（`packages/core/src/document/sanitize.test.ts`）。

两道防线的分工是刻意的：

| 防线 | 位置 | 行为 |
|---|---|---|
| 输入边界 | `src/recipe.ts#normalizeOp` | 补全 + **强校验** —— 写错了要吵，列出可用字段 |
| 内核安全网 | `packages/core/src/document/sanitize.ts` | 补全 + 有限性 —— **绝不静默碎图**，退化为中性 |

**新增任何读 JSON 的入口，都必须复用 `normalizeOp`。** 内核安全网是兜底，不是许可证。

## 安全性

`photo render a.png`（不给 `--suffix` / `--out`）会让输出正好覆盖输入。
这在批处理里是不可逆事故，因此整批**拒绝执行**并逐条列出冲突项，
而不是"部分成功"。这是 `paths.ts` 里 `findOutputCollisions` 的职责。

## 格式支持

| 格式 | 来源 | 备注 |
| --- | --- | --- |
| BMP | `@photo/io` | 零依赖；24 / 32 位 |
| PPM | `@photo/io` | 零依赖；P6 / P5 |
| PNG | 本包 `node-png.ts` | 基于 `node:zlib`；8 位、非隔行、colorType 0/2/4/6 |

PNG 明确**拒绝**并报错的情况：16 位、调色板（colorType 3）、Adam7 隔行、
CRC 校验失败、数据截断。宁可吵，也不要静默解出一张错图。

编码时全图不透明会降为 RGB（colorType 2），省掉四分之一体积。

## 端到端冒烟

`scripts/make-sample.mjs` 生成一张四象限 + 渐变的 BMP（用 io 的零依赖编码器，
不掺任何平台能力），输出到 `tmp/`（已在 `.gitignore` 中）：

```bash
node scripts/make-sample.mjs                                  # → tmp/sample.bmp 320×240
node bin/photo.js info   tmp/sample.bmp
node bin/photo.js plan   tmp/sample.bmp --recipe examples/film-90.json --long-edge 640
node bin/photo.js render tmp/sample.bmp --recipe examples/film-90.json --out tmp/out --long-edge 640
```

四象限色块便于肉眼核对旋转 / 调色 / 边框是否真的生效。

## 性能实测

性能结论**不能**建立在合成小图上：纯色小图的熵极低，deflate 几乎不花时间，
量出来的"编码耗时"是假的。所以这里有一张**高熵的"照片感"大图**（渐变 + 太阳光晕 +
细密纹理 + 逐像素噪声），专门用来让压缩器真的干活。

```bash
npm run photo -w @photo/cli -- 6000 4000   # → tmp/photo-6000x4000.ppm（24MP，约 69 MB）
npm run bench -w @photo/cli                # 跑完全部场景：表格 + tmp/bench-result.json
```

`bench.mjs` 出两组数据：

- **冷启动单张导出** —— 走 CLI 完整路径（解码 → 计划 → 执行 → 编码），
  分别给出渲染 / 解码 / 编码 / 管线耗时与**进程峰值内存**。
- **缓存复用** —— 同一进程内改一个末端参数（颗粒）再渲染一次，
  报告复用了几个阶段、省了多少时间；并对比不同快照预算下的复用率。
  后者很关键：**24MP 一张快照就是 96 MB**，预算给不够，前缀快照被淘汰，
  缓存就等于没有。

> **一场景一进程**：`process.resourceUsage().maxRSS` 是进程级高水位、只增不减。
> 在同一进程里连测多个场景，后面的读数会被前面的峰值污染 ——
> 那正是"合成小图测出来的漂亮数字"的另一副面孔。

实测数字与解读见 `docs/ARCHITECTURE.md` §5.4。

## 已知限制

- **文字（水印 / 贴纸）**：内核只做布局数学，真正的字形绘制依赖注入的
  `TextRenderer`。Node 侧目前没接，因此 `plan` 里会看到 `text(...)` 阶段，
  但渲染时走 `noopTextRenderer`（不绘制）。要真正画字，需在 `renderOne` 里
  注入一个 Node 实现（例如 `@napi-rs/canvas` 或 SVG → 位图）。
- **JPEG / WebP**：未提供 Node 端编解码器。io 的注册表设计允许后续补上。
- **并行**：批处理目前顺序执行。内核已有 `WorkerPool`（P5），
  接 `worker_threads` 适配器即可并行，尚未接线。
- **`node-png.ts` 的位置**：它属于外壳（用了 `node:zlib`），因此暂时住在
  `apps/cli`。将来若 Electron 壳也要用，再提升为 `packages/io-node` ——
  现在只有一个 Node 壳，提前抽象只是负担。
