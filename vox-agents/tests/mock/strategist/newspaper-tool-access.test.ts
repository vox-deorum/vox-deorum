import { describe, expect, it } from 'vitest';
import { dynamicTool, jsonSchema } from 'ai';
import { agentRegistry } from '../../../src/agents/runtime/agent-registry.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { createFakeVoxContext, makeStrategistParameters } from '../../helpers/fake-vox-context.js';

const newspaperEndpoint = 'get-newspaper-evidence';

/** Minimal run context whose tool registry holds the shared catalogue's newspaper endpoint. */
function makeRunContext() {
  const context = createFakeVoxContext();
  context.tools[newspaperEndpoint] = dynamicTool({ inputSchema: jsonSchema({ type: 'object' }) });
  return context.asContext();
}

/** The built-in chat strategists that declare a run tool list. */
const chatStrategists = [
  'simple-strategist',
  'simple-strategist-briefed',
  'simple-strategist-staffed',
  'simple-strategist-learned',
];

/** The decision tool each decision mode expects in the run list. */
const modes = [
  { mode: 'Strategy' as const, decisionTool: 'set-strategy' },
  { mode: 'Flavor' as const, decisionTool: 'set-flavors' },
];

describe.each(chatStrategists)('%s run tools', name => {
  it.each(modes)('should declare an explicit $mode list without the newspaper endpoint', async ({ mode, decisionTool }) => {
    const agent = agentRegistry.get<StrategistParameters>(name);
    const tools = await agent?.getRunTools(makeStrategistParameters({ mode }), undefined, makeRunContext());

    expect(tools).toBeDefined();
    expect(tools).not.toContain(newspaperEndpoint);
    expect(tools).toContain(decisionTool);
  });
});

describe('EvaluatorStrategist run tools', () => {
  it('should declare no tools', async () => {
    const agent = agentRegistry.get<StrategistParameters>('evaluator-strategist');
    const tools = await agent?.getRunTools(makeStrategistParameters(), undefined, makeRunContext());

    expect(tools).toEqual([]);
  });
});
