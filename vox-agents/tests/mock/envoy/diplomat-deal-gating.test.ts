/**
 * Tests for the Diplomat's deal-gating in prepareStep (interactive-diplomacy 05.1). When a deal
 * authored by the counterpart is open on the table, the diplomat is restricted to call-negotiator +
 * send-message so it can't wander into briefings/analyst calls while the ball is in its court. The
 * gate reads the AUTHORITATIVE durable reduction (readActiveProposal → read-transcript), never the
 * in-memory cache, so a stale cache can't keep restricting. Uses the shared mcpClient fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

// Load the full agent graph through the registry (the canonical load entry) before reaching an agent
// module — otherwise the circular-import hazard noted in negotiator.test bites.
import '../../../src/infra/agent-registry.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';

const diplomat = agentRegistry.get('diplomat') as any;

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Diplomacy thread: ordered pair 1↔3, the diplomat voices seat 3 (so the counterpart is seat 1). */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    diplomacy: true,
    ...partial,
  };
}

/** A deal-proposal transcript row authored by `speakerID`. */
function dealRow(speakerID: number, id = 5) {
  return {
    ID: id,
    Player1ID: 1,
    Player2ID: 3,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: speakerID,
    MessageType: 'deal-proposal',
    Content: '',
    Payload: { Deal: { version: 1, items: [], promises: [] } },
    Turn: 5,
    CreatedAt: 0,
  };
}

const params = { playerID: 3, turn: 5, metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } }, gameStates: {} } as any;

/** Resolve the next-step config from prepareStep at the first step (lastStep null). */
async function prepareStep(input: EnvoyThread) {
  const ctx = createFakeVoxContext().asContext();
  return diplomat.prepareStep(params, input, null, [], [], ctx);
}

describe('Diplomat.prepareStep deal-gating', () => {
  it('restricts to call-negotiator + send-message when the counterpart has an open proposal', async () => {
    // Seat 1 (the counterpart) authored the open proposal; the ball is in the diplomat's (seat 3) court.
    mcp.respondWith('read-transcript', structuredResult({ messages: [dealRow(1)] }));

    const config = await prepareStep(thread());
    expect(config.activeTools).toEqual(['call-negotiator', 'send-message']);
  });

  it('does not restrict when OUR own side authored the open proposal (ball on the other side)', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [dealRow(3)] }));

    const config = await prepareStep(thread());
    // Unrestricted: prepareStep leaves activeTools unset so the full getActiveTools list applies.
    expect(config.activeTools).toBeUndefined();
  });

  it('does not restrict when no proposal is on the table', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [] }));

    const config = await prepareStep(thread());
    expect(config.activeTools).toBeUndefined();
  });

  it('restricts special (greeting) mode to send-message without consulting the deal store', async () => {
    // Special mode is handled by LiveEnvoy before the deal-gate; the gate is skipped entirely.
    const input = thread({
      messages: [{ message: { role: 'user', content: '{{{Greeting}}}' }, metadata: { datetime: new Date(0), turn: 5 } }],
    });

    const config = await prepareStep(input);
    expect(config.activeTools).toEqual(['send-message']);
    expect(mcp.calls('read-transcript')).toHaveLength(0);
  });
});
