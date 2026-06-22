/**
 * Regression test for VoxContext.execute()'s currentInput save/restore.
 *
 * Agent-tools run a sub-agent via `context.execute(...)` on the SAME VoxContext
 * (see utils/tools/agent-tools.ts). execute() sets `this.currentInput = input`; if it did
 * not restore the parent's input afterwards, a sub-agent call (e.g. the diplomat invoking
 * call-diplomatic-analyst) would leave `currentInput` pointing at the sub-agent's input.
 * A later tool in the parent's loop that reads `context.currentInput` (e.g. the diplomat's
 * close-conversation tool) would then see the wrong object — the bug this guards against.
 *
 * Agents with an empty system prompt short-circuit execute() before any model/streamText
 * call, and a Model override per agent name keeps getModel off the config.json fallback —
 * so the real execute() code path runs with no network access.
 */

import { describe, it, expect } from 'vitest';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { VoxAgent, AgentParameters } from '../../../src/infra/vox-agent.js';
import type { Model } from '../../../src/types/index.js';

/** No-op agent: empty system prompt makes execute() return early (no LLM call). */
class NoopAgent extends VoxAgent<AgentParameters> {
  readonly description = 'test no-op agent';
  constructor(
    public readonly name: string,
    private readonly onSystem?: (ctx: VoxContext<AgentParameters>) => Promise<void>
  ) {
    super();
  }
  async getSystem(_p: AgentParameters, _i: unknown, ctx: VoxContext<AgentParameters>): Promise<string> {
    if (this.onSystem) await this.onSystem(ctx);
    return ''; // empty → execute() takes the no-system early-return branch
  }
}

describe('VoxContext.execute currentInput save/restore', () => {
  it('restores the parent input after a nested execute (agent-tool re-entrancy)', async () => {
    const params: AgentParameters = { playerID: 1, gameID: 'g', turn: 1 };
    const innerInput = { kind: 'analyst-request' };
    const outerInput = { kind: 'envoy-thread', player1ID: 1, player2ID: 3 };

    let seenDuringInner: unknown = 'unset';
    let seenAfterInner: unknown = 'unset';

    agentRegistry.register(new NoopAgent('test-ci-inner', async (ctx) => {
      seenDuringInner = ctx.currentInput; // sub-agent should see its own input
    }));
    agentRegistry.register(new NoopAgent('test-ci-outer', async (ctx) => {
      // Mid-parent: invoke a sub-agent on the SAME context (mirrors call-diplomatic-analyst).
      // The nested execute stays in the parent's active root (no parameter argument).
      await ctx.execute('test-ci-inner', innerInput);
      // After the sub-agent returns, the parent's input must be back in place.
      seenAfterInner = ctx.currentInput;
    }));

    // Per-agent Model overrides so getModel() never touches config.json. The model is never
    // actually invoked (empty system prompt), so a stub object is sufficient.
    const stubModel = { provider: 'test', name: 'test' } as unknown as Model;
    const context = new VoxContext<AgentParameters>(
      { 'test-ci-inner': stubModel, 'test-ci-outer': stubModel },
      'test-ci-context'
    );
    expect(context.currentInput).toBeUndefined();

    // execute() requires an active run; open one over the params, then run the outer agent inside it.
    await context.withRun({ parameters: params }, () => context.execute('test-ci-outer', outerInput));

    expect(seenDuringInner).toBe(innerInput); // sub-agent saw its own input
    expect(seenAfterInner).toBe(outerInput);  // parent input restored — the fix
    expect(context.currentInput).toBeUndefined(); // top level restored to pre-execute state
  });
});
