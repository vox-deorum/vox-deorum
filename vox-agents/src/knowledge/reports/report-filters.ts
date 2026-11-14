/**
 * Utility functions for filtering player and city reports.
 * Provides elegant cherry-pick and discard operations on game data structures.
 */

import type { PlayersReport } from '../../../../mcp-server/dist/tools/knowledge/get-players.js';
import type { CitiesReport } from '../../../../mcp-server/dist/tools/knowledge/get-cities.js';

/**
 * Extract the PlayerData type from PlayersReport
 * PlayersReport is Record<string, PlayerData | string>
 */
type PlayerData = Exclude<PlayersReport[string], string>;

/**
 * Extract the CityData type from CitiesReport
 * CitiesReport is Record<string, Record<string, CityData>>
 */
type CityData = CitiesReport[string][string];

/**
 * Generic utility to pick specific fields from an object
 */
function pickFields<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  fields: K[]
): Pick<T, K> {
  return fields.reduce((result, field) => {
    if (field in obj) {
      result[field] = obj[field as keyof T] as any;
    }
    return result;
  }, {} as Pick<T, K>);
}

/**
 * Generic utility to omit specific fields from an object
 */
function omitFields<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  fields: K[]
): Omit<T, K> {
  return Object.entries(obj).reduce((result, [key, value]) => {
    if (!fields.includes(key as K)) {
      (result as any)[key] = value;
    }
    return result;
  }, {} as Omit<T, K>);
}

/**
 * Preserves the _markdownConfig property from source to target
 * This ensures jsonToMarkdown compatibility after filtering
 */
function preserveMarkdownConfig<T>(source: Record<string, unknown>, target: T): T {
  if ('_markdownConfig' in source && source._markdownConfig) {
    (target as Record<string, unknown>)._markdownConfig = source._markdownConfig;
  }
  return target;
}

/**
 * Cherry-picks specific fields from a players report.
 * Preserves string values for unmet/defeated players.
 *
 * @param players - The full players report
 * @param fields - Array of field names to include
 * @returns Filtered players report with only specified fields
 *
 * @example
 * const filtered = pickPlayerFields(players, ['Civilization', 'Score', 'Cities']);
 */
export function pickPlayerFields<K extends keyof PlayerData>(
  players: PlayersReport,
  fields: K[]
): Record<string, Pick<PlayerData, K> | string> {
  const result = Object.entries(players).reduce((acc, [playerName, playerData]) => {
    // Preserve string values (e.g., "Not met", "Defeated")
    if (typeof playerData === 'string') {
      acc[playerName] = playerData;
      return acc;
    }

    acc[playerName] = pickFields(playerData, fields);
    return acc;
  }, {} as Record<string, Pick<PlayerData, K> | string>);

  return preserveMarkdownConfig(players, result);
}

/**
 * Removes specific fields from a players report.
 * Preserves string values for unmet/defeated players.
 *
 * @param players - The full players report
 * @param fields - Array of field names to exclude
 * @returns Filtered players report without specified fields
 *
 * @example
 * const filtered = omitPlayerFields(players, ['Resources', 'ResourcesAvailable', 'Spies', 'Quests']);
 */
export function omitPlayerFields<K extends keyof PlayerData>(
  players: PlayersReport,
  fields: K[]
): Record<string, Omit<PlayerData, K> | string> {
  const result = Object.entries(players).reduce((acc, [playerName, playerData]) => {
    // Preserve string values (e.g., "Not met", "Defeated")
    if (typeof playerData === 'string') {
      acc[playerName] = playerData;
      return acc;
    }

    acc[playerName] = omitFields(playerData, fields);
    return acc;
  }, {} as Record<string, Omit<PlayerData, K> | string>);

  return preserveMarkdownConfig(players, result);
}

/**
 * Cherry-picks specific fields from a cities report.
 * Maintains the nested structure: { owner: { cityName: cityData } }
 *
 * @param cities - The full cities report
 * @param fields - Array of field names to include
 * @returns Filtered cities report with only specified fields
 *
 * @example
 * const filtered = pickCityFields(cities, ['Population', 'IsCapital', 'CurrentProduction']);
 */
export function pickCityFields<K extends keyof CityData>(
  cities: CitiesReport,
  fields: K[]
): Record<string, Record<string, Pick<CityData, K>>> {
  const result = Object.entries(cities).reduce((accOwner, [ownerName, ownerCities]) => {
    accOwner[ownerName] = Object.entries(ownerCities).reduce((accCity, [cityName, cityData]) => {
      accCity[cityName] = pickFields(cityData, fields);
      return accCity;
    }, {} as Record<string, Pick<CityData, K>>);

    return accOwner;
  }, {} as Record<string, Record<string, Pick<CityData, K>>>);

  return preserveMarkdownConfig(cities, result);
}

/**
 * Removes specific fields from a cities report.
 * Maintains the nested structure: { owner: { cityName: cityData } }
 *
 * @param cities - The full cities report
 * @param fields - Array of field names to exclude
 * @returns Filtered cities report without specified fields
 *
 * @example
 * const filtered = omitCityFields(cities, ['FoodStored', 'ProductionStored', 'RazingTurns']);
 */
export function omitCityFields<K extends keyof CityData>(
  cities: CitiesReport,
  fields: K[]
): Record<string, Record<string, Omit<CityData, K>>> {
  const result = Object.entries(cities).reduce((accOwner, [ownerName, ownerCities]) => {
    accOwner[ownerName] = Object.entries(ownerCities).reduce((accCity, [cityName, cityData]) => {
      accCity[cityName] = omitFields(cityData, fields);
      return accCity;
    }, {} as Record<string, Omit<CityData, K>>);

    return accOwner;
  }, {} as Record<string, Record<string, Omit<CityData, K>>>);

  return preserveMarkdownConfig(cities, result);
}

/**
 * Filters players report by removing detailed fields that are not needed for high-level strategic decisions.
 * Removes: Spies, Quests, IncomingTradeRoutes, OutgoingTradeRoutes, Resources, ResourcesAvailable, DiplomaticDeals
 *
 * @param players - The full players report
 * @returns Filtered players report for strategic analysis
 *
 * @example
 * const filtered = getStrategicPlayersReport(state.players!);
 */
export function getStrategicPlayersReport(players: PlayersReport) {
  return omitPlayerFields(players, [
    'Spies', 'Quests', 'IncomingTradeRoutes', 'OutgoingTradeRoutes', 'Resources', 'ResourcesAvailable', 'DiplomaticDeals'
  ]);
}
