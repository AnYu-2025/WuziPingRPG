# 桌面功能对齐表 —— 内核能力 ↔ 壳接线现状

> **为什么有这张表。**
> 内核（`packages/core`）的 op 面有 10 种操作、覆盖面已经**超过** legacy；
> 但桌面壳目前只接了其中一小部分。若不显性追踪，「内核强、壳弱」就会从
> "里程碑尚未排到"悄悄固化成"产品事实"——用户双击后看到的永远是**壳接了多少**，
> 而不是内核能做多少。
>
> **用法。** 每接一项，把第 5 列改成 ✅，并在同一个提交里补一条回归用例
> （同源断言 `预览==导出` 或行为用例）。**只在代码真的跑通了之后才改状态**，
> 不接受"计划中""即将"。裸改状态 = 假进度，比不记还糟。
>
> 关联：里程碑定义见 `docs/P6D-PLAN.md`；架构约束见 `docs/ARCHITECTURE.md`。

---

## 0. 图例

| 符号 | 含义 |
|---|---|
| ✅ | 壳已接线，用户可用 |
| 🟡 | 部分接线（缺口写在第 5 列） |
| ⬜ | 未接线（**内核有能力**，壳没做） |
| ⛔ | 内核**也没有**该能力（需先补内核，才能接壳） |
| — | 明确不做（见 P6-c §3.3 / P6-d §3） |

## 1. 对照基准：内核的 op 面

`packages/core/src/document/types.ts` 定义 **11** 种 op。**壳只应通过 `doc.pushOp` 产生它们**，
不许自己拼 `Op` 对象、不许在壳里算像素（见 P6-c §3.4）。

| op | 携带状态 | 壳是否已产生过 |
|---|---|---|
| `setSources` | `SourceRef[] + current` | ✅ 打开/添加多图 + 缩略图切换/删除/清空（序 4） |
| `setAdjust` | `AdjustParams`（12 个参数） | ✅ 全 12 个（序 3） |
| `applyPreset` | `key + intensity` | ✅ key 与 intensity 均可变（强度滑杆 / 口语"效果轻一点"）；强度落在 `EditState.presetIntensity` |
| `setLevels` | `LevelsState`（r/g/b × lo/hi/gain） | ✅ 自动增强的产物（序 6）；也可由 CLI 配方手写 |
| `setCurves` | `CurveSet`（RGB + R + G + B） | ✅（序4 曲线编辑器已接） |
| `setBands` | `BandAdjustMap`（HSL 分色带） | ✅（序 4 已接） |
| `setGeometry` | `rotate / flipH / flipV / straighten` | ✅ 全接（旋转 / 水平镜像 / 垂直镜像 / 水平校正）（序 3） |
| `setCrop` | `Rect \| null`（**归一化到内容区** 0..1） | ✅（序4 裁切框：框选/移动/四角缩放 + 比例锁） |
| `setCollage` | `CollageState`（拼图/切图/边框） | ✅（序4 拼图模式/缝隙/背景 + 切图行列 + 边框宽/色） |
| `setWatermark` | `WatermarkState`（6 字段） | ✅ 全 6 字段（序 4） |
| `setSticker` | `StickerState`（4 字段） | ✅ 全 4 字段（序 4） |

---

## 2. 对齐表（主表）

优先级口径：**P0** = 主链路闭环或缺了会被用户当成"废功能"；**P1** = 补齐 legacy 主力；
**P2** = 锦上添花；**P3** = 明确不做 / 远期。

