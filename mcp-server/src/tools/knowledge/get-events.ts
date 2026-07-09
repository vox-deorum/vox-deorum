/**
 * Tool for retrieving game events from the knowledge database
 */

import { knowledgeManager } from "../../server.js";
import { ToolBase } from "../base.js";
import * as z from "zod";
import { isAfter, isAtTurn, isBeforeOrAt, isVisible } from "../../knowledge/expressions.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { parseVisibility } from "../../utils/knowledge/visibility.js";
import { getPlayerSummaries } from "../../knowledge/getters/player-summary.js";
import { PlayerSummary } from "../../knowledge/schema/timed.js";
import { Selectable } from "kysely";
import pluralize from 'pluralize-esm'

/**
 * Input schema for the GetEvents tool
 */
const GetEventsInputSchema = z.object({
  Turn: z.number().optional().describe("Turn number filter"),
  Type: z.string().optional().describe("Event type string filter"),
  After: z.number().optional().describe("Only filter events after the ID"),
  Before: z.number().optional().describe("Only filter events before or at the ID"),
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1).optional().describe("Player ID visibility filter"),
  Original: z.boolean().optional().describe("Send out original events before consolidation")
});

/**
 * Schema for game event output
 */
const GameEventOutputSchema = z.object({
  ID: z.number(),
  Turn: z.number(),
  Type: z.string(),
  Visibility: z.array(z.number()).optional()
}).passthrough();

/**
 * Consolidated event schema - can have:
 * - Events array (nested differing fields)
 * - Merged fields (single event)
 * - Property arrays (uniform properties like Plot: [...])
 */
const ConsolidatedEventSchema = z.object({
  Type: z.string(),
  Events: z.array(z.record(z.string(), z.any())).optional()
}).passthrough();

/**
 * Type for the tool's output - plain union of consolidated vs original format
 */
const GetEventsOutputSchema = z.union([
  z.object({ events: z.array(GameEventOutputSchema) }),  // Original format
  z.record(z.string(), z.array(ConsolidatedEventSchema))  // Consolidated format (turn-keyed)
]);

/**
 * Derive types from Zod schemas
 */
export type EventsReport = z.infer<typeof GetEventsOutputSchema>;
export type ConsolidatedEventsReport = Record<string, z.infer<typeof ConsolidatedEventSchema>[]>;

/**
 * Tool for retrieving game events with optional filtering
 */
class GetEventsTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-events";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves a detailed list of recent game events";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = GetEventsInputSchema;

  /**
   * Output schema for the tool
   */
  readonly outputSchema = GetEventsOutputSchema;

  /**
   * Optional annotations for the tool
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true
  }

  /**
   * Optional metadata for the tool
   */
  readonly metadata = {
    autoComplete: ["PlayerID", "Before", "After", "Original"],
    markdownConfig: ["Turn {key}", "{key}"]
  }

  /**
   * Execute the tool to retrieve game events
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const db = knowledgeManager.getStore().getDatabase();
    
    // Build the query
    let query = db.selectFrom("GameEvents")
      .selectAll();
    // Apply turn filter
    if (args.Turn !== undefined)
      query = query.where(isAtTurn(args.Turn));
    // Apply after filter
    if (args.After !== undefined)
      query = query.where(isAfter(args.After));
    // Apply before filter
    if (args.Before !== undefined)
      query = query.where(isBeforeOrAt(args.Before));
    // Apply after filter
    if (args.Type !== undefined)
      query = query.where('Type', '=', args.Type);
    // Apply player visibility filter if provided
    if (args.PlayerID !== undefined)
      query = query.where(isVisible(args.PlayerID));
    
    // Order by ID
    query = query.orderBy("ID");
    
    // Execute the query
    const events = await query.execute();

    // Get the player
    const player = args.PlayerID === undefined ? null :
      await knowledgeManager.getStore().getMutableKnowledge("PlayerSummaries", args.PlayerID, undefined, async () => await getPlayerSummaries());
    
    // Format the output
    const formattedEvents = events.map((event) => {
      const processedPayload = postprocessPayload({ ...(event.Payload as Record<string, unknown>) }, player);
      const toolPayload = event.Type === "DealMade"
        ? hideDealMadeTradeItems(processedPayload)
        : processedPayload;

      return {
        ID: event.ID,
        Turn: event.Turn,
        Type: event.Type,
        Visibility: args.PlayerID === undefined ? parseVisibility(event) : undefined,
        ...toolPayload
      };
    });
    
    // If consolidation is requested, group events by turn
    if (!args.Original) {
      const consolidatedEvents = consolidateEventsByTurn(formattedEvents);
      return consolidatedEvents;
    } else {
      return {
        events: formattedEvents
      }
    }
  }
}

/**
 * Creates a new instance of the get events tool
 */
