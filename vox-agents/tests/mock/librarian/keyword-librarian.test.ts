/**
 * Tests for the KeywordLibrarian agent (src/librarian/keyword-librarian.ts).
 * Resolved through the registry (canonical load entry) to avoid circular-import hazards;
 * prompt/lifecycle methods are reached through a loosely-typed handle as in the envoy tests.
 * Exercises the programmatic getOutput search path via a fake VoxContext — no live model/MCP.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import {
  createFakeVoxContext,
  makeStrategistParameters,
} from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

const librarian = agentRegistry.get('keyword-librarian') as any;

let ctx: ReturnType<typeof createFakeVoxContext>;
const params = makeStrategistParameters();

beforeEach(() => {
  ctx = createFakeVoxContext();
});

describe('KeywordLibrarian.getInitialMessages', () => {
  it('numbers each supplied context and marks empty/whitespace ones as skip', async () => {
    const msgs = await librarian.getInitialMessages(params, ['research walls', '   ', 'tech rush'], ctx.asContext());

    expect(msgs).toHaveLength(1);
    const content = msgs[0].content as string;
    expect(msgs[0].role).toBe('user');
    expect(content).toContain('## Context 1');
    expect(content).toContain('research walls');
    expect(content).toContain('## Context 2');
    expect(content).toContain('(Empty - skip)');
    expect(content).toContain('## Context 3');
    expect(content).toContain('tech rush');
  });
});

describe('KeywordLibrarian.getActiveTools', () => {
  it('is empty — the LLM only emits keyword JSON, it does not call tools', () => {
    expect(librarian.getActiveTools(params)).toEqual([]);
  });
});

describe('KeywordLibrarian.getModel', () => {
  it('applies the low reasoning tier to the agent model override', () => {
    const override: Model = { provider: 'openai', name: 'test-model', options: {} } as Model;
    const model = librarian.getModel(params, [], { 'keyword-librarian': override });
    expect(model.options?.reasoningEffort).toBe('low');
  });
});

describe('KeywordLibrarian.getOutput', () => {
  it('returns an array of empty strings for empty/whitespace finalText', async () => {
    expect(await librarian.getOutput(params, ['a', 'b'], '   ', ctx.asContext())).toEqual(['', '']);
    expect(ctx.calls('search-database')).toHaveLength(0);
  });

  it('returns an array of empty strings for invalid JSON without throwing', async () => {
    const out = await librarian.getOutput(params, ['a', 'b'], 'not json {', ctx.asContext());
    expect(out).toEqual(['', '']);
    expect(ctx.calls('search-database')).toHaveLength(0);
  });

  it('searches per context with {Keywords, MaxResults:10} and skips keyword-less contexts', async () => {
    ctx.respondWith('search-database', {
      Library: { Relevance: 0.876, Cost: 90, Name: 'Library' },
    });

    const finalText = JSON.stringify({
      contexts: [
        { contextNumber: 1, keywords: ['Writing', 'Library'] },
        { contextNumber: 2, keywords: [] },
      ],
    });

    const out = await librarian.getOutput(params, ['ctx1', 'ctx2'], finalText, ctx.asContext());

    // Exactly one search — context 2 has no keywords and is skipped.
    const searches = ctx.calls('search-database');
    expect(searches).toHaveLength(1);
    expect(searches[0].args).toEqual({ Keywords: ['Writing', 'Library'], MaxResults: 10 });

    // Formatted result keeps the name, the relevance (fixed to 2 dp), and non-filtered fields;
    // the Relevance/Name fields are not duplicated as bullet lines.
    expect(out[0]).toContain('**Library**');
    expect(out[0]).toContain('Relevance: 0.88');
    expect(out[0]).toContain('Cost: 90');
    expect(out[0]).not.toMatch(/- Name:/);
    expect(out[0]).not.toMatch(/- Relevance:/);

    // Skipped context yields an empty string in its slot.
    expect(out[1]).toBe('');
  });

  it('yields an empty slot when a searched context returns no results', async () => {
    ctx.respondWith('search-database', {});
    const finalText = JSON.stringify({ contexts: [{ contextNumber: 1, keywords: ['Nothing'] }] });

    const out = await librarian.getOutput(params, ['ctx1'], finalText, ctx.asContext());

    expect(ctx.calls('search-database')).toHaveLength(1);
    expect(out[0]).toBe('');
  });
});
