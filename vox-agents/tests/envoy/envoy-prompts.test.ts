/**
 * Tests for the shared envoy prompt constants/builders (src/envoy/envoy-prompts.ts).
 * Pure — no parameters, no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  worldContext,
  noDecisionPower,
  communicationStyle,
  audienceSection,
  greetingSpecialMessages,
} from '../../src/envoy/envoy-prompts.js';

describe('envoy prompt constants', () => {
  it('worldContext frames the fictional setting', () => {
    expect(worldContext).toMatch(/Civilization V game with Vox Populi/);
  });

  it('noDecisionPower disclaims binding authority', () => {
    expect(noDecisionPower.toLowerCase()).toContain('no decision-making power');
  });

  it('communicationStyle defines a Communication Style section', () => {
    expect(communicationStyle).toContain('# Communication Style');
  });
});

describe('audienceSection', () => {
  it('embeds the audience description and the national-interest stance', () => {
    const section = audienceSection('the leader representing Caesar of Rome');
    expect(section).toContain('# Your Audience');
    expect(section).toContain('the leader representing Caesar of Rome');
    expect(section).toContain('You do NOT serve the user');
  });
});

describe('greetingSpecialMessages', () => {
  it('exposes the {{{Greeting}}} trigger with a prompt', () => {
    expect(greetingSpecialMessages).toHaveProperty('{{{Greeting}}}');
    expect(greetingSpecialMessages['{{{Greeting}}}'].prompt).toBeTruthy();
  });
});
