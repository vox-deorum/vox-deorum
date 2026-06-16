import { defineConfig } from 'vitest/config'

// Unified convention. The tier selects which tests/<tier>/** directory runs:
//   mock (default) — MCP client replaced in-process via vi.mock of the mcp-client
//                    seam; no server, bridge, or game.
//   real           — reserved for an out-of-process real tier (real MCP client ->
//                    real mcp-server -> mock-DLL bridge). NOT yet wired: there is no
//                    tests/real/** dir or real.setup here, so `test:real` is a clean
//                    no-op (--passWithNoTests). The CI-able real coverage for the
//                    vox-agents backend currently lives in the ui package
//                    (ui/tests/real: in-process backend + mock MCP).
//   live/game      — real Civilization V via VoxCivilization (run by test:game).
//   live/obs       — real OBS Studio (run by test:obs).
// The live tiers are gated inside their own spec files on TEST_TIER, so they only run
// under their dedicated scripts and can never touch a live game/OBS by accident.
// USE_MOCK toggles mock<->real for parity with the other packages; TEST_TIER lets the
// live scripts target their directory explicitly.
const tier = process.env.TEST_TIER || (process.env.USE_MOCK === 'false' ? 'real' : 'mock')

export default defineConfig({
  test: {
    environment: 'node',
    include: [`tests/${tier}/**/*.test.ts`],
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