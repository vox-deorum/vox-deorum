import { z } from 'zod';

/**
 * Schema for CityProjectComplete event.
 * Triggered when a city completes the construction of a project.
 */
export const CityProjectComplete = z.object({
  /** The ID of the player who owns the city completing the project */
  PlayerID: z.number(),
  /** The unique identifier of the city where the project is completed */
  CityID: z.number(),
  /** The identifier of the specific project type being completed */
  ProjectType: z.number(),
});