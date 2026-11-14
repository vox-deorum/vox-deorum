import { CaptureTypes } from "../../database/enums/CaptureTypes.js";
import { TradeConnectionTypes } from "../../database/enums/ConnectionTypes.js";
import { FeatureTypes } from "../../database/enums/FeatureTypes.js";
import { GuessConfidenceTypes } from "../../database/enums/GuessConfidenceTypes.js";
import { PlotTypes } from "../../database/enums/PlotTypes.js";
import { RouteTypes } from "../../database/enums/RouteTypes.js";
import { SpyResult } from "../../database/enums/SpyResult.js";
import { TerrainTypes } from "../../database/enums/TerrainTypes.js";
import { TradeableItems } from "../../database/enums/TradeableItems.js";
import { UnitAITypes } from "../../database/enums/UnitAITypes.js";
import { YieldTypes } from "../../database/enums/YieldTypes.js";

// Mappings between object keys and mappings.
export const enumMappings: Record<string, Record<number, string>> = {
  "TerrainType": TerrainTypes,
  "FeatureType": FeatureTypes,
  "RouteType": RouteTypes,
  "PlotType": PlotTypes,
  "AIType": UnitAITypes,
  "YieldType": YieldTypes,
  "ConnectionType": TradeConnectionTypes,
  "CaptureType": CaptureTypes,
  "GuessConfidence": GuessConfidenceTypes,
  "ItemType": TradeableItems,
  "SpyResult": SpyResult,
}

/**
 * Recursively scans through an object and replaces enum values with their mappings
 * @param obj The object to scan and transform
 * @returns A new object with enum values replaced by their mappings
 */
export function explainEnums<T extends Record<string, any>>(obj: T): T {
  const entries = Object.entries(obj);
  // Handle objects
  for (const [key, value] of entries) {
    // Check if this key has an enum mapping (exact match or fuzzy match)
    let enumMapping: Record<number, string> | undefined;
    
    // First try exact match
    if (key in enumMappings) {
      enumMapping = enumMappings[key];
    } else {
      // Try fuzzy match: check if key ends with any of the enum mapping keys
      const lowerKey = key.toLowerCase();
      for (const [mappingKey, mappingValue] of Object.entries(enumMappings)) {
        if (lowerKey.endsWith(mappingKey.toLowerCase())) {
          enumMapping = mappingValue;
          break;
        }
      }
    }
    
    if (enumMapping) {
      // Try to replace the value with the enum mapping
      if (typeof value === 'number' && value in enumMapping) {
        (obj as any)[key] = enumMapping[value];
      } else {
        // Keep original value if not found in mapping
        (obj as any)[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively process nested objects
      (obj as any)[key] = explainEnums(value);
    } else {
      // Keep original value for non-mapped keys
      (obj as any)[key] = value;
    }
  }
  return obj;
}

/**
 * Try to retrieve enum values from the string representation.
 * @param type The enum type key (e.g., "YieldType", "TerrainType")
 * @param value The string value to look up (e.g., "Food", "Gold")
 * @returns The numeric enum value, or -1 if not found
 */
export function retrieveEnumValue(type: string, value?: string): number {
  if (!value) return -1;

  // First try exact match for the type
  let enumMapping: Record<number, string> | undefined;

  if (type in enumMappings) {
    enumMapping = enumMappings[type];
  } else {
    throw new Error(`Enum type not found: ${type}`);
  }

  // If we found a matching enum mapping, search for the value
  for (const [numKey, strValue] of Object.entries(enumMapping)) {
    if (strValue === value) return Number(numKey);
  }

  // Return -1 if not found (following Civ5 convention for "None")
  return -1;
}

/**
 * Convert a numeric enum value back to its string representation
 * @param type The enum type key (e.g., "YieldType", "TerrainType")
 * @param value The numeric value to look up
 * @returns The string representation, or undefined if not found
 */
export function retrieveEnumName(type: string, value?: number | null): string | undefined {
  if (value === undefined || value === null) return undefined;

  // First try exact match for the type
  let enumMapping: Record<number, string> | undefined;

  if (type in enumMappings) {
    enumMapping = enumMappings[type];
  } else {
    throw new Error(`Enum type not found: ${type}`);
  }

  // Return the string value if found
  return enumMapping[value];
}

/**
 * Convert strategy result object with numeric IDs to string names
 * @param strategies Object containing strategy fields with numeric values
 * @returns Object with strategy names as strings
 */
export function convertStrategyToNames(strategies: {
  GrandStrategy?: number;
  EconomicStrategies?: number[];
  MilitaryStrategies?: number[];
}): {
  GrandStrategy: string | undefined;
  EconomicStrategies: string[] | undefined;
  MilitaryStrategies: string[] | undefined;
} {
  const result: any = {};

  if (strategies.GrandStrategy !== undefined) {
    result.GrandStrategy = retrieveEnumName("GrandStrategy", strategies.GrandStrategy);
  }

  if (strategies.EconomicStrategies) {
    result.EconomicStrategies = strategies.EconomicStrategies
      .map((id: number) => retrieveEnumName("EconomicStrategy", id))
      .filter((name: string | undefined) => name !== undefined).sort();
  }

  if (strategies.MilitaryStrategies) {
    result.MilitaryStrategies = strategies.MilitaryStrategies
      .map((id: number) => retrieveEnumName("MilitaryStrategy", id))
      .filter((name: string | undefined) => name !== undefined).sort();
  } 

  return result;
}