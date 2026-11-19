import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../src/knowledge/schema/base.js';
import { newspaperEvidenceSchema } from '../../src/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../src/newspaper/queries.js';
import { createEvidenceDatabase, event, seedEvidence } from './fixtures.js';

let db: Kysely<KnowledgeDatabase>;
beforeEach(async () => { db = await createEvidenceDatabase(); await seedEvidence(db); });
afterEach(async () => { await db.destroy(); });

/** Build the recorded operation payload used by one test row. */
function operationPayload(values: Record<string, unknown> = {}) {
  return {
    SourcePlayerID: 0, TargetPlayerID: 1, SpyResult: 'Undetected', TechID: 0, AmountStolen: 0,
    CityX: 2, CityY: 3, City: { Owner: 'Civ1', City: 'Port', CityID: 42 }, ...values
  };
}

/** Record one operation with explicit source access. */
async function operation(id: number, turn: number, values: Record<string, unknown> = {}, level = 1) {
  await event(db, id, turn, 'EspionageResult', operationPayload(values), level);
}

/** Record one player turn marker. */
async function playerTurn(id: number, turn: number, playerID: number, level = 1) {
  await event(db, id, turn, 'PlayerDoTurn', { PlayerID: playerID }, level);
}

/** Record one research gain event. */
async function techGain(id: number, turn: number, teamID: number, tech: unknown, change = 1) {
  await event(db, id, turn, 'TeamTechResearched', { TeamID: teamID, TechID: tech, ChangeAmount: change });
}

/** Record one election result row. */
async function election(id: number, turn: number, type: 'ElectionResultSuccess' | 'ElectionResultFailure',
  values: Record<string, unknown>, level = 1) {
  await event(db, id, turn, type, values, level);
}

/** Query the seeded recording from the receiver's perspective. */
function request(overrides: Record<string, unknown> = {}) {
  return { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 11, ...overrides };
}

describe('espionage operation evidence', () => {
  it('should project the source perspective regardless of generic visibility and keep only permitted fields', async () => {
    await operation(300, 11, { SpyResult: 'Undetected' }, 0);

    const result = await queryNewspaperEvidence(db, request());
    const projected = result.events.find(row => row.source.id === 300);

    expect(projected).toMatchObject({
      type: 'EspionageResult',
      source: { table: 'GameEvents', id: 300, turn: 11 },
      values: {
        Perspective: 'source', SpyResult: 'Undetected', SourcePlayerID: 0, TargetPlayerID: 1,
        CityX: 2, CityY: 3, CityName: 'Port'
      }
    });
    expect(projected?.values).not.toHaveProperty('TechID');
    expect(projected?.values).not.toHaveProperty('AmountStolen');
    expect(projected).not.toHaveProperty('reportTurn');
    expect(newspaperEvidenceSchema.parse(result)).toEqual(result);
  });

  it('should accept recorded names and numeric results in enum order while skipping unknown results', async () => {
    const names = ['Undetected', 'Detected', 'Identified', 'Killed', 'KilledNotIdentified'];
    for (const [index, name] of names.entries()) {
      await operation(300 + index, 11, { SpyResult: index % 2 === 0 ? index : name });
    }
    await operation(310, 11, { SpyResult: 5 });
    await operation(311, 11, { SpyResult: 'None' });

    const result = await queryNewspaperEvidence(db, request());
    const projected = result.events.filter(row => row.type === 'EspionageResult' && row.source.id >= 300);

    expect(projected.map(row => row.source.id)).toEqual([300, 301, 302, 303, 304]);
    expect(projected.map(row => row.values.SpyResult)).toEqual(names);
  });

  it('should publish only to the exact parties, not to teammates or generic visibility witnesses', async () => {
    await db.updateTable('PlayerInformations').set({ TeamID: 0 }).where('Key', '=', 1).execute();
    await operation(300, 11, { SourcePlayerID: 1, TargetPlayerID: 2 }, 2);
    await operation(301, 11, { SourcePlayerID: 2, TargetPlayerID: 1 }, 2);
    await operation(302, 11, { SourcePlayerID: 2, TargetPlayerID: 3 }, 2);

    const result = await queryNewspaperEvidence(db, request());

    expect(result.events.filter(row => row.source.id >= 300 && row.type === 'EspionageResult')).toEqual([]);
  });

  it('should not publish a legacy operation without recorded source and target parties', async () => {
    await event(db, 300, 11, 'EspionageResult',
      { SpyOwnerID: 0, SpyIndex: 1, SpyResult: 'Undetected', CityX: 2, CityY: 3 }, 2);

    const result = await queryNewspaperEvidence(db, request());

    expect(result.events.filter(row => row.type === 'EspionageResult')).toEqual([]);
  });
});

