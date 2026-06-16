/**
 * Tests for the archivist transformer: derived Episode fields and feature vectors.
 * Pure computation over inline RawEpisode + TurnContext fixtures (no I/O).
 */
import { describe, it, expect } from 'vitest';
import { transformEpisode } from '../../../src/archivist/pipeline/transformer.js';
import type { RawEpisode, TurnContext } from '../../../src/archivist/types.js';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

/** Build a RawEpisode with neutral defaults, overridable per test. */
function makeRaw(overrides: Partial<RawEpisode> = {}): RawEpisode {
  return {
    gameId: 'game-a',
    turn: 100,
    playerId: 0,
    civilization: 'Rome',
    isWinner: false,
    era: 'Medieval Era',
    grandStrategy: null,
    isVassal: 0,
    activeWars: 0,
    truces: 0,
    defensivePacts: 0,
    friends: 0,
    denouncements: 0,
    vassals: 0,
    warWeariness: 0,
    score: 100,
    cities: 1,
    population: 10,
    goldPerTurn: 20,
    culturePerTurn: 10,
    tourismPerTurn: 5,
    militaryStrength: 100,
    technologies: 10,
    votes: 2,
    happinessPercentage: 50,
    productionPerTurn: 30,
    foodPerTurn: 40,
    policies: 5,
    minorAllies: 1,
    militaryUnits: 8,
    militarySupply: 10,
    dominationProgress: null,
    scienceProgress: null,
    cultureProgress: null,
    diplomaticProgress: null,
    dominationLeaderProgress: null,
    scienceLeaderProgress: null,
    cultureLeaderProgress: null,
    diplomaticLeaderProgress: null,
    situationAbstract: null,
    decisionAbstract: null,
    situation: null,
    decisions: null,
    ...overrides,
  };
}

/** Minimal PlayerInformation row. */
function makeInfo(civ: string, isMajor = 1): any {
  return { Civilization: civ, IsMajor: isMajor };
}

/** Minimal PlayerSummary row. */
function makeSummary(overrides: Record<string, any> = {}): any {
  return {
    Cities: 1,
    Population: 10,
    CulturePerTurn: 10,
    TourismPerTurn: 5,
    GoldPerTurn: 20,
    MilitaryStrength: 100,
    Technologies: 10,
    Votes: 2,
    Score: 100,
    SciencePerTurn: 30,
    FaithPerTurn: 5,
    PolicyBranches: null,
    FoundedReligion: null,
    Relationships: null,
    MajorAlly: null,
    ...overrides,
  };
}

/**
 * Build a TurnContext given a list of [pid, civ, summaryOverrides, isMajor] tuples.
 * Always includes the player under test (raw.playerId) if listed.
 */
