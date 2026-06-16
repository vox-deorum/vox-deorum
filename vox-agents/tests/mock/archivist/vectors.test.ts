/**
 * Tests for archivist feature-vector helpers: distance/stance parsing,
 * neighbor vector construction (filter/sort/pad/safe-ratio), and the
 * game-state vector dimensions, ranges, and grand-strategy one-hot contract.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDistance,
  parseStance,
  buildNeighborVector,
  buildGameStateVector,
  NEUTRAL_PAD,
} from '../../../src/archivist/utils/vectors.js';
import type { Episode, TurnContext } from '../../../src/archivist/types.js';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

type GameStateInput = Omit<Episode, 'gameStateVector' | 'neighborVector' | 'situationAbstractEmbedding' | 'isLandmark'>;

/** Build the game-state vector input with neutral defaults. */
function makeGsInput(overrides: Partial<GameStateInput> = {}): GameStateInput {
  return {
    gameId: 'g',
    turn: 1,
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
    score: null,
    cities: null,
    population: null,
    goldPerTurn: null,
    culturePerTurn: null,
    tourismPerTurn: null,
    militaryStrength: null,
    technologies: null,
    votes: null,
    happinessPercentage: 50,
    productionPerTurn: null,
    foodPerTurn: null,
    policies: null,
    minorAllies: null,
    militaryUnits: null,
    militarySupply: null,
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
    // computed fields
    tourismShare: null,
    militaryShare: null,
    citiesShare: null,
    populationShare: null,
    votesShare: null,
    minorAlliesShare: null,
    sciencePerPop: null,
    faithPerPop: null,
    productionPerPop: null,
    foodPerPop: null,
    culturePerPop: null,
    goldPerPop: null,
    technologiesGap: 0,
    policiesGap: 0,
    supplyUtilization: null,
    religionPercentage: 0,
    ideologyAllies: 0,
    ideologyShare: 0,
    ...overrides,
  };
}

function makeInfo(civ: string, isMajor = 1): any {
  return { Civilization: civ, IsMajor: isMajor };
}

function makeSummary(overrides: Record<string, any> = {}): any {
  return {
    MilitaryStrength: 100,
    Technologies: 10,
    PolicyBranches: null,
    Relationships: null,
    ...overrides,
  };
}

/** Build a TurnContext from a list of neighbor descriptors. */
function makeContext(
  neighbors: Array<{ pid: number; civ: string; summary?: Record<string, any>; isMajor?: number }>
): { ctx: TurnContext; civToPlayerId: Map<string, number> } {
  const playerInfos = new Map<number, any>();
  const playerSummaries = new Map<number, any>();
  const civToPlayerId = new Map<string, number>();
  for (const n of neighbors) {
    playerInfos.set(n.pid, makeInfo(n.civ, n.isMajor ?? 1));
    playerSummaries.set(n.pid, makeSummary(n.summary));
    civToPlayerId.set(n.civ, n.pid);
  }
  const ctx: TurnContext = {
    playerInfos,
    playerSummaries,
    cityInformations: [],
    victoryProgress: null,
  };
  return { ctx, civToPlayerId };
}

// ---------------------------------------------------------------------------
// parseDistance
// ---------------------------------------------------------------------------

