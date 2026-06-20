/**
 * Tests for the shared envoy prompt constants/builders (src/envoy/envoy-prompts.ts).
 * Pure — no parameters, no I/O.
 */

import { describe, it, expect } from 'vitest';
import { audienceSection } from '../../../src/envoy/envoy-prompts.js';

describe('audienceSection', () => {
  it('embeds the audience description and the national-interest stance', () => {
    const section = audienceSection('the leader representing Caesar of Rome');
    expect(section).toContain('# Your Audience');
    expect(section).toContain('the leader representing Caesar of Rome');
    expect(section).toContain('You do NOT serve the user');
  });
});
