/**
 * @module archivist/utils/vectors
 *
 * Feature vector construction for the archivist pipeline.
 * Builds the 35-element game state vector and 32-element neighbor vector
 * used for similarity search and diversity selection.
 */

import type { Selectable } from 'kysely';
import type { PlayerSummary } from '../../../../mcp-server/dist/knowledge/schema/index.js';
import type { Episode, TurnContext } from '../types.js';
import { eraMap } from '../types.js';
import { clamp, normalizeShare } from './math.js';
import { countPolicies } from './game-data.js';
import { hasDefensivePact, isAtWar, isFriend, isMasterOf, isVassalOf } from '../../../../mcp-server/dist/diplomacy/relationships.js';

// ---------------------------------------------------------------------------
// Neighbor vector helpers
// ---------------------------------------------------------------------------

/** Distance rank: lower = closer. */
export function parseDistance(statuses: string[]): number {
  for (const s of statuses) {
    if (s.includes('Distance: Neighbors')) return 0;
    if (s.includes('Distance: Close')) return 1;
    if (s.includes('Distance: Far')) return 2;
    if (s.includes('Distance: Distant')) return 3;
  }
  return 3; // default: distant
}

/** Parse stance from relationship status strings. Higher = more hostile. */
export function parseStance(statuses: string[]): number {
  let stance = 2; // default: neutral
  for (const s of statuses) {
    if (isAtWar(s)) return 4;
    if (s === 'Denounced Them' || isVassalOf(s)) {
      if (stance < 3) stance = 3;
    }
    if (isFriend(s) || isMasterOf(s)) {
      if (stance > 1) stance = 1;
    }
    if (hasDefensivePact(s)) {
      stance = 0;
    }
  }
  return stance;
}

export interface NeighborFeatures {
  distanceRank: number;
  strengthRatio: number;
  stanceNorm: number;
  techGap: number;
  policyGap: number;
}

export const NEUTRAL_PAD: [number, number, number, number] = [0.2, 0.5, 0.5, 0.5];

/**
 * Build the 32-element neighbor vector.
 * 8 slots × 4 features. Sorted by distance rank first, then strength_ratio descending.
 */
export function buildNeighborVector(
  playerSummary: Selectable<PlayerSummary>,
  turnContext: TurnContext,
  civToPlayerId: Map<string, number>,
  playerTech: number | null,
  playerPolicies: number | null,
  playerMilitary: number | null
): number[] {
  const relationships = playerSummary.Relationships as Record<string, string | string[]> | null;
  if (!relationships) {
    return Array(32).fill(0).map((_, i) => NEUTRAL_PAD[i % 4]);
  }

  const safeMilitary = (playerMilitary != null && playerMilitary > 0) ? playerMilitary : 1;
  const neighbors: NeighborFeatures[] = [];

  for (const [civName, statuses] of Object.entries(relationships)) {
    const statusArray = Array.isArray(statuses) ? statuses : [statuses];

    // Only major civs
    const neighborPid = civToPlayerId.get(civName);
    if (neighborPid == null) continue;
    const neighborInfo = turnContext.playerInfos.get(neighborPid);
    if (!neighborInfo || neighborInfo.IsMajor !== 1) continue;

    const distanceRank = parseDistance(statusArray);
    const stance = parseStance(statusArray);

    // Filter: only Neighbors (0) and Close (1)
    if (distanceRank > 1) continue;

    const neighborSummary = turnContext.playerSummaries.get(neighborPid);
    if (!neighborSummary) continue;

    const nMilitary = (neighborSummary.MilitaryStrength as number) ?? 0;
    const nTech = (neighborSummary.Technologies as number) ?? 0;
    const nPolicies = countPolicies(neighborSummary.PolicyBranches as Record<string, string[]> | null) ?? 0;

    const rawRatio = nMilitary / safeMilitary;
    const strengthRatio = clamp(rawRatio, 0, 5) / 5;
    const stanceNorm = stance / 4;
    const techGap = clamp((nTech - (playerTech ?? 0)) / 20 + 0.5, 0, 1);
    const policyGap = clamp((nPolicies - (playerPolicies ?? 0)) / 10 + 0.5, 0, 1);

    neighbors.push({ distanceRank, strengthRatio, stanceNorm, techGap, policyGap });
  }

  // Sort by distance rank ascending, then strength ratio descending
  neighbors.sort((a, b) => {
    if (a.distanceRank !== b.distanceRank) return a.distanceRank - b.distanceRank;
    return b.strengthRatio - a.strengthRatio;
  });

  // Build 32-element vector: 8 slots × 4 features
  const vector: number[] = [];
  for (let i = 0; i < 8; i++) {
    if (i < neighbors.length) {
      const n = neighbors[i];
      vector.push(n.strengthRatio, n.stanceNorm, n.techGap, n.policyGap);
    } else {
      vector.push(...NEUTRAL_PAD);
    }
  }
  return vector;
}

