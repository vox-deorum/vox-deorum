import { z } from 'zod';

/**
 * Schema for the NaturalWonderDiscovered event
 * Triggered when a team discovers a natural wonder for the first time
 */
export const NaturalWonderDiscovered = z.object({
  /** The ID of the team that discovered the natural wonder */
  TeamID: z.number(),
  
  /** The type/ID of the natural wonder feature discovered */
  FeatureType: z.number(),
  
  /** The X coordinate of the natural wonder location */
  PlotX: z.number(),
  
  /** The Y coordinate of the natural wonder location */
  PlotY: z.number(),
  
  /** Whether this team is the first major civilization to discover this wonder */
  IsFirst: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});