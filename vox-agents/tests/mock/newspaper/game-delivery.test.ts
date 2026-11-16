/** Check game registration, structured transport, and explicit reader acknowledgements. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewspaperGameDelivery } from '../../../src/newspaper/game-delivery.js';
import { buildLuaFixturePayload } from '../../../src/newspaper/export/lua-fixture.js';
import { createNewspaperBundle, createNewspaperIssue } from '../../helpers/newspaper-fixtures.js';
import { deferred } from '../../helpers/deferred.js';

afterEach(() => vi.useRealTimers());

/** Wrap a Lua response in the structured MCP contract returned by the actual tools. */
function envelope(structuredContent: Record<string, unknown>) {
  return { structuredContent, content: [] };
}

/** Supply normal registration, preparation, and delivery without connecting to a game. */
function fixture() {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'lua-executor') return envelope({ Success: true, Result: true });
      const values = args.Args as unknown[];
      return envelope({ success: true, result: args.Name === 'VoxDeorumNewspaperPrepare'
        ? { success: true, requestId: values[0], receiver: 4, view: { width: 1140, height: 558, zoom: 1 } } : { success: true } });
    }),
  };
  const game = new NewspaperGameDelivery(client);
  const payload = buildLuaFixturePayload(createNewspaperIssue(), {
    key: 'a'.repeat(64), directory: 'cache/bundle', bundle: createNewspaperBundle(),
  }, 'cache');
  return { game, client, payload };
}

describe('newspaper game delivery', () => {
  it('should connect, register with fixed source, prepare, and deliver data in argument arrays', async () => {
    const { game, client, payload } = fixture();
    const prepared = await game.prepare();
    expect(prepared.receiver).toBe(4);
    expect(prepared.view).toEqual({ width: 1140, height: 558, zoom: 1 });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.callTool).toHaveBeenNthCalledWith(1, 'lua-executor', expect.objectContaining({
      Script: 'LuaEvents.VoxDeorumNewspaperRegister(); return true',
    }), { retry: false });
    expect(client.callTool).toHaveBeenNthCalledWith(2, 'call-lua-function', {
      Name: 'VoxDeorumNewspaperPrepare', Args: [prepared.requestId],
    }, { retry: false });
    await game.deliver(prepared, payload);
    expect(client.callTool).toHaveBeenNthCalledWith(3, 'call-lua-function', {
      Name: 'VoxDeorumNewspaperDeliver', Args: [prepared.requestId, payload],
    }, { retry: false });
  });

  it('should stop its initial connection wait without dispatching tools after a late shared connection', async () => {
    vi.useFakeTimers();
    const { game, client } = fixture();
    const connection = deferred();
    client.connect.mockReturnValueOnce(connection.promise);
    const result = game.prepare();
    const rejected = expect(result).rejects.toThrow(/connect.*MCP/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(client.callTool).not.toHaveBeenCalled();
    connection.resolve();
    await Promise.resolve();
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('should clear its connection timer on success or immediate failure', async () => {
    vi.useFakeTimers();
    const { game, client } = fixture();
    await game.prepare();
    expect(vi.getTimerCount()).toBe(0);
    client.connect.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(game.prepare()).rejects.toThrow('Connection refused');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should preserve a reader refusal without telling an already connected player to start a game', async () => {
    const { game, client } = fixture();
    client.callTool.mockResolvedValueOnce(envelope({ Success: true, Result: true }))
      .mockResolvedValueOnce(envelope({ success: true, result: { success: false, error: 'Observer has no player seat' } }));
    await expect(game.prepare()).rejects.toThrow(/^Observer has no player seat$/);
  });

  it('should preserve registration errors and stop before preparing or rendering', async () => {
    const { game, client } = fixture();
    client.callTool.mockResolvedValueOnce(envelope({ Success: false, Error: { Message: 'No active game' } }));
    await expect(game.prepare()).rejects.toThrow('No active game');
    expect(client.callTool).toHaveBeenCalledOnce();
  });

  it.each([
    { isError: true, content: [{ type: 'text', text: 'MCP unavailable' }] },
    envelope({ success: false, error: { message: 'Function not registered' } }),
    envelope({ success: true, result: { success: false, error: 'Seat changed' } }),
    envelope({ success: true }),
    envelope({ success: true, result: { success: true, receiver: 2, requestId: 'another-request' } }),
  ])('should reject invalid or unsuccessful preparation responses %#', async response => {
    const { game, client } = fixture();
    client.callTool.mockResolvedValueOnce(envelope({ Success: true, Result: true })).mockResolvedValueOnce(response);
    await expect(game.prepare()).rejects.toThrow();
  });

  it('should await delivery acknowledgement and reject a reader refusal', async () => {
    const { game, client, payload } = fixture();
    const prepared = await game.prepare();
    client.callTool.mockResolvedValueOnce(envelope({ success: true, result: { success: false, error: 'Stale request' } }));
    await expect(game.deliver(prepared, payload)).rejects.toThrow('Stale request');
    client.callTool.mockRejectedValueOnce(new Error('DLL timeout'));
    await expect(game.deliver(prepared, payload)).rejects.toThrow('DLL timeout');
  });

  it.each([
    undefined,
    { width: 0, height: 558, zoom: 1 },
    { width: 1140, height: Infinity, zoom: 1 },
    { width: 1140, height: 558, zoom: 0.49 },
    { width: 1140, height: 558, zoom: 2.01 },
    { width: 1140, height: 558 },
  ])('should explain how to update a reader returning an invalid publication view %#', async view => {
    const { game, client } = fixture();
    client.callTool.mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'lua-executor'
      ? envelope({ Success: true, Result: true })
      : envelope({ success: true, result: { success: true, requestId: (args.Args as unknown[])[0], receiver: 4, view } }));
    await expect(game.prepare()).rejects.toThrow(/update.*mod.*reload/i);
  });
});
