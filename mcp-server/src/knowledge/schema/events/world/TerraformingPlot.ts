import { z } from 'zod';

/**
 * Event triggered when individual plot properties are modified during gameplay.
 * Covers terrain changes, river modifications, feature updates, and ownership changes.
 */
export const TerraformingPlot = z.object({
  /** The specific type of terraforming operation being performed */
  EventType: z.number(),
  
  /** The X coordinate of the plot being modified */
  PlotX: z.number(),
  
  /** The Y coordinate of the plot being modified */
  PlotY: z.number(),
  
  /** Direction parameter (used for river changes, 0 for others) */
  Direction: z.number(),
  
  /** The new value being set (terrain type, feature type, etc.) */
  NewValue: z.number(),
  
  /** The previous value being replaced */
  OldValue: z.number(),
  
  /** Context-specific additional parameter */
  AdditionalParam1: z.number(),
  
  /** Context-specific additional parameter */
  AdditionalParam2: z.number(),
});