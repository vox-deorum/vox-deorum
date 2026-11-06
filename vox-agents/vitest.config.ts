import { defineConfig } from 'vitest/config'
import { TEST_TELEMETRY_DIR } from './tests/helpers/telemetry-test-dir'

// Unified convention. The tier selects which tests/<tier>/** directory runs:
//   mock (default) — MCP client replaced in-process via vi.mock of the mcp-client
//                    seam; no server, bridge, or game.
//   real           — reserved for a future out-of-process tier (real MCP client ->
//                    real mcp-server -> mock-DLL bridge). It is not wired yet, so
//                    `test:real` is a clean no-op (--passWithNoTests). In-process
//                    web server coverage lives in tests/mock/web/server.test.ts.
//   live/game      — real Civilization V via VoxCivilization (run by test:game).
//   live/obs       — real OBS Studio (run by test:obs).
//   live/claude-code — the real Claude Code CLI (run by test:claude-code).
// The live tiers are gated inside their own spec files on TEST_TIER, so they only run
// under their dedicated scripts and can never touch a live game, OBS, or CLI by accident.
// USE_MOCK toggles mock<->real for parity with the other packages; TEST_TIER lets the
// live scripts target their directory explicitly.
const tier = process.env.TEST_TIER || (process.env.USE_MOCK === 'false' ? 'real' : 'mock')

export default defineConfig({
  test: {
    environment: 'node',
    include: [`tests/${tier}/**/*.test.ts`],
    setupFiles: ['./tests/setup.ts'],
    // Redirect all test telemetry to an isolated temp dir so test-created
    // VoxContext databases never pollute the real `telemetry/` directory (the
    // "Past Games" UI). Applied before any source module loads, so config.ts
    // picks it up as `config.telemetryDir`. The dir is wiped by global-setup.ts.
    env: { TELEMETRY_DIR: TEST_TELEMETRY_DIR },
    globalSetup: ['./tests/global-setup.ts'],
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
    // One worker runs test files sequentially; each file still gets fresh modules.
    pool: 'forks',
    maxWorkers: 1
  }
})
