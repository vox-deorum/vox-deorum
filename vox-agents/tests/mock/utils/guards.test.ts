/**
 * Mock-tier unit tests for `src/utils/guards.ts`: the shared record guards used to read untyped JSON.
 */

import { describe, expect, it } from 'vitest';
import { asRecord, isRecord } from '../../../src/utils/guards.js';

describe('guards', () => {
  it('isRecord accepts plain objects and rejects null, arrays and primitives', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('text')).toBe(false);
    expect(isRecord(3)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it('asRecord returns the same object or undefined', () => {
    const value = { a: 1 };
    expect(asRecord(value)).toBe(value);
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord([value])).toBeUndefined();
    expect(asRecord('text')).toBeUndefined();
  });
});
