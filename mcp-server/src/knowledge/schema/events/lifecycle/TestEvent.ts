import { z } from 'zod';

/**
 * TestEvent - A debugging and performance testing utility that triggers Lua hooks
 * through the scripting system. Used for testing the performance and functionality
 * of the Lua event system in development and debugging scenarios.
 */
export const TestEvent = z.object({
  /** Fixed test value for debugging purposes (always -1) */
  TestParameter1: z.number(),
  
  /** Fixed test value for debugging purposes (always -1) */
  TestParameter2: z.number(),
  
  /** Fixed test value for debugging purposes (always -1) */
  TestParameter3: z.number(),
  
  /** Fixed test value for debugging purposes (always -1) */
  TestParameter4: z.number(),
});