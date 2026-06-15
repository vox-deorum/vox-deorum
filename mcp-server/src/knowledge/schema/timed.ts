import { JSONColumnType } from "kysely";
import { Knowledge, MutableKnowledge, TimedKnowledge } from "./base";
import * as z from "zod";

/**
 * Render-time events from the observer mod (e.g. panel switch, turn animation complete)
 * Not player-specific — timestamps anchor video recording metadata to on-screen moments
 */
export interface RenderEvent extends Knowledge {
  Time: number; // Unix ms from Game.GetCurrentTimeEpochMs()
  Turn: number;
  Event: string; // Event name without "Render:" prefix (e.g. "PlayerPanelSwitch")
  Payload: JSONColumnType<Record<string, unknown>>;
}

/**
 * Game events with typed payloads
 * Example implementation of dynamic content with JSONColumnType
 */
export interface GameEvent extends TimedKnowledge {
  Type: string;
  Payload: JSONColumnType<Record<string, unknown>>;
}

/**
 * Strategy change records for AI players
 * Visible to the player only, unless espionage (in the future)
 * Unchanged strategies represented as null
 */
export interface StrategyChange extends MutableKnowledge {
  GrandStrategy: string | null;
  EconomicStrategies: JSONColumnType<string[]> | null;
  MilitaryStrategies: JSONColumnType<string[]> | null;
  Rationale: string;
}

/**
 * Policy change records for AI policy selection
 * Visible only to the player themselves (self-knowledge)
 * Tracks policy selection decisions
 */
export interface PolicyChange extends MutableKnowledge {
  Policy: string; // The policy branch or policy name that was set
  IsBranch: number; // Whether this is a policy branch (true) or individual policy (false)
  Rationale: string; // Explanation for why this policy was chosen
}

/**
 * Research change records for AI technology selection
 * Visible only to the player themselves (self-knowledge)
 * Tracks technology research decisions and their rationale
 */
export interface ResearchChange extends MutableKnowledge {
  Technology: string; // The technology being researched
  Rationale: string; // Explanation for why this technology was chosen
}

/**
 * Trade route details for a specific route
 */
export interface TradeRouteDetails {
  TurnsLeft: number;
  Domain: string; // "Land" or "Sea"
  FromGold: number;
  ToGold: number;
  ToFood: number;
  ToProduction: number;
  FromScience: number;
  ToScience: number;
  FromCulture: number;
  ToCulture: number;
}

/**
 * Spy details for a specific spy
 */
export interface SpyDetails {
  Role: string; // "Spy", "Counterspy", "Diplomat", "Vassal Diplomat"
  Location: string; // City name (Civ) or "Unassigned"
  State: string; // Localized state (e.g., "Establishing Surveillance", "Gathering Intelligence")
  Network: number; // Network points stored
  NetworkPerTurn: number; // Network points per turn
}

/**
 * Diplomatic deal details for a specific deal
 */
export interface DiplomaticDealDetails {
  TurnsRemaining: number; // Turns until the deal expires
  WeGive: string[]; // Array of items the player is giving (formatted strings)
  TheyGive: string[]; // Array of items the other player is giving (formatted strings)
}

/**
 * Player summary information (visible to met players)
 */
