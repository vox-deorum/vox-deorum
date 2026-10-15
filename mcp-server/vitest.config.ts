import { defineConfig } from 'vitest/config'

// tests/mock/** is the default tier. It needs no bridge or game: tools run against
// in-memory stores, and a few suites start the source server over real HTTP and stdio
// transports with external managers stubbed. Set USE_MOCK=false to run tests/real/**,
// which boots the source mcp-server (tests/setup.ts) against the real bridge-service on
// a mock DLL (tests/real.setup.ts spawns tests/fixtures/start-bridge.ts). The stack
// bottoms out at the mock DLL, so the real tier needs no Civilization V game.
const useMock = process.env.USE_MOCK !== 'false'

export default defineConfig({
  test: {
    environment: 'node',
    include: [`tests/${useMock ? 'mock' : 'real'}/**/*.test.ts`],
    // The shared server/client setup and the bridge-spawning global setup are real-tier only.
    setupFiles: useMock ? [] : ['./tests/setup.ts'],
    globalSetup: useMock ? [] : ['./tests/real.setup.ts'],
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
