import { z } from 'zod';

/**
 * Schema for the ContractStarted event triggered when a new contract is initiated and becomes active
 */
export const ContractStarted = z.object({
  /** The player ID who started/owns the contract */
  PlayerID: z.number(),
  /** The type/ID of the contract being started */
  ContractType: z.number(),
  /** Duration of the contract in game turns */
  Turns: z.number(),
  /** Maintenance cost per turn for the contract */
  Maintenance: z.number(),
});