export interface PlayerSummary extends MutableKnowledge {
  Score: number | null; // Player's current score (major civs only)
  Era: string | null; // Localized era name (e.g., "Ancient Era", "Classical Era")
  Votes: number | null; // Votes in World Congress/UN (null if no league)
  MajorAlly: string | null; // Ally civilization's short description (null if no ally)
  Cities: number | null;
  Population: number;
  Territory: number | null; // Number of plots owned by the player (major civs only)
  BestSettlementLocation: JSONColumnType<string[]> | null; // Best settlement locations (major civs only, visibility 1+)
  Gold: number | null;
  GoldPerTurn: number | null; // Player:CalculateGoldRateTimes100() / 100
  HappinessPercentage: number | null; // Excess happiness percentage (can be negative)
  GoldenAge: string | null; // Golden Age status (e.g., "5 turns remaining", "Estimated in 8 turns", "Need More Happiness")
  TourismPerTurn: number | null;
  CulturePerTurn: number | null; // Culture per turn (visible to met players - visibility 1+)
  FaithPerTurn: number | null; // Faith per turn (visibility 2 only - team/self)
  SciencePerTurn: number | null; // Science per turn (visibility 2 only - team/self)
  Technologies: number | null;
  CurrentResearch: string | null; // Current technology being researched (visibility 2 only)
  NextPolicyTurns: number | null; // Turns until next policy can be adopted (visibility 2 only)
  MilitaryUnits: number | null; // Current military units needing supply
  MilitarySupply: number | null; // Maximum supply capacity
  MilitaryStrength: number | null; // Total military strength (attack power of all units)
  PolicyBranches: JSONColumnType<Record<string, string[]>> | null; // Policy branch -> array of policy names (details visibility 2 only)
  FoundedReligion: string | null;
  MajorityReligion: string | null;
  Resources: JSONColumnType<Record<string, string | number>> | null; // "available / total" for majors, count for minors
  Relationships: JSONColumnType<Record<string, string | string[]>> | null; // Civ name -> relationship status (string for minor civs) or array of relationship types (array for major civs)
  OutgoingTradeRoutes: JSONColumnType<Record<string, number | TradeRouteDetails>> | null; // "Not assigned": count or "FromCity => ToCity (Civ)": route details
  IncomingTradeRoutes: JSONColumnType<Record<string, TradeRouteDetails>> | null; // "FromCity (Civ) => ToCity": route details
  Spies: JSONColumnType<Record<string, SpyDetails>> | null; // "Rank Name" -> spy details (visibility 2 only)
  DiplomaticDeals: JSONColumnType<Record<string, DiplomaticDealDetails[]>> | null; // Civ name -> array of deal details (visibility 2 only)
  Quests: JSONColumnType<Record<number, string[]>> | null; // Civ name -> city-state quests (minor civs only)
  DiplomatPoints: JSONColumnType<Record<string, number>> | null; // "Player0" -> diplomat network points (null if no diplomats)

  // Diplomacy visibility documented by the Visibility columns (2: team, 1: met, 0: unmet)
}

/**
 * Player strategic options (technologies, policies, and strategies)
 * Visible only to the player themselves (self-knowledge)
 * Saved as snapshots when player acquires new options or strategies change
 */
export interface PlayerOptions extends TimedKnowledge {
  PlayerID: number; // Player ID
  EconomicStrategies: JSONColumnType<string[]>; // Available economic strategy names
  MilitaryStrategies: JSONColumnType<string[]>; // Available military strategy names
  Technologies: JSONColumnType<string[]>; // Possible technology names
  NextResearch: string | null; // Next technology to be researched (LLM forced)
  Policies: JSONColumnType<string[]>; // Possible policy names
  PolicyBranches: JSONColumnType<string[]>; // Possible policy branch names
  NextPolicy: string | null; // Next policy to be selected (LLM forced)
  NextBranch: string | null; // Next policy branch to be selected (LLM forced)
}

/**
 * AI Persona/personality values for major civilizations
 * Visible only to the player themselves (like strategy data)
 * Tracks changes in AI personality traits over time
 */
export interface PersonaChange extends MutableKnowledge {
  // Core Competitiveness & Ambition
  VictoryCompetitiveness: number;
  WonderCompetitiveness: number;
  MinorCivCompetitiveness: number;
  Boldness: number;

  // War & Peace Tendencies (including defensive traits)
  WarBias: number;
  HostileBias: number;
  WarmongerHate: number;
  NeutralBias: number;
  FriendlyBias: number;
  GuardedBias: number;
  AfraidBias: number;

  // Diplomacy & Cooperation
  DiplomaticBalance: number;
  Friendliness: number;
  WorkWithWillingness: number;
  WorkAgainstWillingness: number;
  Loyalty: number;

  // Minor Civ Relations
  MinorCivFriendlyBias: number;
  MinorCivNeutralBias: number;
  MinorCivHostileBias: number;
  MinorCivWarBias: number;

  // Personality Traits
  DenounceWillingness: number;
  Forgiveness: number;
  Meanness: number;
  Neediness: number;
  Chattiness: number;
  DeceptiveBias: number;

  // Metadata
  Rationale: string;
}

/**
 * Diplomatic relationship modifiers for AI players
 * Visible only to the player themselves (self-knowledge)
 * Tracks both public and private relationship modifiers
 * Values are additive in diplomacy calculations
 */
