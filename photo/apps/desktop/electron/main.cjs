'use strict';
/**
 * Electron 主进程 —— 只做三件事：
 *   1. 窗口生命周期；
 *   2. 文件对话框 + 落盘（渲染进程拿不到 Node，全靠这里）；
 *   3. 冒烟结果的收口（核对窗口配置 → 打印 JSON → 决定退出码）。
 *
 * ── 为什么主进程里没有一行内核代码 ─────────────────────────────────
 * 这不是"顺手分开"，是**被模块系统逼出来的**：
 *   - `@photo/core` 是纯 ESM（`"type": "module"`，只导出 `import`）；
 *   - Electron 主进程是 CJS，随附的 Node 不支持 `require(esm)`。
 * 于是 `require('@photo/core')` 必然失败。内核只能活在**渲染进程**里。
 *
 * 这个约束恰好与 P6-c 的分层设计一致（见 docs/P6C-PLAN.md §3）：
 * 主进程管外壳，内核与业务逻辑全在渲染进程。所以这里不需要"绕过去"，
 * 顺着它就是对的。
 */
const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
/* 产品名只有一份：`package.json` 的 `build.productName`，也就是 electron-builder
 * 打进安装目录、快捷方式和 exe 元数据的那一个。这里直接读它，标题就**不可能**
 * 与打包产物分家；页面侧那份由 `scripts/check-brand.mjs` 钉住。 */
const PRODUCT_TITLE = require('../package.json').build.productName;
const fs = require('node:fs/promises');
const path = require('node:path');

/** 冒烟模式：不显示窗口、跑完自检就退出。 */
const SMOKE = process.argv.includes('--smoke');
const SMOKE_TIMEOUT_MS = 90_000;

/**
 * 冒烟报告的**文件**落点（可选）。
 *
 * 为什么需要它：免安装（portable）产物是 NSIS 包装器，它启动真正的应用时
 * **不透传子进程的 stdout**，于是"读 stdout 里的 SMOKE_REPORT"这条在
 * 单文件产物上失效（包装器立刻以 0 退出，报告一个字也拿不到）。
 * 让应用额外把同一份 JSON 写进指定文件，产物冒烟就能绕开这个限制。
 * 见 apps/desktop/scripts/smoke-dist.mjs。
 */
const SMOKE_REPORT_FILE = process.env.PHOTO_SMOKE_REPORT_FILE ?? null;

/** 截图模式：`--shot <输出路径>` —— 加载正式页面、跑一次示例图、存一张 PNG 后退出。 */
const SHOT_INDEX = process.argv.indexOf('--shot');
const SHOT_PATH = SHOT_INDEX >= 0 ? (process.argv[SHOT_INDEX + 1] ?? null) : null;

/** 需要软件渲染的场景（无头环境跑不了 GPU）。 */
const NEEDS_SOFTWARE_GL = SMOKE || SHOT_PATH !== null;

/**
 * 受限环境下的降级开关 —— 只影响自检/截图，**绝不影响正式运行**。
 *
 * `--disable-gpu`：无头/CI 环境没有可用 GPU 时，Chromium 的 GPU 进程会反复
 * 启动失败，最后 `FATAL: GPU process isn't usable. Goodbye.` 直接终止进程 ——
 * 连窗口都建不起来，表现为"一行输出都没有"。加上后走软件光栅化
 * （Skia CPU），Canvas2D / OffscreenCanvas 仍然完全可用，对**正确性**无影响。
 *
 * `--no-sandbox`：受限环境（容器、受限的会话沙箱）里 Chromium 的 OS 级沙箱
 * 无法初始化，**渲染进程起不来** —— 页面永远不加载，同样没有任何输出。
 * 这一条是关键：光有 `--disable-gpu` 不够，因为 Chromium 仍会为合成器拉起
 * GPU 进程，而它同样受沙箱初始化失败的影响。
 *
 * ── 一条必须说清的边界 ─────────────────────────────────────────────
 * `--no-sandbox` 关的是 **OS 级沙箱**；而核对通过的
 * `webPreferences.sandbox` 是 **Electron 的渲染沙箱偏好**。两者相关但不是
 * 同一件事：开着 `--no-sandbox` 时，那个偏好即便报 true，其强制力也已被削弱。
 * 所以本模式启动时会打一条 WARN —— **配置核对通过不等于"OS 沙箱已启用"**，
 * 不要让一份绿油油的自检报告变成过度承诺。
 *
 * 想要严格模式（不用 `--no-sandbox`）就设 `PHOTO_SMOKE_STRICT_SANDBOX=1`；
 * 在沙箱能正常初始化的机器上它会通过。
 */
