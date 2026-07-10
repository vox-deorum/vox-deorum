/**
 * @module archivist/pipeline/game-state-vector
 *
 * Adapter that converts live MCP report types (PlayersReport, CitiesReport,
 * VictoryProgressReport) into the archivist pipeline's input types (TurnContext,
 * RawEpisode), then calls transformEpisode() to produce game-state and neighbor
 * feature vectors for similarity search against archived episodes.
 */

import type { Selectable } from 'kysely';
import type {
  PlayerSummary,
  CityInformation,
  VictoryProgress,
  PlayerInformation,
} from '../../../../mcp-server/dist/knowledge/schema/index.js';
import type { PlayersReport } from '../../../../mcp-server/dist/tools/knowledge/get-players.js';
import type { CitiesReport } from '../../../../mcp-server/dist/tools/knowledge/get-cities.js';
import type { VictoryProgressReport } from '../../../../mcp-server/dist/tools/knowledge/get-victory-progress.js';
import type { GameState } from '../../strategist/strategy-parameters.js';
import type { RawEpisode, TurnContext } from '../types.js';
import { countPolicies, parseDiplomatics, extractAllVictoryProgress } from '../utils/game-data.js';
import { transformEpisode } from './transformer.js';

/**
 * Convert MCP report objects into a TurnContext suitable for the archivist transformer.
 *
 * Iterates PlayersReport entries, skipping unmet/defeated players (string values),
 * and builds PlayerSummary, PlayerInformation, CityInformation, and VictoryProgress
 * shaped objects that match the Kysely Selectable types expected by transformEpisode.
 */
export function reportsToTurnContext(
  players: PlayersReport,
  cities?: CitiesReport,
  victory?: VictoryProgressReport,
  totalMajors?: number
): TurnContext {
  const playerSummaries = new Map<number, Selectable<PlayerSummary>>();
  const playerInfos = new Map<number, Selectable<PlayerInformation>>();

  // 1-2. Iterate PlayersReport, skip string entries (unmet/defeated)
  for (const [idStr, entry] of Object.entries(players)) {
    if (typeof entry === 'string') continue;

    const key = parseInt(idStr, 10);

    // Build PlayerSummary-shaped object (PascalCase fields)
    const summary = {
      Key: key,
      Turn: 0,
      Score: entry.Score ?? null,
      Era: entry.Era ?? null,
      Votes: entry.Votes ?? null,
      MajorAlly: entry.MajorAlly ?? null,
      Cities: entry.Cities ?? null,
      Population: entry.Population ?? 0,
      Territory: entry.Territory ?? null,
      BestSettlementLocation: null,
      Gold: entry.Gold ?? null,
      GoldPerTurn: entry.GoldPerTurn ?? null,
      HappinessPercentage: entry.HappinessPercentage ?? null,
      GoldenAge: null,
      TourismPerTurn: entry.TourismPerTurn ?? null,
      CulturePerTurn: entry.CulturePerTurn ?? null,
      FaithPerTurn: entry.FaithPerTurn ?? null,
      SciencePerTurn: entry.SciencePerTurn ?? null,
      Technologies: entry.Technologies ?? null,
      CurrentResearch: null,
      NextPolicyTurns: null,
      MilitaryUnits: entry.MilitaryUnits ?? null,
      MilitarySupply: entry.MilitarySupply ?? null,
      MilitaryStrength: entry.MilitaryStrength ?? null,
      PolicyBranches: entry.PolicyBranches ?? null,
      FoundedReligion: entry.FoundedReligion ?? null,
      MajorityReligion: entry.MajorityReligion ?? null,
      Resources: null,
      Relationships: entry.Relationships ?? null,
      OutgoingTradeRoutes: null,
      IncomingTradeRoutes: null,
      Spies: null,
      DiplomaticDeals: null,
      Quests: null,
      DiplomatPoints: null,
    } as Selectable<PlayerSummary>;

    playerSummaries.set(key, summary);

    // 3. Build PlayerInformation-shaped object
    const info = {
      Key: key,
      Civilization: entry.Civilization,
      Leader: entry.Leader,
      IsMajor: entry.IsMajor ? 1 : 0,
      IsHuman: 0,
      TeamID: entry.TeamID ?? 0,
      Data: {},
    } as Selectable<PlayerInformation>;

    playerInfos.set(key, info);
  }

  // 4. Convert CitiesReport to flat CityInformation[]
  const cityInformations: Selectable<CityInformation>[] = [];
  if (cities) {
    let cityKey = 0;
    for (const [civName, civCities] of Object.entries(cities)) {
      for (const [, cityData] of Object.entries(civCities)) {
        cityInformations.push({
          Key: cityKey++,
          Turn: 0,
          Owner: civName,
          MajorityReligion: cityData.MajorityReligion ?? null,
          ProductionPerTurn: cityData.ProductionPerTurn ?? null,
          FoodPerTurn: cityData.FoodPerTurn ?? null,
          Population: cityData.Population,
        } as any as Selectable<CityInformation>);
      }
    }
  }

  // 5. Convert VictoryProgressReport to VictoryProgress-shaped object
  let victoryProgress: Selectable<VictoryProgress> | null = null;
  if (victory) {
    victoryProgress = {
      DominationVictory: victory.DominationVictory,
      ScienceVictory: victory.ScienceVictory,
      CulturalVictory: victory.CulturalVictory,
      DiplomaticVictory: victory.DiplomaticVictory,
    } as any as Selectable<VictoryProgress>;
  }

  return {
    playerSummaries,
    cityInformations,
    victoryProgress,
    playerInfos,
    totalMajors,
  };
}