export interface RelationshipChange extends TimedKnowledge {
  PlayerID: number; // The player who sets the relationship
  TargetID: number; // The player whose relationship is being modified
  PublicValue: number; // ScenarioModifier1 - visible diplomatic stance
  PrivateValue: number; // ScenarioModifier2 - hidden feelings/attitudes
  Rationale: string; // Explanation for the relationship change
}

/**
 * AI Flavor values for major civilizations
 * Visible only to the player themselves (like strategy data)
 * Tracks custom flavor overrides for AI decision-making
 */
export interface FlavorChange extends MutableKnowledge {
  // Military Flavors (18)
  Offense: number;
  Defense: number;
  Mobilization: number;
  CityDefense: number;
  MilitaryTraining: number;
  Recon: number;
  Ranged: number;
  Mobile: number;
  Nuke: number;
  UseNuke: number;
  Naval: number;
  NavalRecon: number;
  NavalGrowth: number;
  NavalTileImprovement: number;
  Air: number;
  AirCarrier: number;
  Antiair: number;
  Airlift: number;

  // Economy Flavors (9)
  Expansion: number;
  Growth: number;
  TileImprovement: number;
  Infrastructure: number;
  Production: number;
  WaterConnection: number;
  Gold: number;
  Science: number;
  Culture: number;

  // Development Flavors (7)
  Happiness: number;
  GreatPeople: number;
  Wonder: number;
  Religion: number;
  Diplomacy: number;
  Spaceship: number;
  Espionage: number;

  // Metadata
  GrandStrategy: string;
  Rationale: string;
}

/**
 * Basic city information (visibility level 1 - revealed)
 * Contains fundamental city data visible to players who have revealed the city
 * This does not inherit from any knowledge base as it's not persisted directly
 */
export interface CityInformationBasic {
  Key: number; // City ID (unique identifier)
  Owner: string; // Owner name (leader for major civs, civ name for minor civs)
  Name: string; // Localized city name
  X: number; // X coordinate
  Y: number; // Y coordinate
  Population: number; // City population
  MajorityReligion: string | null; // Majority religion (localized)
  DefenseStrength: number; // Defense strength value
  HitPoints: number; // Current hit points (MaxHP - Damage)
  MaxHitPoints: number; // Maximum hit points
  IsCapital: number; // Is capital city (0/1)
  IsPuppet: number; // Is puppet city (0/1)
  IsOccupied: number; // Is occupied (0/1)
  IsCoastal: number; // Is coastal city (0/1)
}

/**
 * City information with visibility-based access control
 * Full city data updated per turn
 * Key field contains the City ID
 */
export interface CityInformation extends MutableKnowledge, CityInformationBasic {
  // Visibility level 2 fields (visible to owner/team/spy)
  FoodStored: number; // Current food stored
  FoodPerTurn: number; // Food difference per turn
  ProductionStored: number; // Current production stored
  ProductionPerTurn: number; // Production per turn
  GoldPerTurn: number; // Gold generated per turn
  SciencePerTurn: number; // Science generated per turn
  CulturePerTurn: number; // Culture generated per turn
  FaithPerTurn: number; // Faith generated per turn
  TourismPerTurn: number; // Tourism generated
  HappinessDelta: number; // Local happiness
  RazingTurns: number; // Turns until razed (0 if not razing)
  ResistanceTurns: number; // Resistance turns remaining
  BuildingCount: number; // Total number of buildings
  ImportantBuildings: JSONColumnType<string[]>; // List of recent buildings (localized names, prerequisites filtered)
  Wonders: JSONColumnType<string[]>; // List of wonders (localized names, Palace excluded)
  GreatWorkCount: number; // Number of great works
  CurrentProduction: string | null; // What is being produced (localized)
  ProductionTurnsLeft: number; // Turns to complete production
}

/**
 * Player opinion data (visible to self/espionage reasons)
 * Each player has their own opinion fields following the visibility pattern
 */
export interface PlayerOpinions extends MutableKnowledge {
  // Opinion from Player 0 to the Key player
  OpinionFrom0: string | null;
  // Opinion from the Key player to Player 0
  OpinionTo0: string | null;
  
  // Opinion from Player 1 to the Key player
  OpinionFrom1: string | null;
  // Opinion from the Key player to Player 1
  OpinionTo1: string | null;
  
  // Opinion from Player 2 to the Key player
  OpinionFrom2: string | null;
  // Opinion from the Key player to Player 2
  OpinionTo2: string | null;
  
