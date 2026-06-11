import { z } from 'zod';

/**
 * Schema for the HumanDecision event.
 *
 * Fired by the human-control panel (via `Game.BroadcastEvent("HumanDecision", ...)`)
 * to carry a human strategist's decision back to vox-agents. Deliberately
 * permissive: only a numeric `PlayerID` — which is what routes the stored event
 * onward to a notification — and a `Rationale` are required. Everything else is
 * optional and loosely typed so the panel's payload can evolve without events
 * being silently dropped at the schema gate. The store validates with
 * `.passthrough()`, so any additional fields ride along untouched.
 */
export const HumanDecision = z.object({
  /** The human strategist's player ID — routes this event onward to a notification */
  PlayerID: z.number(),
  /** Free-text rationale covering the whole turn's decision */
  Rationale: z.string(),
  /** Source turn the decision was made on */
  Turn: z.number().optional(),
  /** Explicit keep-status-quo: maintain the current direction (recorded as a real decision) */
  StatusQuo: z.boolean().optional(),
  /** Chosen grand strategy name (part of Flavor mode) */
  GrandStrategy: z.string().optional(),
  /** Custom flavor values by flavor name */
  Flavors: z.any().optional(),
  /** Chosen next research (technology name) */
  Technology: z.string().optional(),
  /** Chosen next policy (policy name) */
  Policy: z.string().optional(),
  /** Persona value overrides */
  Persona: z.any().optional(),
  /** Diplomatic relationship modifiers by civilization name */
  Relationships: z.any().optional()
});