describe('defender operation reports', () => {
  it('should date a defender report at the next player turn and mask an unidentified source', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 11, 0);

    const before = await queryNewspaperEvidence(db, { ...request(), previousCheckTurn: 9, cutoffTurn: 10 });
    expect(before.events.some(row => row.source.id === 300)).toBe(false);

    const result = await queryNewspaperEvidence(db, request());
    const reported = result.events.find(row => row.source.id === 300)!;

    expect(reported).toMatchObject({
      source: { id: 300, turn: 10 },
      reportTurn: 11,
      relatedSources: [{ table: 'GameEvents', id: 320, turn: 11 }],
      values: {
        Perspective: 'target', SpyResult: 'Detected', TargetPlayerID: 0, CityX: 2, CityY: 3, CityName: 'Port'
      }
    });
    expect(reported.values).not.toHaveProperty('SourcePlayerID');
  });

  it('should reveal the source only for identified or killed results and skip an undetected operation', async () => {
    const results = ['Detected', 'KilledNotIdentified', 'Identified', 'Killed', 'Undetected'];
    for (const [index, spyResult] of results.entries()) {
      await operation(300 + index, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: spyResult });
    }
    await playerTurn(320, 11, 0);

    const result = await queryNewspaperEvidence(db, request());
    const reported = (id: number) => result.events.find(row => row.source.id === id);

    expect(reported(300)?.values).not.toHaveProperty('SourcePlayerID');
    expect(reported(301)?.values).not.toHaveProperty('SourcePlayerID');
    expect(reported(302)?.values).toMatchObject({ SourcePlayerID: 1, SpyResult: 'Identified' });
    expect(reported(303)?.values).toMatchObject({ SourcePlayerID: 1, SpyResult: 'Killed' });
    expect(reported(304)).toBeUndefined();
  });

  it('should keep a same-turn marker and cite it without inventing a different report turn', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(310, 10, 0);

    const result = await queryNewspaperEvidence(db, { ...request(), previousCheckTurn: 9, cutoffTurn: 10 });
    const reported = result.events.find(row => row.source.id === 300)!;

    expect(reported).not.toHaveProperty('reportTurn');
    expect(reported.relatedSources).toMatchObject([{ table: 'GameEvents', id: 310, turn: 10 }]);
    const nextWindow = await queryNewspaperEvidence(db, request());
    expect(nextWindow.events.some(row => row.source.id === 300)).toBe(false);
  });

  it('should use the next turn when the defender has not yet taken a turn after the operation', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(290, 10, 0);
    await playerTurn(320, 11, 0);

    const result = await queryNewspaperEvidence(db, request());
    const reported = result.events.find(row => row.source.id === 300)!;

    expect(reported.reportTurn).toBe(11);
    expect(reported.relatedSources).toMatchObject([{ table: 'GameEvents', id: 320, turn: 11 }]);
  });

  it('should require a same or next turn marker for the exact defender', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(310, 10, 1);
    await playerTurn(320, 12, 0);

    expect((await queryNewspaperEvidence(db, { ...request(), cutoffTurn: 12 })).events
      .some(row => row.source.id === 300)).toBe(false);
  });

  it('should keep a report outside the display window out of the result while including it in history', async () => {
    await operation(300, 9, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 10, 0);

    const result = await queryNewspaperEvidence(db, { ...request(), previousCheckTurn: 10, cutoffTurn: 10, historyFromTurn: 9 });

    expect(result.events.some(row => row.source.id === 300)).toBe(false);
    expect(result.history?.events.find(row => row.source.id === 300)).toMatchObject({ source: { turn: 9 }, reportTurn: 10 });
  });

  it('should keep an operation on the display bound out of that window and include it in history', async () => {
    await operation(300, 10, { SpyResult: 'Detected' });

    const result = await queryNewspaperEvidence(db, { ...request(), historyFromTurn: 9 });

    expect(result.events.some(row => row.source.id === 300)).toBe(false);
    expect(result.history?.events.find(row => row.source.id === 300)).toMatchObject({ source: { turn: 10 } });
  });

  it('should skip a report when the operation plot was captured or razed before the marker', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 11, 0);
    await event(db, 310, 11, 'CityCaptureComplete', { OldOwnerID: 0, NewOwnerID: 1, CityX: 2, CityY: 3 });

    expect((await queryNewspaperEvidence(db, request())).events.some(row => row.source.id === 300)).toBe(false);
  });

  it('should keep a report when a loss was at a different plot or outside the reporting interval', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 11, 0);
    await event(db, 290, 10, 'CityCaptureComplete', { OldOwnerID: 2, NewOwnerID: 0, CityX: 2, CityY: 3 });
    await event(db, 310, 11, 'CityRazed', { PlayerID: 1, CityX: 8, CityY: 9 });
    await event(db, 330, 11, 'CityCaptureComplete', { OldOwnerID: 0, NewOwnerID: 1, CityX: 2, CityY: 3 });

    const reported = (await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300);

    expect(reported).toMatchObject({ reportTurn: 11 });
  });

  it('should skip a report when a flip shows the defender lost the old ownership', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 11, 0);
    await event(db, 310, 11, 'CityFlipped', { CityID: 42, OldOwnerID: 0, NewOwnerID: 1, City: { Name: 'Port' } });

    expect((await queryNewspaperEvidence(db, request())).events.some(row => row.source.id === 300)).toBe(false);
  });

  it('should keep a report when flips concerned another owner or another city', async () => {
    await operation(300, 10, { SourcePlayerID: 1, TargetPlayerID: 0, SpyResult: 'Detected' });
    await playerTurn(320, 11, 0);
    await event(db, 310, 11, 'CityFlipped', { CityID: 42, OldOwnerID: 1, NewOwnerID: 2 });
    await event(db, 311, 11, 'CityFlipped', { CityID: 99, OldOwnerID: 0, NewOwnerID: 2, City: { Name: 'Other port' } });

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300))
      .toMatchObject({ reportTurn: 11 });
  });
});

