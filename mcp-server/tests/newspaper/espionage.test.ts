import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence, summary } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

/** Build one recorded agent roster entry. */
function spy(role: string, location: string, state: string, network: number) {
  return { Role: role, Location: location, State: state, Network: network, NetworkPerTurn: 20 };
}

/** Insert a dated city observation with the columns the newspaper reads. */
async function city(id: number, key: number, turn: number, owner: string, name: string, level: number,
  values: Record<string, unknown> = {}) {
  await db.insertInto('CityInformations').values({
    ID: id, Key: key, Turn: turn, Version: 1, IsLatest: 1, CreatedAt: 3000 + id, Payload: {}, Changes: [],
    Player0: level, Owner: owner, Name: name, X: key === 42 ? 0 : key, Y: 4, Population: 5, MajorityReligion: null,
    DefenseStrength: 10, HitPoints: 0, MaxHitPoints: 100, IsPuppet: 0, IsCapital: 0, IsOccupied: 0, IsCoastal: 0,
    FoodStored: 0, FoodPerTurn: 0, ProductionStored: 0, ProductionPerTurn: 0, GoldPerTurn: 0,
    SciencePerTurn: 0, CulturePerTurn: 0, FaithPerTurn: 0, TourismPerTurn: 0, HappinessDelta: 0,
    RazingTurns: 0, ResistanceTurns: 0, BuildingCount: 0, Wonders: [], ImportantBuildings: [], GreatWorkCount: 0,
    ProductionTurnsLeft: 0, ...values
  } as any).execute();
}

describe('passive espionage presence', () => {
  it('derives presence for known hosts and separates a clear miss from unrecorded or ambiguous evidence', async () => {
    await city(20, 40, 10, 'Civ0', 'Home', 2, { IsCapital: 1 });
    await city(22, 44, 10, 'Civ2', 'Outpost', 1, { IsCapital: 1 });
    await city(23, 45, 10, 'Civ1', 'Border', 1);
    await summary(db, 20, 0, 11, 2, {
      DiplomatPoints: {},
      Spies: {
        AgentA: spy('Spy', 'Port (Civ1)', 'Collecte de renseignements', 500),
        AgentB: spy('Spy', 'Border (Civ1)', 'Unrecognized local state', -1),
        Envoy: spy('Diplomat', 'Port (Civ1)', 'Diplomatie', 200)
      }
    });
    await summary(db, 21, 1, 11, 1, { Spies: {}, PolicyBranches: { Tradition: ['A', 'B'] } });
    await summary(db, 22, 2, 11, 1, { PolicyBranches: { Liberty: ['A'] } });

    const result = await queryNewspaperEvidence(db, { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 11 });

    expect(result.cities.find(row => row.subjectID === 42)?.values).toMatchObject({ OurSpyPresent: true, OurSpyPoints: 500 });
    expect(result.cities.find(row => row.subjectID === 40)?.values).toMatchObject({ OurSpyPresent: false, OurSpyPoints: 0 });
    expect(result.players.find(row => row.subjectID === 1)?.values).toMatchObject({
      OurDiplomatThere: true,
      OurDiplomatPoints: 200,
      TheirDiplomatHere: false,
      PolicyBranches: { Tradition: ['A', 'B'] }
    });
    expect(result.cities.find(row => row.subjectID === 44)?.values).toMatchObject({ OurSpyPresent: false, OurSpyPoints: 0 });
    expect(result.players.find(row => row.subjectID === 2)?.values).toMatchObject({ OurDiplomatThere: false, OurDiplomatPoints: 0 });
    expect(result.players.find(row => row.subjectID === 2)?.values).not.toHaveProperty('TheirDiplomatHere');
    expect(result.cities.find(row => row.subjectID === 45)?.values).not.toHaveProperty('OurSpyPresent');
    expect(result.cities.find(row => row.subjectID === 45)?.values).not.toHaveProperty('OurSpyPoints');
  });

  it('leaves presence unknown when the relevant roster was not recorded', async () => {
    await city(20, 40, 10, 'Civ0', 'Home', 2, { IsCapital: 1 });
    await summary(db, 20, 0, 11, 2, { DiplomatPoints: {} });
    await summary(db, 21, 1, 11, 1, { PolicyBranches: { Tradition: ['A', 'B'] } });

    const result = await queryNewspaperEvidence(db, { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 11 });

    expect(result.cities.find(row => row.subjectID === 42)?.values).not.toHaveProperty('OurSpyPresent');
    expect(result.cities.find(row => row.subjectID === 42)?.values).not.toHaveProperty('OurSpyPoints');
    expect(result.players.find(row => row.subjectID === 1)?.values).not.toHaveProperty('OurDiplomatThere');
    expect(result.players.find(row => row.subjectID === 1)?.values).not.toHaveProperty('OurDiplomatPoints');
    expect(result.players.find(row => row.subjectID === 1)?.values).not.toHaveProperty('TheirDiplomatHere');
    expect(result.players.find(row => row.subjectID === 1)?.values).toMatchObject({ PolicyBranches: { Tradition: ['A', 'B'] } });
  });
});

