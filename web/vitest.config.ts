import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests import the parity fixture shared with Python (../pipeline/tests/fixtures).
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'node', include: ['src/lib/tests/*.test.ts'],
    pool: 'threads', minWorkers: 1, maxWorkers: 1,
  },
});
