import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Unified convention, jsdom flavour. tests/mock/** (default) mounts components and
// exercises pure logic with the apiClient stubbed — no backend. tests/real/**
// (USE_MOCK=false) drives the real in-process vox-agents Express backend with the
// MCP client mocked (mock bottom), via fetch only (jsdom has no EventSource, so SSE
// routes are out of scope for the real tier). Separate from vite.config.ts, which
// loads dev-only vite-plugin-vue-devtools.
const tier = process.env.TEST_TIER || (process.env.USE_MOCK === 'false' ? 'real' : 'mock')

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
    include: [`tests/${tier}/**/*.{test,spec}.ts`],
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: process.env.CI ? 1 : 0,
  },
})
