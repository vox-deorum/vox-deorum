import { z } from 'zod';

/**
 * CombatResult event schema
 * Triggered during combat preparation phase before actual combat resolution
 * Provides predicted combat parameters for analysis and potential intervention
 */
export const CombatResult = z.object({
  /** Player ID of the attacking player */
  AttackingPlayerID: z.number(),
  
  /** Unit ID of the attacking unit */
  AttackingUnitID: z.number(),
  
  /** Predicted initial damage for the attacker */
  AttackerRemainingHP: z.number(),
  
  /** Predicted final damage state of the attacker */
  AttackerDamage: z.number(),
  
  /** Maximum hit points of the attacking unit */
  AttackerMaxHp: z.number(),
  
  /** Player ID of the defending player */
  DefendingPlayerID: z.number(),
  
  /** Unit ID of the defending unit */
  DefendingUnitID: z.number(),
  
  /** Predicted initial damage for the defender */
  DefenderRemainingHP: z.number(),
  
  /** Predicted final damage state of the defender */
  DefenderDamage: z.number(),
  
  /** Maximum hit points of the defending unit */
  DefenderMaxHp: z.number(),
  
  /** Player ID of any intercepting unit (if applicable) */
  InterceptingPlayerID: z.number(),
  
  /** Unit ID of any intercepting unit (if applicable) */
  InterceptingUnitID: z.number(),
  
  /** Predicted damage for interceptor */
  InterceptorDamage: z.number(),
  
  /** X coordinate of the combat location */
  PlotX: z.number(),
  
  /** Y coordinate of the combat location */
  PlotY: z.number(),
});