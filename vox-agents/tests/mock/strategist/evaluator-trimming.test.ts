/**
 * Tests for the evaluator strategist's trim walk (src/strategist/agents/evaluator-trimming.ts and
 * evaluator-trim-config.ts): the config contract on the real ladder, `trimToFit` walking hand-built
 * ladders over small reports (cumulative steps, first fit wins, no-op steps skipped, input never
 * mutated), the real ladder run to exhaustion over realistic report fixtures, and `compressOpinions`
 * shortening weighted opinion lists and leaving unweighted ones alone.
 */
import { describe, expect, it } from 'vitest';
import { evaluatorTrimConfig, type TrimStep } from '../../../src/strategist/agents/evaluator-trim-config.js';
import { compressOpinions, trimToFit, type TrimmableReports } from '../../../src/strategist/agents/evaluator-trimming.js';
import { eventImportanceTiers } from '../../../src/utils/prompts/event-importance.js';

/** The six action keys a ladder step may carry. */
const actionKeys = [
  'events', 'cityFields', 'militaryKeys', 'militaryZoneFields', 'cityStateRelationships', 'opinions',
] as const;

/** Which action keys one ladder step carries (exactly one is the config contract). */
function actionKeysOf(step: TrimStep): string[] {
  return actionKeys.filter(key => key in step);
}

/** The event tier a step drops, or undefined when the step is not an events step. */
function eventsTierOf(step: TrimStep): string | undefined {
  return 'events' in step ? step.events : undefined;
}

/** A turn-keyed events report holding one event of each given type on turn 5. */
function eventsOf(types: string[]): Record<string, unknown> {
  return { '5': types.map(Type => ({ Type })) };
}

/** The event types a trimmed events report still holds, in report order. */
function keptTypes(events: object | undefined): string[] {
  return Object.values((events ?? {}) as Record<string, unknown>)
    .flatMap(value => (Array.isArray(value) ? value.map(entry => (entry as { Type: string }).Type) : []));
}

/** Read one player entry of a trimmed players report as an object. */
function playerOf(reports: TrimmableReports, id: string): Record<string, unknown> {
  return reports.players?.[id] as Record<string, unknown>;
}

/** Read one city record of a trimmed cities report. */
function cityOf(reports: TrimmableReports, owner: string, city: string): Record<string, unknown> {
  return (reports.cities as unknown as Record<string, Record<string, Record<string, unknown>>>)[owner][city];
}

/** Read the parenthesized weight at the end of an opinion line. */
function trailingWeight(line: string): number {
  const match = /\((-?\d+)\)\.?$/.exec(line);
  expect(match, `line ends without a parenthesized weight: ${line}`).not.toBeNull();
  return Number(match![1]);
}

