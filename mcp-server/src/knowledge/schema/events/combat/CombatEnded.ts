import { z } from 'zod';

/**
 * Schema for the CombatEnded event that is triggered after a combat encounter has concluded.
 * Provides comprehensive information about all participants in the combat, including damage dealt,
 * final health states, and battlefield location.
 */
export const CombatEnded = z.object({
  /** Player ID of the attacking player */
  AttackingPlayerID: z.number(),
  
  /** Unit ID of the attacking unit */
  AttackingUnitID: z.number(),
  
  /** Remaining HP value for the attacker */
  AttackerRemainingHP: z.number(),
  
  /** Final damage state of the attacker */
  AttackerDamage: z.number(),
  
  /** Maximum hit points of the attacking unit */
  AttackerMaxHP: z.number(),
  
  /** Player ID of the defending player */
  DefendingPlayerID: z.number(),
  
  /** Unit ID of the defending unit */
  DefendingUnitID: z.number(),
  
  /** Remaining HP value for the defender */
  DefenderRemainingHP: z.number(),
  
  /** Final damage state of the defender */
  DefenderDamage: z.number(),
  
  /** Maximum hit points of the defending unit */
  DefenderMaxHP: z.number(),
  
  /** Player ID of any intercepting unit (if applicable) */
  InterceptingPlayerID: z.number(),
  
  /** Unit ID of any intercepting unit (if applicable) */
  InterceptingUnitID: z.number(),
  
  /** Damage dealt by or to interceptor */
  InterceptorDamage: z.number(),
  
  /** X coordinate of the combat location */
  PlotX: z.number(),
  
  /** Y coordinate of the combat location */
  PlotY: z.number()
});