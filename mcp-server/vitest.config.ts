import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/global.setup.ts'],
    // Bind the test server to a dedicated port so it never collides with a live
    // production mcp-server on the default 4000 (e.g. while Civ V is running).
    // Read at config load via process.env.MCP_PORT; override with MCP_TEST_PORT.
    env: {
      MCP_PORT: process.env.MCP_TEST_PORT || '4100',
    },
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