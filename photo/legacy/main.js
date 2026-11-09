const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '照片加工 v0.11',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
  if (process.argv.includes('--dev')) win.webContents.openDevTools();
}

// 桌面另存为：渲染进程传 ArrayBuffer，主进程弹系统对话框写盘
ipcMain.handle('save-buffer', async (event, buf, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '保存照片',
    defaultPath: (opts && opts.defaultName) || '照片加工.png',
    filters: (opts && opts.filters) || [{ name: '图片', extensions: ['png', 'jpg', 'webp'] }]
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, Buffer.from(buf));
  return { saved: true, filePath };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
