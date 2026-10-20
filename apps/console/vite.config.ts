/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const API = 'http://localhost:4000';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // Same origin as behind Nginx in production: the __Host- session cookie stays first-party.
    proxy: { '/v1': API, '/health': API },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/main.ts', 'src/**/*.spec.ts', 'src/lib/types.ts'],
      reporter: ['text-summary', 'lcov', 'html'],
      thresholds: { lines: 80, statements: 80, functions: 75, branches: 75 },
    },
  },
});
