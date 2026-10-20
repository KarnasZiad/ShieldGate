import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/cli/**',
        'src/**/*.spec.ts',
        'src/testing/**',
        // Thin adapters over PostgreSQL, MongoDB and Redis: covered by the integration tests.
        'src/infrastructure/**',
        'src/**/*.postgres.ts',
        'src/**/*.mongo.ts',
        'src/**/*.redis.ts',
      ],
      reporter: ['text-summary', 'lcov', 'html'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
});