/**
 * Build a single RawEpisode for a specified player from MCP report data.
 *
 * Returns undefined if the player is not found in the PlayersReport or is
 * unmet/defeated (string entry).
 */
export function reportsToRawEpisode(
  players: PlayersReport,
  playerId: number,
  gameId: string,
  turn: number,
  cities?: CitiesReport,
  victory?: VictoryProgressReport,
  options?: {
    grandStrategy?: string | null;
    isWinner?: boolean;
    situationAbstract?: string | null;
    decisionAbstract?: string | null;
    situation?: string | null;
    decisions?: string | null;
  }
): RawEpisode | undefined {
  // 1. Get the player entry
  const playerEntry = players[String(playerId)];
  if (!playerEntry || typeof playerEntry === 'string') return undefined;

  const civilization = playerEntry.Civilization;

  // 2. Build majorCivNames set
  const majorCivNames = new Set<string>();
  for (const entry of Object.values(players)) {
    if (typeof entry === 'string') continue;
    if (entry.IsMajor) {
      majorCivNames.add(entry.Civilization);
    }
  }

  // 3. Parse diplomatics
  const relationships = (playerEntry.Relationships as Record<string, string | string[]>) ?? null;
  const diplomatics = parseDiplomatics(relationships, majorCivNames);

  // 4. Aggregate productionPerTurn and foodPerTurn from CitiesReport
  let productionPerTurn: number | null = null;
  let foodPerTurn: number | null = null;
  if (cities && cities[civilization]) {
    let totalProduction = 0;
    let totalFood = 0;
    let found = false;
    for (const cityData of Object.values(cities[civilization])) {
      found = true;
      totalProduction += cityData.ProductionPerTurn ?? 0;
      totalFood += cityData.FoodPerTurn ?? 0;
    }
    if (found) {
      productionPerTurn = totalProduction;
      foodPerTurn = totalFood;
    }
  }

  // 5. Extract victory progress
  let victoryRow: Selectable<VictoryProgress> | null = null;
  if (victory) {
    victoryRow = {
      DominationVictory: victory.DominationVictory,
      ScienceVictory: victory.ScienceVictory,
      CulturalVictory: victory.CulturalVictory,
      DiplomaticVictory: victory.DiplomaticVictory,
    } as any as Selectable<VictoryProgress>;
  }
  const victoryFields = extractAllVictoryProgress(victoryRow, civilization);

  // 6. Count policies
  const policies = countPolicies(
    (playerEntry.PolicyBranches as Record<string, string[] | number>) ?? null
  );

  // 7. Count minor allies
  let minorAllies = 0;
  for (const entry of Object.values(players)) {
    if (typeof entry === 'string') continue;
    if (!entry.IsMajor && entry.MajorAlly === civilization) {
      minorAllies++;
    }
  }

  // 8. Assemble and return the RawEpisode
  return {
    gameId,
    turn,
    playerId,
    civilization,
    isWinner: options?.isWinner ?? false,
    era: (playerEntry.Era as string) ?? 'Unknown',
    grandStrategy: options?.grandStrategy ?? null,
    ...diplomatics,
    score: playerEntry.Score ?? null,
    cities: playerEntry.Cities ?? null,
    population: playerEntry.Population ?? null,
    goldPerTurn: playerEntry.GoldPerTurn ?? null,
    culturePerTurn: playerEntry.CulturePerTurn ?? null,
    tourismPerTurn: playerEntry.TourismPerTurn ?? null,
    militaryStrength: playerEntry.MilitaryStrength ?? null,
    militaryUnits: (playerEntry.MilitaryUnits as number | undefined) ?? null,
    militarySupply: (playerEntry.MilitarySupply as number | undefined) ?? null,
    technologies: playerEntry.Technologies ?? null,
    votes: (playerEntry.Votes as number | undefined) ?? null,
    happinessPercentage: playerEntry.HappinessPercentage ?? null,
    productionPerTurn,
    foodPerTurn,
    policies,
    minorAllies,
    ...victoryFields,
    situationAbstract: options?.situationAbstract ?? null,
    decisionAbstract: options?.decisionAbstract ?? null,
    situation: options?.situation ?? null,
    decisions: options?.decisions ?? null,
  };
}

/**
 * Build game-state and neighbor feature vectors from a live GameState snapshot.
 *
 * Converts MCP reports to archivist input types, then runs the transformer
 * pipeline to produce normalized vectors suitable for similarity search
 * against archived game episodes.
 *
 * @returns The 35-element gameStateVector and 32-element neighborVector, or
 *          undefined if the player data is unavailable.
 */
export function buildLiveGameStateVector(
  state: GameState,
  playerId: number,
  gameId: string,
  options?: {
    grandStrategy?: string | null;
    isWinner?: boolean;
    totalMajors?: number;
  }
): { gameStateVector: number[]; neighborVector: number[] } | undefined {
  // 1. Players report is required
  if (!state.players) return undefined;

  // 2. Build TurnContext
  const turnContext = reportsToTurnContext(
    state.players,
    state.cities,
    state.victory,
    options?.totalMajors
  );

  // 3. Build RawEpisode
  const rawEpisode = reportsToRawEpisode(
    state.players,
    playerId,
    gameId,
    state.turn,
    state.cities,
    state.victory,
    options
  );

  // 4. RawEpisode may be undefined if player not found
  if (!rawEpisode) return undefined;

  // 5. Transform to full Episode with computed vectors
  const episode = transformEpisode(rawEpisode, turnContext);

  // 6. Return the feature vectors
  return {
    gameStateVector: episode.gameStateVector,
    neighborVector: episode.neighborVector,
  };
}
