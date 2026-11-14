/**
 * Abstract base class for tools that create dynamic (non-game) events
 * and store them in the GameEvents table with enriched payloads.
 */

import { ToolBase } from '../base.js';
import * as z from 'zod';
import { Selectable } from 'kysely';
import { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { composeVisibility } from '../../knowledge/helpers/visibility.js';
import { storeDynamicEvent, getPlayerMap, resolvePlayerName } from '../../knowledge/helpers/dynamic-event.js';
import { PlayerInformation } from '../../knowledge/schema/public.js';

/** Standard output schema for all dynamic event tools */
export const DynamicEventOutputSchema = z.object({
  Success: z.boolean(),
  EventID: z.number().optional(),
  Error: z.string().optional()
});

export type DynamicEventOutput = z.infer<typeof DynamicEventOutputSchema>;

export abstract class DynamicEventTool extends ToolBase {
  /** The event type string stored in GameEvents.Type */
  abstract readonly eventType: string;

  /** Standard output schema */
  readonly outputSchema = DynamicEventOutputSchema;

  /** Dynamic events are write operations */
  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  /**
   * Build the enriched payload from input args.
   * Subclasses resolve player names and construct the payload to store.
   */
  protected abstract buildPayload(
    args: z.infer<typeof this.inputSchema>,
    playerMap: Map<number, Selectable<PlayerInformation>>
  ): Promise<Record<string, unknown>>;

  /**
   * Determine which player IDs can see this event.
   * Default: only ToPlayerID, or VisibleTo if explicitly provided.
   */
  protected getVisiblePlayerIds(args: Record<string, unknown>): number[] {
    if ('VisibleTo' in args && Array.isArray(args.VisibleTo)) {
      return args.VisibleTo;
    }
    if ('PlayerID' in args && typeof args.PlayerID === 'number') {
      return [args.PlayerID];
    }
    return [];
  }

  /**
   * Execute: build payload, generate ID, store event, return result.
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<DynamicEventOutput> {
    try {
      const playerMap = await getPlayerMap();
      const payload = await this.buildPayload(args, playerMap);
      const visibility = composeVisibility(this.getVisiblePlayerIds(args));
      const eventId = await storeDynamicEvent(this.eventType, payload, visibility);

      return { Success: true, EventID: eventId };
    } catch (error) {
      return {
        Success: false,
        Error: (error as Error).message ?? 'Unknown error'
      };
    }
  }
}

// Re-export utilities for use by subclasses
export { resolvePlayerName, getPlayerMap };
