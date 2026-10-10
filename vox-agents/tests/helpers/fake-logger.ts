/**
 * A spyable stand-in for the Winston logger, for tests that inject a logger instead of mocking the module.
 */

import { vi, type Mock } from 'vitest';

/** Spy handles of a fake Winston logger. */
export interface FakeLogger {
  error: Mock;
  warn: Mock;
  info: Mock;
  debug: Mock;
  child: Mock;
}

/** A spyable Winston-shaped logger: error/warn/info/debug are vi.fn(), child() returns the same fake. */
export function createFakeLogger(): FakeLogger {
  const logger: FakeLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  // `.child()` returns the same logger so child-logger call sites are recorded alongside it.
  logger.child.mockReturnValue(logger);
  return logger;
}
