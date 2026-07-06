/**
 * The createSimpleTool key-casing backstop: every factory-built tool wraps its input schema so a
 * model that emits mismatched key casing (top-level or nested) still validates — covering paths that
 * bypass the tool-rescue middleware (e.g. gemma/hermes models, direct invocation). dynamicTool stores
 * inputSchema verbatim, so `tool.inputSchema.parse(...)` runs exactly the SDK's pre-execute validation.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createSimpleTool } from '../../../../src/utils/tools/simple-tools.js';

/** Minimal VoxContext stub: createSimpleTool only reads `id` + `currentParameters` (in execute). */
function makeCtx() {
  return { id: 'ctx', currentParameters: { turn: 1 } } as any;
}

describe('createSimpleTool key-casing backstop', () => {
  // Mirrors propose-deal: flat fields plus an array of nested objects whose `Term` is a preprocess-
  // wrapped enum (the exact shape that produced the reported failure).
  const schema = z.object({
    Rationale: z.string(),
    Message: z.string(),
    Give: z
      .array(
        z.object({
          Term: z.preprocess((v) => v, z.enum(['Gold', 'Gold Per Turn', 'Declaration of Friendship'])),
          Amount: z.number().int().optional(),
        })
      )
      .default([]),
  });
  const tool: any = createSimpleTool(
    { name: 'propose-deal', description: 'x', inputSchema: schema, execute: async (i) => i },
    makeCtx()
  );

  it('validates a payload with lowercase top-level and nested keys (the reported failure)', () => {
    const raw = {
      Rationale: 'r',
      Message: 'm',
      Give: [{ term: 'Declaration of Friendship' }, { term: 'Gold Per Turn', amount: 3 }],
    };
    expect(tool.inputSchema.parse(raw)).toEqual({
      Rationale: 'r',
      Message: 'm',
      Give: [{ Term: 'Declaration of Friendship' }, { Term: 'Gold Per Turn', Amount: 3 }],
    });
  });

  it('still rejects genuinely invalid input after normalization', () => {
    // A misspelled term is not a casing slip — it must still fail rather than be masked.
    expect(() => tool.inputSchema.parse({ Rationale: 'r', Message: 'm', Give: [{ term: 'Goldd' }] })).toThrow();
  });

  it('leaves the model-facing JSON Schema byte-identical to the unwrapped schema', () => {
    expect(JSON.stringify(z.toJSONSchema(tool.inputSchema))).toBe(JSON.stringify(z.toJSONSchema(schema)));
  });
});
