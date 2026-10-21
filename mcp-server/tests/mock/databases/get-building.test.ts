/** Regression coverage for building listings and full reports used by the files-mode reference. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DB } from '../../../src/database/database.js';
import { gameDatabase } from '../../../src/server.js';
import createGetBuildingTool, { getBuilding } from '../../../src/tools/databases/get-building.js';
import { wrapResults } from '../../../src/utils/mcp.js';

vi.mock('../../../src/server.js', () => ({
  gameDatabase: { getDatabase: vi.fn(), getGeneration: vi.fn(() => 0), localizeObjects: vi.fn() },
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

describe('get-building full report', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE Buildings (Type TEXT, Description TEXT, Help TEXT, Strategy TEXT, Cost INTEGER, PrereqTech TEXT, BuildingClass TEXT, Happiness INTEGER, Defense INTEGER, ExtraCityHitPoints INTEGER, GoldMaintenance INTEGER);
      CREATE TABLE BuildingClasses (Type TEXT, Description TEXT, DefaultBuilding TEXT, MaxPlayerInstances INTEGER, MaxGlobalInstances INTEGER);
      CREATE TABLE Building_ClassesNeededInCity (BuildingType TEXT, BuildingClassType TEXT);
      CREATE TABLE Technologies (Type TEXT, Description TEXT, Era TEXT);
      CREATE TABLE Civilization_BuildingClassOverrides (BuildingType TEXT, CivilizationType TEXT);
      CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT);
      CREATE TABLE Eras (Type TEXT);
      CREATE TABLE Corporations (Type TEXT, Description TEXT, HeadquartersBuildingClass TEXT, OfficeBuildingClass TEXT, FranchiseBuildingClass TEXT);
      CREATE TABLE Belief_BuildingClassFaithPurchase (BeliefType TEXT, BuildingClassType TEXT);
      CREATE TABLE Beliefs (Type TEXT, ShortDescription TEXT);
      INSERT INTO BuildingClasses VALUES ('BUILDINGCLASS_TEMPLE', 'Temple class', 'BUILDING_TEMPLE', -1, -1);
      INSERT INTO BuildingClasses VALUES ('BUILDINGCLASS_STEEL_HEADQUARTERS', 'Steel headquarters class', 'BUILDING_STEEL_HEADQUARTERS', -1, -1);
      INSERT INTO BuildingClasses VALUES ('BUILDINGCLASS_STEEL_OFFICE', 'Steel office class', 'BUILDING_STEEL_OFFICE', -1, -1);
      INSERT INTO BuildingClasses VALUES ('BUILDINGCLASS_MONUMENT', 'Monument class', 'BUILDING_MONUMENT', -1, -1);
      INSERT INTO Civilizations VALUES ('CIVILIZATION_MAYA', 'Maya');
      INSERT INTO Buildings VALUES ('BUILDING_TEMPLE', 'Temple', NULL, NULL, 100, NULL, 'BUILDINGCLASS_TEMPLE', 0, 0, 0, 2);
      INSERT INTO Buildings VALUES ('BUILDING_MAYA_PYRAMID', 'Pyramid', NULL, NULL, 100, NULL, 'BUILDINGCLASS_TEMPLE', 0, 0, 0, 2);
      INSERT INTO Buildings VALUES ('BUILDING_STEEL_HEADQUARTERS', 'Steel Works', NULL, NULL, 200, NULL, 'BUILDINGCLASS_STEEL_HEADQUARTERS', 0, 0, 0, 4);
      INSERT INTO Buildings VALUES ('BUILDING_STEEL_OFFICE', 'Steel Office', NULL, NULL, 100, NULL, 'BUILDINGCLASS_STEEL_OFFICE', 0, 0, 0, 1);
      INSERT INTO Buildings VALUES ('BUILDING_MONUMENT', 'Monument', NULL, NULL, 65, NULL, 'BUILDINGCLASS_MONUMENT', 1, 0, 0, 0);
      INSERT INTO Civilization_BuildingClassOverrides VALUES ('BUILDING_MAYA_PYRAMID', 'CIVILIZATION_MAYA');
      INSERT INTO Corporations VALUES ('CORPORATION_STEEL', 'Steel', 'BUILDINGCLASS_STEEL_HEADQUARTERS', 'BUILDINGCLASS_STEEL_OFFICE', 'BUILDINGCLASS_STEEL_FRANCHISE');
      INSERT INTO Beliefs VALUES ('BELIEF_SKY_GOD', 'God of the Open Sky');
      INSERT INTO Beliefs VALUES ('BELIEF_HARVEST_GOD', 'God of the Harvest');
      INSERT INTO Belief_BuildingClassFaithPurchase VALUES ('BELIEF_SKY_GOD', 'BUILDINGCLASS_TEMPLE');
      INSERT INTO Belief_BuildingClassFaithPurchase VALUES ('BELIEF_HARVEST_GOD', 'BUILDINGCLASS_TEMPLE');
    `);
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  it('should name the standard building a unique building replaces', async () => {
    expect(await getBuilding('BUILDING_MAYA_PYRAMID')).toMatchObject({ UniqueOf: 'Maya', Replaces: 'Temple' });
  });

  it('should leave Replaces empty for standard buildings', async () => {
    expect((await getBuilding('BUILDING_TEMPLE')).Replaces).toBeNull();
  });

  describe('corporations and beliefs', () => {
    it('should name the corporation whose headquarters or office class a building belongs to', async () => {
      expect((await getBuilding('BUILDING_STEEL_HEADQUARTERS')).Corporation).toBe('Steel');
      expect((await getBuilding('BUILDING_STEEL_OFFICE')).Corporation).toBe('Steel');
    });

    it('should list the beliefs that unlock faith purchase for the building class', async () => {
      const beliefs = (await getBuilding('BUILDING_TEMPLE')).UnlockedByBeliefs;
      expect(beliefs).toHaveLength(2);
      expect(beliefs.sort()).toEqual(['God of the Harvest', 'God of the Open Sky']);
    });

    it('should report no corporation and no beliefs for a plain building', async () => {
      const monument = await getBuilding('BUILDING_MONUMENT');
      expect(monument.Corporation).toBeNull();
      expect(monument.UnlockedByBeliefs).toEqual([]);
    });
  });
});
