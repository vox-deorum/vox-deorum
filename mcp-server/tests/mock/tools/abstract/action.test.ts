/**
 * Tests for the ActionTool abstract base (src/tools/abstract/action.ts).
 *
 * Covers the contracts the base class owns directly: the exported sourceTurnField
 * default, resolveSourceTurn's arg-vs-manager-turn rule, the trimRationale / pushAction /
 * getStore delegations, and the shared annotations + metadata. The Lua boundary and the
 * pushPlayerAction util are stubbed; schema validation is intentionally out of scope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as z from 'zod';
import { ActionTool, sourceTurnField } from '../../../../src/tools/abstract/action.js';
import { knowledgeManager } from '../../../../src/server.js';
import * as playerActions from '../../../../src/utils/lua/player-actions.js';
import * as text from '../../../../src/utils/text.js';

/**
 * Minimal concrete ActionTool that supplies every abstract member and exposes the
 * protected helpers (resolveSourceTurn / trimRationale / getStore / pushAction) as
 * public wrappers so they can be exercised directly.
 */
class TestActionTool extends ActionTool {
  readonly name = 'test-action';
  readonly description = 'test action tool';
  readonly inputSchema = z.object({ PlayerID: z.number() }).extend(sourceTurnField);
  protected readonly resultSchema = z.any();
  protected readonly arguments = ['playerID'];
  protected readonly script = 'return {}';

  async execute() {
    return { Success: true };
  }

  // Public wrappers over the protected members under test.
  public callResolveSourceTurn(args: { Turn?: number }) {
    return this.resolveSourceTurn(args);
  }
  public callTrimRationale(r: string) {
    return this.trimRationale(r);
  }
  public callGetStore() {
    return this.getStore();
  }
  public callPushAction(...a: Parameters<TestActionTool['pushAction']>) {
    return this.pushAction(...a);
  }
}

let tool: TestActionTool;

beforeEach(() => {
  tool = new TestActionTool();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sourceTurnField', () => {
  it('exposes a Turn zod field defaulting to -1', () => {
    const parsed = z.object({}).extend(sourceTurnField).parse({});
    expect(parsed).toEqual({ Turn: -1 });
  });

  it('passes through an explicit Turn value', () => {
    const parsed = z.object({}).extend(sourceTurnField).parse({ Turn: 7 });
    expect(parsed.Turn).toBe(7);
  });
});

describe('resolveSourceTurn', () => {
  beforeEach(() => {
    vi.spyOn(knowledgeManager, 'getTurn').mockReturnValue(42);
  });

  it('uses the manager turn when Turn is the -1 sentinel', () => {
    expect(tool.callResolveSourceTurn({ Turn: -1 })).toBe(42);
  });

  it('uses the manager turn when Turn is undefined', () => {
    expect(tool.callResolveSourceTurn({})).toBe(42);
  });

  it('uses the arg when Turn >= 0', () => {
    expect(tool.callResolveSourceTurn({ Turn: 0 })).toBe(0);
    expect(tool.callResolveSourceTurn({ Turn: 3 })).toBe(3);
  });
});

describe('trimRationale', () => {
  it('delegates to utils/text.trimRationale', () => {
    const spy = vi.spyOn(text, 'trimRationale').mockReturnValue('trimmed');
    const out = tool.callTrimRationale('some rationale');
    expect(out).toBe('trimmed');
    expect(spy).toHaveBeenCalledWith('some rationale');
  });
});

describe('getStore', () => {
  it('returns the knowledgeManager store', () => {
    const fakeStore = { marker: true } as any;
    vi.spyOn(knowledgeManager, 'getStore').mockReturnValue(fakeStore);
    expect(tool.callGetStore()).toBe(fakeStore);
  });
});

describe('pushAction', () => {
  it('delegates to pushPlayerAction with all forwarded arguments', async () => {
    const spy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
    await tool.callPushAction(0, 'strategy', 'summary', 'rationale', 'Prefix', 9);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0, 'strategy', 'summary', 'rationale', 'Prefix', 9);
  });

  it('forwards undefined optional trailing args verbatim', async () => {
    const spy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
    await tool.callPushAction(1, 'type', 's', 'r');
    expect(spy).toHaveBeenCalledWith(1, 'type', 's', 'r', undefined, undefined);
  });
});

describe('shared annotations and metadata', () => {
  it('marks the tool as not read-only', () => {
    expect(tool.annotations).toEqual({ readOnlyHint: false });
  });

  it('exposes the default autoComplete metadata', () => {
    expect(tool.metadata).toEqual({ autoComplete: ['PlayerID', 'Turn'] });
  });
});