  // Opinion from Player 3 to the Key player
  OpinionFrom3: string | null;
  // Opinion from the Key player to Player 3
  OpinionTo3: string | null;
  
  // Opinion from Player 4 to the Key player
  OpinionFrom4: string | null;
  // Opinion from the Key player to Player 4
  OpinionTo4: string | null;
  
  // Opinion from Player 5 to the Key player
  OpinionFrom5: string | null;
  // Opinion from the Key player to Player 5
  OpinionTo5: string | null;
  
  // Opinion from Player 6 to the Key player
  OpinionFrom6: string | null;
  // Opinion from the Key player to Player 6
  OpinionTo6: string | null;
  
  // Opinion from Player 7 to the Key player
  OpinionFrom7: string | null;
  // Opinion from the Key player to Player 7
  OpinionTo7: string | null;
  
  // Opinion from Player 8 to the Key player
  OpinionFrom8: string | null;
  // Opinion from the Key player to Player 8
  OpinionTo8: string | null;
  
  // Opinion from Player 9 to the Key player
  OpinionFrom9: string | null;
  // Opinion from the Key player to Player 9
  OpinionTo9: string | null;
  
  // Opinion from Player 10 to the Key player
  OpinionFrom10: string | null;
  // Opinion from the Key player to Player 10
  OpinionTo10: string | null;
  
  // Opinion from Player 11 to the Key player
  OpinionFrom11: string | null;
  // Opinion from the Key player to Player 11
  OpinionTo11: string | null;
  
  // Opinion from Player 12 to the Key player
  OpinionFrom12: string | null;
  // Opinion from the Key player to Player 12
  OpinionTo12: string | null;
  
  // Opinion from Player 13 to the Key player
  OpinionFrom13: string | null;
  // Opinion from the Key player to Player 13
  OpinionTo13: string | null;
  
  // Opinion from Player 14 to the Key player
  OpinionFrom14: string | null;
  // Opinion from the Key player to Player 14
  OpinionTo14: string | null;
  
  // Opinion from Player 15 to the Key player
  OpinionFrom15: string | null;
  // Opinion from the Key player to Player 15
  OpinionTo15: string | null;
  
  // Opinion from Player 16 to the Key player
  OpinionFrom16: string | null;
  // Opinion from the Key player to Player 16
  OpinionTo16: string | null;
  
  // Opinion from Player 17 to the Key player
  OpinionFrom17: string | null;
  // Opinion from the Key player to Player 17
  OpinionTo17: string | null;
  
  // Opinion from Player 18 to the Key player
  OpinionFrom18: string | null;
  // Opinion from the Key player to Player 18
  OpinionTo18: string | null;
  
  // Opinion from Player 19 to the Key player
  OpinionFrom19: string | null;
  // Opinion from the Key player to Player 19
  OpinionTo19: string | null;
  
  // Opinion from Player 20 to the Key player
  OpinionFrom20: string | null;
  // Opinion from the Key player to Player 20
  OpinionTo20: string | null;
  
  // Opinion from Player 21 to the Key player
  OpinionFrom21: string | null;
  // Opinion from the Key player to Player 21
  OpinionTo21: string | null;
}

// Victory data type schemas
export const DominationVictoryDataSchema = z.object({
  CapitalsNeeded: z.number(),
  Contender: z.string().nullable()
}).passthrough();

export const ScienceVictoryDataSchema = z.object({
  Contender: z.string().nullable()
}).passthrough();

export const CulturalVictoryDataSchema = z.object({
  CivsNeeded: z.number(),
  Contender: z.string().nullable()
}).passthrough();

export const DiplomaticVictoryDataSchema = z.object({
  VotesNeeded: z.number(),
  Status: z.string(), // Combined: "{World Congress|United Nations} - {Voting Now|Voting in X turns}"
  ActiveResolutions: z.record(z.string(), z.any()),
  Proposals: z.record(z.string(), z.any()),
  Contender: z.string().nullable()
}).passthrough();

/**
 * Domination victory progress data
 * Player-keyed object with capital control counts
 */
export type DominationVictoryData = z.infer<typeof DominationVictoryDataSchema>;

/**
 * Spaceship victory progress data
 * Player-keyed object with spaceship progress
 */
export type ScienceVictoryData = z.infer<typeof ScienceVictoryDataSchema>;

/**
 * Cultural victory progress data
 * Player-keyed object with tourism/influence progress
 */
