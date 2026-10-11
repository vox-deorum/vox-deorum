/**
 * Mock-tier tests for the shared `continuationNudge` mechanism (VoxAgent + overrides).
 *
 * The base `VoxAgent.continuationNudge` builds the step's closing reminder. From the second step on
 * it nudges toward the agent's `completionTools`, intersected with the tools VoxContext resolves as
 * executable after prepareStep, so an agent is nudged only toward the ones it may call on the current
 * step. When the step is narrowed, it also names the allowed tools, and when its tool choice is
 * required, it opens with the requirement.
 * Oracle inherits this behavior so replay continuations receive the same finalize reminder.
 *
 * These cover the wording produced for a given tool set; that the resolved set is what reaches the
 * hook, and that the reminder is appended once, are covered in context/vox-context-execute-runs.
 *
 * Expectations check which tools a reminder names and in what order, never its wording, so the
 * prose in utils/prompts/closing-reminder.ts can be edited freely.
 *
 * Loaded through the agent-registry (the canonical entry) to avoid the circular-import hazard of
 * importing agent modules in isolation.
 */

import { describe, expect, it } from 'vitest';
import '../../../src/infra/agent-registry.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { formatToolChoiceList } from '../../../src/utils/tools/tool-names.js';

/** A later, unnarrowed step with an auto tool choice that may run `executable`. */
function later(executable: string[]) {
  return { executable, narrowed: false, step: 1, required: false };
}

describe('continuationNudge', () => {
  it('derives the default nudge from completionTools (negotiator, inherited)', () => {
    const negotiator = agentRegistry.get('negotiator') as any;
    expect(negotiator.continuationNudge({}, later(['accept-deal', 'propose-deal', 'reject-deal']))).toContain(formatToolChoiceList(['accept-deal', 'propose-deal', 'reject-deal']));
  });

  it('derives the strategist nudge from the tools active for its current mode', () => {
    const strategist = agentRegistry.get('simple-strategist') as any;
    expect(strategist.continuationNudge(
      { mode: 'Strategy' },
      later(['set-strategy', 'set-persona', 'keep-status-quo']),
    )).toContain(formatToolChoiceList(['set-strategy', 'keep-status-quo']));
    expect(strategist.continuationNudge(
      { mode: 'Flavor' },
      later(['set-flavors', 'set-persona', 'keep-status-quo']),
    )).toContain(formatToolChoiceList(['set-flavors', 'keep-status-quo']));
    expect(strategist.continuationNudge(
      { mode: 'Strategy' },
      later(['set-persona', 'keep-status-quo']),
    )).toContain(formatToolChoiceList(['keep-status-quo']));
  });

  it('derives the Oracle nudge from the completion tools active in the replay', () => {
    const oracle = agentRegistry.get('oracle') as any;
    expect(oracle.continuationNudge({}, later(['set-strategy', 'get-briefing', 'keep-status-quo']))).toContain(formatToolChoiceList(['set-strategy', 'keep-status-quo']));
    expect(oracle.continuationNudge({}, later(['get-briefing']))).toBeUndefined();
  });

  it('nudges a live envoy toward its own completion tools in normal mode (diplomat)', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    expect(diplomat.continuationNudge(
      {},
      later(['get-briefing', 'send-message', 'call-negotiator', 'close-conversation']),
    )).toContain(formatToolChoiceList(['send-message', 'call-negotiator', 'close-conversation']));
  });

  it('nudges a live envoy only toward the completion tools resolved for this step', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    const nudge = diplomat.continuationNudge({}, later(['send-message']));
    expect(nudge).toContain(formatToolChoiceList(['send-message']));
    expect(nudge).not.toContain('call-negotiator');
    expect(nudge).not.toContain('close-conversation');

    expect(diplomat.continuationNudge(
      {},
      later(['call-negotiator', 'send-message']),
    )).toContain(formatToolChoiceList(['send-message', 'call-negotiator']));
  });

  it('omits the nudge when the resolved step exposes no completion tool', () => {
    const diplomat = agentRegistry.get('diplomat') as any;
    expect(diplomat.continuationNudge({}, later(['get-briefing']))).toBeUndefined();
  });

  describe('closing reminder', () => {
    const diplomat = () => agentRegistry.get('diplomat') as any;
    const gated = ['call-negotiator', 'send-message'];
    const policy = formatToolChoiceList(gated)!;
    const finishing = formatToolChoiceList(['send-message', 'call-negotiator'])!;
    /** The diplomat's reminder for a step with the given shape. */
    const remind = (step: { executable?: string[]; narrowed?: boolean; step?: number; required?: boolean; notes?: boolean }) =>
      diplomat().continuationNudge({}, { executable: gated, narrowed: false, step: 0, required: false, ...step });

    it('adds nothing on an unnarrowed auto first step', () => {
      expect(remind({})).toBeUndefined();
    });

    it('names no tool when only the requirement applies', () => {
      const reminder = remind({ required: true });
      expect(reminder).toBeDefined();
      for (const name of gated) expect(reminder).not.toContain(name);
    });

    it('names the allowed tools on a narrowed step', () => {
      expect(remind({ narrowed: true })).toContain(policy);
    });

    it('orders the requirement, the policy, and the finalize nudge in one reminder', () => {
      const reminder: string = remind({ narrowed: true, step: 1, required: true });
      const requirement: string = remind({ required: true });
      expect(reminder.startsWith(requirement)).toBe(true);
      const policyAt = reminder.indexOf(policy);
      expect(policyAt).toBeGreaterThan(requirement.length - 1);
      expect(reminder.indexOf(finishing)).toBeGreaterThan(policyAt);
    });

    it('names no tool when the narrowed step allows none', () => {
      const reminder = remind({ executable: [], narrowed: true });
      expect(reminder).toBeDefined();
      expect(reminder).not.toBe(remind({ narrowed: true }));
      for (const name of gated) expect(reminder).not.toContain(name);
    });

    it('asks for notes with the finishing call only on a finalize step', () => {
      const finalize = remind({ step: 1 });
      const withNotes: string = remind({ step: 1, notes: true });
      expect(withNotes).not.toBe(finalize);
      expect(withNotes.startsWith(finalize)).toBe(true);
      expect(remind({ notes: true })).toBeUndefined();
      expect(remind({ step: 1, executable: [], narrowed: true, notes: true })).toBe(remind({ step: 1, executable: [], narrowed: true }));
    });
  });
});
