/**
 * Tests for the post-notification action tool. The Lua boundary is stubbed (no
 * bridge); we assert argument shaping, the CounterpartID default, IPC text
 * sanitization, participant validation, and the Success/Result passthrough.
 *
 * Stage 7.04 widened the recipient to the full addressable player range so a human watching from
 * an observer slot can be notified. The delivery-side half of that (the pinned-observer redirect)
 * lives in `lua/post-notification.lua` and needs live game state, which this tier cannot execute
 * (the repo has no Lua harness), so it is not exercised here.
 */

import { beforeEach, describe, it, expect, afterEach, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createPostNotificationTool from '../../../src/tools/actions/post-notification.js';
import { MaxMajorCivs, MaxPlayers } from '../../../src/knowledge/schema/base.js';
import { connectToolClient } from '../tool-client.js';

const tool = createPostNotificationTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
});

/** Stub the Lua boundary so super.call() returns a canned boolean result. */
function mockLua(result = true, success = true) {
  return vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

describe('post-notification', () => {
  it('forwards a diplomacy notification with the counterpart and maps Success/Result', async () => {
    const spy = mockLua(true);

    const result = await client.call({
      PlayerID: 0, CounterpartID: 3, Summary: 'Napoleon writes', Message: 'We should talk.',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(true);
    const [, counterpartID, summary, message] = spy.mock.calls[0];
    expect(counterpartID).toBe(3);
    expect(summary).toContain('Napoleon writes');
    expect(summary).not.toBe('Napoleon writes');
    expect(message).toBe('We should talk.');
  });

  it('defaults CounterpartID to -1 when omitted (general message path)', async () => {
    const spy = mockLua(true);

    await client.call({
      PlayerID: 2, Summary: 'Notice', Message: 'The council has news.',
    } as any);

    const [, counterpartID, summary, message] = spy.mock.calls[0];
    expect(counterpartID).toBe(-1);
    expect(summary).toContain('Notice');
    expect(message).toBe('The council has news.');
  });

  it('trims text and strips the IPC frame delimiter from Summary and Message', async () => {
    const spy = mockLua(true);

    await client.call({
      PlayerID: 1,
      Summary: '  head!@#$%^!line  ',
      Message: '  before!@#$%^!after  ',
    } as any);

    const [, , summary, message] = spy.mock.calls[0];
    expect(summary).toContain('headline');
    expect(summary).not.toContain('!@#$%^!');
    expect(message).toBe('beforeafter');
    expect(message).not.toContain('!@#$%^!');
  });

  it('truncates messages longer than 400 characters and ends them with an ellipsis', async () => {
    const spy = mockLua(true);

    await client.call({
      PlayerID: 1,
      Summary: 'Notice',
      Message: 'M'.repeat(401),
    } as any);

    const message = spy.mock.calls[0]?.[3] as string;
    expect(message).toHaveLength(400);
    expect(message.startsWith('M'.repeat(397))).toBe(true);
    expect(message.endsWith('...')).toBe(true);
  });

  it('does not truncate a message of exactly 400 characters', async () => {
    const spy = mockLua(true);
    const message = 'M'.repeat(400);

    await client.call({
      PlayerID: 1,
      Summary: 'Notice',
      Message: message,
    } as any);

    expect(spy.mock.calls[0]?.[3]).toBe(message);
  });

  it('rejects a diplomacy notification addressed to the receiving player', async () => {
    const spy = mockLua(true);

    await expect(client.call({
      PlayerID: 1, CounterpartID: 1, Summary: 'Notice', Message: 'Message',
    } as any)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['Summary', '!@#$%^!', 'Message'],
    ['Message', 'Summary', '  \t\n  '],
  ])('rejects %s when sanitization leaves no visible text', async (_field, summary, message) => {
    const spy = mockLua(true);

    await expect(client.call({
      PlayerID: 1, Summary: summary, Message: message,
    } as any)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates a failed Lua response', async () => {
    mockLua(false, false);

    const result = await client.call({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(false);
  });

  it('preserves a Civ V rejection as a false result on a successful bridge call', async () => {
    mockLua(false, true);

    const result = await client.call({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(false);
  });
});

describe('post-notification observer-capable recipient', () => {
  it('accepts an observer-slot PlayerID beyond the major-civ range', async () => {
    const spy = mockLua(true);

    // A pure observer's real slot sits above MaxMajorCivs; it is still a real Players[] entry and
    // a legitimate notification recipient, so the schema must admit it.
    const observerSlot = MaxMajorCivs + 5;
    await client.call({ PlayerID: observerSlot, Summary: 'Notice', Message: 'A reply arrived.' });
    const [recipientID, counterpartID, summary, message] = spy.mock.calls[0];
    expect(recipientID).toBe(observerSlot);
    expect(counterpartID).toBe(-1);
    expect(summary).toContain('Notice');
    expect(summary).not.toBe('Notice');
    expect(message).toBe('A reply arrived.');
  });

  it('bounds PlayerID at the full player range and CounterpartID at the major civs', async () => {
    // The counterpart is a conversation partner, so it stays a major civilization even though the
    // recipient no longer has to be one.
    mockLua(true);
    await client.call({ PlayerID: MaxPlayers - 1, Summary: 's', Message: 'm' });
    await expect(client.call({ PlayerID: MaxPlayers, Summary: 's', Message: 'm' })).rejects.toThrow();
    await expect(client.call({ PlayerID: -1, Summary: 's', Message: 'm' })).rejects.toThrow();
    await expect(client.call({
      PlayerID: 0, CounterpartID: MaxMajorCivs, Summary: 's', Message: 'm',
    })).rejects.toThrow();
  });
});
