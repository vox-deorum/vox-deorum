/**
 * Tests for the post-notification action tool. The Lua boundary is stubbed (no
 * bridge); we assert argument shaping, the CounterpartID default, IPC text
 * sanitization, participant validation, and the Success/Result passthrough.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createPostNotificationTool from '../../../src/tools/actions/post-notification.js';

const tool = createPostNotificationTool();

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stub the Lua boundary so super.call() returns a canned boolean result. */
function mockLua(result = true, success = true) {
  return vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

describe('post-notification', () => {
  it('forwards a diplomacy notification with the counterpart and maps Success/Result', async () => {
    const spy = mockLua(true);

    const result = await tool.execute({
      PlayerID: 0, CounterpartID: 3, Summary: 'Napoleon writes', Message: 'We should talk.',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(true);
    expect(spy).toHaveBeenCalledWith(0, 3, 'Napoleon writes', 'We should talk.');
  });

  it('defaults CounterpartID to -1 when omitted (general message path)', async () => {
    const spy = mockLua(true);

    await tool.execute({
      PlayerID: 2, Summary: 'Notice', Message: 'The council has news.',
    } as any);

    expect(spy).toHaveBeenCalledWith(2, -1, 'Notice', 'The council has news.');
  });

  it('trims text and strips the IPC frame delimiter from Summary and Message', async () => {
    const spy = mockLua(true);

    await tool.execute({
      PlayerID: 1,
      Summary: '  head!@#$%^!line  ',
      Message: '  before!@#$%^!after  ',
    } as any);

    expect(spy).toHaveBeenCalledWith(1, -1, 'headline', 'beforeafter');
  });

  it('rejects a diplomacy notification addressed to the receiving player', async () => {
    const spy = mockLua(true);

    await expect(tool.execute({
      PlayerID: 1, CounterpartID: 1, Summary: 'Notice', Message: 'Message',
    } as any)).rejects.toThrow('CounterpartID must be different from PlayerID');
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['Summary', '!@#$%^!', 'Message'],
    ['Message', 'Summary', '  \t\n  '],
  ])('rejects %s when sanitization leaves no visible text', async (field, summary, message) => {
    const spy = mockLua(true);

    await expect(tool.execute({
      PlayerID: 1, Summary: summary, Message: message,
    } as any)).rejects.toThrow(`${field} must contain visible text after IPC sanitization`);
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates a failed Lua response', async () => {
    mockLua(false, false);

    const result = await tool.execute({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(false);
  });

  it('preserves a Civ V rejection as a false result on a successful bridge call', async () => {
    mockLua(false, true);

    const result = await tool.execute({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(false);
  });
});
