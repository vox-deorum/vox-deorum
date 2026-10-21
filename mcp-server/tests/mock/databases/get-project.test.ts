/**
 * Coverage for project listings and full reports used by the files-mode reference, and for the
 * projects that technology and policy reports say they unlock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DB } from '../../../src/database/database.js';
import { gameDatabase } from '../../../src/server.js';
import createGetProjectTool, { getProject } from '../../../src/tools/databases/get-project.js';
import { getTechnology } from '../../../src/tools/databases/get-technology.js';
import { getPolicy } from '../../../src/tools/databases/get-policy.js';
import { wrapResults } from '../../../src/utils/mcp.js';

vi.mock('../../../src/server.js', () => ({
  gameDatabase: { getDatabase: vi.fn(), localizeObjects: vi.fn() },
}));

/** Tables and rows shared by the listing and full-report tests. */
const schema = `
  CREATE TABLE Projects (Type TEXT, Description TEXT, Help TEXT, Strategy TEXT, Cost INTEGER, TechPrereq TEXT,
    CivilizationType TEXT, VictoryPrereq TEXT, IsRepeatable INTEGER, MaxGlobalInstances INTEGER,
    MaxTeamInstances INTEGER, MaxPlayerInstances INTEGER, PolicyType TEXT, CultureBranchesRequired INTEGER);
  CREATE TABLE Project_Prereqs (ProjectType TEXT, PrereqProjectType TEXT, AmountNeeded INTEGER);
  CREATE TABLE Technologies (Type TEXT, Description TEXT, Era TEXT);
  CREATE TABLE Eras (Type TEXT);
  CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT);
  CREATE TABLE Victories (Type TEXT, Description TEXT);
  CREATE TABLE Policies (Type TEXT, Description TEXT, Help TEXT, Level INTEGER, PolicyBranchType TEXT);
  CREATE TABLE PolicyBranchTypes (Type TEXT, Description TEXT, Help TEXT, EraPrereq TEXT, FreePolicy TEXT);
  CREATE TABLE Policy_PrereqPolicies (PolicyType TEXT, PrereqPolicy TEXT);
  CREATE TABLE Technology_PrereqTechs (TechType TEXT, PrereqTech TEXT);
  CREATE TABLE Units (Description TEXT, PrereqTech TEXT);
  CREATE TABLE Buildings (Description TEXT, BuildingClass TEXT, PrereqTech TEXT);
  CREATE TABLE BuildingClasses (Type TEXT, MaxGlobalInstances INTEGER, MaxPlayerInstances INTEGER);
  CREATE TABLE Builds (ImprovementType TEXT, PrereqTech TEXT);
  CREATE TABLE Improvements (Type TEXT, Description TEXT);
  CREATE TABLE Resources (Description TEXT, TechReveal TEXT);
  INSERT INTO Policies VALUES ('POLICY_CIVIL_ENGINEERS', 'Civil Engineers', 'Faster improvements.', 1, NULL);
  INSERT INTO Policies VALUES ('POLICY_LIBERTY', 'Liberty', 'Opens Liberty.', 0, NULL);
  INSERT INTO Technologies VALUES ('TECH_ROCKETRY', 'Rocketry', 'ERA_MODERN');
  INSERT INTO Technologies VALUES ('TECH_MACHINERY', 'Machinery', 'ERA_MEDIEVAL');
  INSERT INTO Eras VALUES ('ERA_MODERN');
  INSERT INTO Eras VALUES ('ERA_MEDIEVAL');
  INSERT INTO Civilizations VALUES ('CIVILIZATION_MONGOL', 'Mongolia');
  INSERT INTO Victories VALUES ('VICTORY_SPACE_RACE', 'Science Victory');
  INSERT INTO Victories VALUES ('VICTORY_CULTURAL', 'Cultural Victory');
  INSERT INTO Projects VALUES ('PROJECT_APOLLO_PROGRAM', 'Apollo Program', 'Unlocks spaceship parts.', NULL, 1500, 'TECH_ROCKETRY', NULL, 'VICTORY_SPACE_RACE', 0, -1, 1, -1, NULL, 0);
  INSERT INTO Projects VALUES ('PROJECT_SS_BOOSTER', 'SS Booster', NULL, NULL, 1500, 'TECH_ROCKETRY', NULL, 'VICTORY_SPACE_RACE', 0, -1, 3, -1, NULL, 0);
  INSERT INTO Projects VALUES ('PROJECT_UTOPIA_PROJECT', 'Citizen Earth Protocol', 'Win a Cultural Victory.', NULL, 6000, NULL, NULL, 'VICTORY_CULTURAL', 0, -1, 1, -1, NULL, 0);
  INSERT INTO Projects VALUES ('PROJECT_PUBLIC_WORKS', 'Public Works', 'Reduces unhappiness.', NULL, 300, 'TECH_MACHINERY', NULL, NULL, 1, -1, -1, -1, 'POLICY_CIVIL_ENGINEERS', 2);
  INSERT INTO Projects VALUES ('PROJECT_YASSA', 'Yassa', 'Mongol laws.', NULL, 0, NULL, 'CIVILIZATION_MONGOL', NULL, 0, -1, -1, 1, NULL, NULL);
  INSERT INTO Projects VALUES ('PROJECT_SS_ENGINE', 'SS Engine', NULL, NULL, -1, 'TECH_ROCKETRY', NULL, 'VICTORY_SPACE_RACE', 0, -1, 1, -1, 'POLICY_CIVIL_ENGINEERS', 0);
  INSERT INTO Project_Prereqs VALUES ('PROJECT_SS_BOOSTER', 'PROJECT_APOLLO_PROGRAM', 1);
  INSERT INTO Project_Prereqs VALUES ('PROJECT_SS_BOOSTER', 'PROJECT_PUBLIC_WORKS', 2);
`;