describe('evaluator trimming', () => {
  describe('evaluatorTrimConfig', () => {
    it('should give every ladder step a unique id', () => {
      const ids = evaluatorTrimConfig.ladder.map(step => step.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should give every ladder step exactly one action', () => {
      for (const step of evaluatorTrimConfig.ladder) {
        expect(actionKeysOf(step), `step ${step.id}`).toHaveLength(1);
      }
    });

    it('should drop only tiers the importance table names', () => {
      const named = new Set<string>(eventImportanceTiers.map(tier => tier.name));
      for (const step of evaluatorTrimConfig.ladder) {
        const tier = eventsTierOf(step);
        if (tier !== undefined) expect(named.has(tier), `step ${step.id}`).toBe(true);
      }
    });

    it('should never drop the turning-points or diplomacy tiers', () => {
      for (const step of evaluatorTrimConfig.ladder) {
        expect(eventsTierOf(step), `step ${step.id}`).not.toBe('turning-points');
        expect(eventsTierOf(step), `step ${step.id}`).not.toBe('diplomacy');
      }
    });

    it('should delete city IDs before coordinates and never a field the evaluator decides on', () => {
      const cutAt = new Map<string, number>();
      for (const [index, step] of evaluatorTrimConfig.ladder.entries()) {
        for (const field of 'cityFields' in step ? step.cityFields : []) cutAt.set(field, index);
      }
      // IDs go before coordinates: the evaluator answers with no tools, so it never needs them.
      expect(cutAt.get('X')!).toBeGreaterThan(cutAt.get('ID')!);
      expect(cutAt.get('Y')!).toBeGreaterThan(cutAt.get('ID')!);
      // Readouts the evaluator decides on stay in the state at every level of the walk.
      for (const field of [
        'ProductionTurnsLeft', 'HappinessDelta', 'Population', 'DefenseStrength', 'MajorityReligion',
        'CurrentProduction',
      ]) {
        expect(cutAt.has(field), field).toBe(false);
      }
    });

    it('should drop event tiers from the least important up, matching the shared tier order', () => {
      const rank = new Map<string, number>(eventImportanceTiers.map((tier, index) => [tier.name, index]));
      const dropped = evaluatorTrimConfig.ladder.map(eventsTierOf).filter(tier => tier !== undefined);
      const ranks = dropped.map(tier => rank.get(tier!)!);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    });

    it('should keep the state budget a share of the input limit', () => {
      expect(evaluatorTrimConfig.budgetShare).toBeGreaterThan(0);
      expect(evaluatorTrimConfig.budgetShare).toBeLessThan(1);
    });
  });

  describe('trimToFit', () => {
    it('should return the reports untouched when they already fit', () => {
      const reports: TrimmableReports = { events: eventsOf(['TileRevealed']) };
      const ladder: TrimStep[] = [{ id: 'drop-noise', events: 'noise', note: 'noise' }];
      let checks = 0;

      const result = trimToFit(reports, ladder, () => {
        checks++;
        return true;
      });

      expect(result.fits).toBe(true);
      expect(result.reports).toBe(reports);
      expect(result.steps).toEqual([]);
      expect(result.droppedEvents).toBe(0);
      expect(checks).toBe(1);
    });

    it('should stop at the first step that makes the reports fit', () => {
      const reports: TrimmableReports = {
        events: eventsOf(['TileRevealed', 'SetPopulation']),
        military: { 'Unit Stats': ['Legion'], 'Rome Core Zone 1': {} },
      };
      const ladder: TrimStep[] = [
        { id: 'drop-noise', events: 'noise', note: 'noise' },
        { id: 'drop-economy', events: 'economy', note: 'economy' },
        { id: 'drop-unit-stats', militaryKeys: ['Unit Stats'], note: 'unit stats' },
      ];
      let checks = 0;
      // The first check (the untouched reports) fails; the one after the first step passes.
      const fits = () => ++checks >= 2;

      const result = trimToFit(reports, ladder, fits);

      expect(result.fits).toBe(true);
      expect(result.steps.map(step => step.id)).toEqual(['drop-noise']);
      expect(result.droppedEvents).toBe(1);
      expect(result.reports.events).toEqual(eventsOf(['SetPopulation']));
      // The untouched reports plus the candidate after the one applied step: the walk stops there.
      expect(checks).toBe(2);
    });

    it('should apply steps cumulatively', () => {
      const reports: TrimmableReports = {
        events: eventsOf(['TileRevealed', 'SetPopulation']),
        military: { 'Unit Stats': ['Legion'] },
      };
      const ladder: TrimStep[] = [
        { id: 'drop-noise', events: 'noise', note: 'noise' },
        { id: 'drop-unit-stats', militaryKeys: ['Unit Stats'], note: 'unit stats' },
        { id: 'drop-economy', events: 'economy', note: 'economy' },
      ];

      const result = trimToFit(reports, ladder, () => false);

      expect(result.fits).toBe(false);
      expect(result.steps.map(step => step.id)).toEqual(['drop-noise', 'drop-unit-stats', 'drop-economy']);
      expect(result.reports).toEqual({ events: {}, military: {} });
      expect(result.droppedEvents).toBe(2);
    });

    it('should skip steps that change nothing and run no size check for them', () => {
      const reports: TrimmableReports = {
        events: eventsOf(['TileRevealed']),
        military: { 'Rome Core Zone 1': {} },
        players: { '2': { Civilization: 'Greece', Leader: 'Gorgo', IsMajor: true } },
      };
      const ladder: TrimStep[] = [
        { id: 'drop-combat-events', events: 'combat', note: 'no such events' },
        { id: 'drop-missing-section', militaryKeys: ['Unit Stats'], note: 'no such section' },
        { id: 'drop-zone-fields', militaryZoneFields: ['Plots'], note: 'no zone geometry' },
        { id: 'drop-city-fields', cityFields: ['FoodPerTurn'], note: 'no cities report' },
        { id: 'trim-relationships', cityStateRelationships: true, note: 'no city-states' },
        { id: 'compress-opinions', opinions: { keep: 3 }, note: 'no opinion lists' },
        { id: 'drop-noise', events: 'noise', note: 'the only step that changes anything' },
      ];
      let checks = 0;

      const result = trimToFit(reports, ladder, () => {
        checks++;
        return false;
      });

      expect(result.steps.map(step => step.id)).toEqual(['drop-noise']);
      expect(result.droppedEvents).toBe(1);
      // One check for the untouched reports plus one for the single applied step.
      expect(checks).toBe(2);
    });

    it('should report fits false with every applicable step when nothing fits', () => {
      const reports: TrimmableReports = { events: eventsOf(['TileRevealed', 'CombatResult', 'SetPopulation']) };
      const ladder: TrimStep[] = [
        { id: 'drop-noise', events: 'noise', note: 'noise' },
        { id: 'drop-combat-events', events: 'combat', note: 'combat' },
        { id: 'compress-opinions', opinions: { keep: 3 }, note: 'never applies without players' },
        { id: 'drop-economy', events: 'economy', note: 'economy' },
      ];

      const result = trimToFit(reports, ladder, () => false);

      expect(result.fits).toBe(false);
      expect(result.steps.map(step => step.id)).toEqual(['drop-noise', 'drop-combat-events', 'drop-economy']);
      expect(result.droppedEvents).toBe(3);
      expect(result.reports).toEqual({ events: {} });
    });

    it('should never mutate the reports it trims', () => {
      const reports: TrimmableReports = {
        events: eventsOf(['TileRevealed', 'SetPopulation']),
        players: {
          '2': { Civilization: 'Greece', Leader: 'Gorgo', IsMajor: true, Relationships: { Rome: ['Warm'], Persia: ['Angry'] } },
          '4': { Civilization: 'Genoa', Leader: 'Doge', IsMajor: false, Relationships: { Rome: ['Friendly'], Persia: ['Wary'] } },
        },
        cities: {
          '1': {
            Antium: {
              ID: 1, X: 4, Y: 6, Population: 5, MajorityReligion: null, DefenseStrength: 20, FoodPerTurn: 6,
            },
          },
        },
        military: { 'Unit Stats': ['Legion'] },
      };
      const before = JSON.parse(JSON.stringify(reports));
      const ladder: TrimStep[] = [
        { id: 'drop-noise', events: 'noise', note: 'noise' },
        { id: 'drop-city-fields', cityFields: ['FoodPerTurn'], note: 'yields' },
        { id: 'drop-unit-stats', militaryKeys: ['Unit Stats'], note: 'unit stats' },
        { id: 'trim-relationships', cityStateRelationships: true, note: 'relationships' },
      ];

      trimToFit(reports, ladder, () => false, { civilization: 'Rome' });

      expect(reports).toEqual(before);
    });

    describe('the real ladder', () => {
      /** Trimmable reports shaped like the MCP knowledge tools' output, each with trimmable content. */
      function realisticReports(): TrimmableReports {
        return {
          events: {
            '4': [
              { Type: 'DeclareWar', OriginatingPlayer: 2 },
              { Type: 'TeamTechResearched', Tech: 'Bronze Working' },
              { Type: 'SetPopulation', City: 'Antium', Population: 5 },
            ],
            '5': [
              { Type: 'SetAlly', Target: 2 },
              { Type: 'CombatResult', Winner: 'Rome' },
              { Type: 'CityTrained', City: 'Antium', Unit: 'Legion' },
              { Type: 'UnitKilledInCombat', Loser: 'Greece' },
              { Type: 'TileRevealed', X: 12, Y: 8 },
              { Type: 'GameSave' },
            ],
            _markdownConfig: { configs: ['Turn {key}'] },
          },
          players: {
            '1': { Civilization: 'Rome', Leader: 'Caesar', IsMajor: true, OurOpinionOfThem: ['Fear their army (-80)'] },
            '2': {
              Civilization: 'Greece', Leader: 'Gorgo', IsMajor: true,
              OurOpinionOfThem: [
                'Trade partners (+40)', 'War weariness (-80)', 'Holy city (+30)',
                'Contested borders (-60)', 'Wonder race (+10)', 'Old grievance (-20)',
              ],
              TheirOpinionOfUs: [
                'Likes your religion', 'Fears your army', 'Trades with you',
                'Envious of your capital', 'Disputes your borders',
              ],
              Relationships: { Rome: ['Warm', 'Trade partners'] },
            },
            '3': 'Babylon',
            '4': {
              Civilization: 'Genoa', Leader: 'Doge', IsMajor: false,
              MajorAlly: 'Rome', Quests: ['Spread the word about Genoa'],
              Relationships: { Rome: ['Friendly'], Greece: ['Wary'], Persia: ['Neutral'] },
            },
            // A city-state with no IsMajor field and no relationship with the context civilization.
            '5': { Civilization: 'Veni', Leader: 'Dandolo', Relationships: { Greece: ['Wary'] } },
          },
          cities: {
            '1': {
              Antium: {
                ID: 1, X: 12, Y: 8, Population: 6, MajorityReligion: null, DefenseStrength: 45,
                IsCapital: true, Wonders: ['Great Library'], ImportantBuildings: ['Granary', 'Library'],
                BuildingCount: 7, GreatWorkCount: 2, FoodStored: 12, FoodPerTurn: 6,
                ProductionPerTurn: 8, ProductionTurnsLeft: 3, HappinessDelta: 2, GoldPerTurn: 3, SciencePerTurn: 7,
              },
            },
            '2': {
              Athens: {
                ID: 4, X: 20, Y: 15, Population: 4, MajorityReligion: 'Orthodoxy', DefenseStrength: 30,
                IsCapital: true, Wonders: [], ImportantBuildings: ['Marketplace'],
                BuildingCount: 5, GreatWorkCount: 0, FoodPerTurn: 5, ProductionPerTurn: 4,
                ProductionTurnsLeft: 6, HappinessDelta: -1, CulturePerTurn: 3,
              },
            },
          },
          military: {
            'Unit Stats': [{ Name: 'Swordsman', Count: 6 }],
            'Rome Core Zone 1': {
              ZoneValue: 3, City: 'Antium', AreaID: 7, Plots: 21, CenterX: 12, CenterY: 8, Units: ['Legion'],
            },
            'Persia Frontier Zone 2': {
              ZoneValue: 1, EnemyStrength: 4, AreaID: 7, Plots: 9, CenterX: 18, CenterY: 10, Units: [], Neighbors: [1],
            },
            'Zone Unassigned': { Units: ['Scout'] },
          },
        } as unknown as TrimmableReports;
      }

      it('should run every applicable step and leave only what no step names', () => {
        const reports = realisticReports();

        // Victory progress, options, and the situation are not trimmable reports, so they are
        // outside the ladder's reach. Nothing fits here: the walk must run the whole ladder.
        const result = trimToFit(reports, evaluatorTrimConfig.ladder, () => false, { civilization: 'Rome' });

        expect(result.fits).toBe(false);
        expect(result.steps.map(step => step.id)).toEqual(evaluatorTrimConfig.ladder.map(step => step.id));

        // Events: only the turning-points and diplomacy tiers survive; the render hint stays.
        expect(keptTypes(result.reports.events).sort()).toEqual(['DeclareWar', 'SetAlly']);
        expect(result.droppedEvents).toBe(7);
        expect(result.reports.events).toHaveProperty('_markdownConfig');

        // Military: the unit stats table and zone geometry are gone; every zone keeps its
        // strengths, units, and neighbors.
        const military = result.reports.military as Record<string, Record<string, unknown>>;
        expect(military).not.toHaveProperty('Unit Stats');
        expect(military['Zone Unassigned']).toEqual({ Units: ['Scout'] });
        for (const zone of ['Rome Core Zone 1', 'Persia Frontier Zone 2']) {
          expect(Object.keys(military[zone]), zone).toEqual(expect.arrayContaining(['ZoneValue', 'Units']));
          for (const gone of ['AreaID', 'Plots', 'CenterX', 'CenterY']) {
            expect(military[zone], `${zone} ${gone}`).not.toHaveProperty(gone);
          }
        }
        expect(military['Persia Frontier Zone 2'].Neighbors).toEqual([1]);

        // Players: string entries ride along untouched, majors keep their flag.
        expect(result.reports.players?.['3']).toBe('Babylon');
        expect(playerOf(result.reports, '1').IsMajor).toBe(true);
        expect(playerOf(result.reports, '2').IsMajor).toBe(true);
        expect(playerOf(result.reports, '4').IsMajor).toBe(false);
        expect(playerOf(result.reports, '5')).not.toHaveProperty('IsMajor');

        // City-states keep quests and ally; relationships keep only our entry, or go entirely.
        expect(playerOf(result.reports, '4').Quests).toEqual(['Spread the word about Genoa']);
        expect(playerOf(result.reports, '4').MajorAlly).toBe('Rome');
        expect(playerOf(result.reports, '4').Relationships).toEqual({ Rome: ['Friendly'] });
        expect(playerOf(result.reports, '5')).not.toHaveProperty('Relationships');

        // A major's relationships are no step's to trim.
        expect(playerOf(result.reports, '2').Relationships).toEqual({ Rome: ['Warm', 'Trade partners'] });

        // Opinions: Greece's weighted list compressed, its unweighted list and Rome's one-liner
        // stayed as they were.
        expect(playerOf(result.reports, '2').OurOpinionOfThem).toHaveLength(4);
        expect(playerOf(result.reports, '2').TheirOpinionOfUs).toEqual(
          (reports.players?.['2'] as Record<string, unknown>).TheirOpinionOfUs,
        );
        expect(playerOf(result.reports, '1').OurOpinionOfThem).toEqual(['Fear their army (-80)']);

        // Cities: population, wonders, capital status, turns-left, and happiness survive;
        // buildings, yields, IDs, and coordinates do not.
        for (const city of [cityOf(result.reports, '1', 'Antium'), cityOf(result.reports, '2', 'Athens')]) {
          expect(Object.keys(city)).toEqual(expect.arrayContaining([
            'Population', 'Wonders', 'IsCapital', 'ProductionTurnsLeft', 'HappinessDelta',
          ]));
          for (const gone of ['ImportantBuildings', 'FoodPerTurn', 'ProductionPerTurn', 'ID', 'X', 'Y']) {
            expect(city, gone).not.toHaveProperty(gone);
          }
        }
      });
    });
  });

  describe('compressOpinions', () => {
    describe('weighted lists', () => {
      it('should keep the largest weights in their original order and merge the rest', () => {
        const lines = [
          'Trade partners (+40)',
          'War weariness (-80)',
          'Holy city (+30)',
          'Contested borders (-60)',
          'Wonder race (+10)',
          'Old grievance (-20)',
        ];

        const result = compressOpinions(lines, 2);

        expect(result).toBeDefined();
        expect(result).toHaveLength(3);
        expect(result![0]).toBe('War weariness (-80)');
        expect(result![1]).toBe('Contested borders (-60)');
        // The merged line's weight is the sum of every dropped factor (40 + 30 + 10 - 20).
        expect(trailingWeight(result![2])).toBe(60);
      });

      it('should always keep lines without a weight', () => {
        const summary = 'The leader pursues a cultural victory';
        const lines = [summary, 'War weariness (-70)', 'Trade (+5)', 'Borders (-4)', 'Faith (+3)', 'Wonder (-2)'];

        const result = compressOpinions(lines, 2);

        expect(result).toHaveLength(4);
        expect(result![0]).toBe(summary);
        // The dropped factors (-4 + 3 - 2) merge into one line carrying their sum.
        expect(trailingWeight(result![3])).toBe(-3);
      });

      it('should read a weight written with a trailing period', () => {
        const lines = ['Old grievance (-51).', 'Trade partners (+9)', 'Contested borders (-8)', 'Holy city (+7)'];

        const result = compressOpinions(lines, 2);

        // Without the period the list would be short enough to keep whole.
        expect(result).toBeDefined();
        expect(result![0]).toBe('Old grievance (-51).');
        // The two dropped factors (-8 + 7) merge into one line carrying their sum.
        expect(trailingWeight(result![result!.length - 1])).toBe(-1);
      });

      it('should return undefined when the weighted count is at most keep plus one', () => {
        const lines = ['War weariness (-70)', 'Trade (+5)', 'Borders (-40)', 'The leader admires your culture'];

        // Three weighted lines (the plain summary does not count) against keep + 1 = 3.
        expect(compressOpinions(lines, 2)).toBeUndefined();
      });
    });

    describe('unweighted lists', () => {
      it('should leave a list without any weights alone, since it cannot be ranked', () => {
        const lines = [
          'Likes your religion', 'Fears your army', 'Trades with you',
          'Envious of your capital', 'Disputes your borders',
        ];

        expect(compressOpinions(lines, 2)).toBeUndefined();
      });
    });
  });
});