const RELAX_SANDBOX = process.env.PHOTO_SMOKE_STRICT_SANDBOX !== '1';

if (NEEDS_SOFTWARE_GL) {
  app.commandLine.appendSwitch('disable-gpu');
  if (RELAX_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
}
/* GPU 着色器磁盘缓存与结论无关，压掉噪声。 */
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

/**
 * 窗口与任务栏图标。
 *
 * 打包后的 exe 已把图标嵌进二进制，Electron 自动用它；但**开发模式**跑的是
 * `node_modules/electron/dist/electron.exe`，不给这一行就是 Electron 的原子图标。
 *
 * 只管窗口与任务栏。桌面上那条快捷方式的图标是 `.lnk` 自己的 `IconLocation`，
 * 不由本文件决定。
 */
const WINDOW_ICON = path.join(APP_ROOT, 'assets', 'icon.ico');

/**
 * 内核 / io 的构建产物目录 —— **打包后路径必须跟着产物结构走**。
 *
 * 源码树里它们是 `packages/<pkg>/dist`（相对 `REPO_ROOT`）；
 * 但打包后 `__dirname` 落在 `resources/app.asar/electron`，`REPO_ROOT`
 * 会指到 `resources/` —— 那里**没有** `packages/`。若仍按源码树算，
 * `app://core/index.js` 必然 404，页面在 import 阶段就死掉，
 * 表现为"开发机能跑、装完白屏"（P6-d §2.4 专门要堵的落差）。
 *
 * 所以打包时改读 `electron-builder` 的 `extraResources` 落点：
 * `resources/core` 与 `resources/io`（见 apps/desktop/package.json 的 build 段）。
 */
const CORE_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'core')
  : path.join(REPO_ROOT, 'packages', 'core', 'dist');
const IO_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'io')
  : path.join(REPO_ROOT, 'packages', 'io', 'dist');

/**
 * 把磁盘目录挂到 `app://` 自定义协议上。
 *
 * 为什么不直接 `file://` 加载：Chromium 禁止在 `file://` 下做 ESM 导入
 * （CORS 把它当不透明来源），而本项目内核与外壳全是 ESM 模块。
 * 自定义协议是绕开这条限制的正规做法。
 */
const MOUNTS = new Map([
  ['app', APP_ROOT],
  ['core', CORE_DIST],
  ['io', IO_DIST],
]);

/**
 * Content-Type 必须准确。
 *
 * 特别是 `.js` —— Chromium 只接受 `text/javascript`（或等价的 JS MIME）
 * 才会把脚本当模块执行，类型不对会直接报
 * "Expected a JavaScript module script but the server responded with ..."，
 * 而且报错指向的具体行是加载器内部，排查起来极不直观。
 */
const CONTENT_TYPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * 窗口配置 —— 与 `packages/core/src/pipeline/shell.ts` 里的
 * SHELL_REQUIREMENTS 一一对应。冒烟测试会拿内核给的要求逐条核对这里的实际值，
 * 因此**改这里就必须同步那边**，反之亦然；不一致会在冒烟里当场暴露。
 */
