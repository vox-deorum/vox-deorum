import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeManager } from '../../src/knowledge/manager.js';

/** Install a private knowledge store with stable game identity and player records. */
export async function configureKnowledgeManager(manager: KnowledgeManager): Promise<() => Promise<void>> {
  const directory = await mkdtemp(join(tmpdir(), 'vox-mcp-knowledge-'));
  const currentConfig = (manager as unknown as { config: { autoSaveInterval: number } }).config;
  Object.assign(manager, {
    config: { ...currentConfig, databasePath: directory },
    gameIdentity: { gameId: 'integration-fixture', turn: 40, activePlayerId: 0 },
  });

  await manager.loadKnowledge('integration-fixture');
  const store = manager.getStore();
  for (const player of [
    { Key: 0, TeamID: 0, Civilization: 'Rome', Leader: 'Augustus', IsHuman: 1, IsMajor: 1 },
    { Key: 1, TeamID: 1, Civilization: 'Greece', Leader: 'Alexander', IsHuman: 0, IsMajor: 1 },
    { Key: 2, TeamID: 2, Civilization: 'Japan', Leader: 'Oda', IsHuman: 0, IsMajor: 1 },
  ]) {
    await store.storePublicKnowledge('PlayerInformations', player.Key, player);
  }

  return async () => {
    try {
      await manager.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
