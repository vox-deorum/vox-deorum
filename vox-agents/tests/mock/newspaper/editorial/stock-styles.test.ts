/** Behavioral checks for the stock newspaper style preferences. */
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperCongressObservation, NewspaperDiplomacySnapshot, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import type { AuthoredVariant, EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { applyStylePreferences } from '../../../../src/newspaper/editorial/selection/styles.js';
import type { EditorialCandidate } from '../../../../src/newspaper/editorial/selection/templates.js';
import type { ExpressionCheckBudget } from '../../../../src/newspaper/editorial/shared/expressions.js';
import { relationship } from '../../../helpers/newspaper-diplomacy.js';

type Relationship = NewspaperDiplomacySnapshot['relationships'][number];

/** One additional player the fixture exposes at the cutoff turn. */
interface OtherPlayer {
  id: number;
  values?: Record<string, unknown>;
  relationships?: Relationship[];
  major?: boolean;
}

/** One receiver city the fixture exposes with an optional unhappiness breakdown. */
interface FixtureCity {
  name: string;
  unhappiness?: unknown;
}

/** Optional players, relationships, cities, Congress record and receiver name a style test can add. */
interface FixtureExtra {
  others?: OtherPlayer[];
  relationships?: Relationship[];
  cities?: FixtureCity[];
  congress?: NewspaperEvidence['congress'];
  name?: string;
}

let config: EditorialConfig;

/** Build a permitted snapshot with a predictable row reference. */
function snapshot(subjectID: number, turn: number, values: Record<string, unknown>): NewspaperSnapshot {
  return { subjectID, values, source: { table: 'PlayerSummaries', id: turn * 100 + subjectID, turn, createdAt: turn * 1000 } };
}

/** Pair a player row with the relationship entries that player observed. */
function diplomatic(
  row: NewspaperSnapshot, isMajor: boolean, relationships: Relationship[] = [],
): NewspaperDiplomacySnapshot {
  return { source: row.source, subjectID: row.subjectID, teamID: row.subjectID + 100, isMajor, relationships };
}

/** Build receiver evidence with optional other players, their relationships and the receiver's cities. */
function fixture(era: string, values: Record<string, unknown> = {}, extra: FixtureExtra = {}): NewspaperEvidence {
  const receiver = snapshot(0, 10, { Era: era, Gold: 20, ...values });
  const others = (extra.others ?? []).map(other => snapshot(other.id, 10, other.values ?? {}));
  const observations = [
    diplomatic(receiver, true, extra.relationships ?? []),
    ...(extra.others ?? []).map((other, index) => diplomatic(
      others[index], other.major ?? true, other.relationships ?? [],
    )),
  ];
  const cities = (extra.cities ?? []).map((city, index) => ({
    subjectID: 100 + index,
    source: { table: 'CityInformations' as const, id: 300 + index, turn: 10, createdAt: 10_000 },
    values: {
      OwnerID: 0, Name: city.name, IsCapital: index === 0 ? 1 : 0, X: index, Y: 0,
      ...(city.unhappiness === undefined ? {} : { UnhappinessSources: city.unhappiness }),
    },
  }));
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10 },
    players: [receiver, ...others],
    cities, comparisons: { players: [], cities: [] }, events: [],
    ...(extra.congress ? { congress: extra.congress } : {}),
    diplomacy: { fromTurn: 5, baseline: [], history: observations, gaps: [] },
  };
}

/** Build one public Congress observation at the fixture cutoff turn. */
function congressEvidence(
  fields: Partial<NewspaperCongressObservation> = {},
): NewspaperEvidence['congress'] {
  return {
    observations: [{
      source: { table: 'VictoryProgress', id: 900, turn: 10, createdAt: 10_000 },
      available: true,
      votingNow: false,
      activeResolutions: [],
      proposals: [],
      ...fields,
    }],
  };
}

/** Build one authored variant whose style starts at general, neutral and report. */
function variant(id: string, style: { voice?: string; stance?: string; genre?: string } = {}): AuthoredVariant {
  return {
    id, headline: id, body: [id],
    voice: style.voice ?? 'general',
    stance: style.stance ?? 'neutral',
    genre: style.genre ?? 'report',
    weight: { base: 1, adjustments: [] },
    links: [],
  };
}

/** Build a selected candidate with explicit style variants and story facts. */
function styleCandidate(
  id: string, variants: EditorialCandidate['variants'],
  facts: Partial<Pick<EditorialCandidate, 'importance' | 'tier' | 'urgent' | 'short' | 'tags'>> = {},
): EditorialCandidate {
  return {
    id, subject: `player/${id}`, period: { from: 5, to: 10 }, triggerIds: [], ruleIds: [], templateIds: [],
    seriesKeys: [], tier: facts.tier ?? 'routine', tags: facts.tags ?? [], importance: facts.importance ?? 50, urgent: facts.urgent ?? false,
    short: facts.short ?? false, weight: 1, variants,
    variantWeights: Object.fromEntries(variants.map(item => [item.id, 1])),
    variantSources: {}, variantBindings: {}, values: {}, sources: [], fingerprint: id,
  };
}

