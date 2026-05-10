/**
 * @module utils/prompts/event-filters
 *
 * Event filtering utilities for categorizing and filtering game events by type.
 * Loads event category mappings from the MCP server's event categories definition.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ConsolidatedEventsReport } from '../../../../mcp-server/dist/tools/knowledge/get-events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Event category types
 */
export type EventCategory = 'Military' | 'Economy' | 'Diplomacy' | 'System';

/**
 * Cached event category mappings loaded from event-categories.json
 * Maps event type names to their category arrays
 */
let eventCategoriesCache: Record<string, EventCategory[]> | null = null;

/**
 * Loads and caches event category mappings from the MCP server's configuration.
 * This is called automatically on first use and the result is cached.
 *
 * @returns Record mapping event type to its categories
 */
function loadEventCategories(): Record<string, EventCategory[]> {
  if (eventCategoriesCache) {
    return eventCategoriesCache;
  }

  try {
    // Load from mcp-server/docs/events/event-categories.json
    const categoriesPath = join(__dirname, '../../../../mcp-server/docs/strategies/event-categories.json');
    const categoriesData = readFileSync(categoriesPath, 'utf-8');
    eventCategoriesCache = JSON.parse(categoriesData);
    return eventCategoriesCache!;
  } catch (error) {
    throw new Error(`Failed to load event categories: ${error}`);
  }
}

/**
 * Filters consolidated events (turn-keyed format) to only include those belonging
 * to the specified category. Events can belong to multiple categories, so an event
 * is included if the category is present in its category list.
 *
 * Note: This function filters the parent event by Type. Nested Events arrays are
 * preserved as-is since they don't have their own Type field.
 *
 * @param eventsByTurn - Consolidated events report (turn-keyed object)
 * @param category - The event category to filter by
 * @returns Filtered consolidated events report with only matching events
 */
export function filterEventsByCategory(
  eventsByTurn: ConsolidatedEventsReport,
  category: EventCategory
): ConsolidatedEventsReport {
  const categories = loadEventCategories();
  const filtered: ConsolidatedEventsReport = {};

  for (const [turn, events] of Object.entries(eventsByTurn)) {
    if (turn === "_markdownConfig") {
      filtered[turn] = events;
      continue;
    }

    const turnFiltered = events.filter(event => {
      const eventCategories = categories[event.Type];
      return eventCategories && eventCategories.includes(category);
    });

    // Only include turn if it has events
    if (turnFiltered.length > 0) {
      filtered[turn] = turnFiltered;
    }
  }

  return filtered;
}
