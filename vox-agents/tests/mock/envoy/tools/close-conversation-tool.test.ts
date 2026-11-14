/**
 * Tests for the diplomat's close-conversation tool (src/envoy/close-conversation-tool.ts).
 * The tool stages a close inside the active turn. Terminal reconciliation owns the durable write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient } from '../../../helpers/mock-mcp-client.js';
import type { EnvoyThread } from '../../../../src/types/index.js';

vi.mock('../../../../src/agents/mcp/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { createCloseConversationTool } from '../../../../src/envoy/tools/close-conversation-tool.js';
import { beginTurnState } from '../../../../src/diplomacy/turn/active-turn-state.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Active diplomacy thread the diplomat is voicing (agent = seat 3). */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

/** Minimal VoxContext stub: the tool reads currentInput + currentParameters. */
function makeContext(currentInput: EnvoyThread | undefined) {
  return { id: 'ctx', currentInput, currentParameters: { turn: 5, playerID: 3 } } as any;
}

/** Run the tool's execute with the given active conversation. */
function close(currentInput: EnvoyThread | undefined, farewell = 'Farewell.') {
  const tool = createCloseConversationTool(makeContext(currentInput)) as any;
  return tool.execute({ Farewell: farewell }, { toolCallId: 't', messages: [] });
}

describe('close-conversation tool', () => {
  it('reports no active conversation when currentInput is missing', async () => {
    expect(await close(undefined)).toBe('No active conversation to close.');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('reports no active conversation when the pair is incomplete', async () => {
    expect(await close(thread({ player2ID: undefined as any }))).toBe('No active conversation to close.');
  });

  it('stages one close idempotently under an active turn without writing early', async () => {
    const input = thread();
    const turnState = beginTurnState(input);

    expect(await close(input, 'First farewell.'))
      .toBe('Conversation will close after this reply is recorded.');
    expect(await close(input, 'Duplicate farewell.'))
      .toBe('Conversation will close after this reply is recorded.');

    expect(mcp.calls('read-transcript')).toHaveLength(0);
    expect(mcp.calls('append-message')).toHaveLength(0);
    expect(turnState.takeStagedClose()).toEqual({
      speakerID: 3,
      content: 'First farewell.',
    });
    expect(turnState.takeStagedClose()).toBeUndefined();
    expect(turnState.freeze()).toEqual([]);
  });

  // Throwing (rather than returning the refusal as ordinary output) is what keeps the errored call
  // from counting as a terminal action, so the turn still archives its stand-in reply.
  it('throws when no chat turn owns the thread, and writes nothing', async () => {
    await expect(close(thread()))
      .rejects.toThrow('A conversation can only be closed during an active chat turn.');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });
});
