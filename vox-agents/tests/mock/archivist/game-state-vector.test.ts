/**
 * Tests for the live-game-state adapter (game-state-vector): converting MCP report
 * shapes into archivist TurnContext / RawEpisode, and building live feature vectors.
 * Pure computation over inline GameState / PlayersReport fixtures (no I/O).
 */
import { describe, it, expect } from 'vitest';
import {
  reportsToTurnContext,
  reportsToRawEpisode,
  buildLiveGameStateVector,
} from '../../../src/archivist/pipeline/game-state-vector.js';
import type { GameState } from '../../../src/strategist/strategy-parameters.js';
import type { PlayersReport } from '../../../../mcp-server/dist/tools/knowledge/get-players.js';
import type { CitiesReport } from '../../../../mcp-server/dist/tools/knowledge/get-cities.js';
import type { VictoryProgressReport } from '../../../../mcp-server/dist/tools/knowledge/get-victory-progress.js';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

/** A single live player entry with neutral defaults. */
function makePlayer(overrides: Partial<Record<string, any>> = {}): any {
  return {
    Civilization: 'Rome',
    Leader: 'Augustus',
    IsMajor: true,
    Score: 100,
    Era: 'Medieval Era',
    Cities: 3,
    Population: 50,
    Technologies: 12,
    GoldPerTurn: 15,
    CulturePerTurn: 10,
    TourismPerTurn: 5,
    MilitaryStrength: 200,
    MilitaryUnits: 8,
    MilitarySupply: 10,
    Votes: 4,
    HappinessPercentage: 60,
    ...overrides,
  };
}

/** Build a PlayersReport from [idStr -> entry] pairs (entry may be a string for unmet/defeated). */
function makePlayersReport(entries: Record<string, any>): PlayersReport {
  return entries as PlayersReport;
}

/** A cities report: { CivName: { cityId: cityData } }. */
function makeCities(byCiv: Record<string, Array<{ ProductionPerTurn?: number; FoodPerTurn?: number; Population?: number; MajorityReligion?: string | null }>>): CitiesReport {
  const report: any = {};
  for (const [civ, cities] of Object.entries(byCiv)) {
    report[civ] = {};
    cities.forEach((c, i) => {
      report[civ][`city-${i}`] = {
        ID: i,
        X: 0,
        Y: 0,
        Population: c.Population ?? 5,
        MajorityReligion: c.MajorityReligion ?? null,
        DefenseStrength: 0,
        ProductionPerTurn: c.ProductionPerTurn,
        FoodPerTurn: c.FoodPerTurn,
      };
    });
  }
  return report as CitiesReport;
}

// ---------------------------------------------------------------------------
// reportsToTurnContext
// ---------------------------------------------------------------------------

