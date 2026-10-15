/** Tests for the thin registered Lua function transport tool. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeManager, knowledgeManager } from '../../../src/server.js';
import createCallLuaFunctionTool from '../../../src/tools/general/call-lua-function.js';
import { connectToolClient } from '../tool-client.js';

const tool = createCallLuaFunctionTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

describe('call-lua-function', () => {
  // What BridgeManager settles is the whole lua_response frame. Publishing `type` and
  // `id` put internal framing in a caller-facing contract, and when the output schema
  // still forbade extra keys it failed validation *after* the Lua call had already run
  // in the game — which the client then retried, re-executing the call each time.
  // The tool publishes the response with the transport frame removed and nothing else
  // reshaped, for success and error payloads alike.
  it.each([
    {
      name: 'strips the DLL transport frame from its structured output',
      call: { Name: 'VoxDeorumDiploBegin', Args: [] },
      response: { type: 'lua_response', id: 'b8dfa317-df98-48d7-9050-b2f7ab6fb768', success: true, result: true },
      published: { success: true, result: true },
    },
    {
      name: 'preserves the BridgeManager success response',
      call: { Name: 'VoxDeorumDiploBegin', Args: [{ busy: false }] },
      response: { success: true, result: { accepted: true } },
      published: { success: true, result: { accepted: true } },
    },
    {
      name: 'returns DLL_DISCONNECTED unchanged',
      call: { Name: 'VoxDeorumDiploStatus', Args: [] },
      response: { success: false, error: { code: 'DLL_DISCONNECTED', message: 'The Civilization V DLL is disconnected.' } },
      published: { success: false, error: { code: 'DLL_DISCONNECTED', message: 'The Civilization V DLL is disconnected.' } },
    },
  ])('$name', async ({ call, response, published }) => {
    const spy = vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(response as any);

    const output = await client.call(call);

    expect(output).not.toHaveProperty('type');
    expect(output).not.toHaveProperty('id');
    expect(output).toEqual(published);
    expect(spy).toHaveBeenCalledWith(call.Name, call.Args);
  });

  it('rejects a guarded call before it reaches BridgeManager after a game switch', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');
    const call = vi.spyOn(bridgeManager, 'callLuaFunction');

    await expect(
      client.call({ Name: 'VoxDeorumDiploAppend', Args: [], ExpectedGameID: 'previous-game' })
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});
