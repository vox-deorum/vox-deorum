/**
 * Knowledge Management System Database Schema
 * Defines TypeScript interfaces and types for knowledge persistence using Kysely
 */

import type { Generated, JSONColumnType } from 'kysely';
import {
  GameEvent,
  RenderEvent,
  StrategyChange,
  PolicyChange,
  ResearchChange,
  RelationshipChange,
  PlayerSummary,
  PlayerOpinions,
  CityInformation,
  PersonaChange,
  FlavorChange,
  PlayerOptions,
  VictoryProgress,
  TacticalZones,
  DiplomaticMessage
} from './timed';
import { PlayerInformation } from './public';

/**
 * The maximum number of major civilizations.
 */
export const MaxMajorCivs = 22;

/**
 * The leader identity recorded for a minor civ (city-state), which carries no real leader. Consumers
 * distinguish major/major pairs from minor civs by matching against this sentinel, so it is exported
 * as the single source of truth (see e.g. vox-agents' diplomacy-context guard). It lives here in a
 * dependency-free leaf module so the vox-agents runtime can import it without loading the server graph.
 */
export const MINOR_CIV_LEADER = "City State";

/**
 * Player visibility flags for knowledge entries
 */
export interface PlayerVisibility {
  Player0: Generated<number>; // Whether Player 0 knows this
  Player1: Generated<number>; // Whether Player 1 knows this
  Player2: Generated<number>; // Whether Player 2 knows this
  Player3: Generated<number>; // Whether Player 3 knows this
  Player4: Generated<number>; // Whether Player 4 knows this
  Player5: Generated<number>; // Whether Player 5 knows this
  Player6: Generated<number>; // Whether Player 6 knows this
  Player7: Generated<number>; // Whether Player 7 knows this
  Player8: Generated<number>; // Whether Player 8 knows this
  Player9: Generated<number>; // Whether Player 9 knows this
  Player10: Generated<number>; // Whether Player 10 knows this
  Player11: Generated<number>; // Whether Player 11 knows this
  Player12: Generated<number>; // Whether Player 12 knows this
  Player13: Generated<number>; // Whether Player 13 knows this
  Player14: Generated<number>; // Whether Player 14 knows this
  Player15: Generated<number>; // Whether Player 15 knows this
  Player16: Generated<number>; // Whether Player 16 knows this
  Player17: Generated<number>; // Whether Player 17 knows this
  Player18: Generated<number>; // Whether Player 18 knows this
  Player19: Generated<number>; // Whether Player 19 knows this
  Player20: Generated<number>; // Whether Player 20 knows this
  Player21: Generated<number>; // Whether Player 21 knows this
}

/**
 * Metadata key-value store for game state
 */
export interface GameMetadata {
  Key: string;
  Value: string;
}

/**
 * Base interface for all knowledge entries
 * All knowledge items inherit from this base class
 */
export interface Knowledge {
  ID: Generated<number>;
}

/**
 * Public knowledge accessible to all players
 * Example: Basic player information, civilizations, etc.
 */
export interface PublicKnowledge extends Knowledge {
  Key: number; // Item identifier
  Data: JSONColumnType<Record<string, unknown>>;
}

/**
 * Time-based knowledge with turn-based access control
 * Base class for knowledge that changes over turns
 */
export interface TimedKnowledge extends Knowledge, PlayerVisibility {
  Turn: number;
  Payload: JSONColumnType<Record<string, unknown>>;
  CreatedAt: Generated<number>; // Unix timestamp in seconds (SQLite unixepoch())
}

/**
 * Mutable knowledge that can be updated
 * Tracks changes between versions
 */
export interface MutableKnowledge extends TimedKnowledge {
  Key: number; // Item identifier
  Version: number;
  IsLatest: number; 
  Changes: JSONColumnType<string[]>; // Array of changed field names
}

/**
 * Database schema combining all knowledge tables
 */
export interface KnowledgeDatabase {
  GameMetadata: GameMetadata;
  // Render-Time Events
  RenderEvents: RenderEvent;
  // Timed Knowledge
  GameEvents: GameEvent;
  PlayerOptions: PlayerOptions;
  TacticalZones: TacticalZones;
  DiplomaticMessages: DiplomaticMessage;
  // Mutable Knowledge
  PlayerSummaries: PlayerSummary;
  PlayerOpinions: PlayerOpinions;
  CityInformations: CityInformation;
  PersonaChanges: PersonaChange;
  FlavorChanges: FlavorChange;
  StrategyChanges: StrategyChange;
  PolicyChanges: PolicyChange;
  ResearchChanges: ResearchChange;
  RelationshipChanges: RelationshipChange;
  VictoryProgress: VictoryProgress;
  // Public Knowledge
  PlayerInformations: PlayerInformation;
}
