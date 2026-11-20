import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperEvidence, NewspaperSnapshot, NewspaperTacticalZone,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { relationship, snapshot as diplomacySnapshot } from '../../../../helpers/newspaper-diplomacy.js';

let config: EditorialConfig;

/** Record a readable city at a fixed location on the cutoff turn. */
function city(id: number, owner: number, name: string): NewspaperSnapshot {
  return {
    subjectID: id,
    values: { Name: name, OwnerID: owner, X: id, Y: 1 },
    source: { table: 'CityInformations', id: 1000 + id, turn: 10, createdAt: 10000 + id },
  };
}

/** Record one receiver front observation with an optional prior-check reading. */
function zone({
  zoneID, city: cityName, domain, posture, previousPosture,
}: {
  zoneID: number;
  city: string;
  domain: 'Land' | 'Sea';
  posture: string;
  previousPosture?: string;
}): NewspaperTacticalZone {
  const offset = zoneID < 0 ? 30 : 0;
  return {
    zoneID,
    city: cityName,
    domain,
    posture,
    ...(previousPosture === undefined ? {} : {
      previousPosture: {
        posture: previousPosture,
        source: { table: 'TacticalZones', id: 400 + offset + Math.abs(zoneID), turn: 5, createdAt: 5000 },
      },
    }),
    units: {},
    source: { table: 'TacticalZones', id: 200 + offset + Math.abs(zoneID), turn: 10, createdAt: 10000 },
  };
}

/** Supply visible cities, fronts and a continuous diplomatic relationship. */
function fixture({
  cities, zones, state = 'peace',
}: {
  cities: NewspaperSnapshot[];
  zones: NewspaperTacticalZone[];
  state?: 'peace' | 'war';
}): NewspaperEvidence {
  const players = [0, 1].map(subjectID => {
    const row = diplomacySnapshot(subjectID, 10, []);
    return { subjectID, values: {}, source: row.source };
  });
  const pastPlayers = players.map(row => ({
    ...row, source: { ...row.source, id: row.subjectID, turn: 0, createdAt: 0 },
  }));
  const diplomacy = [
    diplomacySnapshot(0, 10, [relationship(1, state)]),
    diplomacySnapshot(1, 10, [relationship(0, state)]),
  ];
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    players,
    cities,
    comparisons: { players: [], cities: [] },
    events: [],
    tacticalZones: zones,
    history: {
      fromTurn: -1,
      baseline: { players: [], cities: [] },
      snapshots: { players: [...pastPlayers, ...players], cities: [...cities] },
      events: [],
      gaps: [],
    },
    diplomacy: { fromTurn: -1, baseline: [], history: diplomacy, gaps: [] },
  };
}

/** Run the complete stock editor and expose its rule audit. */
async function check(evidence: NewspaperEvidence) {
  const facts = buildNewspaperFacts(evidence, {
    playerIdentities: {
      0: { name: 'France', major: true, teamId: 100 },
      1: { name: 'Brazil', major: true, teamId: 101 },
    },
  });
  const result = await runEditorialCheck({
    campaignId: 'fixture',
    timelineId: 'zone-posture',
    receiver: { playerId: 0, label: 'France' },
    evidence,
    facts,
    config,
    speedMultiplier: 1,
    state: createInitialPublicationState(),
  });
  expect(result.decision.choiceErrors ?? []).toEqual([]);
  return result;
}

type CheckResult = Awaited<ReturnType<typeof check>>;

/** Find the audit entry for one rule and city subject. */
function audit(result: CheckResult, ruleId: string, subject: string) {
  return result.decision.triggerAudit
    .find(entry => entry.rule === ruleId)
    ?.subjects.find(entry => entry.subject === subject);
}

/** Read one audited value from a rule subject. */
function value(result: CheckResult, ruleId: string, subject: string, field: string) {
  return audit(result, ruleId, subject)?.expressions.find(entry => entry.field === field)?.value;
}

const home = city(10, 0, 'Paris');
const enemy = city(20, 1, 'Persepolis');

