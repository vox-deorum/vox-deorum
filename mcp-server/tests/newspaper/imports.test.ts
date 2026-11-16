import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// These imports must never be reached by the offline query graph.
vi.mock('../../src/server.js', () => { throw new Error('Offline code loaded server startup'); });
vi.mock('../../src/knowledge/store.js', () => { throw new Error('Offline code loaded the live store'); });
vi.mock('../../src/knowledge/getters/player-summary.js', () => { throw new Error('Offline code loaded a live getter'); });

describe('offline import boundary', () => {
  it('should keep the source runtime module graph free of live services, getters and tools', async () => {
    const visited = new Set<string>();
    /** Follow emitted runtime imports so type-only schema dependencies remain allowed. */
    async function inspect(url: URL): Promise<void> {
      if (visited.has(url.href)) return;
      visited.add(url.href);
      expect(url.pathname).not.toMatch(/\/src\/(?:server\.ts|knowledge\/(?:store\.ts|getters\/)|tools\/|bridge\/)/);
      const source = await readFile(url, 'utf8');
      const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
      for (const imported of ts.preProcessFile(emitted).importedFiles) {
        if (imported.fileName.startsWith('.')) await inspect(new URL(imported.fileName.replace(/\.js$/, '.ts'), url));
      }
    }
    await inspect(new URL('../../src/newspaper/queries.ts', import.meta.url));
  });

  it('should load the query, history and projection without live services', async () => {
    expect((await import('../../src/newspaper/queries.js')).queryNewspaperEvidence).toBeTypeOf('function');
    expect((await import('../../src/knowledge/history.js')).readEvents).toBeTypeOf('function');
    expect((await import('../../src/newspaper/projection.js')).projectNewspaperEvent).toBeTypeOf('function');
  });

  it('should load evidence contracts without database runtime dependencies', async () => {
    vi.resetModules();
    vi.doMock('kysely', () => { throw new Error('Contracts loaded a database dependency'); });
    const { newspaperEvidenceRequestSchema } = await import('../../src/newspaper/evidence.js');
    expect(newspaperEvidenceRequestSchema.safeParse({ receiverPlayerID: 0, previousCheckTurn: -1, cutoffTurn: 0 }).success).toBe(true);
    vi.doUnmock('kysely');
  });
});