export default function createGetEventsTool() {
  return new GetEventsTool();
}

/**
 * Configuration for event consolidation
 * Maps event types to their matching field paths (uses ID sub-field for matching)
 */
const consolidationConfig: Record<string, string[]> = {
  "StealPlot": ["FromPlayer", "ToPlayer"],
  "TileRevealed": ["Unit", "Player"],
  "UnitMoved": ["Unit", "Player"],
  "UnitPromoted": ["Unit", "Player"]
};

const blockedKeys: string[] = [ 
  "RevealedToTeam", "RevealedToTeamID", "RevealedByTeam", "RevealedByTeamID", "IsFirstDiscovery", 
  "DefenderMaxHp", "AttackerMaxHp" ];

/**
 * Strips the TradedItems detail from DealMade event payloads before output
 */
export function hideDealMadeTradeItems(payload: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...payload };
  delete cleaned.TradedItems;
  return cleaned;
}

/**
 * Consolidates events by turn, stripping turn and ID from individual events
 * @param events - Array of formatted events
 * @returns Object with turn keys containing arrays of events
 */
function consolidateEventsByTurn(events: Array<Record<string, unknown>>): Record<string, any[]> {
  const consolidated: Record<string, any[]> = {};
  
  for (const event of events) {
    const turnKey = `${event.Turn}`;
    
    // Create a copy of the event without Turn
    const { Turn, ID, ...eventWithoutTurn } = event;
    
    if (!consolidated[turnKey]) {
      consolidated[turnKey] = [];
    }
    consolidated[turnKey].push(cleanEventData(eventWithoutTurn));
  }

  for (const key of Object.keys(consolidated)) {
    consolidated[key] = consolidateConsecutiveEvents(consolidated[key]);
  }
  
  return consolidated;
}

/**
 * Consolidates consecutive events of the same type with matching fields
 */
