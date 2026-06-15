/**
 * Knowledge Database Initialization and Migration Utility
 * Handles SQLite database creation and schema migration using Kysely
 */

import { Kysely } from 'kysely';
import { MaxMajorCivs, type KnowledgeDatabase } from './base.js';
import {
  createPublicKnowledgeTable,
  createTimedKnowledgeTable,
  createTimedKnowledgeIndexes,
  createPublicKnowledgeIndexes,
  createMutableKnowledgeTable,
  createMutableKnowledgeIndexes
} from './table-utils.js';

/**
 * Setup a knowledge database
 * Creates the database file and schema if it doesn't exist
 * Always runs migrations and creates database if not exists
 */
export async function setupKnowledgeDatabase(
  db: Kysely<KnowledgeDatabase>
): Promise<Kysely<KnowledgeDatabase>> {
  
  // Create GameMetadata table
  await db.schema
    .createTable('GameMetadata')
    .ifNotExists()
    .addColumn('Key', 'text', (col) => col.primaryKey())
    .addColumn('Value', 'text', (col) => col.notNull())
    .execute();
  
  // Create RenderEvents table (render-time events for video metadata)
  await db.schema
    .createTable('RenderEvents')
    .ifNotExists()
    .addColumn('ID', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('Time', 'integer', (col) => col.notNull())
    .addColumn('Turn', 'integer', (col) => col.notNull())
    .addColumn('Event', 'text', (col) => col.notNull())
    .addColumn('Payload', 'text')
    .execute();
  await db.schema
    .createIndex('idx_renderevents_turn')
    .ifNotExists()
    .on('RenderEvents')
    .column('Turn')
    .execute();

  // Create GameEvents table (TimedKnowledge implementation)
  await createTimedKnowledgeTable(db, 'GameEvents')
    .addColumn('Type', 'text', (col) => col.notNull())
    .execute();
  // Create indexes for GameEvents table
  await createTimedKnowledgeIndexes(db, 'GameEvents', 'Type');

  // Create StrategyChanges table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'StrategyChanges')
    .addColumn('GrandStrategy', 'integer')
    .addColumn('EconomicStrategies', 'text') // JSON array
    .addColumn('MilitaryStrategies', 'text') // JSON array
    .addColumn('Rationale', 'text')
    .execute();
  // Create indexes for StrategyChanges table
  await createMutableKnowledgeIndexes(db, 'StrategyChanges');

  // Create PolicyChanges table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'PolicyChanges')
    .addColumn('Policy', 'text', (col) => col.notNull())
    .addColumn('Rationale', 'text', (col) => col.notNull())
    .addColumn('IsBranch', 'integer', (col) => col.notNull())
    .execute();
  // Create indexes for PolicyChanges table
  await createMutableKnowledgeIndexes(db, 'PolicyChanges');

  // Create ResearchDecisions table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'ResearchChanges')
    .addColumn('Technology', 'text', (col) => col.notNull())
    .addColumn('Rationale', 'text', (col) => col.notNull())
    .execute();
  // Create indexes for ResearchChanges table
  await createMutableKnowledgeIndexes(db, 'ResearchChanges');

  // Create RelationshipChanges table (TimedKnowledge implementation)
  await createTimedKnowledgeTable(db, 'RelationshipChanges')
    .addColumn('PlayerID', 'integer', (col) => col.notNull())
    .addColumn('TargetID', 'integer', (col) => col.notNull())
    .addColumn('PublicValue', 'integer', (col) => col.notNull())
    .addColumn('PrivateValue', 'integer', (col) => col.notNull())
    .addColumn('Rationale', 'text', (col) => col.notNull())
    .execute();
  // Create indexes for RelationshipChanges table
  await createTimedKnowledgeIndexes(db, 'RelationshipChanges', 'PlayerID');
  // Create additional index for TargetID
  await db.schema
    .createIndex('idx_relationshipchanges_targetid')
    .on('RelationshipChanges')
    .columns(['TargetID', 'Turn'])
    .ifNotExists()
    .execute();

  // Create PlayerOptions table (TimedKnowledge implementation)
  await createTimedKnowledgeTable(db, 'PlayerOptions')
    .addColumn('PlayerID', 'integer', (col) => col.notNull()) // Player ID
    .addColumn('EconomicStrategies', 'text') // JSON array
    .addColumn('MilitaryStrategies', 'text') // JSON array
    .addColumn('Technologies', 'text') // JSON array
    .addColumn('NextResearch', 'text') // Next technology to research (nullable)
    .addColumn('Policies', 'text') // JSON array
    .addColumn('PolicyBranches', 'text') // JSON array
    .addColumn('NextPolicy', 'text') // Next policy to select (nullable)
    .addColumn('NextBranch', 'text') // Next policy branch to select (nullable)
    .execute();
  // Create indexes for PlayerOptions table
  await createTimedKnowledgeIndexes(db, 'PlayerOptions', 'PlayerID');

  // Create PersonaChanges table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'PersonaChanges')
    // Core Competitiveness & Ambition
    .addColumn('VictoryCompetitiveness', 'integer', (col) => col.notNull())
    .addColumn('WonderCompetitiveness', 'integer', (col) => col.notNull())
    .addColumn('MinorCivCompetitiveness', 'integer', (col) => col.notNull())
    .addColumn('Boldness', 'integer', (col) => col.notNull())

    // War & Peace Tendencies (including defensive traits)
    .addColumn('WarBias', 'integer', (col) => col.notNull())
    .addColumn('HostileBias', 'integer', (col) => col.notNull())
    .addColumn('WarmongerHate', 'integer', (col) => col.notNull())
    .addColumn('NeutralBias', 'integer', (col) => col.notNull())
    .addColumn('FriendlyBias', 'integer', (col) => col.notNull())
    .addColumn('GuardedBias', 'integer', (col) => col.notNull())
    .addColumn('AfraidBias', 'integer', (col) => col.notNull())

    // Diplomacy & Cooperation
    .addColumn('DiplomaticBalance', 'integer', (col) => col.notNull())
    .addColumn('Friendliness', 'integer', (col) => col.notNull())
    .addColumn('WorkWithWillingness', 'integer', (col) => col.notNull())
    .addColumn('WorkAgainstWillingness', 'integer', (col) => col.notNull())
    .addColumn('Loyalty', 'integer', (col) => col.notNull())

    // Minor Civ Relations
    .addColumn('MinorCivFriendlyBias', 'integer', (col) => col.notNull())
    .addColumn('MinorCivNeutralBias', 'integer', (col) => col.notNull())
    .addColumn('MinorCivHostileBias', 'integer', (col) => col.notNull())
    .addColumn('MinorCivWarBias', 'integer', (col) => col.notNull())

    // Personality Traits
    .addColumn('DenounceWillingness', 'integer', (col) => col.notNull())
    .addColumn('Forgiveness', 'integer', (col) => col.notNull())
    .addColumn('Meanness', 'integer', (col) => col.notNull())
    .addColumn('Neediness', 'integer', (col) => col.notNull())
    .addColumn('Chattiness', 'integer', (col) => col.notNull())
    .addColumn('DeceptiveBias', 'integer', (col) => col.notNull())

    // Metadata
    .addColumn('Rationale', 'text', (col) => col.notNull())
    .execute();
  // Create indexes for PersonaChanges table
  await createMutableKnowledgeIndexes(db, 'PersonaChanges');

  // Create FlavorChanges table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'FlavorChanges')
    // Military Flavors (18)
    .addColumn('Offense', 'integer')
    .addColumn('Defense', 'integer')
    .addColumn('Mobilization', 'integer')
    .addColumn('CityDefense', 'integer')
    .addColumn('MilitaryTraining', 'integer')
    .addColumn('Recon', 'integer')
    .addColumn('Ranged', 'integer')
    .addColumn('Mobile', 'integer')
    .addColumn('Nuke', 'integer')
    .addColumn('UseNuke', 'integer')
    .addColumn('Naval', 'integer')
    .addColumn('NavalRecon', 'integer')
    .addColumn('NavalGrowth', 'integer')
    .addColumn('NavalTileImprovement', 'integer')
    .addColumn('Air', 'integer')
    .addColumn('AirCarrier', 'integer')
    .addColumn('Antiair', 'integer')
    .addColumn('Airlift', 'integer')

    // Economy Flavors (9)
    .addColumn('Expansion', 'integer')
    .addColumn('Growth', 'integer')
    .addColumn('TileImprovement', 'integer')
    .addColumn('Infrastructure', 'integer')
    .addColumn('Production', 'integer')
    .addColumn('WaterConnection', 'integer')
    .addColumn('Gold', 'integer')
    .addColumn('Science', 'integer')
    .addColumn('Culture', 'integer')

    // Development Flavors (7)
    .addColumn('Happiness', 'integer')
    .addColumn('GreatPeople', 'integer')
    .addColumn('Wonder', 'integer')
    .addColumn('Religion', 'integer')
    .addColumn('Diplomacy', 'integer')
    .addColumn('Spaceship', 'integer')
    .addColumn('Espionage', 'integer')

    // Metadata
    .addColumn('GrandStrategy', 'text', (col) => col.notNull())
    .addColumn('Rationale', 'text', (col) => col.notNull())
    .execute();
  // Create indexes for FlavorChanges table
  await createMutableKnowledgeIndexes(db, 'FlavorChanges');

  // Create PlayerSummaries table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'PlayerSummaries')
    .addColumn('Score', 'integer') // Player's current score (major civs only)
    .addColumn('Era', 'text')
    .addColumn('MajorAlly', 'text')
    .addColumn('Votes', 'integer')
    .addColumn('Cities', 'integer', (col) => col.notNull())
    .addColumn('Population', 'integer', (col) => col.notNull())
    .addColumn('Territory', 'integer') // Number of plots owned (major civs only)
    .addColumn('BestSettlementLocation', 'text')
    .addColumn('Gold', 'integer', (col) => col.notNull())
    .addColumn('GoldPerTurn', 'real', (col) => col.notNull())
    .addColumn('HappinessPercentage', 'integer') // Excess happiness percentage (can be negative)
    .addColumn('GoldenAge', 'text') // Golden Age status (e.g., "5 turns remaining", "Estimated in 8 turns", "Need More Happiness")
    .addColumn('SciencePerTurn', 'integer')
    .addColumn('CulturePerTurn', 'integer')
    .addColumn('FaithPerTurn', 'integer')
    .addColumn('TourismPerTurn', 'integer')
    .addColumn('PolicyBranches', 'text') // JSON object
    .addColumn('Technologies', 'integer', (col) => col.notNull())
    .addColumn('CurrentResearch', 'text') // Current technology being researched
    .addColumn('NextPolicyTurns', 'integer') // Turns until next policy can be adopted
    .addColumn('MilitaryUnits', 'integer') // Current military units needing supply
    .addColumn('MilitarySupply', 'integer') // Maximum supply capacity
    .addColumn('MilitaryStrength', 'integer') // Total military strength (attack power of all units)
    .addColumn('Resources', 'text')
    .addColumn('FoundedReligion', 'text')
    .addColumn('MajorityReligion', 'text')
    .addColumn('Relationships', 'text') // JSON object of diplomatic relationships
    .addColumn('OutgoingTradeRoutes', 'text')
    .addColumn('IncomingTradeRoutes', 'text')
    .addColumn('Spies', 'text')
    .addColumn('DiplomaticDeals', 'text')
    .addColumn('Quests', 'text')
    .addColumn('DiplomatPoints', 'text') // JSON object: "Player0" -> network points
    .execute();
  // Create indexes for PlayerSummaries table
  await createMutableKnowledgeIndexes(db, 'PlayerSummaries');

  // Create PlayerOpinions table (MutableKnowledge implementation)
  var opinions = createMutableKnowledgeTable(db, 'PlayerOpinions');
  for (var I = 0; I < MaxMajorCivs; I++) {
    opinions = opinions.addColumn('OpinionFrom' + I, 'text')
    opinions = opinions.addColumn('OpinionTo' + I, 'text')
  }
  await opinions.execute();

  // Create indexes for PlayerOpinions table
  await createMutableKnowledgeIndexes(db, 'PlayerOpinions');

  // Create CityInformations table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'CityInformations')
    // Basic fields (visibility level 1)
    .addColumn('Owner', 'text', (col) => col.notNull())
    .addColumn('Name', 'text', (col) => col.notNull())
    .addColumn('X', 'integer', (col) => col.notNull())
    .addColumn('Y', 'integer', (col) => col.notNull())
    .addColumn('Population', 'integer', (col) => col.notNull())
    .addColumn('MajorityReligion', 'text')
    .addColumn('DefenseStrength', 'integer', (col) => col.notNull())
    .addColumn('HitPoints', 'integer', (col) => col.notNull())
    .addColumn('MaxHitPoints', 'integer', (col) => col.notNull())
    .addColumn('IsCapital', 'integer', (col) => col.notNull())
    .addColumn('IsPuppet', 'integer', (col) => col.notNull())
    .addColumn('IsOccupied', 'integer', (col) => col.notNull())
    .addColumn('IsCoastal', 'integer', (col) => col.notNull())
    // Full fields (visibility level 2)
    .addColumn('FoodStored', 'integer', (col) => col.notNull())
    .addColumn('FoodPerTurn', 'integer', (col) => col.notNull())
    .addColumn('ProductionStored', 'integer', (col) => col.notNull())
    .addColumn('ProductionPerTurn', 'integer', (col) => col.notNull())
    .addColumn('GoldPerTurn', 'integer', (col) => col.notNull())
    .addColumn('SciencePerTurn', 'integer', (col) => col.notNull())
    .addColumn('CulturePerTurn', 'integer', (col) => col.notNull())
    .addColumn('FaithPerTurn', 'integer', (col) => col.notNull())
    .addColumn('TourismPerTurn', 'integer', (col) => col.notNull())
    .addColumn('HappinessDelta', 'integer', (col) => col.notNull())
    .addColumn('RazingTurns', 'integer', (col) => col.notNull())
    .addColumn('ResistanceTurns', 'integer', (col) => col.notNull())
    .addColumn('BuildingCount', 'integer', (col) => col.notNull())
    .addColumn('Wonders', 'text', (col) => col.notNull()) // JSON array of wonder names
    .addColumn('ImportantBuildings', 'text', (col) => col.notNull()) // JSON array of wonder names
    .addColumn('GreatWorkCount', 'integer', (col) => col.notNull())
    .addColumn('CurrentProduction', 'text')
    .addColumn('ProductionTurnsLeft', 'integer', (col) => col.notNull())
    .execute();
  // Create indexes for CityInformations table
  await createMutableKnowledgeIndexes(db, 'CityInformations');

  // Create PlayerInformation table (PublicKnowledge implementation)
  await createPublicKnowledgeTable(db, 'PlayerInformations')
    .addColumn('Civilization', 'text', (col) => col.notNull())
    .addColumn('Leader', 'text', (col) => col.notNull())
    .addColumn('TeamID', 'integer', (col) => col.notNull())
    .addColumn('IsHuman', 'integer', (col) => col.notNull())
    .addColumn('IsMajor', 'integer', (col) => col.notNull())
    .execute();
  // Create indexes for PlayerInformation table
  await createPublicKnowledgeIndexes(db, 'PlayerInformations');

  // Create VictoryProgress table (MutableKnowledge implementation)
  await createMutableKnowledgeTable(db, 'VictoryProgress')
    .addColumn('DominationVictory', 'text', (col) => col.notNull()) // JSON or status string
    .addColumn('ScienceVictory', 'text', (col) => col.notNull()) // JSON or status string
    .addColumn('CulturalVictory', 'text', (col) => col.notNull()) // JSON or status string
    .addColumn('DiplomaticVictory', 'text', (col) => col.notNull()) // JSON or status string
    .execute();
  // Create indexes for VictoryProgress table
  await createMutableKnowledgeIndexes(db, 'VictoryProgress');

  // Create TacticalZones table (TimedKnowledge implementation)
  await createTimedKnowledgeTable(db, 'TacticalZones')
    .addColumn('PlayerID', 'integer', (col) => col.notNull())
    .addColumn('ZoneID', 'integer', (col) => col.notNull())
    .addColumn('Territory', 'text', (col) => col.notNull())
    .addColumn('Dominance', 'text', (col) => col.notNull())
    .addColumn('Domain', 'text', (col) => col.notNull())
    .addColumn('Posture', 'text', (col) => col.notNull())
    .addColumn('AreaID', 'integer', (col) => col.notNull())
    .addColumn('City', 'text')
    .addColumn('CenterX', 'integer', (col) => col.notNull())
    .addColumn('CenterY', 'integer', (col) => col.notNull())
    .addColumn('Plots', 'integer', (col) => col.notNull())
    .addColumn('Value', 'integer', (col) => col.notNull())
    .addColumn('FriendlyStrength', 'integer', (col) => col.notNull())
    .addColumn('EnemyStrength', 'integer', (col) => col.notNull())
    .addColumn('NeutralStrength', 'integer', (col) => col.notNull())
    .addColumn('Neighbors', 'text', (col) => col.notNull()) // JSON array
    .addColumn('Units', 'text', (col) => col.notNull()) // JSON object: Civ name -> Unit type -> Count
    .execute();
  // Create indexes for TacticalZones table
  await createTimedKnowledgeIndexes(db, 'TacticalZones', 'PlayerID');

  // Create DiplomaticMessages table (TimedKnowledge implementation)
  // One conversation per ordered player pair: no thread table, no status column.
  // Player1ID = min(playerID), Player2ID = max(playerID); -1 (observer) sorts to Player1ID.
  // Transcript order is the append ID; Turn is metadata.
  await createTimedKnowledgeTable(db, 'DiplomaticMessages')
    .addColumn('Player1ID', 'integer', (col) => col.notNull())
    .addColumn('Player2ID', 'integer', (col) => col.notNull())
    .addColumn('Player1Role', 'text', (col) => col.notNull())
    .addColumn('Player2Role', 'text', (col) => col.notNull())
    .addColumn('SpeakerID', 'integer', (col) => col.notNull())
    .addColumn('MessageType', 'text', (col) => col.notNull())
    .addColumn('Content', 'text', (col) => col.notNull())
    .execute();
  // Create standard timed indexes for DiplomaticMessages table
  await createTimedKnowledgeIndexes(db, 'DiplomaticMessages');
  // Extra player-pair index for transcript reads (one conversation per pair, ordered by ID)
  await db.schema
    .createIndex('idx_diplomaticmessages_pair')
    .on('DiplomaticMessages')
    .columns(['Player1ID', 'Player2ID', 'ID'])
    .ifNotExists()
    .execute();

  return db;
}