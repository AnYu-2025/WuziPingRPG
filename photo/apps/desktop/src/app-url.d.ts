/**
 * `app://` 模块说明符的**类型声明**。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────
 * 页面上用 `@photo/core` 这种裸模块名，靠 `index.html` 里的 import map 解析。
 * 但 **import map 只作用于文档，不作用于 Worker** —— 在 Worker 的模块图里，
 * `@photo/core` 是一个无法解析的裸说明符，脚本会在加载阶段直接死掉。
 *
 * Worker 里必须写**绝对 URL** `app://core/index.js`（与 import map 指向同一个
 * 构建产物），这样模块解析器无需任何映射即可取到它。
 *
 * 于是出现一个纯类型问题：`app://core/index.js` 不是一个真实存在的包名，
 * `tsc` 找不到它。这里用一条**环境模块声明**把它指回 `@photo/core` 的类型 ——
 * 于是 Worker 里的导入**照样有完整类型检查**，而不是退化成 `any`。
 *
 * 运行期这条声明不产生任何代码（`.d.ts` 无 emit），所以它同时也不会让
 * vitest 去解析 `app://` 这个 Node 不认识的方案。
 */
declare module 'app://core/index.js' {
  export * from '@photo/core';
}

declare module 'app://io/index.js' {
  export * from '@photo/io';
}