export type CulturalVictoryData = z.infer<typeof CulturalVictoryDataSchema>;

/**
 * Diplomatic victory progress data
 * Player-keyed object with delegate counts
 */
export type DiplomaticVictoryData = z.infer<typeof DiplomaticVictoryDataSchema>;

/**
 * Victory progress tracking for all victory types
 * Visible to all players (global knowledge)
 * Each victory type can be "Not available", "Not yet unlocked", or an object with progress data
 */
export interface VictoryProgress extends MutableKnowledge {
  DominationVictory: string | JSONColumnType<DominationVictoryData>;
  ScienceVictory: string | JSONColumnType<ScienceVictoryData>;
  CulturalVictory: string | JSONColumnType<CulturalVictoryData>;
  DiplomaticVictory: string | JSONColumnType<DiplomaticVictoryData>;
}

/**
 * Tactical zone information from the AI's tactical analysis
 * Visible only to the player who owns the tactical analysis (self-knowledge)
 * Saved per turn with all zone properties including unit assignments
 */
export interface TacticalZones extends TimedKnowledge {
  ZoneID: number; // Unique zone identifier
  Territory: string; // Territory type: "None", "Friendly", "Enemy", "Neutral"
  Dominance: string; // Dominance status: "NoUnits", "Friendly", "Enemy", "Even"
  Domain: string; // Domain type: "Sea" or "Land"
  Posture: string; // Tactical posture: "None", "Withdraw", "Attrition", etc.
  AreaID: number; // Area ID
  City: string | null; // City name key (or null if no city)
  CenterX: number; // Zone center X coordinate
  CenterY: number; // Zone center Y coordinate
  Plots: number; // Number of plots in zone
  Value: number; // Dominance zone priority value
  FriendlyStrength: number; // Overall friendly strength
  EnemyStrength: number; // Overall enemy strength
  NeutralStrength: number; // Neutral strength
  Neighbors: JSONColumnType<number[]>; // Array of neighboring zone IDs
  Units: JSONColumnType<Record<string, Record<string, number>>>; // Unit assignments: Civ name -> Unit type -> Count
}

/**
 * A single message in a durable diplomatic conversation between two endpoints.
 *
 * There is exactly one conversation per ordered player pair, so the conversation
 * itself *is* the append-ID-ordered list of these rows — there is no thread table
 * and no status column. The two endpoints are stored ordered by playerID:
 * Player1ID = min, Player2ID = max. The observer sentinel (-1) sorts to Player1ID.
 *
 * Player1Role / Player2Role are free-form role descriptors following the EnvoyThread
 * tradition: an agent name for an LLM-voiced side (`diplomat`, `spokesperson`,
 * `negotiator`, `diplomatic-analyst`, …), the `UserIdentity.role` text for a human
 * side (`the leader`, `an ambassador`, …), or `observer` for the observer endpoint.
 * They are used for display and for filtering the transcript. They do NOT encode
 * human-vs-LLM — that is a game fact, not stored here.
 *
 * The row holds only the message — never LLM internals (reasoning, scratch state,
 * tool traces), which stay transient in vox-agents. Optional message metadata lives
 * in the inherited `Payload`:
 *   - deal-proposal / deal-counter: `Payload.Deal` holds the proposed terms, with
 *     optional proposal-time `Payload.Value1` / `Payload.Value2` snapshots for the
 *     two ordered players (undefined for human participants).
 *   - deal-accept / deal-reject / deal-enacted: `Payload.ProposalMessageID` points
 *     at the proposal/counter message they answer or record as enacted.
 * Legality and live DLL state are never stored.
 */
export interface DiplomaticMessage extends TimedKnowledge {
  Player1ID: number; // min(playerID) of the pair, or -1 for the observer sentinel
  Player2ID: number; // max(playerID) of the pair
  Player1Role: string; // Free-form role descriptor for Player1ID (agent name / UserIdentity.role / 'observer'); does NOT encode human-vs-LLM
  Player2Role: string; // Free-form role descriptor for Player2ID (agent name / UserIdentity.role / 'observer'); does NOT encode human-vs-LLM
  SpeakerID: number; // The endpoint that authored this message (one of the two players)
  MessageType: string; // 'text' | 'close' | 'deal-proposal' | 'deal-counter' | 'deal-accept' | 'deal-reject' | 'deal-enacted'
  Content: string; // Free-text message body
}