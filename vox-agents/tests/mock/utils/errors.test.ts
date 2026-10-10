/**
 * Mock-tier unit tests for `src/utils/errors.ts`: turning caught values into error text.
 */

import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../../src/utils/errors.js';

describe('errorMessage', () => {
  it('returns the message of an Error, ignoring the fallback', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(new TypeError('bad type'), 'fallback')).toBe('bad type');
  });

  it('stringifies non-Error values when no fallback is given', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage({ code: 1 })).toBe(String({ code: 1 }));
  });

  it('uses the fallback for non-Error values when one is given', () => {
    expect(errorMessage('plain', 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
