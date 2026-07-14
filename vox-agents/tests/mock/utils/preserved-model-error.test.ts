/**
 * Tests for the model error side channel shared by middleware and retry handling.
 */

import { describe, expect, it } from 'vitest';
import {
  preserveModelError,
  takePreservedModelError,
} from '../../../src/utils/models/preserved-model-error.js';

describe('preserved model errors', () => {
  it('preserves arbitrary thrown values and deletes them when taken', () => {
    const params: { providerOptions?: Record<string, unknown> } = {};
    const thrownValue = { reason: 'context limit' };

    preserveModelError(params, thrownValue);

    expect(takePreservedModelError(params)).toEqual({ found: true, error: thrownValue });
    expect(params.providerOptions).not.toHaveProperty('error');
    expect(takePreservedModelError(params)).toEqual({ found: false });
  });

  it('distinguishes falsy thrown values from a missing preserved error', () => {
    const params: { providerOptions?: Record<string, unknown> } = {};

    preserveModelError(params, undefined);

    expect(takePreservedModelError(params)).toEqual({ found: true, error: undefined });
    expect(takePreservedModelError(params)).toEqual({ found: false });
  });
});
