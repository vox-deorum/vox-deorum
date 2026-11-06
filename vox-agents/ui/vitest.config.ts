import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// The UI test suite runs in jsdom with mocked API boundaries. This remains separate
// from vite.config.ts, which loads the development-only vite-plugin-vue-devtools.

export default defineConfig({
  // Cast works around a rolldown-vite (ui) vs rollup (root) plugin-type mismatch;
  // the plugin is runtime-compatible. vite.config.ts sidesteps this via vite's own
  // defineConfig, but the test config needs vitest/config's.
  plugins: [vue() as any],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vox': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/mock/**/*.{test,spec}.ts'],
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