const WEB_PREFERENCES = {
  preload: path.join(__dirname, 'preload.cjs'),
  /* P1-6：失焦时 rAF 降频会让逐帧导出变成幻灯片。 */
  backgroundThrottling: false,
  /* 安全基线三件套。 */
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

let smokeFinished = false;
let lockRequested = false;
let appUserModelIdSet = false;

/* ── 特权协议必须在 ready 之前登记 ── */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/* ── 单实例锁：多开会让两套进程争抢同一份工程文件 ──
 * 冒烟模式下仍**申请**锁（要求就是这个动作），但不因抢不到而退出 ——
 * 否则在已经开着应用时跑冒烟会直接静默退出，看起来像"冒烟没跑"。 */
lockRequested = true;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !SMOKE) {
  app.quit();
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const dir = MOUNTS.get(url.hostname);
    if (dir === undefined) {
      return new Response(`未知的 app:// 主机：${url.hostname}`, { status: 404 });
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(dir, relative);
    /* 目录穿越防护：解析后必须仍在挂载点之内。 */
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      return new Response('路径越界', { status: 403 });
    }

    try {
      const data = await fs.readFile(target);
      const type = CONTENT_TYPE[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'content-type': type } });
    } catch {
      return new Response(`找不到：${relative}`, { status: 404 });
    }
  });
}

function createWindow(page) {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    show: !SMOKE,
    icon: WINDOW_ICON,
    backgroundColor: '#14141a',
    title: PRODUCT_TITLE,
    webPreferences: WEB_PREFERENCES,
  });
  win.removeMenu();
  void win.loadURL(`app://app/${page}`);
  return win;
}

