import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  /* 与 tsconfig 的 paths 保持一致：测试直接吃源码，不依赖 dist 是否已构建。 */
  resolve: {
    alias: {
      '@photo/core': at('../../packages/core/src/index.ts'),
      /* 测试夹具子路径必须排在 '@photo/io' 前面：别名是**前缀**替换，
       * 顺序反了就会被折成 src/index.ts/testing。 */
      '@photo/io/testing': at('../../packages/io/src/jpeg-synth.ts'),
      '@photo/io': at('../../packages/io/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/version.ts'],
    },
  },
});
