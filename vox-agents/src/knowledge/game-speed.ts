/**
 * Utility functions for handling game speed calculations
 */

import type { StrategistParameters } from "../strategist/strategy-parameters.js";

/**
 * Game speed multipliers based on Civilization V standard settings
 * These values represent how turn counts scale with different game speeds
 */
const gameSpeedMultipliers: Record<string, number> = {
  // Quick games are 67% of standard length
  "Quick": 0.67,
  // Standard is the baseline
  "Standard": 1.0,
  // Epic games are 150% of standard length
  "Epic": 1.5,
  // Marathon games are 300% of standard length
  "Marathon": 3.0,
};

/**
 * Calculates an offseted turn number based on game speed
 *
 * @param parameters - The strategy parameters containing metadata with game speed
 * @param offset - The turn offset from the current turn (positive for future, negative for past)
 * @returns The offseted turn number adjusted for game speed, or null if metadata is missing
 */
export function getOffsetedTurn(
  parameters: StrategistParameters,
  offset: number = 0
): number {
  // Get the multiplier for the current game speed
  const multiplier = getGameSpeedMultiplier(parameters);
  // Calculate weighted turn (normalized to standard pace)
  const weightedTurn = parameters.turn + Math.round(offset * multiplier);
  return weightedTurn;
}

/**
 * Gets the game speed multiplier for the current game
 *
 * @param parameters - The strategy parameters containing metadata with game speed
 * @returns The game speed multiplier, or 1.0 if metadata is missing
 */
export function getGameSpeedMultiplier(parameters: StrategistParameters): number {
  if (!parameters.metadata?.GameSpeed) return 1.0;
  const gameSpeed = parameters.metadata.GameSpeed;
  return gameSpeedMultipliers[gameSpeed] ?? 1.0;
}