describe('get-project', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(schema);
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
    vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async rows => rows);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  describe('listing via MCP', () => {
    let client: Client;
    let server: McpServer;

    beforeEach(async () => {
      const tool = createGetProjectTool();
      server = new McpServer({ name: 'project-test', version: '1.0.0' });
      server.registerTool(tool.name, {
        inputSchema: tool.inputSchema.shape,
        outputSchema: tool.getOutputSchema().shape,
      }, async args => wrapResults(await tool.execute(args)));
      client = new Client({ name: 'project-test-client', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    });

    afterEach(async () => {
      await client.close();
      await server.close();
    });

    it('should list every buildable project, including ones without help text or a technology, and leave out unbuildable ones', async () => {
      const result = await client.callTool({ name: 'get-project', arguments: { MaxResults: 5000 } });

      expect(result.isError).not.toBe(true);
      const { Count, Items } = result.structuredContent as { Count: number; Items: Record<string, unknown>[] };
      expect(Count).toBe(5);
      expect(Items.map(item => item.Type)).not.toContain('PROJECT_SS_ENGINE');
      expect(Items.find(item => item.Type === 'PROJECT_SS_BOOSTER')).toMatchObject({ Help: '', PrereqTech: 'Rocketry', Era: 'Modern' });
      expect(Items.find(item => item.Type === 'PROJECT_UTOPIA_PROJECT')).toMatchObject({ PrereqTech: null, Era: null });
    });
  });

  describe('full report', () => {
    it('should name prerequisite projects, with a count when more than one is needed, and the victory', async () => {
      const booster = await getProject('PROJECT_SS_BOOSTER');
      expect(booster.PrereqProjects.sort()).toEqual(['Apollo Program', 'Public Works x2']);
      expect(booster).toMatchObject({ Victory: 'Science Victory', PrereqTech: 'Rocketry', Era: 'Modern', MaxTeamInstances: 3 });
    });

    it('should report a victory project without a technology as having no era', async () => {
      expect(await getProject('PROJECT_UTOPIA_PROJECT')).toMatchObject({ Victory: 'Cultural Victory', PrereqTech: null, Era: null });
    });

    it('should report a repeatable project with no victory or prerequisite projects', async () => {
      expect(await getProject('PROJECT_PUBLIC_WORKS')).toMatchObject({ IsRepeatable: true, Victory: null, PrereqProjects: [] });
    });

    it('should name a required policy and branch count, and report neither when a project has none', async () => {
      expect(await getProject('PROJECT_PUBLIC_WORKS')).toMatchObject({ PrereqPolicy: 'Civil Engineers', PolicyBranchesRequired: 2 });
      expect(await getProject('PROJECT_APOLLO_PROGRAM')).toMatchObject({ PrereqPolicy: null, PolicyBranchesRequired: null });
      expect(await getProject('PROJECT_YASSA')).toMatchObject({ PrereqPolicy: null, PolicyBranchesRequired: null });
    });

    it('should name the civilization of a unique project and its per-player limit', async () => {
      expect(await getProject('PROJECT_YASSA')).toMatchObject({ UniqueOf: 'Mongolia', MaxPlayerInstances: 1 });
    });

    it('should throw for an unknown project', async () => {
      await expect(getProject('PROJECT_MISSING')).rejects.toThrow();
    });
  });

  describe('projects unlocked by technologies and policies', () => {
    it('should list the buildable projects a technology unlocks', async () => {
      expect((await getTechnology('TECH_ROCKETRY')).ProjectsUnlocked.sort()).toEqual(['Apollo Program', 'SS Booster']);
    });

    it('should list the buildable projects a policy unlocks, and none for other policies', async () => {
      expect((await getPolicy('POLICY_CIVIL_ENGINEERS')).ProjectsUnlocked).toEqual(['Public Works']);
      expect((await getPolicy('POLICY_LIBERTY')).ProjectsUnlocked).toEqual([]);
    });
  });
});
