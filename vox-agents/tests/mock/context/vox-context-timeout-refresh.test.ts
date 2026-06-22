/**
 * Regression tests for execution-frame scoping of `context.timeoutRefresh`.
 *
 * The concurrency wrapper rebinds `context.timeoutRefresh` per model call and MCP tools read it at
 * the start of their execute() to reset *that* stream's execution timeout. Because the slot lives
 * on the per-execution frame (not the shared root), concurrent sibling executions on one root never
 * refresh one another's timeout, and a nested execution restores the parent's slot on return.
 *
 * No model layer is needed: a no-op agent (empty system prompt) short-circuits execute() right
 * after getSystem(), which runs inside the pushed child frame, so its hook can set/read
 * `ctx.timeoutRefresh` exactly where a real model call would.
 */

import { describe, it, expect } from 'vitest';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { VoxAgent } from '../../../src/infra/vox-agent.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

/** No-op agent: empty system prompt makes execute() return early (no model call). */
class NoopAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'timeout-refresh test no-op agent';
  constructor(
    public readonly name: string,
    private readonly onSystem: (ctx: VoxContext<StrategistParameters>) => Promise<void>
  ) { super(); }
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  async getSystem(_p: StrategistParameters, _i: unknown, ctx: VoxContext<StrategistParameters>): Promise<string> {
    await this.onSystem(ctx);
    return '';
  }
}

/** A two-party rendezvous: both executions arrive() and proceed together. */
function barrier() {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let count = 0;
  return { async arrive() { if (++count >= 2) release(); await gate; } };
}

describe('context.timeoutRefresh is execution-frame scoped', () => {
  it('a nested execution does not clobber the parent slot (restored on return)', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'tr-nested');
    const base = makeStrategistParameters();
    const parentCb = () => {};
    let childSawOwn = false;

    agentRegistry.register(new NoopAgent('tr-child', async c => {
      const childCb = () => {};
      c.timeoutRefresh = childCb;          // writes the child frame's slot
      childSawOwn = c.timeoutRefresh === childCb;
    }) as any);

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      ctx.timeoutRefresh = parentCb;       // writes the top frame's slot
      expect(ctx.timeoutRefresh).toBe(parentCb);
      await ctx.execute('tr-child', {});
      // The nested execution wrote its own frame, so the parent slot is intact.
      expect(ctx.timeoutRefresh).toBe(parentCb);
    });

    expect(childSawOwn).toBe(true);
  });

  it('concurrent nested executions on one root keep independent slots', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'tr-concurrent');
    const base = makeStrategistParameters();
    const sync = barrier();
    const sawOwn: Record<string, boolean> = {};

    const makeChild = (name: string) => new NoopAgent(name, async c => {
      const cb = () => {};
      c.timeoutRefresh = cb;
      await sync.arrive();                  // hold both children active in their own frames
      // Under root scoping the sibling would have clobbered this; under frame scoping it holds.
      sawOwn[name] = c.timeoutRefresh === cb;
    });
    agentRegistry.register(makeChild('tr-conc-a') as any);
    agentRegistry.register(makeChild('tr-conc-b') as any);

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await Promise.all([
        ctx.execute('tr-conc-a', {}),
        ctx.execute('tr-conc-b', {}),
      ]);
    });

    expect(sawOwn['tr-conc-a']).toBe(true);
    expect(sawOwn['tr-conc-b']).toBe(true);
  });
});
