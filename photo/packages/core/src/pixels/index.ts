/**
 * pixels —— 纯像素原语层。
 *
 * 职责：把"对一个像素缓冲做什么"这件事，用**零平台依赖**的纯函数实现。
 * 不引用 DOM、不引用 Canvas、不引用 Node。因此：
 *   - 浏览器 / Worker / Electron 渲染进程 / Node 无头批处理 共用同一份结果；
 *   - 预览与导出走同一批函数 ⇒ 同尺寸下像素级一致（对应病根 1）。
 *
 * 采样、混合、光栅化、模糊、色彩、效果全部在此收敛，
 * 上层（ops / pipeline）只做"选哪些、按什么顺序"。
 */

export * from './sampling.js';
export * from './affine.js';
export * from './resize.js';
export * from './compose.js';
export * from './blur.js';
export * from './raster.js';
export * from './color.js';
export * from './auto.js';
export * from './slice.js';
export * from './effects.js';
export * from './orientation.js';
