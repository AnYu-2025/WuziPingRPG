/**
 * 渲染 Worker —— 内核重负载的**离线程执行体**（P6-d 序 5 / A1）。
 *
 * ── 它解决的是哪个病根 ─────────────────────────────────────────────
 * 病根 4：像素计算在主线程。拖一根滑杆要重跑管线末端一长串卷积/调色，
 * 24MP 源图下一帧几十到上百毫秒 —— 主线程被占满，rAF 直接掉帧。
 * 把这段挪到 Worker，主线程只剩"贴一张已算好的画布"，于是滑杆跟手。
 *
 * ── 它几乎不"写逻辑"，这是刻意的 ──────────────────────────────────
 * 本文件只做三件事：接消息、交给 `createWorkerEngine`、把结果回传（buffer
 * 所有权移交）。**一条像素算法都没有** —— 内核是唯一实现，Worker 只是换了
 * 个线程跑它。这条守住，"预览 == 导出同源"才不会因为多了一个执行体而破掉。
 * 任务引擎单独放在 `engine.ts`，好让它在 Node 单测里被直接驱动。
 *
 * ── 文字栅格化为什么也在 Worker 里 ────────────────────────────────
 * 水印/贴纸是"内核排版 + 外壳光栅化"。光栅化要画布 —— 而 `OffscreenCanvas`
 * 在 Worker 里**可用**（这正是当初选它而不是 `<canvas>` 的回报）。这里直接复用
 * 与主线程**同一个** `createBrowserRenderKit()`，于是"字怎么画"两端同源，
 * 不会出现"预览有字、导出没字"。
 *
 * ── 为什么用绝对 URL 导入内核 ────────────────────────────────────
 * import map 只作用于文档，不作用于 Worker。因此这里必须写
 * `app://core/index.js`（与 import map 指向同一个产物），类型由
 * `src/app-url.d.ts` 的环境模块声明兜底。详见该文件。
 */
import { createBrowserRenderKit } from '../shell-adapter.js';
/* 绝对 URL：本文件在 Worker 的模块图里，裸说明符 `@photo/io` 会让脚本
 * 在加载阶段直接死掉（序3 就栽过一次，闸门见 src/worker-graph.test.ts）。
 * 交出去的是 io 的**同一个** `decodeJpeg` —— 桌面、CLI、Worker 三处同源，
 * "搬线程"不改变解出来的像素，只改变它在哪个线程上算。 */
import { decodeJpeg } from 'app://io/index.js';
import { createWorkerEngine, type WorkerEngine } from './engine.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

/**
 * Worker 全局的**窄接口**。
 *
 * 与 `surface.ts` 收窄画布接口同一条思路：不把 `lib.dom` 的宽类型搬进来
 * （在 DOM lib 里 `self` 被声明成 `Window`，`postMessage` 的重载签名根本不是
 * Worker 那套），只声明真正用到的成员。
 */
interface WorkerScope {
  onmessage: ((event: { readonly data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse, transfer?: readonly ArrayBuffer[]): void;
}

const scope = self as unknown as WorkerScope;

/* 文字栅格化器**懒建**：引擎只在任务声明 `withText` 时才调这个函数，
 * 于是不画字的图不会白付一块大画布的钱。 */
const engine: WorkerEngine = createWorkerEngine({
  createTextRenderer: () => createBrowserRenderKit().textRenderer,
  decodeJpeg,
});

scope.onmessage = (event) => {
  const response = engine.handle(event.data);
  if (response === null) return; // 单向消息（源图 / 重置 / 释放）
  /* 结果 buffer 走 transfer list：所有权移交，零拷贝。引擎交出后不再引用它。
   * 解码结果同理 —— 而且它比渲染结果更大（源像素，24MP 就是 96 MB），
   * 少一次拷贝不是优化而是必需。 */
  if (response.t === 'result' || response.t === 'decoded') {
    scope.postMessage(response, [response.pixels.data.buffer as ArrayBuffer]);
  } else {
    scope.postMessage(response);
  }
};
