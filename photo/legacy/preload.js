// 安全桥：只暴露保存文件一个能力
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  saveBuffer: (buf, opts) => ipcRenderer.invoke('save-buffer', buf, opts)
});
