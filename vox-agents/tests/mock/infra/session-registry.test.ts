/** Tests the public active-game-session registry contract. */

import { describe, expect, it } from 'vitest';
import { sessionRegistry } from '../../../src/infra/session-registry.js';

describe('sessionRegistry', () => {
  it('should keep the first strategist active when registration of a second is rejected', () => {
    expect(sessionRegistry.getActive()).toBeUndefined();
    const first = { id: 'registry-test-primary', config: { type: 'strategist' } } as any;
    const second = { id: 'registry-test-secondary', config: { type: 'strategist' } } as any;

    sessionRegistry.register(first);
    try {
      expect(() => sessionRegistry.register(second)).toThrow();
      expect(sessionRegistry.getActive()).toBe(first);
    } finally {
      sessionRegistry.unregister(first.id);
    }
  });
});
