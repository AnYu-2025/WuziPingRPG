import { CLI_NAME, CLI_VERSION } from './version.js';

/** 帮助文本。放在独立文件里，main 保持"只做接线"的薄壳形态。 */
export const HELP_TEXT = `
${CLI_NAME} ${CLI_VERSION} · 浮生图梦 无头批处理
同一份内核跑在 Node 上 —— 批处理 / CI / 服务端。

用法
  ${CLI_NAME} <命令> [选项] <输入文件...>

命令
  render   渲染并写出图片
  plan     只输出渲染计划（不写文件），用于检查配方
  info     读取图片头信息（格式 / 尺寸）
  preset   预设分享：校验 / 套用一份 photo.preset/v1 预设文件

通用选项
  --json               以 JSON 输出（便于 CI 解析）
  -h, --help           显示本帮助
  -v, --version        显示版本

读入格式（探测靠 magic bytes，扩展名不算数）
  bmp / ppm            @photo/io 内置，零依赖
  jpeg                 @photo/io 内置的 baseline（SOF0/SOF1）解码器：
                       8 位、1 或 3 分量、Huffman。渐进式 / 算术编码 / 无损 /
                       分层 / 多帧一律**明确拒绝**，不会解成一张错图
  png                  Node 的 zlib
  webp / gif / heic    刻意不支持（语义与内核 PixelBuffer 不是一一对应）

render / plan 共用选项
  --recipe <文件>      配方 JSON 路径；省略则不做任何调整，仅按长边归一
  --long-edge <n>      输出长边上限，0 表示保持原尺寸（默认 1920）
  --no-text            不绘制水印与贴纸。**CLI 端目前必须带它**才能跑带文案的配方 ——
                       Node 侧还没有字体光栅化（TextRenderer），内核会选择明确失败，
                       而不是静默产出一张"报告说成功、其实没有水印"的图

render 额外选项
  --out <目录>         输出目录（默认当前目录）
  --format <格式>      输出格式：png / bmp / ppm（默认 png）
  --quality <n>        压缩质量 10..100（默认 85；PNG 映射为 deflate 级别）
  --suffix <后缀>      加在输出文件名后：a.bmp --suffix gray → a_gray.png
  --dry-run            只计算计划并报告，不写文件
  --allow-oversize     内存超预算时仍按当前尺寸执行（默认会自动降长边）
  --zip                把整批成品打成一个 photos.zip（落在 --out 目录里），
                       而非输出 N 个散文件；归档内条目名即各输出的文件名（重名自动去重）

内存门
  导出前内核会估算峰值内存（24MP 约 1.3 GB）。超出预算时：
    自动降长边并告知实际尺寸；降不下来则拒绝，或（带 --allow-oversize）由你承担风险。
  预算默认 2 GB，可用环境变量 PHOTO_MEMORY_BUDGET_MB 覆盖。

配方 JSON
  配方即一份"操作日志" —— 与桌面端共用同一套文档模型。
  稀疏写法会被按默认值补全，因此只需写你要改的字段：

  {
    "name": "film-90",
    "ops": [
      { "k": "applyPreset", "key": "film", "intensity": 0.8 },
      { "k": "setAdjust", "value": { "vignette": 40, "grain": 12 } },
      { "k": "setGeometry", "value": { "rotate": 90 } },
      { "k": "setCollage", "value": { "mode": "single", "borderWidth": 24, "borderColor": "#ffffff" } },
      { "k": "setWatermark", "value": { "text": "© 尤利乌斯", "pos": "br", "size": 3 } }
    ]
  }

  可用操作（键名写错会明确报错，不会静默无效）：
    setSources / setAdjust / applyPreset / setLevels / setCurves / setBands /
    setGeometry / setCrop / setCollage / setWatermark / setSticker

  色阶（setLevels）即"自动增强"的产物，可手写或用内核算法生成：
    { "k": "setLevels", "value": { "r": { "lo": 12, "hi": 238, "gain": 1.05 } } }
    —— 未写的通道保持中性（lo=0 / hi=255 / gain=1）；约束 0 ≤ lo < hi ≤ 255、0 < gain ≤ 4。

示例
  ${CLI_NAME} render *.bmp --recipe film.json --long-edge 1920 --out ./out
  ${CLI_NAME} render *.png --recipe film.json --zip --out ./out
  ${CLI_NAME} plan cover.png --recipe film.json --long-edge 256
  ${CLI_NAME} info *.png --json

preset 子命令
  preset validate <预设.json>           解析并打印预设内容（跨机导入前先校验）
  preset apply <预设.json> <图...>      把预设观感套到图片上并写出
  preset apply 复用 render 的全部输出选项：
    --out <目录>  --format <格式>  --quality <n>  --long-edge <n>
    --no-text  --allow-oversize  --json

预设分享格式（photo.preset/v1）
  一份可跨机迁移的编辑观感快照，结构如下（调色 12 参数必填；曲线/色阶/分色带可选）：

  {
    "format": "photo.preset/v1",
    "key": "my_film",
    "name": "我的胶片",
    "params": { "brightness": 110, "contrast": 108, "saturate": 125 },
    "curves": { "rgb": [[0,0],[255,255]], "r": [[0,0],[255,255]],
                "g": [[0,0],[255,255]], "b": [[0,0],[255,255]] }
  }

  结构错了（缺 format / 缺 params / 未知字段）会明确报错；数值错了（NaN / 越界）
  经内核收敛到中性，绝不静默碎图。

示例
  ${CLI_NAME} preset validate ./shared/my_film.json
  ${CLI_NAME} preset apply ./shared/my_film.json raw/*.png --out ./graded
`.trim();

export const USAGE_HINT = `试试 ${CLI_NAME} --help。`;
