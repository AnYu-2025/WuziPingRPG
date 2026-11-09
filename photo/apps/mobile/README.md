# 浮生图梦 · 手机页（天工修图模块）

这是浮生图梦在天工里的手机界面。修图内核和桌面版共用：`packages/core`（文档模型、操作栈、RenderPlan）和 `packages/io`（PNG / JPEG 编解码、EXIF、ZIP）。渲染器入口仍是 `apps/desktop/src/renderer/app.ts`，这里只换掉外壳。

| 文件 | 作用 |
|---|---|
| `index.html` | 手机布局：顶栏「‹ 天工」+ 导出，图片预览，底部分页面板（调色 / 几何 / 文字 / 拼图 / 导出 / 信息），可展开 |
| `mobile-shell.js` | 实现桌面版 preload 提供的 `window.photoShell`：用 `<input type=file>` 选图；有 `PhotoBridge` 时分块 base64 交给原生写入相册或下载目录，没有时走浏览器下载；预设存 localStorage。还提供 `window.PhotoMobile.back()` 给宿主的返回键 |
| `mobile.css` | 手机尺寸的覆盖样式 |

## 构建

在 `studio/web` 运行 `npm run build`（或单独 `node build-photo.mjs`）。esbuild 把渲染器和渲染 Worker 打成 ES 模块（目标 Chrome 89，因为渲染器用了顶层 await），连同这三个文件一起写到 `studio/src/main/assets/photo/`。`@photo/core` / `@photo/io` 和 `app://core|io/index.js` 都映射到 `packages/*/src/index.ts`，不需要先在 `photo/` 里安装依赖。

## 返回

`PhotoMobile.back()` 依次退出裁剪、收起展开的面板；没有可关的就返回 `false`，宿主 `PhotoActivity` 随后结束页面，天工回到首页。顶栏「‹ 天工」在安装包里调用 `PhotoBridge.close()`，在浏览器预览里跳回 `../studio/index.html`。

## 浏览器预览

用任意静态服务器提供 `studio/src/main/assets/`，打开 `/photo/index.html`。点「新建示例图」可以不选文件直接试。