| # | 能力 | legacy 载体 | 内核落点 | 壳现状 | 缺口 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | 调色 12 参数 | `s_brightness`…`s_fog`（12 根） | `presets.AdjustParams` | ✅ **12/12**（亮度/对比/饱和/曝光/色温/暗角/颗粒/锐化/去雾/磨皮/雨丝/雾气） | — | **P0** |
| 2 | 预设强度 | `intensityRange` | `presets.mixWithNeutral` + `EditState.presetIntensity` | ✅ | 强度滑杆 0..100%；**强度进 `EditState`** 与参数同源，撤销 / 口语"效果轻一点"后滑杆自动跟随；无预设时禁用（强度无基准） | P1 |
| 3 | 内置预设 | `presetList` | `presets.BUILTIN_PRESETS` | ✅ | — | done |
| 4 | 自定义预设保存 | `myPresetName` / `savePresetBtn` / `myPresetList` | ✅ `document/preset-share.ts`：`sharedPresetFromEditState`（观感 → 预设）+ 序9 的 `parseSharedPreset`/`serializeSharedPreset`/`sharedPresetToOps` + `presetKeyFromName`/`presetFileName`（展示名 → 安全文件名） | ✅ **P6-e 序2** | 库落 `userData/presets/*.photo.preset.json`；下拉框在内置项之后列「名字（我的）」；套用走 `sharedPresetToOps` 展开成参数类 op，**不查内置表**（撞名也劫持不走）。收**观感四样**（参数/曲线/色阶/分色带），几何·裁切·水印·拼图不进预设。<br>**已知代价**：多字段预设 = 多步撤销（op 栈无"复合步骤"）；强度滑杆禁用（无插值基准，同 #2 口径）；**没有删除/重命名入口**（桥里刻意无 `deletePreset`），清理只能去磁盘 | P1 |
| 5 | 曲线编辑器 | `curveCanvas` / `curveResetBtn` | `color.curve` + op `setCurves` | ✅ | RGB/R/G/B 四通道 + 拖点/加点/删点，控制点走 `normalizeCurvePoints` 白名单 | **P0** |
| 6 | HSL 分色 | `hslSwatches` / `hslH/S/L` | `color.hsl` + op `setBands` | ✅ | — | P1 |
| 7 | 直方图 | `histCanvas` | `color.histogram` | ✅（只读视图） | — | P2 |
| 8 | 自动增强 | `autoBtn` | ✅ `pixels.analyzeAuto` + `color.buildLevelLut` + op `setLevels` | ✅ | 逐通道 1% 掐头去尾 + 灰世界增益（与 legacy 同构）；结果落成**色阶 op** —— 非破坏性、可撤销、可继续调色；「自动增强 / 救废片」口语已落地 | P1 |
| 9 | 口语指令 | `kouyuInput` / `kouyuBtn` / `kouyuTip` | `nlp.parseKouyu` → `Intent[]` → `doc.adaptIntents` → op | ✅ | 内核 `document/intents.ts` 适配层 + 壳输入框接线；可落文档意图（预设/调参/分色/旋转/镜像/拼图模式/拼图底/强度）直接转 op，crop/tab/export/缩放/对比/删图/视频/自动增强 诚实归入 pending（待后续接 UI） | **P0** |
| 10 | 水平校正 | `straightRange` / `straightGrid` | `GeometryState.straighten`（−15..15） | ✅ | — | **P0** |
| 11 | 旋转 90° | `rotateBtn` | op `setGeometry.rotate` | ✅ | — | done |
| 12 | 水平翻转 | `flipHBtn` | op `setGeometry.flipH` | ✅ | — | done |
| 13 | 垂直翻转 | `flipVBtn` | op `setGeometry.flipV` | ✅ | — | **P0** |
| 14 | 裁切 | `cropBox` / `cropRatio` / `cropOkBtn` | op `setCrop` + `pipeline.plan#clampCrop` | ✅ | 覆盖层框选 + 移动 + 四角缩放 + 比例锁（自由/1:1/4:3/3:4/16:9/9:16）；crop 存**归一化坐标**，预览与导出同源 | **P0** |
| 15 | 拼图 | `modeSel` / `gapRange` / `bgModeSel` | op `setCollage` + `ops.collage` | ✅ | 模式（横/竖/网格）+ 缝隙 + 背景（纯色/模糊）；多图按源图顺序排列 | P1 |
| 16 | 切图 | `cutCols` / `cutRows` | op `setCollage` + `pipeline.plan` 的 `isCut` 分支 | ✅ | 行列 2..4 + 预览宫格线/序号（仅视图，不进导出）；底图忽略几何与水印（与 legacy 一致）。**分片打 ZIP 见 #23（已完成）** | P1 |
| 17 | 边框 | `borderRange` / `borderColorSel` | `CollageState.borderWidth/borderColor` | ✅ | 宽度 0..80 + 黑白；单图与拼图均生效，切图模式隐藏（内核强制 0） | P2 |
| 18 | 水印 | `wmText` / `wmPos` / `wmColor` / `wmStroke` / `wmSize` / `wmAlpha` | op `setWatermark`（6 字段） | ✅ 全 6 字段 | — | P1 |
| 19 | 贴纸 | `stickerText` / `stickerStyle` / `stickerPos` / `stickerSize` | op `setSticker` | ✅ 全 4 字段 | — | P2 |
| 20 | 撤销 | `undoBtn` | `doc.history` | ✅ | — | done |
| 21 | 重做 | —（legacy 没有） | `doc.history` | ✅ | **新内核增益** | done |
| 22 | 多图 / 缩略图 | `fileInput[multiple]` / `thumbList` / `delCurBtn` / `clearBtn` | op `setSources` + `current` | ✅ | 打开（多选，替换）/ 添加（追加）/ 缩略图条（内核重采样）/ 点击切换当前 / 删除当前 / 清空 | P1 |
| 23 | 批量导出 | `batchBtn`（含切图分片 ZIP） | ✅ `pixels.sliceGrid`（切片）+ `io.zipStore`（零依赖 store-only ZIP） | ✅ | 单图模式：库中每张图各套一份当前编辑、打成一个 ZIP（**读操作不落历史**）；切图模式：按 `cutCols×cutRows` 均分分片（`_r{r}c{c}` 命名）；拼接模式明确拒绝（成品只有一张）；CLI 侧对应 `--zip`。切图 #16 的分片打包即此项 | P2 |
| 24 | 导出长边 | `longEdgeSel` | `ExportState.longEdge` | ✅ | — | **P0** |
| 25 | 导出格式 | `formatSel` | `ExportState.format` | ✅（PNG / JPEG） | — | **P0** |
| 26 | 导出画质 | `qualityRange` / `sizeTip` | `ExportState.quality` | ✅ | 10..100 滑杆（默认 92）+ **体积预估回显**。预估按像素数比例外推（见 `session.estimateExportSize`），属估算故文案写「约」 —— 与内核「绝不静默」同一条铁律：估算要标明是估算 | done |
| 27 | **导出内存准入** | —（legacy 无，先分配后爆） | `pipeline.gateExport` / `estimateMemory` / `describeMemory` | ✅（序 3 已接入 UI：四分支提示 + 导出前拦截） | — | **P0** |
| 28 | 缩放 / 视图 | `zoomIn` / `zoomOut` / `zoomFit` / `zoomLabel` | `ViewState.zoom`（不参与撤销） | ✅ | 纯视图层（豁免同源断言）：适应窗口 / ±（1.25 步长）/ 点标签回 1:1 / 双击适应 / Ctrl+滚轮；倍率上限 8×、下限 5%。尺寸一律由 `applyZoom` 写，**刻意不用** CSS `max-width`（它会把放大钳回容器宽，表现为"百分比在变、画面不动"）。超出可用区由 `.stage` 的 overflow 裁掉两侧，与 legacy 一致 | P2 |
| 29 | 对比原图 | `compareBtn` | —（视图层实现，不需内核） | ✅ | 纯视图层（豁免同源断言）：按住显示观感归零版本。**取景保留**（几何 / 裁切 / 拼图），只把调色 / 预设 / 曲线 / 分色 / 自动增强 / 水印 / 贴纸归零 —— 由此对比图与编辑图**同尺寸**，按下不跳。实现上从 baseline 归零而非重放 op（`compareDocument`）。与 legacy 唯一差别：legacy 保留水印、丢了贴纸，这里一并归零 | P2 |
| 30 | 视频 | `video.js` / `vidFile` / `vidInfo` / 画面… | ⛔ 内核无视频能力 | ⬜ | P6-c §3.3 已明确不做 | P3 |
| **31** | **元数据 / EXIF（朝向 + 拍摄参数）** | `renderer.js:844-847` 照片信息条（`exifr` 解析） | ✅ 序1：`core/src/metadata`（EXIF 三态解析 + 朝向表）+ `pixels/applyOrientation` | ✅ 序1 已接：朝向在**导入那一次**置换进像素（显示态尺寸进文档），信息条四行（文件 / 源图 / 朝向 / EXIF）三态可分 | D12/D13。**口径已修订**：朝向**不**折进逆仿射，而是导入时一次精确索引置换（理由见 `ARCHITECTURE.md` D13）。**遗留**：真 JPEG 的跨端逐字节比对顺延序3 C 组；`smoke.ts` 的三条真 EXIF JPEG 断言**未在实机跑过** | **P0** |
| **32** | **工程文件（保存 / 打开整条编辑栈）** | 无（legacy 存 base64 快照，不是工程文件） | ✅ 序2：`core/src/document/doc-share.ts`（`photo.doc/v1` 序列化 / 解析）+ `identity.ts`（FNV-1a 源图指纹 + 漂移核对） | ✅ 序2 已接：「保存工程 / 打开工程」，整条 op 栈 + `cursor` 一起回来；打开时**按位置逐张核对**源图，对不上就整次失败并指名哪张 | **D14**：与 `photo.preset/v1` 同构的双防线 —— 结构错抛 `DocumentParseError`（写错了要吵），数值错走 `sanitize*` 收敛（绝不静默碎图）。**只存引用不存像素**。**已知边界**：`settings` 段在文档里但没有读者，因此导出长边上限**不随工程回来**（不静默改用户的导出偏好）；`view` 同理只作留痕。<br>**未实机跑**：本轮只到离线门，两个新按钮与 6 条新冒烟断言未在真窗口验证 | **P0** |

