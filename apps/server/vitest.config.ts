import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ['test/**/*.test.ts'],
  },
});