describe('espionage city detail', () => {
  it('exposes foreign city detail without a spy and reports OurSpyPresent and OurSpyPoints from the roster', async () => {
    await city(22, 42, 11, 'Civ1', 'Port', 1, { IsCapital: 1, ProductionPerTurn: 6, FoodPerTurn: 4 });
    await summary(db, 20, 0, 11, 2, { DiplomatPoints: {}, Spies: {} });
    const request = { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 11 };

    const withoutAgent = await queryNewspaperEvidence(db, request);
    expect(withoutAgent.cities.find(row => row.subjectID === 42)?.values)
      .toMatchObject({ OurSpyPresent: false, OurSpyPoints: 0, ProductionPerTurn: 6, FoodPerTurn: 4 });

    await summary(db, 21, 0, 12, 2, {
      DiplomatPoints: {},
      Spies: { Agent: spy('Spy', 'Port (Civ1)', 'Collecte de renseignements', 500) }
    });
    const withAgent = await queryNewspaperEvidence(db, { ...request, cutoffTurn: 12 });
    expect(withAgent.cities.find(row => row.subjectID === 42)?.values)
      .toMatchObject({ OurSpyPresent: true, OurSpyPoints: 500, ProductionPerTurn: 6 });
  });

  it('exposes foreign city detail while a duplicate city name leaves spy presence unknown', async () => {
    await city(22, 40, 10, 'Civ0', 'Home', 2, { FoodPerTurn: 4 });
    await city(23, 41, 10, 'Civ3', 'Ally', 2, { FoodPerTurn: 5 });
    await city(24, 44, 10, 'Civ1', 'Port', 0);
    await summary(db, 20, 0, 10, 2, {
      Spies: { Agent: spy('Spy', 'Port (Civ1)', 'Gathering Intelligence', 600) }
    });

    const evidence = await queryNewspaperEvidence(db, { receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 10 });
    expect(evidence.cities.find(row => row.subjectID === 40)?.values.FoodPerTurn).toBe(4);
    expect(evidence.cities.find(row => row.subjectID === 41)?.values.FoodPerTurn).toBe(5);
    const port = evidence.cities.find(row => row.subjectID === 42)!;
    expect(port.values.FoodPerTurn).toBe(999);
    expect(port.values).not.toHaveProperty('OurSpyPresent');
    expect(port.values).not.toHaveProperty('OurSpyPoints');
  });
});

describe('espionage policy insight', () => {
  it('reports an inbound vassal diplomat and exposes policy names to a visible player', async () => {
    await city(20, 40, 10, 'Civ0', 'Home', 2, { IsCapital: 1 });
    await summary(db, 20, 0, 11, 2, { DiplomatPoints: {}, Spies: {} });
    await summary(db, 21, 1, 11, 1, {
      PolicyBranches: { Tradition: ['A', 'B'] },
      Spies: { Envoy: spy('Vassal Diplomat', 'Home (Civ0)', 'Diplomatie', 0) }
    });

    const result = await queryNewspaperEvidence(db, { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 11 });

    expect(result.players.find(row => row.subjectID === 1)?.values).toMatchObject({
      TheirDiplomatHere: true,
      OurDiplomatThere: false,
      OurDiplomatPoints: 0,
      PolicyBranches: { Tradition: ['A', 'B'] }
    });
  });

  it('opens a witnessed policy adoption only from a diplomat roster on an earlier turn', async () => {
    await city(22, 42, 8, 'Civ1', 'Port', 1, { IsCapital: 1 });
    await event(db, 200, 9, 'PlayerAdoptPolicy', { PlayerID: 1, PolicyID: 'Aristocracy' }, 2);
    await summary(db, 20, 0, 9, 2, {
      DiplomatPoints: {},
      Spies: { Agent: spy('Diplomat', 'Port (Civ1)', 'Schmoozing', 200) }
    });
    await summary(db, 21, 0, 10, 2, { DiplomatPoints: {}, Spies: {}, CreatedAt: 1020 });
    const request = { receiverPlayerID: 0, previousCheckTurn: 8, cutoffTurn: 10 };

    expect((await queryNewspaperEvidence(db, request)).events.some(row => row.source.id === 200)).toBe(false);

    await summary(db, 22, 0, 8, 2, {
      DiplomatPoints: {},
      Spies: { Agent: spy('Diplomat', 'Port (Civ1)', 'Schmoozing', 200) }
    });
    const result = await queryNewspaperEvidence(db, request);

    expect(result.events.find(row => row.source.id === 200)).toMatchObject({
      type: 'PlayerAdoptPolicy',
      values: { PlayerID: 1, Policy: 'Aristocracy' },
      relatedSources: [{ table: 'PlayerSummaries', id: 22, turn: 8 }, { table: 'CityInformations', id: 22, turn: 8 }]
    });
  });
});