---

## 3. P0 清单（本轮必须先绿的 9 项）

> 这 9 项直接决定"双击进去到底能不能干活"。全部属于**纯接线**或**小交互**，
> 没有一项需要新写像素算法 —— 这正是"内核强"的红利。

| # | 能力 | 工作量性质 | 依赖 |
|---|---|---|---|
| 1 | 12 参数滑杆补齐 8 根（✅ 序 3 已接） | 纯接线（`PARAM_RANGE` 循环即可，`app.ts` 现在只列了 4 个） | 无 |
| 5 | 曲线编辑器（✅ 序4 已接） | 新交互（RGB/R/G/B 通道 + 拖点/加点/删点，控制点走 `normalizeCurvePoints` 白名单） | 内核已备 |
| 9 | 口语指令（✅ 序4 已接） | 新适配层（Intent → op，落内核 `document/intents.ts`）+ 壳输入框 | 内核已备 |
| 10 | 水平校正（✅ 序 3 已接） | 纯接线（1 根滑杆） | 内核已备 |
| 13 | 垂直翻转（✅ 序 3 已接） | 纯接线（`session.flipVertical()` 5 行） | 内核已备 |
| 14 | 裁切框（✅ 序4 已接） | 新交互（补内核 `RasterStage.crop` + `clampCrop` 归一化映射；壳侧覆盖层框选 + 比例锁） | 内核已备 |
| 24 | 导出长边（✅ 序 3 已接） | 纯接线（下拉） | 内核已备 |
| 25 | 导出格式（JPEG）（✅ 序 3 已接） | 纯接线（下拉 + `imageIo` 已实现） | 内核已备 |
| 27 | 导出内存准入（✅ 序 3 已接） | 新逻辑（**放内核**：`decideExport` 纯函数）+ 壳交互 | 见 `P6D-PLAN.md` §2.2 |

