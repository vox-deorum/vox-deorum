import { z } from 'zod';

/**
 * Schema for the EspionageState event
 * Triggered when a spy's operational state changes during espionage activities
 */
export const EspionageState = z.object({
  /** The unique identifier of the player who owns the spy */
  SpyOwnerID: z.number(),
  
  /** The index identifier of the specific spy whose state is changing */
  SpyIndex: z.number(),
  
  /** The new state that the spy is transitioning to */
  SpyState: z.number(),
  
  /** The X coordinate of the city where the spy is currently operating */
  CityX: z.number(),
  
  /** The Y coordinate of the city where the spy is currently operating */
  CityY: z.number()
});