describe('stock zone posture triggers', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
  });

  describe('own front defensive posture', () => {
    it('should report a land zone that adopts a deliberate defense', async () => {
      const land = zone({
        zoneID: 10, city: 'Paris', domain: 'Land', posture: 'Hedgehog', previousPosture: 'Counterattack',
      });
      const result = await check(fixture({ cities: [home], zones: [land] }));
      const entry = audit(result, 'own-front-posture-defensive', 'city/10');

      expect(entry?.outcome).toBe('fired');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.cityName')).toBe('Paris');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.domain')).toBe('Land');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.previousPosture')).toBe('Counterattack');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.posture')).toBe('Hedgehog');
      expect(entry?.sources).toEqual(expect.arrayContaining([land.source, land.previousPosture!.source]));
    });

    it('should report a sea zone independently', async () => {
      const sea = zone({
        zoneID: -10, city: 'Paris', domain: 'Sea', posture: 'Hedgehog', previousPosture: 'Counterattack',
      });
      const result = await check(fixture({ cities: [home], zones: [sea] }));

      expect(audit(result, 'own-front-posture-defensive', 'city/10')?.outcome).toBe('fired');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.domain')).toBe('Sea');
      expect(value(result, 'own-front-posture-defensive', 'city/10', 'values.posture')).toBe('Hedgehog');
    });

    it('should not report an unchanged defensive stance', async () => {
      const land = zone({
        zoneID: 10, city: 'Paris', domain: 'Land', posture: 'Hedgehog', previousPosture: 'Hedgehog',
      });
      const result = await check(fixture({ cities: [home], zones: [land] }));

      expect(audit(result, 'own-front-posture-defensive', 'city/10')?.outcome).toBe('false');
    });
  });

  describe('withdrawal assessment at an enemy city', () => {
    it('should report a recorded Withdraw after another posture', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Withdraw', previousPosture: 'Attrition',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-withdraw', 'city/20')?.outcome).toBe('fired');
      expect(value(result, 'enemy-front-posture-withdraw', 'city/20', 'values.previousPosture')).toBe('Attrition');
      expect(value(result, 'enemy-front-posture-withdraw', 'city/20', 'values.posture')).toBe('Withdraw');
    });

    it('should not treat an earlier NONE posture as a withdrawal', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Withdraw', previousPosture: 'NONE',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-withdraw', 'city/20')?.outcome).toBe('false');
    });

    it('should not repeat a Withdraw that was already recorded', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Withdraw', previousPosture: 'Withdraw',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-withdraw', 'city/20')?.outcome).toBe('false');
    });
  });

  describe('enemy front offensive posture', () => {
    it('should report a land zone that turns offensive against a known enemy city', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Steamroll', previousPosture: 'Attrition',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('fired');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.cityName')).toBe('Persepolis');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.civilization')).toBe('Brazil');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.domain')).toBe('Land');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.posture')).toBe('Steamroll');
    });

    it('should report a sea zone independently', async () => {
      const sea = zone({
        zoneID: -20, city: 'Persepolis', domain: 'Sea', posture: 'Surgical City Strike', previousPosture: 'Exploit Flanks',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [sea], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('fired');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.domain')).toBe('Sea');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.posture')).toBe('Surgical City Strike');
    });

    it('should not report an offensive posture against a city at peace', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Steamroll', previousPosture: 'Attrition',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land] }));

      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('false');
    });

    it('should not report a change between offensive postures', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Steamroll', previousPosture: 'Surgical City Strike',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('false');
    });
  });

  describe('unknown prior observation', () => {
    it('should leave an absent prior posture unknown on land and sea', async () => {
      const land = zone({ zoneID: 10, city: 'Paris', domain: 'Land', posture: 'Hedgehog' });
      const landResult = await check(fixture({ cities: [home], zones: [land] }));
      expect(audit(landResult, 'own-front-posture-defensive', 'city/10')?.outcome).toBe('false');

      const sea = zone({ zoneID: -20, city: 'Persepolis', domain: 'Sea', posture: 'Surgical City Strike' });
      const seaResult = await check(fixture({ cities: [home, enemy], zones: [sea], state: 'war' }));
      expect(audit(seaResult, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('false');
    });
  });
});