## 4. 统计（基线：`v0.2.0` / `desktop-p6c`，**共 32 项**；截至 **P6-e 序3** —— #31 序1、#32 与 #4 序2 收口，**30 项有判据的已全绿**；序3 是内核 / CLI 侧增量（真机 JPEG 进得来 + 文字诚实化），**本表无行变更，故三项计数不动**）

| 状态 | 数量 | 条目 |
|---|---|---|
| ✅ 已接线 | **31** | #1 12参数、**#4 自定义预设（P6-e 序2）**、#5 曲线编辑器、#6 HSL分色、#7 直方图、#8 自动增强、#9 口语指令、#10 水平校正、#11 旋转、#12 水平翻转、#13 垂直翻转、#14 裁切、#15 拼图、#16 切图、#17 边框、#18 水印、#19 贴纸、#20 撤销、#21 重做、#22 多图、#23 批量导出、#24 导出长边、#25 导出格式、#26 导出画质、**#27 导出内存准入**、**#28 缩放/视图**、**#29 对比原图**、**#31 元数据/EXIF（P6-e 序1）**、**#32 工程文件（P6-e 序2）** |
| 🟡 部分接线 | **0** | — |
| ⬜ 未接线 | **0** | — |
| ⛔ 内核也缺 | **1** | #30 视频（P6-c §3.3 已明确不做） |

