import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const at = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  /* 与 tsconfig 的 paths 保持一致：测试直接吃源码，不依赖 dist 是否已构建。 */
  resolve: {
    alias: {
      '@photo/core': at('../core/src/index.ts'),
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
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
