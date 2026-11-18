/** Shared editorial identity metadata. */

/** Identity metadata supplies labels only for separately observed players. */
export interface EditorialContext {
  receiverTeamId?: number;
  receiverOwnerName?: string;
  playerNames?: Record<string, string>;
  playerTeamIds?: Record<string, number>;
  majorPlayerIds?: number[];
  standardTurnsPerGameTurn?: number;
}
