/**
 * Tests for the present-decision action tool. This is the fire-and-forget
 * outbound half of the human-decision round-trip: it fetches the turn's options
 * server-side (the get-options tool in Flavor mode) and hands the report to the
 * presentHumanDecision Lua util. It records no game state.
 *
 * We stub the options result and the presentHumanDecision utility (the bridge
 * boundary), then check the delivered report and turn defaulting
 * and the success passthrough, without a live bridge or DB reads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { getTool } from '../../../src/tools/index.js';
import * as presentDecisionUtil from '../../../src/utils/lua/present-decision.js';
import createPresentDecisionTool from '../../../src/tools/actions/present-decision.js';
import { connectToolClient } from '../tool-client.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createPresentDecisionTool();
let store: KnowledgeStore;
let getOptionsSpy: ReturnType<typeof vi.spyOn>;
let presentSpy: ReturnType<typeof vi.spyOn>;
let client: Awaited<ReturnType<typeof connectToolClient>>;

const cannedReport = { Options: { Technologies: ['Pottery'] } };

beforeEach(async () => {
  store = await setupStore(42);
  // get-options is fetched via getTool("getOptions"); stub the cached instance.
  const getOptions = getTool('getOptions')!;
  getOptionsSpy = vi.spyOn(getOptions, 'execute').mockResolvedValue(cannedReport as any);
  presentSpy = vi
    .spyOn(presentDecisionUtil, 'presentHumanDecision')
    .mockResolvedValue({ success: true } as any);
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

describe('present-decision', () => {
  it('fetches get-options in Flavor mode and pushes the report for the given turn', async () => {
    const result = await client.call({ PlayerID: 1, Turn: 5 });

    expect(result).toBe(true);

    expect(presentSpy).toHaveBeenCalledTimes(1);
    const [playerID, turn, report] = presentSpy.mock.calls[0];
    expect(playerID).toBe(1);
    expect(turn).toBe(5);
    expect(report).toEqual(cannedReport);
  });

  it("defaults Turn=-1 to the server's current turn", async () => {
    await client.call({ PlayerID: 0, Turn: -1 });

    const [, turn] = presentSpy.mock.calls[0];
    expect(turn).toBe(42); // knowledgeManager.getTurn()
  });

  it('returns the success flag from presentHumanDecision', async () => {
    presentSpy.mockResolvedValue({ success: false } as any);

    expect(await client.call({ PlayerID: 0, Turn: 3 })).toBe(false);
  });
});
