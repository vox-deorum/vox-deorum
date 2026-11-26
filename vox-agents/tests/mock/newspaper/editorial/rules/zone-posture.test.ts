import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperEvidence, NewspaperSnapshot, NewspaperTacticalPostureChange, NewspaperTacticalZone,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, type PublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';
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

/** Record one receiver front observation and an optional earlier sighting. */
function zone({
  zoneID, city: cityName, domain, posture, previousPosture, units = {}, turn = 10,
}: {
  zoneID: number;
  city: string;
  domain: 'Land' | 'Sea';
  posture: string;
  previousPosture?: string;
  units?: NewspaperTacticalZone['units'];
  turn?: number;
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
        source: { table: 'TacticalZones', id: 400 + offset + Math.abs(zoneID), turn: turn - 1, createdAt: (turn - 1) * 1000 },
      },
    }),
    units,
    source: { table: 'TacticalZones', id: 200 + offset + Math.abs(zoneID), turn, createdAt: turn * 1000 },
  };
}

/** Supply visible cities, fronts and a continuous diplomatic relationship. */
function fixture({
  cities, zones, state = 'peace', previousState = state, changes, cutoff = 10, previous = 5,
}: {
  cities: NewspaperSnapshot[];
  zones: NewspaperTacticalZone[];
  state?: 'peace' | 'war';
  previousState?: 'peace' | 'war';
  changes?: NewspaperTacticalPostureChange[];
  cutoff?: number;
  previous?: number;
}): NewspaperEvidence {
  const diplomacy = [
    diplomacySnapshot(0, 0, [relationship(1, previousState)]),
    diplomacySnapshot(1, 0, [relationship(0, previousState)]),
    diplomacySnapshot(0, cutoff, [relationship(1, state)]),
    diplomacySnapshot(1, cutoff, [relationship(0, state)]),
  ];
  const snapshots = diplomacy.map(({ subjectID, source }) => ({ subjectID, values: {}, source }));
  const postureChanges = changes ?? zones.flatMap(({ previousPosture, city, ...observation }) =>
    city && previousPosture && previousPosture.posture !== observation.posture
      ? [{ ...observation, city, previousPosture }]
      : []
  );
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: cutoff, historyFromTurn: -1 },
    players: snapshots.slice(2),
    cities,
    comparisons: { players: [], cities: [] },
    events: [],
    tacticalZones: zones,
    tacticalPostureChanges: postureChanges,
    history: {
      fromTurn: -1,
      baseline: { players: [], cities: [] },
      snapshots: { players: snapshots, cities: [...cities] },
      events: [],
      gaps: [],
    },
    diplomacy: { fromTurn: -1, baseline: [], history: diplomacy, gaps: [] },
  };
}

