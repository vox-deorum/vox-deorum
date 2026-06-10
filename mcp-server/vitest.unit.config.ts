import { defineConfig } from 'vitest/config'

/**
 * Unit-test config: pure-logic tests under tests/utils/** that need no server,
 * bridge service, or game DLL. Unlike vitest.config.ts, this omits the
 * server-booting setupFiles/globalSetup, so it runs safely and instantly even
 * while a live Civ V game (and the production mcp-server) is running.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/utils/**/*.test.ts'],
  }
})