function makeContext(
  players: Array<{ pid: number; civ: string; summary?: Record<string, any>; isMajor?: number }>,
  cityInformations: any[] = []
): TurnContext {
  const playerInfos = new Map<number, any>();
  const playerSummaries = new Map<number, any>();
  for (const p of players) {
    playerInfos.set(p.pid, makeInfo(p.civ, p.isMajor ?? 1));
    playerSummaries.set(p.pid, makeSummary(p.summary));
  }
  return {
    playerInfos,
    playerSummaries,
    cityInformations,
    victoryProgress: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transformEpisode', () => {
  describe('share computations', () => {
    it('should scale raw shares so equal players land at the fair share (1.0)', () => {
      // Two identical majors: each has cities share 1/2 -> scaled by knownMajors(2) -> 1.0
      const raw = makeRaw({ playerId: 0, cities: 2, population: 100, votes: 4, minorAllies: 1 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { Cities: 2, Population: 100, Votes: 4 } },
        { pid: 1, civ: 'Egypt', summary: { Cities: 2, Population: 100, Votes: 4 } },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.citiesShare).toBeCloseTo(1.0);
      expect(ep.populationShare).toBeCloseTo(1.0);
      expect(ep.votesShare).toBeCloseTo(1.0);
    });

    it('should give a dominant player a share above the fair share', () => {
      const raw = makeRaw({ playerId: 0, cities: 3, population: 300 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { Cities: 3, Population: 300 } },
        { pid: 1, civ: 'Egypt', summary: { Cities: 1, Population: 100 } },
      ]);
      const ep = transformEpisode(raw, ctx);
      // 300/400 * 2 majors = 1.5
      expect(ep.populationShare).toBeCloseTo(1.5);
      expect(ep.citiesShare!).toBeGreaterThan(1.0);
    });

    it('should yield null shares when the source value is null', () => {
      const raw = makeRaw({ playerId: 0, cities: null, population: null, votes: null });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { Cities: null, Population: null, Votes: null } },
        { pid: 1, civ: 'Egypt' },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.citiesShare).toBeNull();
      expect(ep.populationShare).toBeNull();
      expect(ep.votesShare).toBeNull();
    });
  });

  describe('per-pop computations', () => {
    it('should divide per-turn yields by population', () => {
      const raw = makeRaw({ playerId: 0, population: 10, productionPerTurn: 30, foodPerTurn: 50, culturePerTurn: 20, goldPerTurn: 40 });
      const ctx = makeContext([{ pid: 0, civ: 'Rome', summary: { Population: 10, SciencePerTurn: 60, FaithPerTurn: 100 } }]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.productionPerPop).toBeCloseTo(3);
      expect(ep.foodPerPop).toBeCloseTo(5);
      expect(ep.culturePerPop).toBeCloseTo(2);
      expect(ep.goldPerPop).toBeCloseTo(4);
      // science/faith sourced from PlayerSummary
      expect(ep.sciencePerPop).toBeCloseTo(6);
      expect(ep.faithPerPop).toBeCloseTo(10);
    });

    it('should yield null per-pop when population is null', () => {
      const raw = makeRaw({ playerId: 0, population: null });
      const ctx = makeContext([{ pid: 0, civ: 'Rome', summary: { Population: null } }]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.productionPerPop).toBeNull();
      expect(ep.sciencePerPop).toBeNull();
      expect(ep.faithPerPop).toBeNull();
    });
  });

  describe('bidirectional gaps', () => {
    it('should be negative when leading the best other player in tech', () => {
      const raw = makeRaw({ playerId: 0, technologies: 30, policies: 12 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { Technologies: 30, PolicyBranches: { Tradition: ['a', 'b', 'c'] } } },
        { pid: 1, civ: 'Egypt', summary: { Technologies: 20, PolicyBranches: { Tradition: ['a'] } } },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.technologiesGap).toBe(-10); // 20 - 30
      expect(ep.policiesGap).toBe(-11); // 1 - 12
    });

    it('should be positive when trailing the best other player', () => {
      const raw = makeRaw({ playerId: 0, technologies: 10 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { Technologies: 10 } },
        { pid: 1, civ: 'Egypt', summary: { Technologies: 25 } },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.technologiesGap).toBe(15); // 25 - 10
    });
  });

  describe('supply utilization', () => {
    it('should compute units / supply', () => {
      const raw = makeRaw({ playerId: 0, militaryUnits: 8, militarySupply: 10 });
      const ctx = makeContext([{ pid: 0, civ: 'Rome' }]);
      expect(transformEpisode(raw, ctx).supplyUtilization).toBeCloseTo(0.8);
    });

    it('should be null when supply is null or zero', () => {
      const ctx = makeContext([{ pid: 0, civ: 'Rome' }]);
      expect(transformEpisode(makeRaw({ militarySupply: null }), ctx).supplyUtilization).toBeNull();
      expect(transformEpisode(makeRaw({ militarySupply: 0 }), ctx).supplyUtilization).toBeNull();
      expect(transformEpisode(makeRaw({ militaryUnits: null }), ctx).supplyUtilization).toBeNull();
    });
  });

  describe('religion percentage', () => {
    it('should be the fraction of cities with the founded religion', () => {
      const raw = makeRaw({ playerId: 0 });
      const cities = [
        { MajorityReligion: 'Christianity' },
        { MajorityReligion: 'Christianity' },
        { MajorityReligion: 'Buddhism' },
        { MajorityReligion: null },
      ];
      const ctx = makeContext([{ pid: 0, civ: 'Rome', summary: { FoundedReligion: 'Christianity' } }], cities);
      expect(transformEpisode(raw, ctx).religionPercentage).toBeCloseTo(2 / 4);
    });

    it('should be 0 when the player founded no religion', () => {
      const raw = makeRaw({ playerId: 0 });
      const ctx = makeContext([{ pid: 0, civ: 'Rome', summary: { FoundedReligion: null } }], [{ MajorityReligion: 'x' }]);
      expect(transformEpisode(raw, ctx).religionPercentage).toBe(0);
    });
  });

  describe('ideology', () => {
    it('should count allies sharing the player ideology and compute the share', () => {
      const raw = makeRaw({ playerId: 0 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { PolicyBranches: { Freedom: ['a'] } } },
        { pid: 1, civ: 'Egypt', summary: { PolicyBranches: { Freedom: ['b'] } } },
        { pid: 2, civ: 'Greece', summary: { PolicyBranches: { Order: ['c'] } } },
      ]);
      const ep = transformEpisode(raw, ctx);
      // 2 of 3 majors are Freedom
      expect(ep.ideologyAllies).toBe(2);
      expect(ep.ideologyShare).toBeCloseTo(2 / 3);
    });

    it('should report 0 allies and 0 share when the player has no ideology', () => {
      const raw = makeRaw({ playerId: 0 });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome', summary: { PolicyBranches: { Tradition: ['a'] } } },
        { pid: 1, civ: 'Egypt', summary: { PolicyBranches: { Freedom: ['b'] } } },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.ideologyAllies).toBe(0);
      expect(ep.ideologyShare).toBe(0);
    });
  });

  describe('feature vectors', () => {
    it('should produce a 35-element game state vector with values in valid ranges', () => {
      const raw = makeRaw({ playerId: 0, grandStrategy: 'Culture' });
      const ctx = makeContext([
        { pid: 0, civ: 'Rome' },
        { pid: 1, civ: 'Egypt' },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.gameStateVector).toHaveLength(35);
      for (const v of ep.gameStateVector) {
        expect(Number.isFinite(v)).toBe(true);
        // element [0] (era) can reach 2.0; all others are clamped/one-hot in [0,1]
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(2);
      }
    });

    it('should encode grand strategy as a one-hot at the expected slot', () => {
      const ctx = makeContext([{ pid: 0, civ: 'Rome' }]);
      const culture = transformEpisode(makeRaw({ grandStrategy: 'Culture' }), ctx).gameStateVector;
      // one-hot occupies indices [1..4]: Conquest, Culture, United Nations, Spaceship
      expect(culture.slice(1, 5)).toEqual([0, 1, 0, 0]);
      const conquest = transformEpisode(makeRaw({ grandStrategy: 'Conquest' }), ctx).gameStateVector;
      expect(conquest.slice(1, 5)).toEqual([1, 0, 0, 0]);
      const none = transformEpisode(makeRaw({ grandStrategy: null }), ctx).gameStateVector;
      expect(none.slice(1, 5)).toEqual([0, 0, 0, 0]);
    });

    it('should produce a 32-element neighbor vector with values in [0,1]', () => {
      const raw = makeRaw({ playerId: 0, militaryStrength: 100, technologies: 10, policies: 5 });
      const ctx = makeContext([
        {
          pid: 0,
          civ: 'Rome',
          summary: {
            MilitaryStrength: 100,
            Relationships: { Egypt: ['Distance: Neighbors', 'War (Our Score: 10)'] },
          },
        },
        { pid: 1, civ: 'Egypt', summary: { MilitaryStrength: 150, Technologies: 12 } },
      ]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.neighborVector).toHaveLength(32);
      for (const v of ep.neighborVector) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('should fall back to a neutral-padded neighbor vector when the player has no summary', () => {
      // raw.playerId not present in playerSummaries -> playerSummary undefined -> NEUTRAL_PAD fallback
      const raw = makeRaw({ playerId: 99 });
      const ctx = makeContext([{ pid: 0, civ: 'Rome' }]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.neighborVector).toHaveLength(32);
      // NEUTRAL_PAD = [0.2, 0.5, 0.5, 0.5] repeated
      expect(ep.neighborVector.slice(0, 4)).toEqual([0.2, 0.5, 0.5, 0.5]);
      expect(ep.neighborVector[4]).toBe(0.2);
    });
  });

  describe('passthrough and flags', () => {
    it('should carry through raw identity fields and set default flags', () => {
      const raw = makeRaw({ playerId: 0, gameId: 'g1', turn: 42, civilization: 'Rome' });
      const ctx = makeContext([{ pid: 0, civ: 'Rome' }]);
      const ep = transformEpisode(raw, ctx);
      expect(ep.gameId).toBe('g1');
      expect(ep.turn).toBe(42);
      expect(ep.civilization).toBe('Rome');
      expect(ep.isLandmark).toBe(false);
      expect(ep.situationAbstractEmbedding).toBeNull();
    });
  });
});
