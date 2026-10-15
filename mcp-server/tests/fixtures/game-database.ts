/** Small, controlled game rules used by the HTTP and stdio integration tiers. */
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DatabaseManager } from '../../src/database/manager.js';

/** Install real SQLite databases without requiring an installed Civilization V cache. */
export async function configureGameDatabase(manager: DatabaseManager): Promise<() => Promise<void>> {
  const rules = new Database(':memory:');
  rules.exec(`
    CREATE TABLE Eras (Type TEXT);
    INSERT INTO Eras VALUES ('ERA_ANCIENT'), ('ERA_MEDIEVAL');
    CREATE TABLE Technologies (Type TEXT, Description TEXT, Help TEXT, Cost INTEGER, Era TEXT);
    INSERT INTO Technologies VALUES
      ('TECH_AGRICULTURE', 'TXT_KEY_TECH_AGRICULTURE_TITLE', 'Grow food', 20, 'ERA_ANCIENT'),
      ('TECH_MINING', 'Mining', 'Extract ore', 35, 'ERA_ANCIENT'),
      ('TECH_BRONZE_WORKING', 'Bronze Working', 'Work bronze', 70, 'ERA_ANCIENT'),
      ('TECH_WRITING', 'Writing', 'Record knowledge', 55, 'ERA_ANCIENT');
    CREATE TABLE Technology_PrereqTechs (TechType TEXT, PrereqTech TEXT);
    INSERT INTO Technology_PrereqTechs VALUES ('TECH_BRONZE_WORKING', 'TECH_MINING'), ('TECH_WRITING', 'TECH_AGRICULTURE');
    CREATE TABLE Buildings (Type TEXT, Description TEXT, Help TEXT, Strategy TEXT, Cost INTEGER, PrereqTech TEXT,
      BuildingClass TEXT, Happiness INTEGER, Defense INTEGER, ExtraCityHitPoints INTEGER, GoldMaintenance INTEGER);
    INSERT INTO Buildings VALUES
      ('BUILDING_LIBRARY', 'Library', 'Research support', 'Invest in science', 80, 'TECH_WRITING', 'CLASS_LIBRARY', 0, 0, 0, 1),
      ('BUILDING_UNIVERSITY', 'University', 'Advanced research', 'Train scholars', 160, 'TECH_WRITING', 'CLASS_UNIVERSITY', 0, 0, 0, 3),
      ('BUILDING_PAPER_MAKER', 'Paper Maker', 'Paper research', 'Trade paper', 90, 'TECH_WRITING', 'CLASS_LIBRARY', 1, 0, 0, 0),
      ('BUILDING_BARRACKS', 'Barracks', 'Train troops', 'Prepare an army', 75, 'TECH_BRONZE_WORKING', 'CLASS_BARRACKS', 0, 2, 25, 1);
    CREATE TABLE BuildingClasses (Type TEXT, Description TEXT, DefaultBuilding TEXT, MaxPlayerInstances INTEGER, MaxGlobalInstances INTEGER);
    INSERT INTO BuildingClasses VALUES
      ('CLASS_LIBRARY', 'Library', 'BUILDING_LIBRARY', 0, 0), ('CLASS_UNIVERSITY', 'University', 'BUILDING_UNIVERSITY', 0, 0),
      ('CLASS_BARRACKS', 'Barracks', 'BUILDING_BARRACKS', 0, 0);
    CREATE TABLE Building_ClassesNeededInCity (BuildingType TEXT, BuildingClassType TEXT);
    INSERT INTO Building_ClassesNeededInCity VALUES ('BUILDING_UNIVERSITY', 'CLASS_LIBRARY');
    CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT, Strategy TEXT, Playable INTEGER);
    INSERT INTO Civilizations VALUES
      ('CIVILIZATION_ROME', 'Rome', 'Build infrastructure', 1), ('CIVILIZATION_GREECE', 'Greece', 'Work with allies', 1),
      ('CIVILIZATION_JAPAN', 'Japan', 'Train warriors', 1), ('CIVILIZATION_CHINA', 'China', 'Trade and research', 1);
    CREATE TABLE Civilization_BuildingClassOverrides (CivilizationType TEXT, BuildingClassType TEXT, BuildingType TEXT);
    INSERT INTO Civilization_BuildingClassOverrides VALUES ('CIVILIZATION_CHINA', 'CLASS_LIBRARY', 'BUILDING_PAPER_MAKER');
    CREATE TABLE Leaders (Type TEXT, Description TEXT, PrimaryVictoryPursuit TEXT);
    INSERT INTO Leaders VALUES ('LEADER_ROME', 'Augustus', 'VICTORY_PURSUIT_DOMINATION'),
      ('LEADER_GREECE', 'Alexander', 'VICTORY_PURSUIT_DIPLOMACY'), ('LEADER_JAPAN', 'Oda', 'VICTORY_PURSUIT_DOMINATION'),
      ('LEADER_CHINA', 'Wu', 'VICTORY_PURSUIT_SCIENCE');
    CREATE TABLE Civilization_Leaders (CivilizationType TEXT, LeaderheadType TEXT);
    INSERT INTO Civilization_Leaders VALUES ('CIVILIZATION_ROME', 'LEADER_ROME'), ('CIVILIZATION_GREECE', 'LEADER_GREECE'),
      ('CIVILIZATION_JAPAN', 'LEADER_JAPAN'), ('CIVILIZATION_CHINA', 'LEADER_CHINA');
    CREATE TABLE Traits (Type TEXT, ShortDescription TEXT, Description TEXT);
    INSERT INTO Traits VALUES ('TRAIT_ROME', 'Glory of Rome', 'Construct buildings faster'),
      ('TRAIT_GREECE', 'Hellenic League', 'Maintain city-state friendships'), ('TRAIT_JAPAN', 'Bushido', 'Fight while wounded'),
      ('TRAIT_CHINA', 'Art of War', 'Train great generals');
    CREATE TABLE Leader_Traits (LeaderType TEXT, TraitType TEXT);
    INSERT INTO Leader_Traits VALUES ('LEADER_ROME', 'TRAIT_ROME'), ('LEADER_GREECE', 'TRAIT_GREECE'),
      ('LEADER_JAPAN', 'TRAIT_JAPAN'), ('LEADER_CHINA', 'TRAIT_CHINA');
    CREATE TABLE Units (Type TEXT, Description TEXT, Help TEXT, Strategy TEXT, PrereqTech TEXT);
    INSERT INTO Units VALUES ('UNIT_SWORDSMAN', 'Swordsman', 'Melee fighter', 'Front line', 'TECH_BRONZE_WORKING'),
      ('UNIT_SAMURAI', 'Samurai', 'Elite fighter', 'Earn experience', 'TECH_BRONZE_WORKING');
    CREATE TABLE UnitClasses (Type TEXT, DefaultUnit TEXT);
    INSERT INTO UnitClasses VALUES ('CLASS_SWORDSMAN', 'UNIT_SWORDSMAN');
    CREATE TABLE Civilization_UnitClassOverrides (CivilizationType TEXT, UnitClassType TEXT, UnitType TEXT);
    INSERT INTO Civilization_UnitClassOverrides VALUES ('CIVILIZATION_JAPAN', 'CLASS_SWORDSMAN', 'UNIT_SAMURAI');
    CREATE TABLE Improvements (Type TEXT, Description TEXT, Help TEXT, CivilizationType TEXT, SpecificCivRequired INTEGER);
    INSERT INTO Improvements VALUES ('IMPROVEMENT_FARM', 'Farm', 'Grow crops', NULL, 0);
    CREATE TABLE Builds (ImprovementType TEXT, PrereqTech TEXT);
    INSERT INTO Builds VALUES ('IMPROVEMENT_FARM', 'TECH_AGRICULTURE');
    CREATE TABLE Resources (ID INTEGER, Type TEXT, Description TEXT, IconString TEXT, TechReveal TEXT);
    INSERT INTO Resources VALUES (1, 'RESOURCE_IRON', 'Iron', '[ICON_RES_IRON]', 'TECH_BRONZE_WORKING');
    CREATE TABLE Yields (ID INTEGER, IconString TEXT, Description TEXT);
    INSERT INTO Yields VALUES (1, '[ICON_SCIENCE]', 'Science');
    CREATE TABLE Corporations (Description TEXT, HeadquartersBuildingClass TEXT, OfficeBuildingClass TEXT, FranchiseBuildingClass TEXT);
    CREATE TABLE Beliefs (Type TEXT, ShortDescription TEXT);
    CREATE TABLE Belief_BuildingClassFaithPurchase (BeliefType TEXT, BuildingClassType TEXT);
    CREATE TABLE Policies (Type TEXT, Description TEXT, Help TEXT, Level INTEGER, PolicyBranchType TEXT);
    INSERT INTO Policies VALUES ('POLICY_TRADITION', 'Tradition', 'Develop the capital', 0, 'BRANCH_TRADITION'),
      ('POLICY_OLIGARCHY', 'Oligarchy', 'Defend the capital', 0, 'BRANCH_TRADITION'),
      ('POLICY_LIBERTY', 'Liberty', 'Expand territory', 0, 'BRANCH_LIBERTY'),
      ('POLICY_HONOR', 'Honor', 'Train soldiers', 0, 'BRANCH_HONOR'),
      ('POLICY_CULTURAL_REVOLUTION', 'Cultural Revolution', 'Produce culture', 2, 'BRANCH_TRADITION');
    CREATE TABLE PolicyBranchTypes (Type TEXT, Description TEXT, Help TEXT, EraPrereq TEXT, FreePolicy TEXT);
    INSERT INTO PolicyBranchTypes VALUES ('BRANCH_TRADITION', 'Tradition', 'Develop cities', 'ERA_ANCIENT', 'POLICY_TRADITION'),
      ('BRANCH_LIBERTY', 'Liberty', 'Expand cities', 'ERA_ANCIENT', 'POLICY_LIBERTY'),
      ('BRANCH_HONOR', 'Honor', 'Improve armies', 'ERA_ANCIENT', 'POLICY_HONOR');
    CREATE TABLE Policy_PrereqPolicies (PolicyType TEXT, PrereqPolicy TEXT);
    INSERT INTO Policy_PrereqPolicies VALUES ('POLICY_OLIGARCHY', 'POLICY_TRADITION');
  `);
  const translations = new Database(':memory:');
  translations.exec(`
    CREATE TABLE LocalizedText (Language TEXT, Tag TEXT, Text TEXT);
    INSERT INTO LocalizedText VALUES ('en_US', 'TXT_KEY_TECH_AGRICULTURE_TITLE', 'Agriculture'),
      ('en_US', 'TXT_KEY_FIXTURE_EMPTY', ''), ('en_US', 'TXT_KEY_FIXTURE_RESEARCH', 'Research support');
  `);
  Object.assign(manager, {
    mainDb: new Kysely({ dialect: new SqliteDialect({ database: rules }) }),
    localizationDb: new Kysely({ dialect: new SqliteDialect({ database: translations }) }),
    initialized: true
  });
  manager.setLanguage('en_US');
  return async () => { await manager.close(); };
}
