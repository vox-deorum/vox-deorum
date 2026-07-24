/**
 * Restart-persistence test for the durable diplomatic transcript (interactive-diplomacy stage 1).
 *
 * The headline guarantee of the transcript store is that a conversation "survives a restart"
 * (01-transcript-store.md). The rest of the diplomacy suite runs against an in-memory SQLite DB,
 * which cannot outlive a `close()`, so this test uses a real on-disk file: write a small
 * conversation through the append-message tool, close the store, reopen a FRESH store on the same
 * file, and assert the messages, roles, order, and the `close` special message all came back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { KnowledgeStore } from '../../../src/knowledge/store.js';
import { knowledgeManager } from '../../../src/server.js';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import { getDiplomaticMessages } from '../../../src/knowledge/getters/diplomatic-messages.js';

// The cache-empty branch of the major-civ check falls back to a live Lua fetch; stub it to [] so
// the test needs no bridge/DLL (and the check is skipped, exactly as in append-message.test.ts).
vi.mock('../../../src/knowledge/getters/player-information.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/player-information.js')>();
  return { ...actual, getPlayerInformations: vi.fn(async () => []) };
});

const tool = createAppendMessageTool();

describe('diplomatic transcript persistence across a restart', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('survives closing and reopening the on-disk store (messages, roles, order, close)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diplo-persist-'));
    const dbPath = path.join(tmpDir, 'knowledge.sqlite');

    const getStore = vi.spyOn(knowledgeManager, 'getStore');
    vi.spyOn(knowledgeManager, 'getTurn').mockReturnValue(7);
    const base = { PlayerAID: 3, PlayerBID: 1, PlayerARole: 'diplomat', PlayerBRole: 'the leader' };

    // --- session 1: write a small conversation (two text turns + a close) to an on-disk store ---
    const store1 = new KnowledgeStore();
    await store1.initialize(dbPath, 'persist-game');
    getStore.mockReturnValue(store1);
    await tool.execute({ ...base, SpeakerID: 1, MessageType: 'text', Content: 'Hello from 1.' } as any);
    await tool.execute({ ...base, SpeakerID: 3, MessageType: 'text', Content: 'Reply from 3.' } as any);
    await tool.execute({ ...base, SpeakerID: 3, MessageType: 'close', Content: '' } as any);
    await store1.close();

    // --- session 2: reopen the SAME file with a brand-new store (simulating a restart) ---
    const store2 = new KnowledgeStore();
    await store2.initialize(dbPath, 'persist-game');
    getStore.mockReturnValue(store2);

    // Read as one ordered thread regardless of endpoint argument order.
    const rows = await getDiplomaticMessages(1, 3);
    expect(rows.messages.map((r) => r.Content)).toEqual(['Hello from 1.', 'Reply from 3.', '']);
    expect(rows.messages.map((r) => r.MessageType)).toEqual(['text', 'text', 'close']);
    // Free-form roles persisted, ordered to the stored pair (Player1 = min = 1 = 'the leader').
    expect(rows.messages[0].Player1Role).toBe('the leader');
    expect(rows.messages[0].Player2Role).toBe('diplomat');
    // Append-ID order survived the restart (the getter orders by ID).
    const ids = rows.messages.map((r) => r.ID);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(rows.messages[0].Turn).toBe(7);

    await store2.close();
  });
});
