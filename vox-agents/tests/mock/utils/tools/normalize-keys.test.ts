/**
 * Tests for the schema-driven, recursive tool-input key-casing normalizer.
 */
import { describe, it, expect } from 'vitest';
import { normalizeKeysToSchema, type JsonSchemaNode } from '../../../../src/utils/tools/normalize-keys.js';

// A propose-deal-shaped schema: flat fields plus arrays of nested objects (the reported failure).
const dealSchema: JsonSchemaNode = {
  type: 'object',
  properties: {
    Rationale: { type: 'string' },
    Message: { type: 'string' },
    Give: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          Term: { type: 'string' },
          Name: { type: 'string' },
          Amount: { type: 'integer' },
        },
      },
    },
  },
};

const messageSchema: JsonSchemaNode = { type: 'object', properties: { Message: { type: 'string' } } };

describe('normalizeKeysToSchema', () => {
  it('rewrites a top-level case-mismatched key to the schema casing', () => {
    expect(normalizeKeysToSchema({ message: 'hi' }, messageSchema)).toEqual({ Message: 'hi' });
  });

  it('rewrites nested keys inside array items (the propose-deal failure)', () => {
    const input = {
      Rationale: 'r',
      Message: 'm',
      Give: [{ term: 'Declaration of Friendship' }, { term: 'Gold Per Turn', amount: 3 }],
    };
    expect(normalizeKeysToSchema(input, dealSchema)).toEqual({
      Rationale: 'r',
      Message: 'm',
      Give: [{ Term: 'Declaration of Friendship' }, { Term: 'Gold Per Turn', Amount: 3 }],
    });
  });

  it('leaves keys without a case-insensitive schema match untouched', () => {
    expect(normalizeKeysToSchema({ Message: 'hi', extra: 1 }, messageSchema)).toEqual({ Message: 'hi', extra: 1 });
  });

  it('does not clobber an already-correct key when a variant is also present', () => {
    const out = normalizeKeysToSchema({ Message: 'keep', message: 'drop' }, messageSchema) as any;
    expect(out.Message).toBe('keep');
    expect(out.message).toBe('drop');
  });

  it('does not silently drop a value when two variants fold to the same schema key', () => {
    const out = normalizeKeysToSchema({ message: 'first', MESSAGE: 'second' }, messageSchema) as any;
    expect(out.Message).toBe('first');
    expect(out.MESSAGE).toBe('second');
  });

  it('returns the identical reference when nothing changes (no-op preserves identity)', () => {
    const already = { Rationale: 'r', Message: 'm', Give: [{ Term: 'Gold', Amount: 1 }] };
    expect(normalizeKeysToSchema(already, dealSchema)).toBe(already);
  });

  it('resolves $ref item schemas', () => {
    const refSchema: JsonSchemaNode = {
      type: 'object',
      properties: { Give: { type: 'array', items: { $ref: '#/$defs/Term' } } },
      $defs: { Term: { type: 'object', properties: { Term: { type: 'string' } } } },
    };
    expect(normalizeKeysToSchema({ Give: [{ term: 'Gold' }] }, refSchema)).toEqual({ Give: [{ Term: 'Gold' }] });
  });

  it('is a no-op without a schema (value passes through unchanged)', () => {
    expect(normalizeKeysToSchema({ message: 'hi' }, undefined)).toEqual({ message: 'hi' });
  });

  it('leaves non-object values and empty-property schemas untouched', () => {
    expect(normalizeKeysToSchema('scalar', messageSchema)).toBe('scalar');
    const emptyProps: JsonSchemaNode = { type: 'object', properties: {} };
    const value = { message: 'x' };
    expect(normalizeKeysToSchema(value, emptyProps)).toBe(value);
  });
});