// ---------------------------------------------------------------------------
// Game state vector
// ---------------------------------------------------------------------------

/** Build the 35-element game state vector from computed Episode fields. */
export function buildGameStateVector(
  ep: Omit<Episode, 'gameStateVector' | 'neighborVector' | 'situationAbstractEmbedding' | 'isLandmark'>
): number[] {
  const eraOrdinal = eraMap[ep.era] ?? 0;
  const gs = ep.grandStrategy ?? '';

  return [
    eraOrdinal / 7 * 2,                                                    // [0]
    // --- Grand strategy one-hot (4 elements) ---
    gs === 'Conquest' ? 1 : 0,                                         // [1]
    gs === 'Culture' ? 1 : 0,                                          // [2]
    gs === 'United Nations' ? 1 : 0,                                   // [3]
    gs === 'Spaceship' ? 1 : 0,                                        // [4]
    // --- Shares (6 elements, relative-to-fair-share, clamp [0.25,4.0] → [0,1]) ---
    normalizeShare(ep.tourismShare),                                    // [5]
    normalizeShare(ep.militaryShare),                                   // [6]
    normalizeShare(ep.citiesShare),                                     // [7]
    normalizeShare(ep.populationShare),                                 // [8]
    normalizeShare(ep.votesShare),                                      // [9]
    normalizeShare(ep.minorAlliesShare),                                // [10]
    // --- Per-pop metrics (6 elements, clamped [1, 10] → [0, 1]) ---
    (clamp(ep.sciencePerPop ?? 1, 1, 10) - 1) / 9,                    // [11]
    (clamp(ep.faithPerPop ?? 1, 1, 10) - 1) / 9,                      // [12]
    (clamp(ep.productionPerPop ?? 1, 1, 10) - 1) / 9,                 // [13]
    (clamp(ep.foodPerPop ?? 1, 1, 10) - 1) / 9,                       // [14]
    (clamp(ep.culturePerPop ?? 1, 1, 10) - 1) / 9,                    // [15]
    (clamp(ep.goldPerPop ?? 1, 1, 10) - 1) / 9,                       // [16]
    // --- Bidirectional gaps (negative = leading, positive = behind) ---
    clamp(ep.technologiesGap / 20 + 0.5, 0, 1),                       // [17]  range [-10, +10]
    clamp(ep.policiesGap / 10 + 0.5, 0, 1),                           // [18]  range [-5, +5]
    // --- Percentages (4 elements) ---
    clamp((ep.happinessPercentage ?? 0) / 100, 0, 1),                  // [19]
    clamp(ep.religionPercentage, 0, 1),                                // [20]
    clamp(ep.ideologyShare, 0, 1),                                     // [21]
    clamp(ep.supplyUtilization ?? 0, 0, 1),                            // [22]
    // --- Diplomatic (8 elements) ---
    ep.isVassal,                                                       // [23]
    clamp(ep.vassals / 2, 0, 1),                                       // [24]
    clamp(ep.warWeariness / 100, 0, 1),                                // [25]
    clamp(ep.activeWars / 3, 0, 1),                                    // [26]
    clamp(ep.truces / 3, 0, 1),                                        // [27]
    clamp(ep.friends / 3, 0, 1),                                       // [28]
    clamp(ep.defensivePacts / 3, 0, 1),                                // [29]
    clamp(ep.denouncements / 3, 0, 1),                                 // [30]
    // --- Victory gaps (4 elements, leaderProgress - playerProgress, range [-50, +50]) ---
    clamp(((ep.dominationLeaderProgress ?? 0) - (ep.dominationProgress ?? 0) + 50) / 100, 0, 1),  // [31]
    clamp(((ep.scienceLeaderProgress ?? 0) - (ep.scienceProgress ?? 0) + 50) / 100, 0, 1),        // [32]
    clamp(((ep.cultureLeaderProgress ?? 0) - (ep.cultureProgress ?? 0) + 50) / 100, 0, 1),        // [33]
    clamp(((ep.diplomaticLeaderProgress ?? 0) - (ep.diplomaticProgress ?? 0) + 50) / 100, 0, 1),  // [34]
  ];
}
