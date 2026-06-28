/**
 * @module tests/helpers/telemetry-test-dir
 *
 * Shared location for telemetry written during test runs, kept out of the real
 * `telemetry/` directory (which the "Past Games" UI scans). The exporter is
 * redirected here via the `TELEMETRY_DIR` env var (see `vitest.config.ts`'s
 * `test.env`), and the whole directory is wiped before and after each run by the
 * global setup (see `tests/global-setup.ts`).
 *
 * This module must have NO app imports — it is imported by `vitest.config.ts`,
 * which runs before the application's `config`/`instrumentation` singletons load.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Absolute, fixed-name temp directory for all test-created telemetry databases.
 * Absolute so it never depends on the current working directory; fixed name so
 * start-of-run cleanup can reliably find leftovers from a crashed run.
 */
export const TEST_TELEMETRY_DIR = path.join(os.tmpdir(), 'vox-agents-telemetry-test');

/**
 * Recursively remove the test telemetry directory. Safe to call when it does not
 * exist (`force`), and retries to ride out transient Windows file locks if a
 * SQLite WAL handle is slow to release. Never throws — cleanup failures are
 * logged, not fatal to the run.
 */
export function cleanTestTelemetryDir(): void {
  try {
    fs.rmSync(TEST_TELEMETRY_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to clean test telemetry directory ${TEST_TELEMETRY_DIR}:`, error);
  }
}
