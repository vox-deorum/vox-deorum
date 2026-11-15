/** Check the optional nonretrying policy without making network connections. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPClient } from '../../../../src/agents/mcp/mcp-client.js';

/** Keep the real call policy and event emitter while supplying only its SDK and connection state. */
function fixture() {
  const client = Object.create(MCPClient.prototype) as MCPClient;
  const dispatch = vi.fn().mockResolvedValue({ content: [] });
  const state = { isConnected: true, client: { callTool: dispatch } };
  Object.assign(client, state);
  return { client, dispatch,
    /** Simulate the connection state change emitted by the real SDK transport. */
    disconnect: () => Object.assign(client, { isConnected: false }),
    /** Simulate the transport becoming available again. */
    reconnect: () => Object.assign(client, { isConnected: true }),
  };
}

afterEach(() => vi.useRealTimers());

describe('MCP client tool retry policy', () => {
  it('should reject a nonretrying call when transport disconnects without waiting for reconnection or dispatching again', async () => {
    const { client, dispatch, disconnect } = fixture();
    const onError = vi.fn();
    client.onToolError(onError);
    const failure = new Error('Transport disconnected');
    dispatch.mockImplementationOnce(async () => { disconnect(); throw failure; });
    await expect(client.callTool('call-lua-function', { Name: 'Show', Args: [] }, { retry: false })).rejects.toBe(failure);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledExactlyOnceWith({ toolName: 'call-lua-function', error: failure });
    expect(dispatch).toHaveBeenCalledWith(expect.any(Object), undefined,
      expect.objectContaining({ timeout: 660_000, resetTimeoutOnProgress: true }));
  });

  it('should preserve the default retries for existing callers', async () => {
    const { client, dispatch } = fixture();
    const result = { content: [{ type: 'text', text: 'done' }] };
    dispatch.mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce(result);
    await expect(client.callTool('get-players', {})).resolves.toBe(result);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('should preserve the default reconnect wait before retrying', async () => {
    vi.useFakeTimers();
    const { client, dispatch, disconnect, reconnect } = fixture();
    dispatch.mockImplementationOnce(async () => { disconnect(); throw new Error('Disconnected'); });
    const pending = client.callTool('get-players');
    await vi.advanceTimersByTimeAsync(200);
    expect(dispatch).toHaveBeenCalledOnce();
    reconnect();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('should reject an already disconnected nonretrying call without dispatching to the SDK', async () => {
    const { client, dispatch, disconnect } = fixture();
    disconnect();
    await expect(client.callTool('call-lua-function', {}, { retry: false })).rejects.toThrow('Not connected');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