/** Apply the stock style rules to selected candidates against one receiver fixture. */
async function applyStock(
  candidates: EditorialCandidate[], era: string, values: Record<string, unknown> = {}, extra: FixtureExtra = {},
) {
  const compiled = await getEditorialExpressions(config);
  const budget: ExpressionCheckBudget = { interruptedSlots: new Set(), choiceErrors: new Map() };
  const metadata = extra.name ? { playerIdentities: { 0: { name: extra.name } } } : {};
  const result = await applyStylePreferences(candidates, compiled, {
    constants: {},
    facts: buildNewspaperFacts(fixture(era, values, extra), metadata, {
      ideologies: config.constants.types.ideologies,
    }),
  }, budget);
  return { ...result, budget };
}

describe('stock newspaper styles', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
  });

  describe('voice by era', () => {
    it('should discourage feed and keep spoken in the Ancient era', async () => {
      const candidate = styleCandidate('ancient',
        ['general', 'spoken', 'feed'].map(id => variant(id, { voice: id })));
      const { selected } = await applyStock([candidate], 'Ancient Era');
      const weights = selected[0].variantWeights;
      expect(weights.feed).toBeLessThan(weights.general);
      expect(weights.spoken).toEqual(weights.general);
    });

    it('should discourage spoken and keep feed in the Information era', async () => {
      const candidate = styleCandidate('information',
        ['general', 'spoken', 'feed'].map(id => variant(id, { voice: id })));
      const { selected } = await applyStock([candidate], 'Information Era');
      const weights = selected[0].variantWeights;
      expect(weights.spoken).toBeLessThan(weights.general);
      expect(weights.feed).toEqual(weights.general);
    });
  });

  describe('genre by story', () => {
    it('should discourage a joke against a report on an urgent story', async () => {
      const candidate = styleCandidate('urgent',
        [variant('joke', { genre: 'joke' }), variant('report')], { urgent: true });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.joke).toBeLessThan(weights.report);
    });

    it('should raise a proverb above an analysis on a short filler', async () => {
      const candidate = styleCandidate('short',
        [variant('proverb', { genre: 'proverb' }), variant('analysis', { genre: 'analysis' })], { short: true });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.proverb).toBeGreaterThan(weights.analysis);
    });

    it('should raise an editorial above a report on an important story', async () => {
      const candidate = styleCandidate('important',
        [variant('editorial', { genre: 'editorial' }), variant('report')], { importance: 90 });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.editorial).toBeGreaterThan(weights.report);
    });
  });

  describe('story topics', () => {
    it('should raise a proverb above a ledger on a religion story and leave a cities story alone', async () => {
      const styles = [variant('proverb', { genre: 'proverb' }), variant('ledger', { genre: 'ledger' })];
      const religion = styleCandidate('religion-topic', styles, { tags: ['religion'] });
      const { selected } = await applyStock([religion], 'Modern Era');
      expect(selected[0].variantWeights.proverb).toBeGreaterThan(selected[0].variantWeights.ledger);

      const cities = styleCandidate('cities-topic', styles, { tags: ['cities'] });
      const quiet = await applyStock([cities], 'Modern Era');
      expect(quiet.selected[0].variantWeights.proverb).toEqual(quiet.selected[0].variantWeights.ledger);
    });

    it('should raise a report above a joke on a military story', async () => {
      const candidate = styleCandidate('military-topic',
        [variant('report'), variant('joke', { genre: 'joke' })], { tags: ['military'] });
      const { selected } = await applyStock([candidate], 'Modern Era');
      expect(selected[0].variantWeights.report).toBeGreaterThan(selected[0].variantWeights.joke);
    });

    it('should raise a notice above an anecdote on a diplomacy story', async () => {
      const candidate = styleCandidate('diplomacy-topic',
        [variant('notice', { genre: 'notice' }), variant('anecdote', { genre: 'anecdote' })], { tags: ['diplomacy'] });
      const { selected } = await applyStock([candidate], 'Modern Era');
      expect(selected[0].variantWeights.notice).toBeGreaterThan(selected[0].variantWeights.anecdote);
    });

    it('should put an obituary below a report on a science story', async () => {
      const candidate = styleCandidate('science-topic',
        [variant('obituary', { genre: 'obituary' }), variant('report')], { tags: ['science'] });
      const { selected } = await applyStock([candidate], 'Modern Era');
      expect(selected[0].variantWeights.obituary).toBeLessThan(selected[0].variantWeights.report);
    });
  });

  describe('underused genres', () => {
    it('should weight an obituary higher on a military story at war than at peace', async () => {
      const candidate = styleCandidate('wartime-obituary',
        [variant('obituary', { genre: 'obituary' }), variant('report')], { tags: ['military'] });
      const peace = await applyStock([candidate], 'Modern Era');
      const war = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'war', { warScore: 0 })],
      });
      expect(war.selected[0].variantWeights.obituary)
        .toBeGreaterThan(peace.selected[0].variantWeights.obituary);
    });

    it('should raise a notice on an urgent short story compared with one that is neither', async () => {
      const styles = [variant('notice', { genre: 'notice' }), variant('report')];
      const pressing = styleCandidate('urgent-short-notice', styles, { urgent: true, short: true });
      const quiet = styleCandidate('quiet-notice', styles, { urgent: false, short: false });
      const urgent = await applyStock([pressing], 'Modern Era');
      const ordinary = await applyStock([quiet], 'Modern Era');
      expect(urgent.selected[0].variantWeights.notice)
        .toBeGreaterThan(ordinary.selected[0].variantWeights.notice);
    });
  });

  describe('stance by story', () => {
    it('should raise a local stance above a neutral one on city and domestic news', async () => {
      const candidate = styleCandidate('local',
        [variant('local', { stance: 'local' }), variant('neutral')], { tags: ['cities', 'domestic'] });
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.local).toBeGreaterThan(weights.neutral);
    });
  });

  describe('policy branches', () => {
    it('should raise devout and lower rationalist under Fealty', async () => {
      const candidate = styleCandidate('fealty', [
        variant('devout', { stance: 'devout' }),
        variant('rationalist', { stance: 'rationalist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Medieval Era', { PolicyBranches: { Fealty: ['A'] } });
      const weights = selected[0].variantWeights;
      expect(weights.devout).toBeGreaterThan(weights.neutral);
      expect(weights.rationalist).toBeLessThan(weights.neutral);
    });

    it('should raise elitist and lower environmentalist under Industry', async () => {
      const candidate = styleCandidate('industry', [
        variant('elitist', { stance: 'elitist' }),
        variant('environmentalist', { stance: 'environmentalist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Industrial Era', { PolicyBranches: { Industry: ['A'] } });
      const weights = selected[0].variantWeights;
      expect(weights.elitist).toBeGreaterThan(weights.neutral);
      expect(weights.environmentalist).toBeLessThan(weights.neutral);
    });

    it('should leave devout equal to neutral without recorded policy branches', async () => {
      const candidate = styleCandidate('no-branches', [
        variant('devout', { stance: 'devout' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era');
      const weights = selected[0].variantWeights;
      expect(weights.devout).toEqual(weights.neutral);
    });
  });

  describe('ideologies', () => {
    it('should raise a joke under Order', async () => {
      const candidate = styleCandidate('order', [
        variant('joke', { genre: 'joke' }),
        variant('report'),
      ]);
      const { selected } = await applyStock([candidate], 'Industrial Era', { PolicyBranches: { Order: ['A'] } });
      const weights = selected[0].variantWeights;
      expect(weights.joke).toBeGreaterThan(weights.report);
    });

    it('should lower a government-critical letter below a neutral report under Autocracy', async () => {
      const candidate = styleCandidate('autocracy', [
        variant('critical', { stance: 'government-critical', genre: 'letter' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Industrial Era', { PolicyBranches: { Autocracy: ['A'] } });
      const weights = selected[0].variantWeights;
      expect(weights.critical).toBeLessThan(weights.neutral);
    });
  });

  describe('voice by ideology', () => {
    it('should raise the voices each ideology favors', async () => {
      const freedom = styleCandidate('freedom',
        ['general', 'tabloid', 'feed'].map(id => variant(id, { voice: id })));
      const free = await applyStock([freedom], 'Information Era', { PolicyBranches: { Freedom: ['A'] } });
      expect(free.selected[0].variantWeights.tabloid).toBeGreaterThan(free.selected[0].variantWeights.general);
      expect(free.selected[0].variantWeights.feed).toBeGreaterThan(free.selected[0].variantWeights.general);

      const order = styleCandidate('order-voice',
        ['general', 'press', 'pamphlet'].map(id => variant(id, { voice: id })));
      const ordered = await applyStock([order], 'Industrial Era', { PolicyBranches: { Order: ['A'] } });
      expect(ordered.selected[0].variantWeights.press).toBeGreaterThan(ordered.selected[0].variantWeights.general);
      expect(ordered.selected[0].variantWeights.pamphlet).toBeGreaterThan(ordered.selected[0].variantWeights.general);

      // The crier is out of era in the Modern era, so compare its weight across the same era.
      const autocracy = styleCandidate('autocracy-voice',
        ['general', 'broadcast', 'crier'].map(id => variant(id, { voice: id })));
      const before = await applyStock([autocracy], 'Modern Era');
      const after = await applyStock([autocracy], 'Modern Era', { PolicyBranches: { Autocracy: ['A'] } });
      expect(after.selected[0].variantWeights.broadcast).toBeGreaterThan(after.selected[0].variantWeights.general);
      expect(after.selected[0].variantWeights.crier).toBeGreaterThan(before.selected[0].variantWeights.crier);
    });
  });

  describe('religion and happiness', () => {
    it('should raise devout with a founded religion and pluralist without one', async () => {
      const candidate = styleCandidate('religion', [
        variant('devout', { stance: 'devout' }),
        variant('pluralist', { stance: 'pluralist' }),
        variant('neutral'),
      ]);
      const founded = await applyStock([candidate], 'Modern Era', { FoundedReligion: 'X' });
      expect(founded.selected[0].variantWeights.devout).toBeGreaterThan(founded.selected[0].variantWeights.neutral);
      expect(founded.selected[0].variantWeights.pluralist).toBeLessThan(founded.selected[0].variantWeights.neutral);
      const none = await applyStock([candidate], 'Modern Era', { FoundedReligion: null });
      expect(none.selected[0].variantWeights.pluralist).toBeGreaterThan(none.selected[0].variantWeights.neutral);
    });

    it('should ignore unreadable or non-name founded religion readings', async () => {
      const candidate = styleCandidate('religion-unreadable', [
        variant('devout', { stance: 'devout' }),
        variant('pluralist', { stance: 'pluralist' }),
        variant('neutral'),
      ]);
      for (const founded of [-1, '', {}, undefined]) {
        const { selected } = await applyStock([candidate], 'Modern Era', { FoundedReligion: founded });
        const weights = selected[0].variantWeights;
        expect(weights.devout).toEqual(weights.neutral);
        expect(weights.pluralist).toEqual(weights.neutral);
      }
    });

    it('should lift traditional only when the majority faith differs from the founded one', async () => {
      const candidate = styleCandidate('faith-pressure', [
        variant('traditional', { stance: 'traditional' }),
        variant('neutral'),
      ]);
      const pressure = await applyStock([candidate], 'Modern Era', {
        FoundedReligion: 'X', MajorityReligion: 'Y',
      });
      expect(pressure.selected[0].variantWeights.traditional)
        .toBeGreaterThan(pressure.selected[0].variantWeights.neutral);
      const settled = await applyStock([candidate], 'Modern Era', {
        FoundedReligion: 'X', MajorityReligion: 'X',
      });
      expect(settled.selected[0].variantWeights.traditional)
        .toEqual(settled.selected[0].variantWeights.neutral);
    });

    it('should ignore unreadable or non-name majority faith readings', async () => {
      const candidate = styleCandidate('faith-pressure-unreadable', [
        variant('traditional', { stance: 'traditional' }),
        variant('neutral'),
      ]);
      for (const majority of [-1, '', {}, undefined]) {
        const { selected } = await applyStock([candidate], 'Modern Era', {
          FoundedReligion: 'X', MajorityReligion: majority,
        });
        expect(selected[0].variantWeights.traditional)
          .toEqual(selected[0].variantWeights.neutral);
      }
      const unfounded = await applyStock([candidate], 'Modern Era', {
        FoundedReligion: -1, MajorityReligion: 'Y',
      });
      expect(unfounded.selected[0].variantWeights.traditional)
        .toEqual(unfounded.selected[0].variantWeights.neutral);
    });

    it('should lift pro-government and artistic only for an active golden age', async () => {
      const candidate = styleCandidate('golden-age', [
        variant('pro-government', { stance: 'pro-government' }),
        variant('artistic', { stance: 'artistic' }),
        variant('neutral'),
      ]);
      // Happiness is left unrecorded, so only the golden-age status decides.
      const active = await applyStock([candidate], 'Modern Era', { GoldenAge: '5 turns remaining' });
      expect(active.selected[0].variantWeights['pro-government'])
        .toBeGreaterThan(active.selected[0].variantWeights.neutral);
      expect(active.selected[0].variantWeights.artistic).toBeGreaterThan(active.selected[0].variantWeights.neutral);

      const stalled = await applyStock([candidate], 'Modern Era', { GoldenAge: 'Need More Happiness' });
      expect(stalled.selected[0].variantWeights['pro-government']).toEqual(stalled.selected[0].variantWeights.neutral);
      expect(stalled.selected[0].variantWeights.artistic).toEqual(stalled.selected[0].variantWeights.neutral);
    });

    it('should raise populist during a deficit', async () => {
      const candidate = styleCandidate('deficit', [
        variant('populist', { stance: 'populist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', { GoldPerTurn: -4 });
      expect(selected[0].variantWeights.populist).toBeGreaterThan(selected[0].variantWeights.neutral);
    });
  });

  describe('city unhappiness', () => {
    it('should raise populist when poverty is the most common top cause', async () => {
      const candidate = styleCandidate('poverty', [
        variant('populist', { stance: 'populist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Gold: 5, Distress: 1 } },
          { name: 'Orleans', unhappiness: { Gold: 4 } },
          { name: 'Lyon', unhappiness: { Culture: 3 } },
        ],
      });
      expect(selected[0].variantWeights.populist).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should raise artistic when boredom is the most common top cause', async () => {
      const candidate = styleCandidate('boredom', [
        variant('artistic', { stance: 'artistic' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Culture: 4 } },
          { name: 'Orleans', unhappiness: { Culture: 3 } },
          { name: 'Lyon', unhappiness: { Gold: 2 } },
        ],
      });
      expect(selected[0].variantWeights.artistic).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should raise devout and pluralist when religious unrest is the most common top cause', async () => {
      const candidate = styleCandidate('unrest', [
        variant('devout', { stance: 'devout' }),
        variant('pluralist', { stance: 'pluralist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Religion: 4 } },
          { name: 'Orleans', unhappiness: { Religion: 2 } },
          { name: 'Lyon', unhappiness: { Gold: 2 } },
        ],
      });
      const weights = selected[0].variantWeights;
      expect(weights.devout).toBeGreaterThan(weights.neutral);
      expect(weights.pluralist).toBeGreaterThan(weights.neutral);
    });

    it('should leave populist unchanged when one city of five has poverty as its top cause', async () => {
      const candidate = styleCandidate('single-poverty', [
        variant('populist', { stance: 'populist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Gold: 5 } },
          { name: 'Orleans', unhappiness: { Culture: 2 } },
          { name: 'Lyon', unhappiness: { Culture: 2 } },
          { name: 'Tours', unhappiness: { Culture: 2 } },
          { name: 'Marseille', unhappiness: { Culture: 2 } },
        ],
      });
      expect(selected[0].variantWeights.populist).toEqual(selected[0].variantWeights.neutral);
    });

    it('should leave populist unchanged without visible cities', async () => {
      const candidate = styleCandidate('no-cities', [
        variant('populist', { stance: 'populist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era');
      expect(selected[0].variantWeights.populist).toEqual(selected[0].variantWeights.neutral);
    });

    it('should raise local and lower national when isolation is the most common top cause', async () => {
      const candidate = styleCandidate('isolation', [
        variant('local', { stance: 'local' }),
        variant('national', { stance: 'national' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Isolation: 3 } },
          { name: 'Orleans', unhappiness: { Isolation: 2 } },
          { name: 'Lyon', unhappiness: { Culture: 1 } },
        ],
      });
      const weights = selected[0].variantWeights;
      expect(weights.local).toBeGreaterThan(weights.neutral);
      expect(weights.national).toBeLessThan(weights.neutral);
    });

    it('should raise environmentalist and lower industrialist when specialists are the most common top cause', async () => {
      const candidate = styleCandidate('crowding', [
        variant('environmentalist', { stance: 'environmentalist' }),
        variant('industrialist', { stance: 'industrialist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Specialists: 3 } },
          { name: 'Orleans', unhappiness: { Specialists: 2 } },
          { name: 'Lyon', unhappiness: { Culture: 1 } },
        ],
      });
      const weights = selected[0].variantWeights;
      expect(weights.environmentalist).toBeGreaterThan(weights.neutral);
      expect(weights.industrialist).toBeLessThan(weights.neutral);
    });

    it('should raise genre letter above report and lower elitist when poverty is the most common top cause', async () => {
      const candidate = styleCandidate('poverty-genre', [
        variant('letter', { genre: 'letter' }),
        variant('report'),
        variant('elitist', { stance: 'elitist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Gold: 5 } },
          { name: 'Orleans', unhappiness: { Gold: 4 } },
          { name: 'Lyon', unhappiness: { Culture: 2 } },
        ],
      });
      const weights = selected[0].variantWeights;
      expect(weights.letter).toBeGreaterThan(weights.report);
      expect(weights.elitist).toBeLessThan(weights.neutral);
    });

    it('should raise genre anecdote when boredom is the most common top cause', async () => {
      const candidate = styleCandidate('boredom-genre', [
        variant('anecdote', { genre: 'anecdote' }),
        variant('report'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Culture: 4 } },
          { name: 'Orleans', unhappiness: { Culture: 3 } },
          { name: 'Lyon', unhappiness: { Gold: 2 } },
        ],
      });
      expect(selected[0].variantWeights.anecdote).toBeGreaterThan(selected[0].variantWeights.report);
    });

    it('should raise genre analysis when illiteracy is the most common top cause', async () => {
      const candidate = styleCandidate('illiteracy-genre', [
        variant('analysis', { genre: 'analysis' }),
        variant('report'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Science: 4 } },
          { name: 'Orleans', unhappiness: { Science: 2 } },
          { name: 'Lyon', unhappiness: { Gold: 2 } },
        ],
      });
      expect(selected[0].variantWeights.analysis).toBeGreaterThan(selected[0].variantWeights.report);
    });

    it('should put neutral below devout when religious unrest is the most common top cause', async () => {
      const candidate = styleCandidate('unrest-down', [
        variant('devout', { stance: 'devout' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        cities: [
          { name: 'Paris', unhappiness: { Religion: 4 } },
          { name: 'Orleans', unhappiness: { Religion: 2 } },
          { name: 'Lyon', unhappiness: { Gold: 2 } },
        ],
      });
      expect(selected[0].variantWeights.neutral).toBeLessThan(selected[0].variantWeights.devout);
    });
  });

  describe('era fit', () => {
    it('should suppress environmentalist before the Industrial era and keep it after', async () => {
      const candidate = styleCandidate('environmentalist', [
        variant('environmentalist', { stance: 'environmentalist' }),
        variant('neutral'),
      ]);
      const ancient = await applyStock([candidate], 'Ancient Era');
      expect(ancient.selected[0].variantWeights.environmentalist)
        .toBeLessThan(ancient.selected[0].variantWeights.neutral);
      const modern = await applyStock([candidate], 'Modern Era');
      expect(modern.selected[0].variantWeights.environmentalist)
        .toEqual(modern.selected[0].variantWeights.neutral);
    });

    it('should suppress industrialist before the Industrial era and keep it after', async () => {
      const candidate = styleCandidate('industrialist', [
        variant('industrialist', { stance: 'industrialist' }),
        variant('neutral'),
      ]);
      const ancient = await applyStock([candidate], 'Ancient Era');
      expect(ancient.selected[0].variantWeights.industrialist)
        .toBeLessThan(ancient.selected[0].variantWeights.neutral);
      const modern = await applyStock([candidate], 'Modern Era');
      expect(modern.selected[0].variantWeights.industrialist)
        .toEqual(modern.selected[0].variantWeights.neutral);
    });
  });

  describe('war and diplomacy', () => {
    it('should lower hawkish and raise conciliatory under war weariness', async () => {
      const candidate = styleCandidate('weariness', [
        variant('hawkish', { stance: 'hawkish' }),
        variant('conciliatory', { stance: 'conciliatory' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'war', { warScore: 0, warWeariness: 60 })],
      });
      const weights = selected[0].variantWeights;
      expect(weights.hawkish).toBeLessThan(weights.neutral);
      expect(weights.conciliatory).toBeGreaterThan(weights.neutral);
    });

    it('should raise government-critical when a war is being lost', async () => {
      const candidate = styleCandidate('losing', [
        variant('critical', { stance: 'government-critical' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'war', { warScore: -30 })],
      });
      expect(selected[0].variantWeights.critical).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should lower hawkish and raise conciliatory when a war is being lost', async () => {
      const candidate = styleCandidate('losing-direction', [
        variant('hawkish', { stance: 'hawkish' }),
        variant('conciliatory', { stance: 'conciliatory' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'war', { warScore: -30 })],
      });
      const weights = selected[0].variantWeights;
      expect(weights.hawkish).toBeLessThan(weights.neutral);
      expect(weights.conciliatory).toBeGreaterThan(weights.neutral);
    });

    it('should raise hawkish when two players have denounced the receiver', async () => {
      const candidate = styleCandidate('denounced', [
        variant('hawkish', { stance: 'hawkish' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }, { id: 2 }],
        relationships: [
          relationship(1, 'war', { warScore: 0, denouncedByThem: true }),
          relationship(2, 'peace', { denouncedByThem: true }),
        ],
      });
      expect(selected[0].variantWeights.hawkish).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should raise national for a large nation', async () => {
      const candidate = styleCandidate('large', [
        variant('national', { stance: 'national' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', { Cities: 8 });
      expect(selected[0].variantWeights.national).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should raise hawkish when a war is being won', async () => {
      const candidate = styleCandidate('winning', [
        variant('hawkish', { stance: 'hawkish' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'war', { warScore: 30 })],
      });
      expect(selected[0].variantWeights.hawkish).toBeGreaterThan(selected[0].variantWeights.neutral);
    });

    it('should lift national for the world leader and lower pro-government for last place', async () => {
      const candidate = styleCandidate('standing', [
        variant('national', { stance: 'national' }),
        variant('critical', { stance: 'government-critical' }),
        variant('pro-government', { stance: 'pro-government' }),
        variant('neutral'),
      ]);
      const leader = await applyStock([candidate], 'Modern Era', { Score: 80 }, {
        others: [{ id: 1, values: { Score: 50 } }, { id: 2, values: { Score: 10 } }],
      });
      expect(leader.selected[0].variantWeights.national)
        .toBeGreaterThan(leader.selected[0].variantWeights.neutral);

      const last = await applyStock([candidate], 'Modern Era', { Score: 10 }, {
        others: [{ id: 1, values: { Score: 50 } }, { id: 2, values: { Score: 80 } }],
      });
      expect(last.selected[0].variantWeights.critical).toBeGreaterThan(last.selected[0].variantWeights.neutral);
      expect(last.selected[0].variantWeights['pro-government']).toBeLessThan(last.selected[0].variantWeights.neutral);
    });

    it('should lift local and lower national for a small nation', async () => {
      const candidate = styleCandidate('small', [
        variant('local', { stance: 'local' }),
        variant('national', { stance: 'national' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', { Cities: 2 });
      const weights = selected[0].variantWeights;
      expect(weights.local).toBeGreaterThan(weights.neutral);
      expect(weights.national).toBeLessThan(weights.neutral);
    });

    it('should treat a vassal and a master differently', async () => {
      const candidate = styleCandidate('vassalage', [
        variant('critical', { stance: 'government-critical' }),
        variant('traditional', { stance: 'traditional' }),
        variant('pro-government', { stance: 'pro-government' }),
        variant('national', { stance: 'national' }),
        variant('neutral'),
      ]);
      const vassal = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'peace', { master: 'voluntary' })],
      });
      expect(vassal.selected[0].variantWeights.critical).toBeGreaterThan(vassal.selected[0].variantWeights.neutral);
      expect(vassal.selected[0].variantWeights.traditional).toBeGreaterThan(vassal.selected[0].variantWeights.neutral);
      expect(vassal.selected[0].variantWeights['pro-government']).toBeLessThan(vassal.selected[0].variantWeights.neutral);

      const master = await applyStock([candidate], 'Modern Era', {}, {
        others: [{ id: 1 }],
        relationships: [relationship(1, 'peace', { vassal: 'voluntary' })],
      });
      expect(master.selected[0].variantWeights.national).toBeGreaterThan(master.selected[0].variantWeights.neutral);
    });
  });

  describe('world congress', () => {
    it('should raise artistic and lower rationalist while the arts resolution is active', async () => {
      const candidate = styleCandidate('arts-funding', [
        variant('artistic', { stance: 'artistic' }),
        variant('rationalist', { stance: 'rationalist' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        congress: congressEvidence({ activeResolutions: [{ name: 'Endowment for the Arts' }] }),
      });
      const weights = selected[0].variantWeights;
      expect(weights.artistic).toBeGreaterThan(weights.neutral);
      expect(weights.rationalist).toBeLessThan(weights.neutral);
    });

    it('should raise conciliatory above hawkish for Global Peace Accords', async () => {
      const candidate = styleCandidate('peace-accords', [
        variant('conciliatory', { stance: 'conciliatory' }),
        variant('hawkish', { stance: 'hawkish' }),
      ]);
      const quiet = await applyStock([candidate], 'Modern Era');
      const accords = await applyStock([candidate], 'Modern Era', {}, {
        congress: congressEvidence({ activeResolutions: [{ name: 'Global Peace Accords' }] }),
      });
      expect(accords.selected[0].variantWeights.conciliatory)
        .toBeGreaterThan(quiet.selected[0].variantWeights.conciliatory);
      expect(accords.selected[0].variantWeights.hawkish)
        .toBeLessThan(quiet.selected[0].variantWeights.hawkish);
    });

    it('should favor a matching World Ideology and oppose a different one', async () => {
      const candidate = styleCandidate('world-ideology', [
        variant('pro-government', { stance: 'pro-government' }),
        variant('critical', { stance: 'government-critical' }),
        variant('neutral'),
      ]);
      const values = { PolicyBranches: { Order: ['A'] } };
      const aligned = await applyStock([candidate], 'Modern Era', values, {
        congress: congressEvidence({ activeResolutions: [{ name: 'World Ideology: Order' }] }),
      });
      expect(aligned.selected[0].variantWeights['pro-government'])
        .toBeGreaterThan(aligned.selected[0].variantWeights.neutral);
      expect(aligned.selected[0].variantWeights.critical)
        .toEqual(aligned.selected[0].variantWeights.neutral);

      const opposed = await applyStock([candidate], 'Modern Era', values, {
        congress: congressEvidence({ activeResolutions: [{ name: 'World Ideology: Freedom' }] }),
      });
      expect(opposed.selected[0].variantWeights.critical)
        .toBeGreaterThan(opposed.selected[0].variantWeights.neutral);
      expect(opposed.selected[0].variantWeights['pro-government'])
        .toEqual(opposed.selected[0].variantWeights.neutral);
    });

    it('should lift analysis during a voting session on an international story only', async () => {
      const styles = [variant('analysis', { genre: 'analysis' }), variant('report')];
      const international = styleCandidate('session-international', styles, { tags: ['international'] });
      const cities = styleCandidate('session-cities', styles, { tags: ['cities'] });
      const congress = congressEvidence({ votingNow: true });
      const abroad = await applyStock([international], 'Modern Era', {}, { congress });
      expect(abroad.selected[0].variantWeights.analysis)
        .toBeGreaterThan(abroad.selected[0].variantWeights.report);

      const domestic = await applyStock([cities], 'Modern Era', {}, { congress });
      expect(domestic.selected[0].variantWeights.analysis)
        .toEqual(domestic.selected[0].variantWeights.report);
    });

    it('should leave artistic equal to neutral without a congress fact', async () => {
      const candidate = styleCandidate('no-congress', [
        variant('artistic', { stance: 'artistic' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era');
      expect(selected[0].variantWeights.artistic).toEqual(selected[0].variantWeights.neutral);
    });

    it('should leave artistic equal to neutral for an unavailable league', async () => {
      const candidate = styleCandidate('locked-league', [
        variant('artistic', { stance: 'artistic' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        congress: congressEvidence({
          available: false,
          activeResolutions: [{ name: 'Endowment for the Arts' }],
        }),
      });
      expect(selected[0].variantWeights.artistic).toEqual(selected[0].variantWeights.neutral);
    });

    it('should leave artistic equal to neutral without an active resolutions field', async () => {
      const candidate = styleCandidate('bare-league', [
        variant('artistic', { stance: 'artistic' }),
        variant('neutral'),
      ]);
      const { selected } = await applyStock([candidate], 'Modern Era', {}, {
        congress: congressEvidence({ activeResolutions: undefined }),
      });
      expect(selected[0].variantWeights.artistic).toEqual(selected[0].variantWeights.neutral);
    });
  });

  describe('rule evaluation', () => {
    it('should record no choice error when every stock style is in play', async () => {
      const styles = config.styles;
      if (!styles) throw new Error('The stock catalogue has no style definitions.');
      const story = {
        importance: 90, urgent: true, short: true,
        tags: [
          'cities', 'domestic', 'military', 'international', 'religion', 'wonders', 'science',
          'diplomacy', 'city-states', 'congress',
        ],
      };
      const voices = styleCandidate('voices', styles.voice.map(({ id }) => variant(id, { voice: id })), story);
      const stances = styleCandidate('stances', styles.stance.map(({ id }) => variant(id, { stance: id })), story);
      const genres = styleCandidate('genres', styles.genre.map(({ id }) => variant(id, { genre: id })), story);
      const values = {
        PolicyBranches: { Order: ['A'], Fealty: ['B'], Tradition: ['C'] },
        FoundedReligion: 'X',
        HappinessPercentage: 30,
        GoldenAge: '5 turns remaining',
        GoldPerTurn: -4,
      };
      // The settled receiver has no visible cities, so the city rules still run with an empty list.
      const settled = await applyStock([voices, stances, genres], 'Ancient Era', values);
      expect(settled.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(settled.budget.choiceEvaluationIncomplete).toBeUndefined();

      // A readable breakdown in every city exercises the city rules with matching top causes.
      const detailed = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        cities: [
          { name: 'Paris', unhappiness: { Gold: 5 } },
          { name: 'Orleans', unhappiness: { Gold: 4 } },
          { name: 'Lyon', unhappiness: { Gold: 3 } },
          { name: 'Tours', unhappiness: { Gold: 2 } },
          { name: 'Marseille', unhappiness: { Culture: 4 } },
          { name: 'Rouen', unhappiness: { Culture: 3 } },
          { name: 'Grenoble', unhappiness: { Science: 3 } },
          { name: 'Dijon', unhappiness: { Religion: 2 } },
          { name: 'Amiens', unhappiness: { Isolation: 2 } },
          { name: 'Brest', unhappiness: { PillagedTiles: 2 } },
        ],
      });
      expect(detailed.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(detailed.budget.choiceEvaluationIncomplete).toBeUndefined();

      // A missing breakdown and an empty breakdown must leave the city rules unchanged.
      const hidden = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        cities: [{ name: 'Paris' }, { name: 'Orleans', unhappiness: {} }],
      });
      expect(hidden.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(hidden.budget.choiceEvaluationIncomplete).toBeUndefined();

      // A second receiver is at war with a neighbor, so the pair and relation rules evaluate too.
      const conflict = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        others: [{ id: 1 }, { id: 2 }],
        relationships: [
          relationship(1, 'war', { warScore: -30, warWeariness: 60, denouncedByThem: true }),
          relationship(2, 'peace', { denouncedByThem: true }),
        ],
      });
      expect(conflict.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(conflict.budget.choiceEvaluationIncomplete).toBeUndefined();

      // A recorded Congress exercises every resolution, proposal, session and project rule.
      const agenda = congressEvidence({
        votingNow: true,
        activeResolutions: [
          { name: 'Endowment for the Arts' },
          { name: 'World Science Initiative' },
          { name: 'World Religion: X' },
          { name: 'Global Peace Accords' },
          { name: 'Casus Belli' },
          { name: 'Cold War' },
          { name: 'Cultural Heritage Sites' },
          { name: 'Historical Landmarks' },
          { name: 'Natural Heritage Sites' },
          { name: 'Scholars in Residence' },
          { name: 'Passport System' },
          { name: 'Travel Ban' },
          { name: 'Decolonization' },
          { name: 'Global Liberation' },
          { name: 'World Ideology: Order' },
          { name: 'World Ideology: Freedom' },
          { name: 'Sanction: Receiver' },
          { name: "World's Fair" },
          { name: 'Treasure Fleet' },
        ],
        proposals: [
          { name: 'World Science Initiative', isEnact: true, proposer: 'Receiver' },
          { name: 'International Games', isEnact: true },
          { name: 'Global Wargames', isEnact: true },
          { name: 'International Space Station', isEnact: true },
        ],
      });
      const congress = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        name: 'Receiver', congress: agenda,
      });
      expect(congress.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(congress.budget.choiceEvaluationIncomplete).toBeUndefined();

      // An unavailable league keeps its recorded agenda out of every Congress rule.
      const locked = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        congress: congressEvidence({
          available: false,
          activeResolutions: [{ name: 'Endowment for the Arts' }],
          proposals: [{ name: 'Endowment for the Arts', isEnact: true, proposer: 'Receiver' }],
        }),
      });
      expect(locked.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(locked.budget.choiceEvaluationIncomplete).toBeUndefined();

      // An available league without an agenda field exercises the guarded session rules.
      const bare = await applyStock([voices, stances, genres], 'Ancient Era', values, {
        congress: congressEvidence({
          votingNow: false,
          expectedSessionTurn: 10,
          activeResolutions: undefined,
          proposals: undefined,
        }),
      });
      expect(bare.budget.choiceErrors?.size ?? 0).toBe(0);
      expect(bare.budget.choiceEvaluationIncomplete).toBeUndefined();
    });
  });
});
