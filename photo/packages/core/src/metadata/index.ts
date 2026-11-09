/**
 * metadata —— 图片元数据层。
 *
 * 职责：把"外部字节里的元数据"读成内核结构，并规定**它能影响什么**。
 * 目前的边界（D12 / D13）：
 *   - **朝向**影响像素，且只在**导入那一次**经 `pixels.applyOrientation` 影响；
 *   - 其余字段（机型 / 光圈 / 快门 / ISO / 焦距 / 拍摄时间）只供展示，
 *     渲染路径拿不到它们 —— 这是 X5 的结构保证，不只是纪律。
 *
 * 零平台依赖：只吃 `Uint8Array`，不引用 DOM / Node。
 */

export * from './orientation.js';
export * from './exif.js';
/* 朝向落到像素的那一步住在 `pixels`（它是像素原语），但**宿主只需要认识 metadata**：
 * "读了 EXIF 就用它给的方向置换一次"是一条完整的能力，拆成两个命名空间就会被漏用一半。 */
export { applyOrientation } from '../pixels/orientation.js';
