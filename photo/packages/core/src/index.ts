/**
 * @photo/core —— 照片加工内核
 *
 * 纯 TypeScript，零平台依赖：不引用 DOM、不引用 Node、不引用 Electron。
 * 因此同一份内核可原样运行在 浏览器 / Web Worker / Electron 渲染进程 /
 * Node（无头批处理）/ 移动端 WebView 中。
 *
 * 分层：
 *   geometry  几何与布局数学（含宽高互换的唯一入口）
 *   metadata  元数据（EXIF 读取 + 朝向语义）
 *   color     色彩空间、曲线 LUT、HSL 分色、直方图
 *   presets   参数模型与预设（纯数据）
 *   nlp       中文口语指令解析 → 结构化意图
 *   doc       文档模型与操作栈（单一真相源）
 *   pixels    纯像素原语（采样/仿射/光栅化/模糊/色彩/效果）
 *   ops       每个操作一个纯函数执行器
 *   pipeline  RenderPlan 与唯一执行引擎（预览/导出/封面同源）
 */

export type { PixelBuffer, CollageMode, ExportUse, ImageFormat } from './types.js';
export { createPixelBuffer, pixelCount } from './types.js';

export * as geometry from './geometry/index.js';
export * as metadata from './metadata/index.js';
export * as color from './color/index.js';
export * as presets from './presets/index.js';
export * as nlp from './nlp/index.js';
export * as doc from './document/index.js';
export * as pixels from './pixels/index.js';
export * as ops from './ops/index.js';
export * as pipeline from './pipeline/index.js';