**一句话读法**：32 项里 31 项已接线，未接与半接都清零；剩下唯一一项 ⛔ 是 #30 视频，而它是**明确不做**、不是缺口。

> **#31 的 ✅ 判据要说清**（§5 第 6 条：状态只在代码真跑通后才改）：
> 它建立在 `npm run verify`（离线门 + 4 包全绿，含 51 条新断言）之上，
> 而**不是**真实渲染进程 —— `smoke.ts` 里那三条真 EXIF JPEG 断言本轮**没跑过**。
> 下次点名跑 smoke 时，若那三条绿了再把这句注掉；若红了，本行应退回 🟡。

> **#32 / #4 的 ✅ 判据同样要说清**（序2 同一个口径）：两者都建立在
> `npm run verify`（4 包全绿 + 新增 43 条断言）之上，而**不是**真窗口 ——
> 「保存工程 / 打开工程 / 存为预设」三个按钮**没被点过**，`smoke.ts` 新加的 6 条断言
> （真 JPEG 下的工程往返、多一个字节拒开、预设文本往返、桥四动词）**没在实机跑过**。
> D1~D4 与 P1 是**逐字节 / 逐文案**的断言，不依赖真窗口，所以这两行的"逻辑对"是钉住的；
> 未钉住的是"接在 Chromium 上、接在真文件对话框上仍然对"。跑完 smoke 若红，两行退回 🟡。

> **本表的判据盲区（P6-e 序0 暴露，值得记）**：#31/#32 **不在原来的 30 项里**，
> 不是因为前任漏勾，而是因为本表只问"**内核有的能力，壳接了没有**"——
> 而这两项**内核自己就没有**，于是它们既不算 ⬜ 也不算 ⛔ 的既有候选，**根本进不了表**。
> 结果就是"P6-d 台账全绿"与"真实照片进不来、编辑栈存不下"同时成立。
>
> 所以 **"内核强、壳弱"这个落差确实合拢了**（在它有判据的那 30 项上）；
> 没合拢的是"**能不能伺候用户手上那张真机 JPEG**"——那是 P6-e 的题目，见 `docs/P6E-PLAN.md` §2。
> **表全绿 ≠ 产品能用。**
>
> **序3 之后这句要改口一半**：真机 baseline JPEG 现在**进得来**了 ——
> `packages/io` 有手写零依赖解码器，CLI 与桌面**用同一个函数**解 JPEG（`ARCHITECTURE.md` D17）。
> 但"进得来"是有边界的：渐进式 / 算术 / 多帧 / CMYK 一律明确拒绝（桌面此前靠 Chromium 能开，
> 现在不能开了），而"能不能伺候"的另一半（大图的解码耗时、真机照片的实际覆盖率）
> 仍未验证。上面那行"表全绿 ≠ 产品能用"依然成立。

