import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  environment: 'node', include: ['src/lib/tests/*.test.ts'],
  pool: 'threads', minWorkers: 1, maxWorkers: 1,
} });