describe('likely stolen technology', () => {
  it('should attach a uniquely matched named gain and cite both rows', async () => {
    await operation(300, 11, { SpyResult: 'Undetected' });
    await techGain(305, 11, 0, 'Civil Service');

    const reported = (await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)!;

    expect(reported.values.Tech).toBe('Civil Service');
    expect(reported.relatedSources).toMatchObject([{ table: 'GameEvents', id: 305, turn: 11 }]);
  });

  it('should attach a gain when the spy was killed', async () => {
    await operation(300, 11, { SpyResult: 'Killed' });
    await techGain(305, 11, 0, 'Civil Service');

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values.Tech)
      .toBe('Civil Service');
  });

  it('should leave the outcome alone without a matching gain, name or positive change', async () => {
    await operation(300, 11, { SpyResult: 'Undetected' });
    await techGain(305, 11, 0, 'None');
    await techGain(306, 11, 0, '');
    await techGain(307, 11, 0, 'Writing', 0);
    await techGain(308, 11, 0, 'Writing', -1);

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values)
      .not.toHaveProperty('Tech');
  });

  it('should require the source recorded team and the ten-ID window', async () => {
    await operation(300, 11, { SpyResult: 'Undetected' });
    await techGain(305, 11, 1, 'Civil Service');

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values)
      .not.toHaveProperty('Tech');

    await db.deleteFrom('GameEvents').where('ID', '=', 305).execute();
    await techGain(311, 11, 0, 'Civil Service');

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values)
      .not.toHaveProperty('Tech');

    await db.deleteFrom('GameEvents').where('ID', '=', 311).execute();
    await techGain(310, 11, 0, 'Civil Service');

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values.Tech)
      .toBe('Civil Service');
  });

  it('should withhold a gain matched by two operations, including an unprojected teammate operation', async () => {
    await db.updateTable('PlayerInformations').set({ TeamID: 0 }).where('Key', '=', 2).execute();
    await operation(300, 11, { SpyResult: 'Undetected' });
    await operation(303, 11, { SourcePlayerID: 2, TargetPlayerID: 1, SpyResult: 'Undetected' });
    await techGain(305, 11, 0, 'Civil Service');

    const result = await queryNewspaperEvidence(db, request());

    expect(result.events.some(row => row.source.id === 303)).toBe(false);
    expect(result.events.find(row => row.source.id === 300)?.values).not.toHaveProperty('Tech');
  });

  it('should withhold a gain when the operation matches two gains', async () => {
    await operation(300, 11, { SpyResult: 'Undetected' });
    await techGain(305, 11, 0, 'Civil Service');
    await techGain(306, 11, 0, 'Theology');

    expect((await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 300)?.values)
      .not.toHaveProperty('Tech');
  });
});

