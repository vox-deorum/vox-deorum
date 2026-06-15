import { defineConfig } from 'vitest/config'

/**
 * Unit-test config: tests under tests/utils/** and tests/diplomacy/** that need no
 * server, bridge service, or game DLL. The diplomacy tests run the real transcript
 * tools against an in-memory SQLite KnowledgeStore. Unlike vitest.config.ts, this
 * omits the server-booting setupFiles/globalSetup, so it runs safely and instantly
 * even while a live Civ V game (and the production mcp-server) is running.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/utils/**/*.test.ts', 'tests/diplomacy/**/*.test.ts'],
  }
})