describe('parseDistance', () => {
  it('should rank Neighbors=0, Close=1, Far=2, Distant=3', () => {
    expect(parseDistance(['Distance: Neighbors'])).toBe(0);
    expect(parseDistance(['Distance: Close'])).toBe(1);
    expect(parseDistance(['Distance: Far'])).toBe(2);
    expect(parseDistance(['Distance: Distant'])).toBe(3);
  });

  it('should default to distant (3) when no distance marker is present', () => {
    expect(parseDistance(['War', 'Denounced Them'])).toBe(3);
    expect(parseDistance([])).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseStance
// ---------------------------------------------------------------------------

describe('parseStance', () => {
  it('should default to neutral (2)', () => {
    expect(parseStance(['Distance: Close'])).toBe(2);
  });

  it('should return war (4) immediately for a war status', () => {
    expect(parseStance(['War (Our Score: 10)'])).toBe(4);
    expect(parseStance(['War'])).toBe(4);
  });

  it('should raise hostility to 3 for denouncements / being a vassal master', () => {
    expect(parseStance(['Denounced Them'])).toBe(3);
    expect(parseStance(['Our Master'])).toBe(3);
  });

  it('should lower to 1 for friendship / having a vassal', () => {
    expect(parseStance(['Declaration of Friendship'])).toBe(1);
    expect(parseStance(['Our Vassal'])).toBe(1);
  });

  it('should drop to 0 for a defensive pact', () => {
    expect(parseStance(['Defensive Pact'])).toBe(0);
  });

  it('should let war override everything', () => {
    expect(parseStance(['Defensive Pact', 'War (Our Score: 1)'])).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// buildNeighborVector
// ---------------------------------------------------------------------------

describe('buildNeighborVector', () => {
  it('should return a fully neutral-padded vector when relationships are null', () => {
    const summary = makeSummary({ Relationships: null });
    const { ctx, civToPlayerId } = makeContext([]);
    const v = buildNeighborVector(summary, ctx, civToPlayerId, 10, 5, 100);
    expect(v).toHaveLength(32);
    for (let i = 0; i < v.length; i++) {
      expect(v[i]).toBe(NEUTRAL_PAD[i % 4]);
    }
  });

  it('should filter out far/distant and non-major neighbors', () => {
    const summary = makeSummary({
      Relationships: {
        Egypt: ['Distance: Neighbors'],
        Greece: ['Distance: Far'], // filtered: too far
        CityState: ['Distance: Neighbors'], // filtered: not major
        Unknown: ['Distance: Neighbors'], // filtered: not in civToPlayerId
      },
    });
    const { ctx, civToPlayerId } = makeContext([
      { pid: 1, civ: 'Egypt', summary: { MilitaryStrength: 100 } },
      { pid: 2, civ: 'Greece', summary: { MilitaryStrength: 100 } },
      { pid: 3, civ: 'CityState', summary: { MilitaryStrength: 100 }, isMajor: 0 },
    ]);
    const v = buildNeighborVector(summary, ctx, civToPlayerId, 10, 5, 100);
    // Only Egypt should occupy slot 0; slots 1..7 are neutral pads
    expect(v.slice(4, 8)).toEqual([...NEUTRAL_PAD]);
    // slot 0 strength ratio = clamp(100/100,0,5)/5 = 0.2, NOT the 0.2 pad coincidence -
    // verify stance/tech/policy differ from a pure pad to confirm it's a real neighbor
    expect(v.slice(0, 4)).not.toEqual([...NEUTRAL_PAD]);
  });

  it('should sort by distance rank ascending then strength ratio descending', () => {
    const summary = makeSummary({
      Relationships: {
        Weak: ['Distance: Neighbors'],
        Strong: ['Distance: Neighbors'],
        CloseOne: ['Distance: Close'],
      },
    });
    const { ctx, civToPlayerId } = makeContext([
      { pid: 1, civ: 'Weak', summary: { MilitaryStrength: 50 } },
      { pid: 2, civ: 'Strong', summary: { MilitaryStrength: 400 } },
      { pid: 3, civ: 'CloseOne', summary: { MilitaryStrength: 1000 } },
    ]);
    const v = buildNeighborVector(summary, ctx, civToPlayerId, 0, 0, 100);
    // strengthRatio is the first feature of each 4-tuple
    const ratio0 = v[0];
    const ratio1 = v[4];
    const ratio2 = v[8];
    // Neighbors first: Strong (clamp(4)/5=0.8) before Weak (0.5/5=0.1);
    // then the Close one (clamp(10->5)/5=1.0) last.
    expect(ratio0).toBeCloseTo(0.8); // Strong
    expect(ratio1).toBeCloseTo(0.1); // Weak
    expect(ratio2).toBeCloseTo(1.0); // CloseOne (rank 1, sorts after both rank-0)
  });

  it('should use a safe military denominator of 1 when player military is null or non-positive', () => {
    const summary = makeSummary({
      Relationships: { Egypt: ['Distance: Neighbors'] },
    });
    const { ctx, civToPlayerId } = makeContext([
      { pid: 1, civ: 'Egypt', summary: { MilitaryStrength: 3 } },
    ]);
    // playerMilitary null -> safe denominator 1 -> rawRatio = 3, clamped to 5, /5 = 0.6
    const vNull = buildNeighborVector(summary, ctx, civToPlayerId, 0, 0, null);
    expect(vNull[0]).toBeCloseTo(3 / 5);
    const vZero = buildNeighborVector(summary, ctx, civToPlayerId, 0, 0, 0);
    expect(vZero[0]).toBeCloseTo(3 / 5);
  });

  it('should pad unused slots with NEUTRAL_PAD and keep values within [0,1]', () => {
    const summary = makeSummary({
      Relationships: { Egypt: ['Distance: Neighbors', 'War (Our Score: 1)'] },
    });
    const { ctx, civToPlayerId } = makeContext([
      { pid: 1, civ: 'Egypt', summary: { MilitaryStrength: 200, Technologies: 30 } },
    ]);
    const v = buildNeighborVector(summary, ctx, civToPlayerId, 10, 5, 100);
    expect(v).toHaveLength(32);
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    // slot 1 onward (indices 4+) should be neutral pads
    expect(v.slice(4)).toEqual(Array.from({ length: 28 }, (_, i) => NEUTRAL_PAD[i % 4]));
    // war stance feature normalized: stance 4 / 4 = 1
    expect(v[1]).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// buildGameStateVector
// ---------------------------------------------------------------------------

describe('buildGameStateVector', () => {
  it('should produce a 35-element vector', () => {
    expect(buildGameStateVector(makeGsInput())).toHaveLength(35);
  });

  it('should encode the era ordinal at index 0 as ordinal/7*2', () => {
    expect(buildGameStateVector(makeGsInput({ era: 'Ancient Era' }))[0]).toBeCloseTo(0);
    expect(buildGameStateVector(makeGsInput({ era: 'Information Era' }))[0]).toBeCloseTo(2);
    expect(buildGameStateVector(makeGsInput({ era: 'Medieval Era' }))[0]).toBeCloseTo((2 / 7) * 2);
    // unknown era falls back to ordinal 0
    expect(buildGameStateVector(makeGsInput({ era: 'Nonexistent' }))[0]).toBe(0);
  });

  it('should encode grand strategy as a one-hot at indices [1..4]', () => {
    const oneHot = (gs: string | null) => buildGameStateVector(makeGsInput({ grandStrategy: gs })).slice(1, 5);
    expect(oneHot('Conquest')).toEqual([1, 0, 0, 0]);
    expect(oneHot('Culture')).toEqual([0, 1, 0, 0]);
    expect(oneHot('United Nations')).toEqual([0, 0, 1, 0]);
    expect(oneHot('Spaceship')).toEqual([0, 0, 0, 1]);
    expect(oneHot(null)).toEqual([0, 0, 0, 0]);
    expect(oneHot('Unknown Strategy')).toEqual([0, 0, 0, 0]);
  });

  it('should keep every element except the era slot within [0,1]', () => {
    const v = buildGameStateVector(
      makeGsInput({
        era: 'Information Era',
        tourismShare: 100,
        militaryShare: -50,
        sciencePerPop: 1000,
        technologiesGap: 9999,
        policiesGap: -9999,
        happinessPercentage: 500,
        warWeariness: 9999,
        activeWars: 100,
        supplyUtilization: 50,
        dominationLeaderProgress: 9999,
        dominationProgress: -9999,
      })
    );
    for (let i = 1; i < v.length; i++) {
      expect(v[i]).toBeGreaterThanOrEqual(0);
      expect(v[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should map a balanced gap of zero to the midpoint 0.5', () => {
    const v = buildGameStateVector(makeGsInput({ technologiesGap: 0, policiesGap: 0 }));
    expect(v[17]).toBeCloseTo(0.5); // tech gap midpoint
    expect(v[18]).toBeCloseTo(0.5); // policy gap midpoint
  });

  it('should default null share and per-pop inputs to their neutral encodings', () => {
    const v = buildGameStateVector(makeGsInput());
    // null share -> normalizeShare returns 0.5
    expect(v[5]).toBeCloseTo(0.5);
    // null per-pop -> defaulted to 1 -> (clamp(1,1,10)-1)/9 = 0
    expect(v[11]).toBeCloseTo(0);
  });
});