describe('private election evidence', () => {
  it('should report success only to the affected player with a signed gain and resolved city-state', async () => {
    await election(400, 11, 'ElectionResultSuccess', {
      PlayerID: 0, SpyID: 4, Value: 12, CityX: 5, CityY: 6,
      City: { Owner: 'City-State Manila', City: 'Manila', CityID: 9 }
    }, 0);

    const reported = (await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 400)!;

    expect(reported).toMatchObject({
      type: 'ElectionResultSuccess',
      values: { PlayerID: 0, InfluenceChange: 12, CityState: 'Manila', CityX: 5, CityY: 6 }
    });
    expect(reported.values).not.toHaveProperty('SpyID');
    expect(reported.values).not.toHaveProperty('Value');
    expect(reported.values).not.toHaveProperty('City');
  });

  it('should convert a failed election loss and normalize the capital plot', async () => {
    await election(400, 11, 'ElectionResultFailure', {
      PlayerID: 0, SpyID: 4, DiminishAmount: 150, CapitalX: 7, CapitalY: 8,
      Capital: { Owner: 'City-State Manila', City: 'A relocated capital' }
    }, 2);

    const reported = (await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 400)!;

    expect(reported.values).toEqual({
      PlayerID: 0, InfluenceChange: -1.5, CityState: 'Manila', CityX: 7, CityY: 8
    });
  });

  it('should skip a failed election without an assigned spy and a success for another player', async () => {
    await election(400, 11, 'ElectionResultFailure', {
      PlayerID: 0, SpyID: -1, DiminishAmount: 150, CapitalX: 7, CapitalY: 8
    });
    await election(401, 11, 'ElectionResultSuccess', {
      PlayerID: 1, SpyID: 4, Value: 12, CityX: 5, CityY: 6
    }, 2);

    const result = await queryNewspaperEvidence(db, request());

    expect(result.events.some(row => row.source.id === 400 || row.source.id === 401)).toBe(false);
  });

  it('should omit a city-state label when the recorded owner is not a city-state', async () => {
    await election(400, 11, 'ElectionResultSuccess', {
      PlayerID: 0, SpyID: 4, Value: 12, CityX: 5, CityY: 6,
      City: { Owner: 'Civ1', City: 'Port' }
    });

    const reported = (await queryNewspaperEvidence(db, request())).events.find(row => row.source.id === 400)!;

    expect(reported.values).toEqual({ PlayerID: 0, InfluenceChange: 12, CityX: 5, CityY: 6 });
  });
});
