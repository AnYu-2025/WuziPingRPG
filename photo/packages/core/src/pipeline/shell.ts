/**
 * 外壳契约 —— 内核无法自己保证、必须由宿主环境提供的配置项。
 *
 * legacy 的 P1-6 就是一个纯外壳问题：Electron 的 BrowserWindow 未设
 * `backgroundThrottling: false`，窗口一失焦，requestAnimationFrame 就被
 * 降频到 1Hz，于是视频导出录出来的是幻灯片。代码逻辑本身完全正确，
 * 错在宿主配置。
 *
 * 这类"内核正确、外壳配置错"的缺陷，靠代码审查很难防。因此把要求
 * 写成**机器可读的契约数据**，由外壳启动时自检（P6 接壳时实现），
 * 让配置项也成为被测试守护的对象，而不是散落在文档里的叮嘱。
 */

export interface ShellRequirement {
  /** 配置路径（点号分隔，与具体外壳映射）。 */
  readonly key: string;
  /** 期望值。 */
  readonly value: string | number | boolean;
  /** 为什么需要它 —— 关联到的缺陷编号，便于回溯。 */
  readonly reason: string;
  /** 是否可选要求（不满足只降级，不致命）。 */
  readonly optional?: boolean;
}

/** Electron 外壳必须满足的配置。 */
export const SHELL_REQUIREMENTS: readonly ShellRequirement[] = [
  {
    key: 'webPreferences.backgroundThrottling',
    value: false,
    reason:
      'P1-6：窗口失焦时 rAF 降频会让视频导出的逐帧采样变成幻灯片。' +
      '必须显式关闭节流。',
  },
  {
    key: 'webPreferences.contextIsolation',
    value: true,
    reason: '安全基线：渲染进程与 preload 隔离，防止页面脚本触达 Node。',
  },
  {
    key: 'webPreferences.nodeIntegration',
    value: false,
    reason: '安全基线：渲染进程不直接持有 Node 能力，一切经 preload 白名单。',
  },
  {
    key: 'webPreferences.sandbox',
    value: true,
    reason: '安全基线：开启沙箱，进一步限制渲染进程。',
  },
  {
    key: 'singleInstanceLock',
    value: true,
    reason: '单实例锁：多开会让两套进程争抢同一份工程文件。',
  },
  {
    key: 'appUserModelId',
    value: true,
    reason: 'Windows 任务栏/通知需要正确的 AppUserModelID，否则图标与通知错乱。',
    optional: true,
  },
];

/** 渲染侧必须提供的能力（供外壳自检与文档生成）。 */
export const RENDER_CAPABILITIES: readonly string[] = [
  'pixels 后端：Canvas2D / WebGL2 / WebGPU 之一（用于预览合成与最终落盘）',
  'TextRenderer 实现：把 core 排好版的文本栅格化到像素（水印 / 贴纸）',
  'PixelWorkerPort 实现：把 RenderJob 交给独立 Worker 执行（批量与后台渲染）',
  '图片解码 / 编码：把文件字节 ↔ PixelBuffer',
];

/** 生成人类可读的契约清单（可粘贴进外壳启动自检的报错信息）。 */
export function describeShellRequirements(): string {
  return SHELL_REQUIREMENTS.map(
    (r) => `- ${r.key} = ${JSON.stringify(r.value)}${r.optional ? '（可选）' : ''}：${r.reason}`,
  ).join('\n');
}
