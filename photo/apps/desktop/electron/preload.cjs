'use strict';
/**
 * preload —— 渲染进程与主进程之间**唯一**的通道。
 *
 * 页面开着 `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`，
 * 拿不到任何 Node 能力。这里用 contextBridge 暴露一个**只有四个方法**的白名单
 * （见 src/shell-api.ts 的 ShellBridge）。每多暴露一个方法，
 * 就多一个页面脚本能触达主进程的入口，所以这里刻意保持最小。
 *
 * 本文件是 CJS（`.cjs`）—— 与主进程同理：Electron 的 preload 不走 ESM。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photoShell', {
  platform: process.platform,

  /** 主进程弹文件对话框并读入字节。 */
  openImage: () => ipcRenderer.invoke('photo:open-image'),

  /** 主进程弹文件对话框（多选）并读入多张字节。 */
  openImages: () => ipcRenderer.invoke('photo:open-images'),

  /** 主进程弹保存对话框并落盘。 */
  saveImage: (defaultName, bytes) => ipcRenderer.invoke('photo:save-image', defaultName, bytes),

  /** 工程文件：保存（弹对话框 + 落盘文本）。 */
  saveProject: (defaultName, text) => ipcRenderer.invoke('photo:save-project', defaultName, text),

  /** 工程文件：打开（弹对话框 + 读出文本），取消返回 null。 */
  openProject: () => ipcRenderer.invoke('photo:open-project'),

  /** 自定义预设：写进 userData/presets（无对话框），返回落盘文件名。 */
  savePreset: (fileName, text) => ipcRenderer.invoke('photo:save-preset', fileName, text),

  /** 自定义预设：列库（读 userData/presets）。 */
  listPresets: () => ipcRenderer.invoke('photo:list-presets'),

  /** 冒烟模式：把自检结果交回主进程打印与判定退出码。 */
  reportSmoke: (report) => ipcRenderer.send('photo:smoke-report', report),
});
