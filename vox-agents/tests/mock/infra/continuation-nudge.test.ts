/**
 * Mock-tier tests for the shared `continuationNudge` mechanism (VoxAgent + overrides).
 *
 * The base `VoxAgent.continuationNudge` derives a default finalize-reminder from an agent's
 * `requiredTools`, so any required-tools agent (e.g. the negotiator) is nudged for free. The
 * strategist overrides it for mode-aware wording (byte-identical to its historical string); Oracle
 * overrides it to `undefined` so a replayed turn is never perturbed by an unrecorded message; and a
 * plain agent with no `requiredTools` (e.g. the diplomat) gets no nudge, exactly as before.
 *
 * Loaded through the agent-registry (the canonical entry) to avoid the circular-import hazard of
 * importing agent modules in isolation.
 */

import { describe, expect, it } from 'vitest';
import '../../../src/infra/agent-registry.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';

describe('continuationNudge', () => {
  it('derives the default nudge from requiredTools (negotiator, inherited)', () => {
    const negotiator = agentRegistry.get('negotiator') as any;
    expect(negotiator.continuationNudge({})).toBe(
      'Make sure to call `accept-deal`, `propose-deal`, or `reject-deal` following the EXACT provided format to finalize your decisions.'
    );
  });

  it('keeps the strategist wording mode-aware after the shared-formatter refactor', () => {
    const strategist = agentRegistry.get('simple-strategist') as any;
    expect(strategist.continuationNudge({ mode: 'Strategy' })).toBe(
      'Make sure to call `set-strategy` or `keep-status-quo` following the EXACT provided format to finalize your decisions.'
    );
    expect(strategist.continuationNudge({ mode: 'Flavor' })).toBe(
      'Make sure to call `set-flavors` or `keep-status-quo` following the EXACT provided format to finalize your decisions.'
    );
  });

  it('disables the nudge for Oracle so a replayed prompt is never perturbed', () => {
    const oracle = agentRegistry.get('oracle') as any;
    expect(oracle.continuationNudge({})).toBeUndefined();
  });

  it('yields no nudge for a plain agent without requiredTools (diplomat)', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    expect(diplomat.continuationNudge({})).toBeUndefined();
  });
});
