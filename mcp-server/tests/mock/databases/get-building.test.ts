/** Regression coverage for building listings used by the files-mode reference. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DB } from '../../../src/database/database.js';
import { gameDatabase } from '../../../src/server.js';
import createGetBuildingTool from '../../../src/tools/databases/get-building.js';
import { wrapResults } from '../../../src/utils/mcp.js';

vi.mock('../../../src/server.js', () => ({
  gameDatabase: { getDatabase: vi.fn(), localizeObjects: vi.fn() },
}));

describe('get-building reference listing via MCP', () => {
  let db: Kysely<DB>;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE Buildings (Type TEXT, Description TEXT, Help TEXT, Cost INTEGER, PrereqTech TEXT);
      CREATE TABLE Technologies (Type TEXT, Description TEXT, Era TEXT);
      CREATE TABLE Civilization_BuildingClassOverrides (BuildingType TEXT, CivilizationType TEXT);
      CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT);
      CREATE TABLE Eras (Type TEXT);
      INSERT INTO Buildings VALUES ('BUILDING_WITH_HELP', 'Building with help', 'Existing help', 80, NULL);
      INSERT INTO Buildings VALUES ('BUILDING_WITHOUT_HELP', 'Building without help', NULL, 0, NULL);
    `);
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
    vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async rows => rows);

    const tool = createGetBuildingTool();
    server = new McpServer({ name: 'building-test', version: '1.0.0' });
    server.registerTool(tool.name, {
      inputSchema: tool.inputSchema.shape,
      outputSchema: tool.getOutputSchema().shape,
    }, async args => wrapResults(await tool.execute(args)));
    client = new Client({ name: 'building-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
    await db.destroy();
  });

  it('should return a schema-valid complete listing when a building has no help text', async () => {
    const result = await client.callTool({ name: 'get-building', arguments: { MaxResults: 5000 } });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      Count: 2,
      Items: [
        { Type: 'BUILDING_WITH_HELP', Help: 'Existing help' },
        { Type: 'BUILDING_WITHOUT_HELP', Help: '' },
      ],
    });
  });
});