function consolidateConsecutiveEvents(events: Array<Record<string, unknown>>): Array<any> {
  if (events.length === 0) return [];

  const result: Array<any> = [];
  let currentGroup: any = null;
  
  for (const event of events) {
    const eventType = event.Type as string;
    const matchFields = consolidationConfig[eventType];
    
    // If this event type isn't configured for consolidation, add as-is
    if (!matchFields) {
      // Flush current group if exists
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(event);
      continue;
    }
    
    // Check if we can add to current group
    if (currentGroup && 
        currentGroup.Type === eventType &&
        eventsMatch(currentGroup, event, matchFields)) {
    } else {
      // Flush current group if exists
      if (currentGroup) result.push(currentGroup);
      
      // Start new group
      const matchingFields: Record<string, unknown> = {};
      for (const field of matchFields) {
        if (event[field] !== undefined) {
          matchingFields[field] = event[field];
        }
      }
      
      currentGroup = {
        Type: eventType,
        ...matchingFields,
        Events: []
      };
    }

    // Add non-matching fields to the Events array
    const eventCopy = { ...event };
    
    // Remove matching fields and metadata from the event copy
    for (const field of matchFields) {
      delete eventCopy[field];
    }
    delete eventCopy.Type;
    
    // Only add if there are remaining fields
    if (eventCopy && Object.keys(eventCopy).length > 0) {
      currentGroup.Events.push(eventCopy);
    }
  }
  
  // Flush final group
  if (currentGroup) {
    result.push(currentGroup);
  }

  result.forEach(item => {
    if (!item.Events) return;
    // If no events, remove the Events array
    else if (item.Events.length === 0) delete item["Events"];
    // If only one event, merge it into the parent and remove the Events array
    else if (item.Events.length === 1) {
      Object.assign(item, item.Events[0]);
      delete item["Events"];
    } else {
      // Explicitly delete undefined keys from each event
      item.Events = (item.Events as Record<string, unknown>[]).map((event: Record<string, unknown>) => {
        for (const key of Object.keys(event)) {
          if (event[key] === undefined) delete event[key];
        }
        return event;
      });
      // If multiple, check if all have the same one property. If so, convert into an array of that property
      const firstKeys = Object.keys(item.Events[0]);
      if (firstKeys.length === 1 && (item.Events as Record<string, unknown>[]).every((e: Record<string, unknown>) => Object.keys(e).length === 1 && Object.keys(e)[0] === firstKeys[0])) {
        const key = firstKeys[0];
        var properties = (item.Events as Record<string, unknown>[]).map((event: Record<string, unknown>) => event[key]);
        if (item.Type === "UnitSetXY" && key === "Plot") {
          // If the unit is a caravan, only keep the last plot
          if (item.AI == "TradeUnit") {
            properties = [properties[properties.length - 1]];
          // If we have way too many events (that can break the context window), only keep the last plot
          } else if (events.length > 100) {
            properties = [properties[properties.length - 1]];
          } else if (properties.length > 2) {
            // For plots, ignore looping movements (a => b => c... => a => d) should become (a => d)
            // AI really loves doing that each turn
            const seen = new Map<string, number>(); // plotKey -> last index
            const filtered: Record<string, unknown>[] = [];

            for (let i = 0; i < properties.length; i++) {
              const plot = properties[i] as Record<string, unknown>;
              const plotKey = `${plot.X},${plot.Y}`;

              // If we've seen this plot before, remove everything from that index to current
              if (seen.has(plotKey)) {
                const prevIndex = seen.get(plotKey)!;
                // Remove all plots from prevIndex to current (the loop)
                filtered.splice(prevIndex);
                // Clear seen entries for removed plots
                seen.clear();
                for (let j = 0; j < filtered.length; j++) {
                  seen.set(`${filtered[j].X},${filtered[j].Y}`, j);
                }
              }

              // Add current plot
              seen.set(plotKey, filtered.length);
              filtered.push(plot);
            }
            properties = filtered;
          }
        }
        delete item["Events"];
        if (properties.length === 1) {
          item[key] = properties[0];
        } else if (key === "Plot") {
          item[pluralize(key)] = Object.fromEntries(
            properties.map((p) => {
              const { X, Y, Plot, Terrain, ...rest } = p as Record<string, unknown>;
              if (Plot === "Ocean") {
                return [`${Terrain} ${X},${Y}`, rest];
              } else {
                return [`${Terrain} ${Plot} ${X},${Y}`, rest];
              }
            })
          );
        } else {
          item[pluralize(key)] = properties;
        }
      }
    }
  });

  // Special postprocesses
  result.forEach(item => {
    if (item.Plot) {
      const { X, Y, Plot, Terrain, ...rest } = item.Plot as Record<string, unknown>;
      if (Plot === "Ocean") {
        item[`${Terrain} ${X},${Y}`] = rest;
      } else {
        item[`${Terrain} ${Plot} ${X},${Y}`] = rest;
      }
      delete item["Plot"];
    }
    if (item.Type === "CombatResult") {
      // Consolidate combat properties under Attacker/Defender/Interceptor objects
      const attacker: Record<string, unknown> = {};
      const defender: Record<string, unknown> = {};
      const interceptor: Record<string, unknown> = {};

      // Move properties to appropriate objects
      for (const key of Object.keys(item)) {
        if (key.startsWith("Attacker")) {
          const newKey = key.replace("Attacker", "");
          attacker[newKey] = item[key];
          delete item[key];
        } else if (key.startsWith("Attacking")) {
          const newKey = key.replace("Attacking", "");
          interceptor[newKey] = item[key];
          delete item[key];
        } else if (key.startsWith("Defender")) {
          const newKey = key.replace("Defender", "");
          defender[newKey] = item[key];
          delete item[key];
        } else if (key.startsWith("Defending")) {
          const newKey = key.replace("Defending", "");
          defender[newKey] = item[key];
          delete item[key];
        } else if (key.startsWith("Interceptor")) {
          const newKey = key.replace("Interceptor", "");
          interceptor[newKey] = item[key];
          delete item[key];
        } else if (key.startsWith("Intercepting")) {
          const newKey = key.replace("Intercepting", "");
          interceptor[newKey] = item[key];
          delete item[key];
        }
      }

      // Add consolidated objects (skip interceptor if damage is 0)
      if (Object.keys(attacker).length > 0) item.Attacker = attacker;
      if (Object.keys(defender).length > 0) item.Defender = defender;
      if (Object.keys(interceptor).length > 0 && interceptor.Damage !== 0) {
        item.Interceptor = interceptor;
      }
    }
  });
  
  return result;
}