describe('reportsToTurnContext', () => {
  it('should skip unmet/defeated string entries and map live player entries', () => {
    const players = makePlayersReport({
      '0': makePlayer({ Civilization: 'Rome', IsMajor: true }),
      '1': makePlayer({ Civilization: 'Egypt', IsMajor: true }),
      '2': 'unmet',
      '3': 'defeated',
    });

    const ctx = reportsToTurnContext(players, undefined, undefined, 6);

    // Only the two non-string entries are mapped.
    expect(ctx.playerSummaries.size).toBe(2);
    expect(ctx.playerInfos.size).toBe(2);
    expect(ctx.playerSummaries.has(0)).toBe(true);
    expect(ctx.playerSummaries.has(2)).toBe(false);
    expect(ctx.playerSummaries.has(3)).toBe(false);
    // totalMajors passthrough.
    expect(ctx.totalMajors).toBe(6);
    // PlayerInformation mapping: IsMajor boolean -> 1/0.
    expect(ctx.playerInfos.get(0)!.IsMajor).toBe(1);
    expect(ctx.playerInfos.get(0)!.Civilization).toBe('Rome');
  });

  it('should map summary scalar fields from the player entry', () => {
    const players = makePlayersReport({
      '0': makePlayer({ Score: 321, Era: 'Atomic Era', Cities: 7, GoldPerTurn: 42 }),
    });
    const summary = reportsToTurnContext(players).playerSummaries.get(0)!;
    expect(summary.Score).toBe(321);
    expect(summary.Era).toBe('Atomic Era');
    expect(summary.Cities).toBe(7);
    expect(summary.GoldPerTurn).toBe(42);
    expect(summary.Turn).toBe(0);
  });

  it('should flatten a CitiesReport into per-owner CityInformation rows', () => {
    const players = makePlayersReport({ '0': makePlayer({ Civilization: 'Rome' }) });
    const cities = makeCities({
      Rome: [{ ProductionPerTurn: 5, FoodPerTurn: 6 }, { ProductionPerTurn: 4, FoodPerTurn: 3 }],
      Egypt: [{ ProductionPerTurn: 2, FoodPerTurn: 1 }],
    });
    const ctx = reportsToTurnContext(players, cities);
    expect(ctx.cityInformations).toHaveLength(3);
    const owners = ctx.cityInformations.map((c) => c.Owner).sort();
    expect(owners).toEqual(['Egypt', 'Rome', 'Rome']);
  });

  it('should map a victory report into a victory-progress row, else null', () => {
    const players = makePlayersReport({ '0': makePlayer() });
    const victory = { DominationVictory: { Rome: { CapitalsPercentage: 25 } } } as unknown as VictoryProgressReport;
    expect(reportsToTurnContext(players, undefined, victory).victoryProgress).not.toBeNull();
    expect(reportsToTurnContext(players).victoryProgress).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reportsToRawEpisode
// ---------------------------------------------------------------------------

describe('reportsToRawEpisode', () => {
  it('should return undefined when the player is missing or unmet/defeated', () => {
    const players = makePlayersReport({ '0': makePlayer(), '2': 'unmet' });
    expect(reportsToRawEpisode(players, 5, 'g', 1)).toBeUndefined(); // not present
    expect(reportsToRawEpisode(players, 2, 'g', 1)).toBeUndefined(); // string entry
  });

  it('should aggregate city yields for the player civilization only', () => {
    const players = makePlayersReport({ '0': makePlayer({ Civilization: 'Rome' }) });
    const cities = makeCities({
      Rome: [{ ProductionPerTurn: 5, FoodPerTurn: 6 }, { ProductionPerTurn: 4, FoodPerTurn: 3 }],
      Egypt: [{ ProductionPerTurn: 99, FoodPerTurn: 99 }],
    });
    const ep = reportsToRawEpisode(players, 0, 'g', 7, cities)!;
    expect(ep.productionPerTurn).toBe(9);
    expect(ep.foodPerTurn).toBe(9);
    expect(ep.turn).toBe(7);
    expect(ep.gameId).toBe('g');
  });

  it('should leave city yields null when the civ owns no cities in the report', () => {
    const players = makePlayersReport({ '0': makePlayer({ Civilization: 'Rome' }) });
    const cities = makeCities({ Egypt: [{ ProductionPerTurn: 5, FoodPerTurn: 6 }] });
    const ep = reportsToRawEpisode(players, 0, 'g', 1, cities)!;
    expect(ep.productionPerTurn).toBeNull();
    expect(ep.foodPerTurn).toBeNull();
  });

  it('should count individual policies from PolicyBranches', () => {
    const players = makePlayersReport({
      '0': makePlayer({ PolicyBranches: { Tradition: ['a', 'b'], Liberty: ['c'] } }),
    });
    expect(reportsToRawEpisode(players, 0, 'g', 1)!.policies).toBe(3);
  });

  it('should count minor allies whose MajorAlly is the player civ', () => {
    const players = makePlayersReport({
      '0': makePlayer({ Civilization: 'Rome', IsMajor: true }),
      '1': makePlayer({ Civilization: 'Egypt', IsMajor: true }),
      '8': makePlayer({ Civilization: 'Venice', IsMajor: false, MajorAlly: 'Rome' }),
      '9': makePlayer({ Civilization: 'Geneva', IsMajor: false, MajorAlly: 'Egypt' }),
    });
    expect(reportsToRawEpisode(players, 0, 'g', 1)!.minorAllies).toBe(1);
  });

  it('should parse diplomacy counts against major civs only', () => {
    const players = makePlayersReport({
      '0': makePlayer({
        Civilization: 'Rome',
        IsMajor: true,
        Relationships: {
          Egypt: ['War (Our War Weariness: 40%)'],
          Greece: ['Declaration of Friendship'],
          Venice: ['War'], // minor — must be ignored
        },
      }),
      '1': makePlayer({ Civilization: 'Egypt', IsMajor: true }),
      '2': makePlayer({ Civilization: 'Greece', IsMajor: true }),
      '8': makePlayer({ Civilization: 'Venice', IsMajor: false }),
    });
    const ep = reportsToRawEpisode(players, 0, 'g', 1)!;
    expect(ep.activeWars).toBe(1); // only Egypt (major)
    expect(ep.warWeariness).toBe(40);
    expect(ep.friends).toBe(1); // Greece
  });

  it('should map victory progress fields and honor option flags', () => {
    const players = makePlayersReport({ '0': makePlayer({ Civilization: 'Rome' }) });
    const victory = {
      DominationVictory: { Rome: { CapitalsPercentage: 30 }, Contender: 'Egypt', Egypt: { CapitalsPercentage: 70 } },
    } as unknown as VictoryProgressReport;
    const ep = reportsToRawEpisode(players, 0, 'g', 1, undefined, victory, {
      grandStrategy: 'Conquest',
      isWinner: true,
      situationAbstract: 'sa',
    })!;
    expect(ep.dominationProgress).toBe(30);
    expect(ep.dominationLeaderProgress).toBe(70);
    expect(ep.grandStrategy).toBe('Conquest');
    expect(ep.isWinner).toBe(true);
    expect(ep.situationAbstract).toBe('sa');
    // Defaults for unspecified text fields.
    expect(ep.decisions).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildLiveGameStateVector
// ---------------------------------------------------------------------------

describe('buildLiveGameStateVector', () => {
  /** Build a minimal live GameState. */
  function makeState(players: PlayersReport | undefined, opts: { cities?: CitiesReport; victory?: VictoryProgressReport; turn?: number } = {}): GameState {
    return {
      turn: opts.turn ?? 50,
      players,
      cities: opts.cities,
      victory: opts.victory,
      reports: {},
    };
  }

  it('should return undefined when there is no players report', () => {
    const state = makeState(undefined);
    expect(buildLiveGameStateVector(state, 0, 'g')).toBeUndefined();
  });

  it('should return undefined when the requested player is not in the report', () => {
    const players = makePlayersReport({ '0': makePlayer() });
    const state = makeState(players);
    expect(buildLiveGameStateVector(state, 42, 'g')).toBeUndefined();
  });

  it('should return undefined when the requested player is unmet/defeated', () => {
    const players = makePlayersReport({ '0': makePlayer(), '1': 'defeated' });
    const state = makeState(players);
    expect(buildLiveGameStateVector(state, 1, 'g')).toBeUndefined();
  });

  it('should produce 35-element game-state and 32-element neighbor vectors', () => {
    const players = makePlayersReport({
      '0': makePlayer({ Civilization: 'Rome', MilitaryStrength: 200 }),
      '1': makePlayer({ Civilization: 'Egypt', MilitaryStrength: 150 }),
    });
    const cities = makeCities({ Rome: [{ ProductionPerTurn: 5, FoodPerTurn: 6 }] });
    const state = makeState(players, { cities });

    const result = buildLiveGameStateVector(state, 0, 'g', { totalMajors: 2 });
    expect(result).toBeDefined();
    expect(result!.gameStateVector).toHaveLength(35);
    expect(result!.neighborVector).toHaveLength(32);

    for (const v of result!.gameStateVector) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
    }
    for (const v of result!.neighborVector) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('should encode grand strategy as a one-hot in the game-state vector', () => {
    const players = makePlayersReport({ '0': makePlayer({ Civilization: 'Rome' }) });
    const state = makeState(players);
    const culture = buildLiveGameStateVector(state, 0, 'g', { grandStrategy: 'Culture' })!.gameStateVector;
    // one-hot occupies indices [1..4]: Conquest, Culture, United Nations, Spaceship.
    expect(culture.slice(1, 5)).toEqual([0, 1, 0, 0]);
    const none = buildLiveGameStateVector(state, 0, 'g')!.gameStateVector;
    expect(none.slice(1, 5)).toEqual([0, 0, 0, 0]);
  });
});
