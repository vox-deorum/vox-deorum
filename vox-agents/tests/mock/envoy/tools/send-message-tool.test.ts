/** Tests for durable diplomat delivery in the shared live-envoy send-message tool. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../../helpers/mock-mcp-client.js';

vi.mock('../../../../src/agents/mcp/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { createSendMessageTool } from '../../../../src/envoy/tools/send-message-tool.js';
import type { EnvoyThread } from '../../../../src/types/index.js';
import { beginTurnState } from '../../../../src/diplomacy/turn/active-turn-state.js';
import { createFakeVoxContext } from '../../../helpers/fake-vox-context.js';

let mcp: ReturnType<typeof installMockMcpClient>;

/** Build the active envoy thread used by the tool. */
function thread(diplomacy = true): EnvoyThread {
  return {
    id: `dipl:g:1:3#send-${diplomacy}`,
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    diplomacy,
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    metadata: {},
  };
}

/** Invoke the AI SDK dynamic tool with the minimal execution metadata it requires. */
async function execute(tool: unknown, Message: string): Promise<unknown> {
  return (tool as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute(
    { Message },
    { toolCallId: 'send-1', messages: [] },
  );
}

beforeEach(() => {
  mcp = installMockMcpClient();
  mcp.onTool('append-message', (args) => structuredResult({
    ID: 101,
    SpeakerID: args.SpeakerID,
    MessageType: args.MessageType,
    Content: args.Content,
    Turn: 5,
  }));
});

describe('createSendMessageTool', () => {
  it('archives and reports one cleaned diplomacy message without mutating the cache', async () => {
    const input = thread();
    const context = createFakeVoxContext();
    context.setBaseParameters({ turn: 5 });
    context.currentInput = input;
    const turnState = beginTurnState(input);

    await expect(execute(createSendMessageTool(context.asContext()), '[Turn 5] Germany, the diplomat: Greetings.'))
      .resolves.toBe('Message delivered.');

    expect(mcp.calls('append-message')[0]!.args).toMatchObject({
      SpeakerID: 3,
      MessageType: 'text',
      Content: 'Greetings.',
    });
    expect(turnState.freeze()).toEqual([expect.objectContaining({ ID: 101, Content: 'Greetings.' })]);
    expect(input.messages).toEqual([]);
  });

  it('does not archive shared-tool calls outside diplomacy', async () => {
    const input = thread(false);
    const context = createFakeVoxContext();
    context.setBaseParameters({ turn: 5 });
    context.currentInput = input;

    await expect(execute(createSendMessageTool(context.asContext()), 'Status report.'))
      .resolves.toBe('Message delivered.');

    expect(mcp.calls('append-message')).toEqual([]);
  });

  it('keeps multiple spoken calls as separate durable rows', async () => {
    let nextID = 101;
    mcp.onTool('append-message', (args) => structuredResult({
      ID: nextID++, SpeakerID: args.SpeakerID, MessageType: args.MessageType, Content: args.Content, Turn: 5,
    }));
    const input = thread();
    const context = createFakeVoxContext();
    context.setBaseParameters({ turn: 5 });
    context.currentInput = input;
    const turnState = beginTurnState(input);
    const tool = createSendMessageTool(context.asContext());

    await execute(tool, 'First point.');
    await execute(tool, 'Second point.');

    expect(turnState.freeze().map((row) => [row.ID, row.Content]))
      .toEqual([[101, 'First point.'], [102, 'Second point.']]);
  });

  it('throws when the diplomacy archive rejects the delivered message', async () => {
    mcp.onTool('append-message', () => { throw new Error('store unavailable'); });
    const context = createFakeVoxContext();
    context.setBaseParameters({ turn: 5 });
    context.currentInput = thread();

    await expect(execute(createSendMessageTool(context.asContext()), 'We agree.'))
      .rejects.toThrow('store unavailable');
  });

  it('rejects an empty message after echo cleaning instead of archiving an invisible row', async () => {
    const context = createFakeVoxContext();
    context.setBaseParameters({ turn: 5 });
    context.currentInput = thread();

    await expect(execute(createSendMessageTool(context.asContext()), '[Turn 5] Germany, the diplomat: '))
      .rejects.toThrow('requires visible message text');

    expect(mcp.calls('append-message')).toEqual([]);
  });
});
