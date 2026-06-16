import { defineConfig } from 'vitest/config'

// Unified convention: tests/mock/** is the default (in-process mock DLL); set
// USE_MOCK=false to run tests/real/** against a live Civ V DLL. Bridge-service
// is the game boundary, so its "real" tier is the live-game tier (not CI).
const useMock = process.env.USE_MOCK !== 'false'

export default defineConfig({
  test: {
    environment: 'node',
    include: [`tests/${useMock ? 'mock' : 'real'}/**/*.test.ts`],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'html']
    },
    testTimeout: 15000, // Extended timeout for IPC operations
    hookTimeout: 15000, // Extended timeout for setup/teardown
    retry: process.env.CI ? 1 : 0, // Retry once in CI for flaky IPC tests
    // Run tests sequentially when using mock DLLs to avoid parallel execution issues
    // Mock DLL server uses a single IPC connection that can't handle concurrent tests
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true // While the server should handle parallel requests, the test has to be run sequentially since the DLL only hosts one connection at a time
      }
    }
  }
})