/**
 * Extracts the ID value from a nested field path
 */
function getFieldID(obj: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  // If the field is an object with an ID property, return the ID
  if (current && typeof current === 'object' && 'ID' in current) {
    return (current as Record<string, unknown>).ID;
  }
  
  return current;
}

/**
 * Checks if two events match on specified fields
 */
function eventsMatch(event1: Record<string, unknown>, event2: Record<string, unknown>, matchFields: string[]): boolean {
  for (const field of matchFields) {
    const id1 = getFieldID(event1, field);
    const id2 = getFieldID(event2, field);
    
    // If either ID is undefined or they don't match, events don't match
    if (id1 === undefined || id2 === undefined || id1 !== id2) {
      return false;
    }
  }
  
  return true;
}

/**
 * Recursively cleans an object by removing -1, "None", "", and empty objects
 * @param obj - Object to clean
 * @returns Cleaned object or undefined if empty
 */
export function cleanEventData<T>(obj: T, embedID: boolean = true): T {
  // Handle primitives
  if (obj === -1 || obj === "None" || obj === "" || obj === false || obj === null) {
    return undefined as unknown as T;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const cleaned = obj
      .map(item => cleanEventData(item))
      .filter(item => item !== undefined);
    return (cleaned.length > 0 ? cleaned : undefined) as unknown as T;
  }

  // Handle objects
  if (typeof obj === 'object') {
    const cleaned: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (blockedKeys.includes(key)) continue;
      cleaned[key] = cleanEventData(value);
    }

    if (!embedID) return cleaned as T;

    for (const key of Object.keys(cleaned)) {
      if (key.endsWith("ID") && key !== "ID") {
        const nested = cleaned[key.substring(0, key.length - 2)];
        if (nested && typeof(nested) === "object") {
          (nested as Record<string, unknown>).ID = cleaned[key];
          delete cleaned[key];
        } else if (!nested) {
          cleaned[key.substring(0, key.length - 2)] = cleaned[key];
          delete cleaned[key];
        }
      }
      if (key.endsWith("Type") && key !== "Type") {
        const nested = cleaned[key.substring(0, key.length - 4)];
        if (!nested) {
          cleaned[key.substring(0, key.length - 4)] = cleaned[key];
          delete cleaned[key];
        }
      }
      if (key.endsWith("X")) {
        const nested = cleaned[key.substring(0, key.length - 1)];
        if (nested && typeof(nested) === "object") {
          (nested as Record<string, unknown>).X = cleaned[key];
          delete cleaned[key];
        }
      }
      if (key.endsWith("Y")) {
        const nested = cleaned[key.substring(0, key.length - 1)];
        if (nested && typeof(nested) === "object") {
          (nested as Record<string, unknown>).Y = cleaned[key];
          delete cleaned[key];
        }
      }
    }

    for (const key of Object.keys(cleaned)) {
      if (key.endsWith("Player") || key.endsWith("Owner")) {
        const nested = cleaned[key] as Record<string, unknown> | undefined;
        if (nested && nested.Civilization)
          cleaned[key] = `${nested.ID}: ${nested.Civilization == "City State" ? nested.Name : nested.Civilization}`;
      }
    }
    
    // Return undefined if the object is empty after cleaning
    return (Object.keys(cleaned).length > 0 ? cleaned : undefined) as unknown as T;
  }
  
  // Return other values as-is
  return obj;
}

/**
 * Postprocess event payload to redact unknown resources
 * @param payload - The event payload to process
 * @param player - The player context for resource visibility
 * @returns Processed payload with redacted resources
 */
function postprocessPayload(value: Record<string, unknown>, player: Selectable<PlayerSummary> | null): Record<string, unknown> {
  if (!player) return value;

  for (const key of Object.keys(value)) {
    const val = value[key];
    if (!val) continue;
    if (key === "ResourceType" || key === "Resource") {
      if (player.Resources && Object.keys(player.Resources).indexOf(val as string) === -1) {
        value[key] = "None";
      }
    } else if (typeof(val) === "object") {
      value[key] = postprocessPayload(val as Record<string, unknown>, player);
    }
  }
  
  return value;
}
