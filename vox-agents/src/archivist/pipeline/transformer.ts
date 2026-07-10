/**
 * @module archivist/pipeline/transformer
 *
 * Pure computation module that transforms RawEpisode + TurnContext into Episode.
 * Computes city-adjusted shares, per-pop metrics, gaps, ideology, religion,
 * game state vector (35d), and neighbor vector (32d).
 * No async, no I/O — all data comes from the extraction phase.
 */

import type { RawEpisode, Episode, TurnContext } from '../types.js';
import {
  scaleShare,
  computeCityAdjustedShare,
  computeRawShare,
  computePerPop,
  computeGapBidirectional,
} from '../utils/math.js';
import {
  countPolicies,
  detectIdeology,
  computeReligionPercentage,
} from '../utils/game-data.js';
import {
  buildNeighborVector,
  buildGameStateVector,
  NEUTRAL_PAD,
} from '../utils/vectors.js';

// ---------------------------------------------------------------------------
// Main transform function
// ---------------------------------------------------------------------------

/**
 * Transform a raw episode into a full episode with computed fields.
 * Pure computation — no I/O.
 */
export function transformEpisode(raw: RawEpisode, turnContext: TurnContext): Episode {
  // Build civ name → player ID lookup
  const civToPlayerId = new Map<string, number>();
  for (const [pid, info] of turnContext.playerInfos) {
    civToPlayerId.set(info.Civilization, pid);
  }

  // Collect all alive major players' data for share computation
  const majorPlayerData: Array<{
    playerId: number;
    cities: number | null;
    population: number | null;
    culture: number | null;
    tourism: number | null;
    gold: number | null;
    military: number | null;
    technologies: number | null;
    policies: number | null;
    votes: number | null;
    minorAllies: number | null;
    score: number | null;
    policyBranches: Record<string, string[]> | null;
  }> = [];

  for (const [pid, summary] of turnContext.playerSummaries) {
    const info = turnContext.playerInfos.get(pid);
    if (!info || info.IsMajor !== 1) continue;

    majorPlayerData.push({
      playerId: pid,
      cities: summary.Cities as number | null,
      population: summary.Population as number | null,
      culture: summary.CulturePerTurn as number | null,
      tourism: summary.TourismPerTurn as number | null,
      gold: summary.GoldPerTurn as number | null,
      military: summary.MilitaryStrength as number | null,
      technologies: summary.Technologies as number | null,
      policies: countPolicies(summary.PolicyBranches as Record<string, string[]> | null),
      votes: summary.Votes as number | null,
      minorAllies: null, // computed separately below
      score: summary.Score as number | null,
      policyBranches: summary.PolicyBranches as Record<string, string[]> | null,
    });
  }

  // Compute minor allies for all majors (needed for share)
  for (const p of majorPlayerData) {
    const info = turnContext.playerInfos.get(p.playerId);
    if (!info) continue;
    let count = 0;
    for (const [sid, summary] of turnContext.playerSummaries) {
      const sInfo = turnContext.playerInfos.get(sid);
      if (!sInfo || sInfo.IsMajor === 1) continue;
      if ((summary.MajorAlly as string) === info.Civilization) count++;
    }
    p.minorAllies = count;
  }

  // Regularize shares to relative-to-fair-share (1.0 = average player)
  const knownMajors = majorPlayerData.length;
  const shareScale = knownMajors;

  // City-adjusted shares
  const tourismShare = scaleShare(computeCityAdjustedShare(raw.tourismPerTurn, raw.cities,
    majorPlayerData.map(p => ({ value: p.tourism, cities: p.cities }))), shareScale);
  const militaryShare = scaleShare(computeCityAdjustedShare(raw.militaryStrength, raw.cities,
    majorPlayerData.map(p => ({ value: p.military, cities: p.cities }))), shareScale);

  // Raw shares
  const citiesShare = scaleShare(computeRawShare(raw.cities, majorPlayerData.map(p => p.cities)), shareScale);
  const populationShare = scaleShare(computeRawShare(raw.population, majorPlayerData.map(p => p.population)), shareScale);
  const votesShare = scaleShare(computeRawShare(raw.votes, majorPlayerData.map(p => p.votes)), shareScale);
  const minorAlliesShare = scaleShare(computeRawShare(raw.minorAllies, majorPlayerData.map(p => p.minorAllies)), shareScale);

  // Player summary for this player (needed for per-pop, religion, ideology)
  const playerSummary = turnContext.playerSummaries.get(raw.playerId);

  // Per-pop (science/faith sourced from PlayerSummary since they're not stored as raw columns)
  const sciencePerTurnValue = (playerSummary?.SciencePerTurn as number | null) ?? null;
  const faithPerTurnValue = (playerSummary?.FaithPerTurn as number | null) ?? null;
  const sciencePerPop = computePerPop(sciencePerTurnValue, raw.population);
  const faithPerPop = computePerPop(faithPerTurnValue, raw.population);
  const productionPerPop = computePerPop(raw.productionPerTurn, raw.population);
  const foodPerPop = computePerPop(raw.foodPerTurn, raw.population);
  const culturePerPop = computePerPop(raw.culturePerTurn, raw.population);
  const goldPerPop = computePerPop(raw.goldPerTurn, raw.population);

  // Bidirectional gaps (bestOther - player: negative = leading, positive = behind)
  const otherData = majorPlayerData.filter(p => p.playerId !== raw.playerId);
  const technologiesGap = computeGapBidirectional(raw.technologies, otherData.map(p => p.technologies));
  const policiesGap = computeGapBidirectional(raw.policies, otherData.map(p => p.policies));
  // Supply utilization
  const supplyUtilization = (raw.militaryUnits != null && raw.militarySupply != null && raw.militarySupply > 0)
    ? raw.militaryUnits / raw.militarySupply
    : null;

  // Religion
  const foundedReligion = (playerSummary?.FoundedReligion as string | null) ?? null;
  const religionPercentage = computeReligionPercentage(foundedReligion, turnContext.cityInformations);

  // Ideology
  const playerPolicyBranches = playerSummary?.PolicyBranches as Record<string, string[]> | null;
  const playerIdeology = detectIdeology(playerPolicyBranches);
  let ideologyAllies = 0;
  if (playerIdeology) {
    for (const p of majorPlayerData) {
      if (detectIdeology(p.policyBranches) === playerIdeology) ideologyAllies++;
    }
  }
  const ideologyShare = majorPlayerData.length > 0 && playerIdeology
    ? ideologyAllies / majorPlayerData.length
    : 0;

  // Build partial episode (without vectors)
  const partial = {
    ...raw,
    tourismShare,
    militaryShare,
    citiesShare,
    populationShare,
    votesShare,
    minorAlliesShare,
    sciencePerPop,
    faithPerPop,
    productionPerPop,
    foodPerPop,
    culturePerPop,
    goldPerPop,
    technologiesGap,
    policiesGap,
    supplyUtilization,
    religionPercentage,
    ideologyAllies,
    ideologyShare,
  };

  // Game state vector (35 elements)
  const gameStateVector = buildGameStateVector(partial);

  // Neighbor vector (32 elements)
  const neighborVector = playerSummary
    ? buildNeighborVector(
        playerSummary,
        turnContext,
        civToPlayerId,
        raw.technologies,
        raw.policies,
        raw.militaryStrength
      )
    : Array(32).fill(0).map((_: number, i: number) => NEUTRAL_PAD[i % 4]);

  return {
    ...partial,
    gameStateVector,
    neighborVector,
    situationAbstractEmbedding: null,
    isLandmark: false,
  };
}