function registerIpc() {
  /** 读入若干已选文件；取消或无文件时返回空数组（由调用方决定语义）。 */
  const readFiles = async (filePaths) => {
    const out = [];
    for (const file of filePaths) {
      const bytes = await fs.readFile(file);
      out.push({ name: path.basename(file), path: file, bytes: new Uint8Array(bytes) });
    }
    return out;
  };

  ipcMain.handle('photo:open-image', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const files = await readFiles(result.filePaths.slice(0, 1));
    return files[0] ?? null;
  });

  ipcMain.handle('photo:open-images', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开图片（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return readFiles(result.filePaths);
  });

  ipcMain.handle('photo:save-image', async (_event, defaultName, bytes) => {
    const result = await dialog.showSaveDialog({
      title: '导出图片',
      defaultPath: typeof defaultName === 'string' && defaultName !== '' ? defaultName : 'export.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || result.filePath === undefined) return null;
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
  });

  /* ── 工程文件与自定义预设（序 2）──────────────────────────────────
   *
   * 这里**只搬运文本**：格式由内核解释（`photo.doc/v1` / `photo.preset/v1`），
   * 主进程既不解析也不校验。D11 的分工就是这样：主进程管落盘与对话框，
   * "文件里该有什么"这条知识只活在内核里 —— 否则同一份格式在两处各长一遍，
   * 迟早漂移。
   */
  const PROJECT_EXT = 'photo.doc.json';
  const PRESET_SUFFIX = '.photo.preset.json';
  /** 一份工程/预设文本的上限：真文件是 KB 级，超了就是选错了文件。 */
  const MAX_TEXT_BYTES = 8 * 1024 * 1024;

  ipcMain.handle('photo:save-project', async (_event, defaultName, text) => {
    const name =
      typeof defaultName === 'string' && defaultName !== '' ? defaultName : `project.${PROJECT_EXT}`;
    const result = await dialog.showSaveDialog({
      title: '保存工程',
      defaultPath: name,
      filters: [{ name: '浮生图梦工程', extensions: [PROJECT_EXT, 'json'] }],
    });
    if (result.canceled || result.filePath === undefined) return null;
    await fs.writeFile(result.filePath, String(text), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('photo:open-project', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开工程',
      properties: ['openFile'],
      filters: [{ name: '浮生图梦工程', extensions: [PROJECT_EXT, 'json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0];
    const buf = await fs.readFile(file);
    /* 上限拦在读取之后、交给渲染进程之前：工程文件本来就该是几十 KB，
     * 兆级只可能是误选了别人的二进制文件，让它穿进解析器没有意义。 */
    if (buf.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`这个文件太大（${(buf.byteLength / 1048576).toFixed(1)} MB），不像工程文件`);
    }
    return { name: path.basename(file), path: file, text: buf.toString('utf8') };
  });

  /**
   * 预设库目录。**只**按这个形状接受文件名。
   *
   * 渲染进程传来的字符串一律不可信：`../../windows/system32/x` 也满足
   * "以 .photo.preset.json 结尾"。所以主干用**白名单**（字母/数字/连字符，
   * 与内核 `presetKeyFromName` 的产物同一集合）过一遍，拼完路径后再用
   * `path.resolve` 复核一次仍在库内 —— 两道都留着，因为任一道单独失效
   * 都不该导致写出目录。
   */
  const presetTarget = (fileName) => {
    const dir = path.join(app.getPath('userData'), 'presets');
    const base = typeof fileName === 'string' ? fileName.trim() : '';
    if (!base.endsWith(PRESET_SUFFIX) || base.length > 160) return null;
    const stem = base.slice(0, -PRESET_SUFFIX.length);
    if (stem === '' || !/^[\p{L}\p{N}-]+$/u.test(stem)) return null;
    const full = path.resolve(dir, base);
    if (path.resolve(full, '..') !== path.resolve(dir)) return null;
    return { dir, full };
  };

  ipcMain.handle('photo:save-preset', async (_event, fileName, text) => {
    const target = presetTarget(fileName);
    if (target === null) throw new Error('预设文件名不合法（应为「名字.photo.preset.json」）');
    const body = String(text);
    if (Buffer.byteLength(body, 'utf8') > 64 * 1024) throw new Error('预设内容过大，拒绝写入');
    await fs.mkdir(target.dir, { recursive: true });
    await fs.writeFile(target.full, body, 'utf8');
    return path.basename(target.full);
  });

  ipcMain.handle('photo:list-presets', async () => {
    const dir = path.join(app.getPath('userData'), 'presets');
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return []; // 还没存过任何预设：空库不是错误
    }
    const out = [];
    for (const name of names.filter((n) => n.endsWith(PRESET_SUFFIX)).sort().slice(0, 500)) {
      try {
        out.push({ file: name, text: await fs.readFile(path.join(dir, name), 'utf8') });
      } catch {
        /* 读不动的那条跳过：库里有半个文件（上次崩溃）不该让整库打不开。 */
      }
    }
    return out;
  });

  ipcMain.on('photo:smoke-report', (_event, report) => {
    finishSmoke(report);
  });
}

/**
 * 用内核给的要求核对窗口的**实际**配置。
 *
 * 这一条是 P1-6 那类"内核正确、外壳配置错"缺陷的机器防线：
 * 配置项不再散落在文档的叮嘱里，而是每次冒烟都会被逐条核对的数据。
 *
 * ── 为什么读值要分两个来源 ────────────────────────────────────────
 * Electron 33 的 `webContents.getLastWebPreferences()` 只保留了
 * `contextIsolation` / `nodeIntegration` / `sandbox` 这三项，
 * `backgroundThrottling` **已不在其中**（连类型声明都移除了）。
 * 它另有一个运行期读取接口 `getBackgroundThrottling()`，那才是生效值。
 *
 * 所以：能读到"运行时生效值"的项优先用运行时接口，其余退回创建时的快照。
 * 直接拿快照读 `backgroundThrottling` 会得到 `undefined`，
 * 于是"配置其实是对的、检查却报失败" —— 这种假阴性会让人开始怀疑检查本身，
 * 比没有检查更糟。
 */
function verifyRequirements(requirements, win) {
  const prefs = win.webContents.getLastWebPreferences() ?? {};
  const throttling =
    typeof win.webContents.getBackgroundThrottling === 'function'
      ? win.webContents.getBackgroundThrottling()
      : prefs.backgroundThrottling;

  const observed = {
    'webPreferences.backgroundThrottling': throttling,
    'webPreferences.contextIsolation': prefs.contextIsolation,
    'webPreferences.nodeIntegration': prefs.nodeIntegration,
    'webPreferences.sandbox': prefs.sandbox,
    singleInstanceLock: lockRequested,
    appUserModelId: appUserModelIdSet,
  };

  return requirements.map((req) => {
    if (!Object.prototype.hasOwnProperty.call(observed, req.key)) {
      /* 内核新增了要求而外壳没跟上 —— 必须吵，而不是默认通过。 */
      return { name: `外壳配置 ${req.key}`, ok: false, detail: '外壳未采集该配置项，无法核对' };
    }
    const actual = observed[req.key];
    return {
      name: `外壳配置 ${req.key} = ${JSON.stringify(req.value)}`,
      ok: actual === req.value,
      detail: actual === req.value ? undefined : `实际为 ${JSON.stringify(actual)}；原因：${req.reason}`,
    };
  });
}

/** 保持引用，避免窗口被 GC 掉。 */
let smokeWindow = null;
// uiWindow 是**刻意只写不读**的：它的唯一职责就是持有强引用，防止界面冒烟期间
// 窗口被 GC 回收。删掉它会重新引入偶发风险，故此处豁免 lint 而不是删代码。
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 写即持有引用，读无意义
let uiWindow = null;

/**
 * 界面冒烟 —— **真的把 index.html 加载起来**。
 *
 * 为什么值得单独做一遍：前面的链路自检跑的是 smoke.html，它证明不了
 * 正式页面能开。import map 写错一个字、`app.ts` 里某个选择器拼错、preload
 * 没注入，都会让界面白屏 —— 而链路自检那几十项检查照样全绿。
 * 这类"产品打不开、自检很绿"的落差，正是这一条要堵的。
 *
 * 检查三件事：
 *   1. 页面元素齐全（缺一个就说明 app.ts 在模块加载期就抛了）；
 *   2. preload 桥注入成功；
 *   3. 真的点一次「新建示例图」，预览画布要出真像素（不是 1×1，也不是全黑）。
 */
async function runUiSmoke() {
  const checks = [];
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    show: false,
    webPreferences: WEB_PREFERENCES,
  });
  uiWindow = win;

  const consoleErrors = [];
  win.webContents.on('console-message', (...args) => {
    /* Electron 33 起改用事件对象；这里兼容两种签名，避免因版本差异漏采。 */
    const detail = args[0] !== null && typeof args[0] === 'object' ? args[0] : null;
    const level = detail === null ? args[1] : detail.level;
    const message = detail === null ? args[2] : detail.message;
    if (level === 3 || level === 'error') consoleErrors.push(String(message));
  });

  try {
    await win.loadURL('app://app/index.html');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const problems = [];
      const need = (selector) => {
        if (document.querySelector(selector) === null) problems.push('缺少元素 ' + selector);
      };
      ['#preview', '#empty', '#preset', '#preset-intensity', '#preset-intensity-val',
       '#preset-intensity-field',
       '#btn-auto', '#btn-auto-clear',
       '#sliders', '#watermark', '#status', '#toast',
       '#btn-open', '#btn-add', '#btn-sample', '#btn-undo', '#btn-redo', '#btn-rotate',
       '#btn-flip', '#btn-flip-v', '#straighten', '#format', '#quality',
       '#btn-zoom-in', '#btn-zoom-out', '#btn-zoom-fit', '#zoom-label', '#btn-compare',
       '#longEdge', '#gate', '#size-tip', '#wm-pos', '#wm-color', '#wm-stroke', '#wm-size',
       '#wm-alpha', '#sticker-text', '#sticker-style', '#sticker-pos', '#sticker-size',
       '#hsl-band', '#hsl-h', '#hsl-s', '#hsl-l', '#histogram',
       '#curve-channel', '#curve-canvas', '#curve-reset', '#btn-export',
       '#kouyu-input', '#kouyu-btn', '#kouyu-tip',
       '#btn-crop', '#crop-overlay', '#crop-panel', '#crop-ratio',
       '#crop-apply', '#crop-cancel', '#btn-export-zip',
       '#thumbs', '#thumb-list', '#btn-del-current', '#btn-clear',
       '#collage-mode', '#collage-gap', '#collage-bg', '#cut-cols', '#cut-rows',
       '#border-width', '#border-color', '#grid-overlay',
       /* 序 2：工程文件与自定义预设的入口。app.ts 在模块加载期就用 el() 取这几个
        * 节点，少一个都会白屏 —— 所以它们必须在这张单子里。 */
       '#btn-save-project', '#btn-open-project', '#preset-name', '#btn-save-preset'].forEach(need);

      if (window.photoShell === undefined) problems.push('preload 桥未注入');

      /* 页面要**等渲染执行体握手完成**才接线（见 app.ts 的顶层 await）——
       * 因此这里轮询等待就绪，而不是假定"加载完就已经接线"。
       * 用"等条件成立"而不是固定睡眠：固定睡眠在慢机器上必然偶发失败，
       * 而偶发失败的测试比没有测试更糟 —— 它会训练人忽略红色。 */
      const waitUntil = async (predicate, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          if (predicate()) return true;
          if (Date.now() > deadline) return false;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const wired = await waitUntil(
        () => document.querySelectorAll('#sliders input[type="range"]').length >= 12,
        5000,
      );
      if (!wired) problems.push('页面 5s 内未完成接线（渲染执行体握手未完成？）');

      const sliders = document.querySelectorAll('#sliders input[type="range"]').length;
      if (sliders < 12) problems.push('滑杆数量不足：' + sliders);
      const presets = document.querySelectorAll('#preset option').length;
      if (presets < 2) problems.push('预设下拉未填充：' + presets);

      /* 真点一次"新建示例图"：串起 导入 → 渲染 → 上屏 三件事。
       * 渲染现在要经过 Worker 一个来回，所以同样等条件，而不是睡死 400ms。 */
      const button = document.querySelector('#btn-sample');
      if (button !== null) button.click();
      const canvas = document.querySelector('#preview');
      await waitUntil(() => canvas.width > 1 && canvas.height > 1, 5000);

      if (canvas.width <= 1 || canvas.height <= 1) {
        problems.push('预览画布仍是 ' + canvas.width + '×' + canvas.height + '，示例图没上屏');
      } else {
        const ctx = canvas.getContext('2d');
        const w = Math.min(64, canvas.width);
        const h = Math.min(64, canvas.height);
        const data = ctx.getImageData(0, 0, w, h).data;
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) nonBlack++;
        }
        if (nonBlack === 0) problems.push('预览画布全黑，渲染结果没上屏');
      }

      /* 批量导出按钮必须由 syncControls 写上文案并处于可用态。
       * "元素在、但没接线"是本项目真实踩过的静默失效：app.ts 模块初始化抛错时，
       * 滑杆 / 预设 / 预览全都没建，而"页面无 console 错误"照样通过。
       * 因此这里不满足于"元素存在"，还要看它真的被写过。 */
      const zipButton = document.querySelector('#btn-export-zip');
      if (zipButton === null) {
        problems.push('缺少元素 #btn-export-zip');
      } else {
        if (!String(zipButton.textContent).includes('ZIP')) {
          problems.push('批量导出按钮文案未接线：' + zipButton.textContent);
        }
        if (zipButton.disabled) problems.push('已导入图片，批量导出按钮却是禁用态');
      }

      /* 视图缩放（#28）：光"元素在"是不够的 —— 按钮存在但没接线的失败模式
       * 本项目真实踩过（见上面批量导出那段）。所以要真的点一下，
       * 看百分比和**显示宽度**是否同步变化。 */
      const zoomLabel = document.querySelector('#zoom-label');
      const zoomIn = document.querySelector('#btn-zoom-in');
      let zoom = null;
      if (zoomLabel === null || zoomIn === null) {
        problems.push('缺少缩放控件 #zoom-label / #btn-zoom-in');
      } else {
        const percent = (text) => parseInt(String(text).replace('%', ''), 10);
        const before = String(zoomLabel.textContent);
        const widthBefore = canvas.getBoundingClientRect().width;
        zoomIn.click();
        const after = String(zoomLabel.textContent);
        const widthAfter = canvas.getBoundingClientRect().width;
        zoom = {
          before,
          after,
          widthBefore: Math.round(widthBefore),
          widthAfter: Math.round(widthAfter),
        };
        if (!(percent(after) > percent(before))) {
          problems.push('点「＋」后缩放百分比没变大：' + before + ' → ' + after);
        }
        if (!(widthAfter > widthBefore + 0.5)) {
          problems.push(
            '点「＋」后画布显示宽度没变大：' + Math.round(widthBefore) + ' → ' + Math.round(widthAfter),
          );
        }
      }
      /* 按住看原图（#29）：按下 → 预览变样；松开 → **必须回到编辑结果**。
       *
       * 先套一个效果强的预设，否则样本图没有编辑，前后两张本就一样，
       * "按下没变化"这条断言会因为编不出差异而失效（假绿，比红了更糟）。
       *
       * 这里的真正重点是**松开**这一半：缺一个松开信号就会永远卡在原图视图，
       * 那是本功能最难自查的失效（用户只会觉得"图突然不跟着调了"）。 */
      const compareBtn = document.querySelector('#btn-compare');
      const presetSelect = document.querySelector('#preset');
      let compare = null;
      if (compareBtn === null || presetSelect === null) {
        problems.push('缺少元素 #btn-compare / #preset');
      } else {
        /* 取左上角一小块的指纹：整张大图逐像素比太慢，而这一块足够暴露
         * "有没有变化" —— 本次改的是全图生效的预设。 */
        const fp = () => {
          const ctx2 = canvas.getContext('2d');
          const w2 = Math.min(48, canvas.width);
          const h2 = Math.min(48, canvas.height);
          return Array.from(ctx2.getImageData(0, 0, w2, h2).data).join(',');
        };

        const pristineFp = fp();
        presetSelect.value = 'nightblue';
        presetSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await waitUntil(() => fp() !== pristineFp, 5000);
        const editedFp = fp();

        compareBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitUntil(() => fp() !== editedFp, 5000);
        const heldFp = fp();

        /* 松开落在**窗口**上而不是按钮上：这正是"在按钮按下、挪开再松"的场景，
         * 也是最容易漏接的那个信号。 */
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await waitUntil(() => fp() === editedFp, 5000);
        const releasedFp = fp();

        compare = {
          changed: heldFp !== editedFp,
          restored: releasedFp === editedFp,
        };
        if (!compare.changed) problems.push('按住「看原图」后预览没有变化');
        if (!compare.restored) problems.push('松开后预览没回到编辑结果（会永远卡在原图）');
      }
      return { problems, size: [canvas.width, canvas.height], zoom, compare };
    })()`);

    checks.push({
      name: '正式页面 index.html 能加载并完成接线',
      ok: result.problems.length === 0,
      detail: result.problems.length === 0 ? undefined : result.problems.join('；'),
    });
    checks.push({
      name: '示例图能渲染并上屏（画布尺寸真实）',
      ok: result.size[0] > 1 && result.size[1] > 1,
      detail: `画布 ${result.size[0]}×${result.size[1]}`,
    });
    checks.push({
      name: '视图缩放（#28）：点「＋」真的改变了显示尺寸（纯视图，不落历史）',
      ok: result.zoom !== null && result.zoom.widthAfter > result.zoom.widthBefore,
      detail:
        result.zoom === null
          ? undefined
          : `${result.zoom.before} → ${result.zoom.after}（显示宽 ${result.zoom.widthBefore} → ${result.zoom.widthAfter}px）`,
    });
    checks.push({
      name: '对比原图（#29）：按住显示原图、松开回到编辑结果',
      ok: result.compare !== null && result.compare.changed && result.compare.restored,
      detail:
        result.compare === null
          ? undefined
          : `按下有变化=${result.compare.changed} 松开已还原=${result.compare.restored}`,
    });
    checks.push({
      name: '页面无 console 错误',
      ok: consoleErrors.length === 0,
      detail: consoleErrors.length === 0 ? undefined : consoleErrors.slice(0, 3).join(' | '),
    });
  } catch (error) {
    checks.push({
      name: '正式页面 index.html 能加载并完成接线',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  return checks;
}

async function finishSmoke(report) {
  if (smokeFinished) return;
  smokeFinished = true;

  const configChecks =
    smokeWindow === null ? [] : verifyRequirements(report.requirements ?? [], smokeWindow);
  const uiChecks = await runUiSmoke();
  const checks = [...(report.checks ?? []), ...uiChecks, ...configChecks];
  const ok = checks.every((c) => c.ok);

  /* 人看的：逐条打到 stderr（stdout 只留机器读的那一行 JSON）。 */
  if (RELAX_SANDBOX) {
    console.error(
      ' WARN  本次自检以 --no-sandbox 运行（受限环境必需）。配置里 sandbox 一项核对的' +
        '是 Electron 渲染沙箱偏好，不构成"OS 沙箱已启用"的证据。',
    );
  }
  for (const c of checks) {
    console.error(`${c.ok ? '  ok  ' : ' FAIL '} ${c.name}${c.detail === undefined ? '' : ` — ${c.detail}`}`);
  }
  /* 机器读的：单行、带前缀，脚本按前缀切。 */
  console.log(`SMOKE_REPORT ${JSON.stringify({ ok, checks })}`);

  /* 单文件产物拿不到 stdout（NSIS 包装器不透传），故按需再落一份到文件。 */
  if (SMOKE_REPORT_FILE !== null) {
    try {
      await fs.writeFile(SMOKE_REPORT_FILE, JSON.stringify({ ok, checks }), 'utf8');
    } catch (error) {
      console.error(`冒烟报告写文件失败：${SMOKE_REPORT_FILE} —— ${String(error)}`);
    }
  }

  app.exit(ok ? 0 : 1);
}

/**
 * 截图模式 —— 开发时"眼看一次"用。
 *
 * 加载**正式页面**、点一次「新建示例图」、套一个内置预设，然后把页面截下来。
 * 这不是自动化验收（那条由冒烟负责），而是给人看的一份凭据：
 * 界面到底长什么样、示例图渲染有没有上屏。
 */
async function takeShot(outPath) {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    show: false,
    backgroundColor: '#14141a',
    title: PRODUCT_TITLE,
    webPreferences: WEB_PREFERENCES,
  });
  try {
    await win.loadURL('app://app/index.html');
    /* 点按钮 + 套预设都在页面里做完再截，这样截出来的是"用起来的样子"。 */
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#btn-sample').click();
      const select = document.querySelector('#preset');
      if (select !== null && select.options.length > 1) {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change'));
      }
      /* 顺手切到切图模式：新面板（拼图/切图/边框）与宫格线是要看的东西。 */
      const mode = document.querySelector('#collage-mode');
      if (mode !== null) {
        mode.value = 'cut';
        mode.dispatchEvent(new Event('change'));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    })()`);
    /* 再等一帧，确保 putImageData 的结果已经进入合成。 */
    await new Promise((resolve) => setTimeout(resolve, 800));
    const image = await win.capturePage();
    await fs.writeFile(outPath, image.toPNG());
    console.log(`SHOT_OK ${outPath} ${image.getSize().width}x${image.getSize().height}`);
    app.exit(0);
  } catch (error) {
    console.error(`截图失败：${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  }
}

app.on('window-all-closed', () => {
  /* 冒烟模式下退出由自检收口（打印报告 + 判定退出码），
   * 不能让"界面窗口被销毁"顺手把进程带走。 */
  if (!SMOKE) app.quit();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    /* 与 electron-builder 的 appId 保持一致：任务栏/通知的身份由此决定，
     * 打包后再改会比较别扭。 */
    app.setAppUserModelId('com.zhaopian.jiagong');
    appUserModelIdSet = true;
  }
  registerProtocol();
  registerIpc();

  if (SHOT_PATH !== null) {
    void takeShot(SHOT_PATH);
    return;
  }

  smokeWindow = createWindow(SMOKE ? 'smoke.html' : 'index.html');

  if (SMOKE) {
    /* 看门狗：渲染进程炸了 / preload 没注入时，不能让进程永远挂着。 */
    setTimeout(() => {
      if (smokeFinished) return;
      smokeFinished = true;
      console.error(` FAIL  冒烟超时（${SMOKE_TIMEOUT_MS} ms 内未收到报告）`);
      console.log(
        `SMOKE_REPORT ${JSON.stringify({
          ok: false,
          checks: [{ name: '冒烟未在限时内完成', ok: false, detail: '渲染进程未上报结果' }],
        })}`,
      );
      app.exit(1);
    }, SMOKE_TIMEOUT_MS).unref();
  }
});