> 其中 #4 曾是**唯一的实质缺口**，它的前置是 P6D-PLAN 序 9「预设分享格式」
> （JSON schema + 校验 + CLI 能吃）。**序 9 已完成**（`photo.preset/v1`
> 格式 + 内核 `parseSharedPreset`/`sharedPresetToOps` + CLI `preset validate/apply`），
> 壳侧接线在 **P6-e 序2** 落地：新增 `sharedPresetFromEditState`（观感 → 预设），
> 落 op 走 `sharedPresetToOps` 展开成参数类 op —— **不是**给 `applyPreset` 传一个
> 自定义 key（那条 op 渲染时要查内置表，撞名就会让"我的胶片感"实际生效成内置的那一个）。

> 维护提示：改动本表时**必须同步更新本节统计**，否则表本身就成了不可信来源。

## 5. 两条不许破的红线（接任何一项前先读）

1. **壳里不许出现像素算法。** 模糊、曲线、HSV、抠图……一律走内核。
   一旦发现"壳里必须算点像素才好使"，停手 —— 说明内核抽象缺了一层，该补的是内核。
2. **新接的每一项都要留回归。** 优先补「预览 == 导出同源」断言；纯视图项（缩放、对比、直方图）
   可豁免，但要在本表备注列注明。理由见 `P6D-PLAN.md` §4。

---

## 6. 本表覆盖不到的 P0 缺口（单列，防第二次漏）

本表的判据是"**内核有的能力，壳接了没有**"。有两项 P0 缺口不属于这个范畴，
因此**装不进这张表** —— 但它们恰恰是 P6-c 交付后"用户依然拿不到东西"的原因：

| 缺口 | 为什么装不进本表 | 归口 |
|---|---|---|
| **桌面分发（打包出安装包）** | 这是**交付形态**，不是能力接线 —— 内核与壳都没问题，问题是**没有产物** | `P6D-PLAN.md` §2.4（序 2，**P0**） |
| **全仓 ESLint** | 属**工程规范**，不是能力对齐 | `P6D-PLAN.md` §2.1（序 0，**P0**） |
| **交付纪律**（版本单一真相源 / 产物能否追认到提交） | 不是"能力没接"也不是"产物没有"，而是**没有门** —— 版本号写在五个地方而无人核对，漂移只在发货时暴露 | ✅ **已由 P6-e 序0 关闭**：`scripts/check-version.mjs` 进 `verify` 第一步（顺带钉住 `electronVersion` 与 `devDependencies.electron` 一致且不带 `^`）。清标识那片又补上**第六处**（`apps/cli/src/version.ts` 里的 `photo --version` 串）与 `scripts/check-brand.mjs`（标题与品牌区逐字等于 `build.productName`，页面上不许有内部记号）—— 见 `P6E-PLAN.md` §3.4.4 |
| **元数据 / EXIF** · **工程文件** | 一度以为"装不进本表"—— 实际暴露的是**本表判据本身的盲区**：它只问"内核有的能力壳接了没有"，答不了"内核自己缺什么" | ✅ **已升格为主表 #31 / #32**（⛔）；开工口径见 `P6E-PLAN.md` 序1 / 序2 |

> 单列的理由：这两项此前"谁都不认领"—— 既不在能力台账里，也不在任何里程碑的验收里，
> 于是 P6-c 宣布"首个可双击版本"时，**能双击的东西仍然是 legacy 的旧 exe**。
> **显性化，才不会第二次漏。**
