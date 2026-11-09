import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  /* 与 tsconfig 的解析规则对齐：测试直接吃内核源码，不依赖 dist 是否已构建。
   * （这与运行时的"跨包只解析构建产物"不冲突 —— 那是 tsc 与浏览器的规则，
   *   这里是 vitest 的加载规则，两者各自内部一致即可。） */
  resolve: {
    alias: {
      '@photo/core': at('../../packages/core/src/index.ts'),
      /* 长键要排在短键前面：别名是**前缀替换**，`@photo/io` 若在前，
       * `@photo/io/testing` 会被它先吃掉，剩下 `/testing` 拼到源码路径上。 */
      '@photo/io/testing': at('../../packages/io/src/jpeg-synth.ts'),
      '@photo/io': at('../../packages/io/src/index.ts'),
      /* Worker 侧的模块用**绝对 URL**导入内核：import map 只作用于文档、
       * 不作用于 Worker，裸说明符在 Worker 里必然解析失败（详见 src/app-url.d.ts）。
       * 同一条 URL 在这里也要能解析到内核源码 —— 否则"Worker 引擎的渲染结果
       * 与内联端口逐字节一致"这条断言就只能靠 Electron 冒烟，单测碰不到。 */
      'app://core/index.js': at('../../packages/core/src/index.ts'),
      /* 同一条规则的第二处：`image-io.ts` 也改用绝对 URL 取 io（它在 Worker 的
       * 模块图里），所以测试侧必须能解析同一个说明符。 */
      'app://io/index.js': at('../../packages/io/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    /* 外壳的纯逻辑层刻意不依赖 DOM —— 于是全链验收能在 node 里跑起来，
     * 不需要无头浏览器。DOM 只出现在 renderer/app.ts 与 canvas-adapter.ts，
     * 它们不参与单测（由 Electron 冒烟覆盖）。 */
    environment: 'node',
    globals: false,
  },
});
