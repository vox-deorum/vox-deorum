import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../src/utils/config.js';
import { knowledgeManager } from '../../src/server.js';
import type { KnowledgeStore } from '../../src/knowledge/store.js';
import { isolateExternalManagers, readPublishedUrl } from '../fixtures/server-process.js';
import { createEvidenceDatabase, openEvidenceRecording, seedEvidence } from './fixtures.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';

describe('newspaper MCP transports', () => {
  it('should match standalone read-only facts through HTTP and stdio without changing the recording', async () => {
    const previous = { transport: { ...config.transport }, pipe: config.bridgeService.eventPipe.enabled, shutdown: process.env.MCP_SHUTDOWN_URL_FILE };
    const directory = await mkdtemp(path.join(tmpdir(), 'vd-newspaper-'));
    const filename = path.join(directory, 'recording.db');
    const shutdownFile = path.join(directory, 'shutdown-url.txt');
    const writer = await createEvidenceDatabase(filename);
    await seedEvidence(writer);
    // Older recordings remain readable without creating the new event index.
    await writer.schema.dropIndex('idx_gameevents_turn').execute();
    await writer.destroy();
    const originalBytes = await readFile(filename);
    const db = openEvidenceRecording(filename);
    const request = { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, comparisonRange: { fromTurn: 5, toTurn: 10 } };
    const expected = await queryNewspaperEvidence(db, request);
    const restoreManagers = await isolateExternalManagers();
    vi.spyOn(knowledgeManager, 'getStore').mockReturnValue({ getDatabase: () => db } as KnowledgeStore);
    vi.spyOn(knowledgeManager, 'getTurn').mockReturnValue(11);
    let closeHttp: (() => Promise<void>) | undefined;
    let httpClient: Client | undefined;
    let stdioClient: Client | undefined;
    try {
      config.transport.type = 'http';
      config.transport.host = '127.0.0.1';
      config.transport.port = 0;
      config.bridgeService.eventPipe.enabled = false;
      process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;
      const { startHttpServer } = await import('../../src/http.js');
      closeHttp = await startHttpServer(false);
      const shutdownUrl = await readPublishedUrl(shutdownFile);
      httpClient = new Client({ name: 'newspaper-http', version: '1.0.0' });
      await httpClient.connect(new StreamableHTTPClientTransport(new URL(shutdownUrl.replace(/\/shutdown$/, '/mcp'))), { timeout: 15000 });
      stdioClient = new Client({ name: 'newspaper-stdio', version: '1.0.0' });
      const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      await stdioClient.connect(new StdioClientTransport({
        command: process.execPath, args: ['--import', 'tsx', fileURLToPath(new URL('./start-stdio.ts', import.meta.url))],
        cwd: process.cwd(), env: { ...environment, NEWSPAPER_FIXTURE_DB: filename }
      }), { timeout: 15000 });
      for (const client of [httpClient, stdioClient]) {
        const catalog = await client.listTools();
        expect(catalog.tools.map(tool => tool.name)).toContain('get-newspaper-evidence');
        expect(catalog.tools.find(tool => tool.name === 'get-newspaper-evidence')?._meta?.autoComplete).toEqual(['PlayerID']);
        const { receiverPlayerID, ...range } = request;
        const args = { ...range, PlayerID: receiverPlayerID };
        const result = await client.callTool({ name: 'get-newspaper-evidence', arguments: args });
        expect(result.isError).not.toBe(true);
        expect(readToolValue(result)).toEqual(expected);
        const invalid = await client.callTool({ name: 'get-newspaper-evidence', arguments: { ...args, cutoffTurn: 4 } });
        expect(invalid.isError).toBe(true);
        for (const cutoffTurn of [11, 12]) {
          const incomplete = await client.callTool({ name: 'get-newspaper-evidence', arguments: { ...args, cutoffTurn } });
          expect(incomplete.isError).toBe(true);
        }
      }
      expect(await readFile(filename)).toEqual(originalBytes);
    } finally {
      await stdioClient?.close();
      await httpClient?.close();
      await closeHttp?.();
      await db.destroy();
      vi.restoreAllMocks();
      restoreManagers();
      Object.assign(config.transport, previous.transport);
      config.bridgeService.eventPipe.enabled = previous.pipe;
      if (previous.shutdown === undefined) delete process.env.MCP_SHUTDOWN_URL_FILE;
      else process.env.MCP_SHUTDOWN_URL_FILE = previous.shutdown;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});

/** Decode a real MCP result while keeping comparison independent of text rendering. */
function readToolValue(result: any): unknown {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find((item: { type: string }) => item.type === 'text')?.text;
  if (!text) throw new Error('Missing MCP evidence result');
  return JSON.parse(text);
}
