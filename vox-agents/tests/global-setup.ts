/**
 * @module tests/global-setup
 *
 * Vitest global setup/teardown for telemetry isolation. Tests create real
 * VoxContext instances that write SQLite databases; `vitest.config.ts` redirects
 * those to {@link TEST_TELEMETRY_DIR} (via `test.env.TELEMETRY_DIR`) so they never
 * pollute the real `telemetry/` directory shown in the "Past Games" UI.
 *
 * `setup` runs in the main process before any worker fork starts; `teardown` runs
 * after all forks have exited. Running cleanup here (rather than in an in-worker
 * `afterAll`) means SQLite's WAL file handles are already released by the time we
 * delete, so `fs.rmSync` succeeds on Windows instead of failing with EBUSY/EPERM.
 */
import { cleanTestTelemetryDir } from './helpers/telemetry-test-dir.js';

/** Clear any telemetry left behind by a previously-crashed run before tests start. */
export function setup(): void {
  cleanTestTelemetryDir();
}

/** Remove all telemetry produced during this run once every worker fork has exited. */
export function teardown(): void {
  cleanTestTelemetryDir();
}
