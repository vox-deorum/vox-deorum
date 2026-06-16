import { defineConfig } from 'vitest/config'

// Unified convention: tests/mock/** is the default (no server, no bridge, no game —
// pure in-process unit tests). Set USE_MOCK=false to run tests/real/**, which boots
// the real mcp-server (tests/setup.ts) against a real bridge in mock-DLL mode
// (tests/real.setup.ts spawns bridge-service `start:mock`). The stack bottoms out at
// the mock DLL, so the real tier needs no Civilization V game and is CI-able.
const useMock = process.env.USE_MOCK !== 'false'

export default defineConfig({
  test: {
    environment: 'node',
    include: [`tests/${useMock ? 'mock' : 'real'}/**/*.test.ts`],
    // The server-/client-booting setup and the bridge-spawning global setup are
    // real-tier only; the mock tier runs instantly with neither.
    setupFiles: useMock ? [] : ['./tests/setup.ts'],
    globalSetup: useMock ? [] : ['./tests/real.setup.ts'],
    // Bind the real-tier test server to a dedicated port so it never collides with a
    // live production mcp-server on the default 4000.
    env: {
      MCP_PORT: process.env.MCP_TEST_PORT || '4100',
    },
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'html']
    },
    testTimeout: 15000, // Extended timeout for IPC operations
    hookTimeout: 30000, // Bridge spawn (real tier) can take a while
    retry: process.env.CI ? 1 : 0,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true // Single IPC connection to the DLL; tests run sequentially
      }
    }
  }
})
