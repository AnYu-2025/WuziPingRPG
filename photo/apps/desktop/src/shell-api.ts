/**
 * preload → 渲染进程的桥（白名单）。
 *
 * 渲染进程开着 `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`，
 * 页面脚本**拿不到**任何 Node 能力。需要主进程做的事只有：弹对话框读文件、
 * 落盘导出的图、落盘工程文件与自定义预设、列预设库、把冒烟结果送出去。
 *
 * 白名单刻意只放**具体动作**，不放"通用读写"：一条 `readFile(path)` 就等于把
 * 整个文件系统交给页面脚本（页面里跑的是任何能注入的代码）。每多一个方法，
 * 就多一个"页面能触达主进程"的入口 —— 所以新增时必须说得出它对应哪件产品能力。
 *
 * 本文件同时是渲染侧的**类型来源**：`window.photoShell` 的声明在这里，
 * 于是 preload 的实现与页面的使用共享同一份契约，改一处两边都会报错。
 */

export interface OpenImageResult {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** 主进程读的实际路径；作为工程文件里的来源记录（渲染不读）。 */
  readonly path?: string;
}

/** 打开工程文件：文件名 + 文本内容（像素仍要用户另行选）。 */
export interface OpenTextResult {
  readonly name: string;
  readonly path: string;
  readonly text: string;
}

/** 预设库里的一项：文件名 + 内容文本，交由内核 `parseSharedPreset` 解释。 */
export interface PresetEntry {
  readonly file: string;
  readonly text: string;
}

/** 单条冒烟检查。 */
export interface SmokeCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SmokeReport {
  readonly ok: boolean;
  readonly checks: readonly SmokeCheck[];
  /** 内核要求外壳满足的配置 —— 由主进程拿自己的实际配置逐条核对。 */
  readonly requirements: readonly {
    readonly key: string;
    readonly value: string | number | boolean;
    readonly reason: string;
    readonly optional?: boolean;
  }[];
}

export interface ShellBridge {
  readonly platform: string;
  /** 打开文件对话框并读入字节；用户取消返回 null。 */
  openImage(): Promise<OpenImageResult | null>;
  /** 打开文件对话框并读入**多张**字节（多选）；用户取消返回空数组。 */
  openImages(): Promise<readonly OpenImageResult[]>;
  /** 保存对话框 + 落盘；用户取消返回 null，成功返回写入路径。 */
  saveImage(defaultName: string, bytes: Uint8Array): Promise<string | null>;
  /** 保存工程文件（`photo.doc/v1` 文本）；取消返回 null。 */
  saveProject(defaultName: string, text: string): Promise<string | null>;
  /** 弹打开对话框读一份工程文件文本；取消返回 null。 */
  openProject(): Promise<OpenTextResult | null>;
  /** 把自定义预设写进预设库（无对话框）；返回落盘文件名。 */
  savePreset(fileName: string, text: string): Promise<string | null>;
  /** 列出预设库内容（读目录下的 `*.photo.preset.json`）。 */
  listPresets(): Promise<readonly PresetEntry[]>;
  /** 冒烟模式专用：把结果交给主进程打印并决定退出码。 */
  reportSmoke(report: SmokeReport): void;
}

declare global {
  interface Window {
    readonly photoShell?: ShellBridge;
  }
}

/** 取桥；没注入时给出能指导排查的错误，而不是一句 "undefined is not a function"。 */
export function shellBridge(): ShellBridge {
  const bridge = window.photoShell;
  if (bridge === undefined) {
    throw new Error('外壳桥未注入：preload 未加载，或页面在 Electron 之外被打开。');
  }
  return bridge;
}