/** Run the editor and expose its rule audit. */
async function check(input: NewspaperEvidence, state: PublicationState = createInitialPublicationState(), briefs = 0) {
  const { evidence, config: catalogue } = briefs ? withEditionBriefs(input, config, briefs) : { evidence: input, config };
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
    config: catalogue,
    speedMultiplier: 1,
    state,
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

describe('zone posture triggers', () => {
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

  describe('own front counterattack posture', () => {
    it('should report a switch from Hedgehog to Counterattack with both observations', async () => {
      const sea = zone({
        zoneID: -10, city: 'Paris', domain: 'Sea', posture: 'Counterattack', previousPosture: 'Hedgehog',
      });
      const result = await check(fixture({ cities: [home], zones: [sea] }));
      const ruleId = 'own-front-posture-counterattack';
      const entry = audit(result, ruleId, 'city/10');

      expect(entry?.outcome).toBe('fired');
      expect(value(result, ruleId, 'city/10', 'values.domain')).toBe('Sea');
      expect(value(result, ruleId, 'city/10', 'values.previousPosture')).toBe('Hedgehog');
      expect(value(result, ruleId, 'city/10', 'values.posture')).toBe('Counterattack');
      expect(entry?.sources).toEqual(expect.arrayContaining([sea.source, sea.previousPosture!.source]));
      expect(audit(result, 'own-front-posture-defensive', 'city/10')?.outcome).toBe('false');
    });

    it('should leave an unchanged or newly observed Counterattack unreported', async () => {
      const result = await check(fixture({
        cities: [home],
        zones: [
          zone({ zoneID: 10, city: 'Paris', domain: 'Land', posture: 'Counterattack', previousPosture: 'Counterattack' }),
          zone({ zoneID: -10, city: 'Paris', domain: 'Sea', posture: 'Counterattack' }),
        ],
      }));
      expect(audit(result, 'own-front-posture-counterattack', 'city/10')?.outcome).toBe('false');
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
    it('should report an offensive between issues even after the posture changes back and peace begins', async () => {
      const latest = zone({ zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Attrition' });
      const offensive: NewspaperTacticalPostureChange = {
        ...latest,
        city: 'Persepolis',
        posture: 'Steamroll',
        source: { ...latest.source, id: 608, turn: 8, createdAt: 8000 },
        previousPosture: { posture: 'Attrition', source: { ...latest.source, id: 607, turn: 7, createdAt: 7000 } },
      };
      const changes = [offensive];
      const rule = 'enemy-front-posture-offensive';
      const result = await check(fixture({ cities: [home, enemy], zones: [latest], previousState: 'war', changes }));

      expect(audit(result, rule, 'city/20')).toMatchObject({
        outcome: 'fired', sources: expect.arrayContaining([offensive.source, offensive.previousPosture.source]),
      });
      expect(value(result, rule, 'city/20', 'values.observedTurn')).toBe(8);
      const reversed = await check(fixture({ cities: [home, enemy], zones: [latest], state: 'war', previousState: 'peace', changes }));
      expect(audit(reversed, rule, 'city/20')?.outcome).toBe('false');
      const older = { ...offensive, source: { ...offensive.source, turn: 5 },
        previousPosture: { ...offensive.previousPosture, source: { ...offensive.previousPosture.source, turn: 4 } } };
      const outside = await check(fixture({ cities: [home, enemy], zones: [latest], state: 'war', changes: [older] }));
      expect(audit(outside, rule, 'city/20')?.outcome).toBe('false');
    });

    it('should report a land zone that turns offensive against a known enemy city', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Steamroll', previousPosture: 'Attrition',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));

      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('fired');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.civilization')).toBe('Brazil');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.domain')).toBe('Land');
      expect(value(result, 'enemy-front-posture-offensive', 'city/20', 'values.posture')).toBe('Steamroll');
    });

    it('should rank the same offensive higher at a closer city of the same enemy', async () => {
      const near = city(16, 1, 'Near City');
      const far = city(110, 1, 'Far City');
      const zones = [near, far].map(({ subjectID, values }) => zone({
        zoneID: subjectID, city: String(values.Name), domain: 'Land', posture: 'Steamroll', previousPosture: 'Attrition',
      }));
      const result = await check(fixture({ cities: [home, near, far], zones, state: 'war' }));
      const nearReport = audit(result, 'enemy-front-posture-offensive', 'city/16');
      const farReport = audit(result, 'enemy-front-posture-offensive', 'city/110');

      expect(nearReport).toMatchObject({ outcome: 'fired', tier: 'notable' });
      expect(farReport).toMatchObject({ outcome: 'fired', tier: 'notable' });
      expect(nearReport?.importance).toBeGreaterThan(farReport!.importance!);
    });

    it('should report a sea zone independently', async () => {
      const sea = zone({
        zoneID: -20, city: 'Persepolis', domain: 'Sea', posture: 'Surgical City Strike', previousPosture: 'Exploit Flanks',
      });
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Attrition', previousPosture: 'Exploit Flanks',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [sea, land], state: 'war' }));

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

  describe('enemy front after withdrawal', () => {
    it.each(['Attrition', 'Exploit Flanks'] as const)('should report a switch from Withdraw to %s at war', async posture => {
      const land = zone({ zoneID: 20, city: 'Persepolis', domain: 'Land', posture, previousPosture: 'Withdraw' });
      const ruleId = 'enemy-front-posture-regroup';
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));
      expect(audit(result, ruleId, 'city/20')?.outcome).toBe('fired');
      expect(value(result, ruleId, 'city/20', 'values.posture')).toBe(posture);
      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('false');

      const peaceful = await check(fixture({ cities: [home, enemy], zones: [land] }));
      expect(audit(peaceful, ruleId, 'city/20')?.outcome).toBe('false');
    });

    it('should leave a switch from Withdraw to Steamroll to the offensive rule', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Steamroll', previousPosture: 'Withdraw',
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }));
      expect(audit(result, 'enemy-front-posture-regroup', 'city/20')?.outcome).toBe('false');
      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('fired');
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

  describe('active war zone analysis', () => {
    const rule = 'active-war-zone-analysis';
    it('should cover sustained contact with observed units on both sides of the same zone', async () => {
      const land = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Attrition', previousPosture: 'Attrition',
        units: { France: { Musketman: 2, Settler: 1 }, Brazil: { Pikeman: 3, 'Great General': 1 } },
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land], state: 'war' }), undefined, 4);

      expect(audit(result, rule, 'city/20')).toMatchObject({
        outcome: 'fired', sources: expect.arrayContaining([land.source]),
      });
      expect(value(result, rule, 'city/20', 'values.ourUnits')).toBe(2);
      expect(value(result, rule, 'city/20', 'values.theirUnits')).toBe(3);
      expect(result.state.issues.at(-1)?.items.some(item => item.ruleIds?.includes(rule))).toBe(true);
      expect(audit(result, 'enemy-front-posture-offensive', 'city/20')?.outcome).toBe('false');
      const later = zone({
        zoneID: 20, city: 'Persepolis', domain: 'Land', posture: 'Attrition', units: land.units, turn: 15,
      });
      const next = await check(fixture({ cities: [home, enemy], zones: [later], state: 'war', cutoff: 15, previous: 10 }), result.state);
      expect(audit(next, rule, 'city/20')?.outcome).toBe('repeat');
    });

    it('should not combine units across domains or infer a front from civilians', async () => {
      const land = zone({
        zoneID: 10, city: 'Paris', domain: 'Land', posture: 'Counterattack',
        units: { France: { Musketman: 3 }, Brazil: { Pikeman: 1, Worker: 4 } },
      });
      const sea = zone({
        zoneID: -10, city: 'Paris', domain: 'Sea', posture: 'Counterattack',
        units: { Brazil: { Galleass: 3 } },
      });
      const result = await check(fixture({ cities: [home, enemy], zones: [land, sea], state: 'war' }));
      expect(audit(result, rule, 'city/10')?.outcome).toBe('false');
    });
  });
});
