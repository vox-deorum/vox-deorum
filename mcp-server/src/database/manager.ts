/**
 * DatabaseManager - Manages connections to Civilization V SQLite databases using Kysely
 * Provides structured access to game rules, units, buildings, technologies, and localized text
 */

import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import { config, getDocumentsPath } from '../utils/config.js';
import type { DB as MainDB } from './database.js';
import type { DB as LocalizationDB } from './localization.js';
import { enumMappings } from '../utils/knowledge/enum.js';
import * as changeCase from "change-case";
import { stripTags } from '../utils/database/localized.js';

const logger = createLogger('DatabaseManager');

// Vox Populi renames Legalism to Ceremony in its en_US text changes. The localization DB is a separate file from the
// main DB, so this rename tells us VP's text changes are in before names are read.
const voxPopuliRenamedTextTag = 'TXT_KEY_POLICY_LEGALISM';
const voxPopuliRenamedTextVanilla = 'Legalism';

// Modulus shared with lua/get-table-checksums.lua
const checksumModulus = 2147483647;

/** Row count and checksum of one game table, as computed by tableChecksum or lua/get-table-checksums.lua. */
export interface TableChecksum {
  Count: number;
  Checksum: number;
}

/** Thrown when the cache database does not match the live game, so its ID-to-name mappings would be wrong. */
export class MappingMismatchError extends Error {
  name = 'MappingMismatchError';
}

/**
 * Checksum the ID and Type of every row, matching lua/get-table-checksums.lua.
 * Rows are folded in ID order as one sequence, so the input order does not matter but swapped IDs do.
 */
export function tableChecksum(rows: ReadonlyArray<{ ID: unknown; Type: unknown }>): TableChecksum {
  const sorted = [...rows].sort((a, b) => Number(a.ID ?? -1) - Number(b.ID ?? -1));
  let checksum = 0;
  // A missing ID or Type counts as empty text, as it does in Lua
  for (const byte of Buffer.from(sorted.map(row => `${row.ID ?? ''}:${row.Type ?? ''};`).join(''), 'utf8')) {
    checksum = (checksum * 31 + byte) % checksumModulus;
  }
  return { Count: rows.length, Checksum: checksum };
}

/** Game tables read into enumMappings once a game connects, paired with the enum name each fills. */
export const enumMappingTables: ReadonlyArray<readonly [tableName: string, mappedName: string]> = [
  ['AICityStrategies', 'CityStrategy'],
  ['AIEconomicStrategies', 'EconomicStrategy'],
  ['AIMilitaryStrategies', 'MilitaryStrategy'],
  ['AIGrandStrategies', 'GrandStrategy'],
  ['Improvements', 'ImprovementType'],
  ['Builds', 'BuildType'],
  ['Buildings', 'BuildingType'],
  ['BuildingClasses', 'BuildingClass'],
  ['Projects', 'ProjectType'],
  ['Specialists', 'SpecialistType'],
  ['GreatWorks', 'GreatWorkType'],
  ['Beliefs', 'BeliefType'],
  ['GoodyHuts', 'GoodyType'],
  ['PolicyBranchTypes', 'BranchType'],
  ['Resolutions', 'ResolutionType'],
  ['Units', 'UnitType'],
  ['UnitClasses', 'UnitClass'],
  ['Technologies', 'TechID'],
  ['Policies', 'PolicyID'],
  ['Resources', 'ResourceType'],
  ['Religions', 'ReligionID'],
  ['Features', 'FeatureType'],
  ['UnitPromotions', 'PromotionType'],
  ['Victories', 'VictoryType'],
];

/**
 * Manages SQLite database connections and queries for Civilization V using Kysely
 */
export class DatabaseManager {
  private mainDb?: Kysely<MainDB>;
  private localizationDb?: Kysely<LocalizationDB>;
  private language: string;
  private initialized = false;
  // Bumped whenever the mappings are rebuilt for a verified game, so caches of database reads know to refresh
  private generation = 0;

  /**
   * Create a new DatabaseManager instance
   */
  constructor() {
    this.language = config.database?.language ?? 'en_US';
  }

  /**
   * Initialize database connections
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing DatabaseManager');

    await this.loadDatabaseWithRetry();

    this.initialized = true;
  }

  /**
   * Open the database files, retrying every 5 seconds until both exist.
   * Enum mappings are built later, once a game connects (see initializeMappings).
   */
  private async loadDatabaseWithRetry(): Promise<void> {
    for (;;) {
      try {
        await this.openConnections();
        return;
      } catch (error) {
        logger.error('Failed to load database, retrying in 5 seconds...', error);
        await setTimeout(5000);
      }
    }
  }

  /**
   * Resolve the paths of the main and localization databases in the Civ V cache folder
   */
  private async getDatabasePaths(): Promise<{ mainDbPath: string; localizationDbPath: string }> {
    const documentsPath = await getDocumentsPath();
    const civ5Path = path.join(documentsPath, 'My Games', 'Sid Meier\'s Civilization 5', 'cache');
    return {
      mainDbPath: path.join(civ5Path, 'Civ5DebugDatabase.db'),
      localizationDbPath: path.join(civ5Path, 'Localization-Merged.db'),
    };
  }

  /**
   * Open fresh read-only connections to both databases, then close any previous ones
   */
  private async openConnections(): Promise<void> {
    const { mainDbPath, localizationDbPath } = await this.getDatabasePaths();
    await fs.access(mainDbPath);
    await fs.access(localizationDbPath);

    // Kysely opens the files through these factories on first use, and only closes handles it opened itself
    const mainDb = new Kysely<MainDB>({
      dialect: new SqliteDialect({ database: async () => new Database(mainDbPath, { readonly: true }) }),
    });
    const localizationDb = new Kysely<LocalizationDB>({
      dialect: new SqliteDialect({ database: async () => new Database(localizationDbPath, { readonly: true }) }),
    });

    // Read from both files now, so a cache the game is still writing fails here instead of on first use
    try {
      await sql`SELECT count(*) FROM sqlite_master`.execute(mainDb);
      await sql`SELECT count(*) FROM sqlite_master`.execute(localizationDb);
    } catch (error) {
      await mainDb.destroy();
      await localizationDb.destroy();
      throw error;
    }

    const previous = [this.mainDb, this.localizationDb];
    this.mainDb = mainDb;
    this.localizationDb = localizationDb;
    logger.info(`Connected to game databases at ${path.dirname(mainDbPath)}`);

    for (const db of previous) await db?.destroy();
  }

  /**
   * Get localized text for a given key
   */
  public async localize(key: string): Promise<string> {
    if (!this.localizationDb) {
      throw new Error('Localization database not initialized. Call initialize() first.');
    }

    try {
      const result = await this.localizationDb
        .selectFrom('LocalizedText')
        .select('Text')
        .where('Language', '=', this.language)
        .where('Tag', '=', key)
        .executeTakeFirst();
      
      return result?.Text ?? key; // Return key if no translation found; empty text stays empty
    } catch (error) {
      logger.error('Localization lookup failed:', error);
      return key; // Return key as fallback
    }
  }

  /**
   * Convert TXT_KEY_* strings in results to localized text
   */
  public async localizeObject<T extends Record<any, any>>(result: T): Promise<T> {
    return (await this.localizeObjects([result]))[0];
  }

  /**
   * Convert TXT_KEY_* strings in results to localized text
   */
  public async localizeObjects<T extends Record<any, any>[]>(results: T, depth: number = 0): Promise<T> {
    if (!this.localizationDb) {
      throw new Error('Localization database not initialized. Call initialize() first.');
    }

    // Pattern to match TXT_KEY_* references, including those within strings
    const TXT_KEY_PATTERN = /\{(TXT_KEY_[A-Z_0-9]+)\}|(TXT_KEY_[A-Z_0-9]+)/g;

    // Recursively collect TXT_KEY_* values
    const collectTxtKeys = (obj: any, keys: Set<string>): void => {
      if (obj == null) return;
      
      if (Array.isArray(obj)) {
        obj.forEach(item => {
          if (typeof item === 'string') {
            let match;
            while ((match = TXT_KEY_PATTERN.exec(item)) !== null) {
              const txtKey = match[1] || match[0];
              keys.add(txtKey);
            }
          } else {
            collectTxtKeys(item, keys);
          }
        });
      } else if (typeof obj === 'object') {
        Object.entries(obj).forEach(([_key, value]) => {
          if (typeof value === 'string') {
            let match;
            while ((match = TXT_KEY_PATTERN.exec(value)) !== null) {
              const txtKey = match[1] || match[0];
              keys.add(txtKey);
            }
          } else if (typeof value === 'object') {
            collectTxtKeys(value, keys);
          }
        });
      }
    };

    // Collect all unique TXT_KEY_* values
    const txtKeys = new Set<string>();
    collectTxtKeys(results, txtKeys);
    if (txtKeys.size === 0) return results;

    // Batch fetch all localizations
    const localizationMap = new Map<string, string>();
    
    try {
      const localizations = await this.localizationDb
        .selectFrom('LocalizedText')
        .select(['Tag', 'Text'])
        .where('Language', '=', this.language)
        .where('Tag', 'in', Array.from(txtKeys).map(k => 
          k.startsWith("TXT_KEY_") ? k : `TXT_KEY_${k}`
        ))
        .execute();
      
      // Build localization map with fallbacks
      // An empty text (Vox Populi leaves some help keys empty) localizes to an empty string
      localizations.forEach(({ Tag, Text }) => {
        if (!Tag || Text == null || (Text === '' && localizationMap.get(Tag))) return;
        localizationMap.set(Tag, stripTags(Text) ?? '');
      });
    } catch (error) {
      logger.error('Batch localization lookup failed:', error);
      return results;
    }
    if (localizationMap.size === 0) return results;

    // Recursively localize values
    const localizeValue = (obj: any): any => {
      if (obj == null) return obj;
      
      // Handle string values - both exact matches and embedded TXT_KEY patterns
      if (typeof obj === 'string') {
        // First check for exact match
        if (localizationMap.has(obj)) {
          return localizationMap.get(obj);
        }
        // Then check for embedded TXT_KEY patterns and replace them
        return obj.replaceAll(TXT_KEY_PATTERN, (match) => {
          const key = match.startsWith('{') && match.endsWith('}') ? match.slice(1, -1) : match;
          return localizationMap.get(key) ?? match;
        });
      }
      
      if (Array.isArray(obj)) {
        // Handle array of items
        return obj.map(item => localizeValue(item));
      }
      
      if (typeof obj === 'object') {
        return Object.entries(obj).reduce((acc, [key, value]) => {
          acc[key] = localizeValue(value);
          return acc;
        }, {} as Record<any, any>);
      }
      
      return obj;
    };

    results = results.map(localizeValue) as T;
    if (depth >= 10) {
      logger.warn('Maximum localization recursion depth reached', results);
      return results;
    }
    return await this.localizeObjects(results, depth + 1);
  }

  /**
   * Get the main database instance for direct Kysely queries
   */
  public getDatabase(): Kysely<MainDB> {
    if (!this.mainDb) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.mainDb;
  }

  /**
   * Set the language for localization
   */
  public setLanguage(language: string): void {
    this.language = language;
    logger.info(`Language set to: ${language}`);
  }

  /**
   * Get current language setting
   */
  public getLanguage(): string {
    return this.language;
  }

  /**
   * Close database connections
   */
  public async close(): Promise<void> {
    logger.info('Closing database connections');
    
    if (this.mainDb) {
      await this.mainDb.destroy();
      this.mainDb = undefined;
    }
    
    if (this.localizationDb) {
      await this.localizationDb.destroy();
      this.localizationDb = undefined;
    }
    
    this.initialized = false;
  }

  /**
   * Check if the manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Rebuild the enum mappings for the connected game.
   * If the open connections don't match, the cache may have been rewritten since they were opened, so the files are
   * reopened and checked once more. Reopening only on a mismatch keeps queries running on the current connections safe.
   * When it still fails, the mapped tables are cleared, so nothing translates names with IDs from the wrong game.
   * @throws MappingMismatchError if the cache databases do not match the live game
   */
  async reloadMappings(gameChecksums: Record<string, TableChecksum>): Promise<void> {
    try {
      try {
        await this.initializeMappings(gameChecksums);
      } catch (error) {
        if (!(error instanceof MappingMismatchError)) throw error;
        logger.warn('Game database does not match the live game, reopening the files to check again');
        await this.openConnections();
        await this.initializeMappings(gameChecksums);
      }
    } catch (error) {
      for (const [, mappedName] of enumMappingTables) delete enumMappings[mappedName];
      delete enumMappings["GreatPersonType"];
      throw error;
    }
  }

  /**
   * Build the enum mappings after checking every table against the live game's checksums.
   * enumMappings is only replaced when every check passes, so a mismatch leaves the previous mappings in place.
   * @throws MappingMismatchError if a table or the Vox Populi text does not match the live game
   */
  async initializeMappings(gameChecksums: Record<string, TableChecksum>): Promise<void> {
    const mappings: Record<string, Record<number, string>> = {};
    const mismatches: string[] = [];

    for (const [tableName, mappedName] of enumMappingTables) {
      const rows = await this.getDatabase().selectFrom(tableName as any).selectAll().execute() as Record<string, unknown>[];
      const local = tableChecksum(rows as { ID: unknown; Type: unknown }[]);
      const game = gameChecksums[tableName];
      if (local.Count !== game?.Count || local.Checksum !== game.Checksum) {
        mismatches.push(`${tableName} (database ${local.Count} rows, game ${game?.Count ?? 'none'})`);
        continue;
      }
      mappings[mappedName] = await this.buildEnumMapping(rows);
    }

    if (mismatches.length > 0) {
      throw new MappingMismatchError(`Game database does not match the live game: ${mismatches.join(', ')}. ${await this.describeMainDb()}`);
    }

    // The localization DB is a separate file, so also check that Vox Populi's text changes are in
    const renamed = await this.localizationDb!
      .selectFrom('LocalizedText')
      .select('Text')
      .where('Language', '=', 'en_US')
      .where('Tag', '=', voxPopuliRenamedTextTag)
      .executeTakeFirst();
    if (!renamed?.Text || renamed.Text === voxPopuliRenamedTextVanilla) {
      throw new MappingMismatchError(`Localization database does not have Vox Populi text yet (${voxPopuliRenamedTextTag} is "${renamed?.Text ?? 'missing'}").`);
    }

    // GreatPersonExpended sends the expended unit's type under this name
    mappings["GreatPersonType"] = mappings["UnitType"];
    Object.assign(enumMappings, mappings);
    this.generation++;
    logger.info(`Enum mappings verified against live game (${enumMappingTables.length} tables)`);
  }

  /**
   * Get the database generation, which changes whenever the mappings are rebuilt for a verified game.
   * Caches of database reads compare it to know when to refresh.
   */
  public getGeneration(): number {
    return this.generation;
  }

  /**
   * Turn a table's rows into an ID-to-name mapping, using the localized Description or a readable Type
   */
  private async buildEnumMapping(rows: Record<string, unknown>[]): Promise<Record<number, string>> {
    const tableMap: Record<number, string> = { "-1": "None" };
    for (const row of rows) {
      if (!('ID' in row)) continue;
      const id = Number(row.ID);
      if ('Description' in row) {
        tableMap[id] = String(row.Description);
      } else if ('Type' in row && !isNaN(id)) {
        const type = String(row.Type);
        tableMap[id] = changeCase.pascalCase(type.includes('_') ? type.split('_').slice(1).join('_') : type);
      }
    }
    return await this.localizeObject(tableMap);
  }

  /**
   * Describe the main database file for mismatch errors, so remote logs show which file was read
   */
  private async describeMainDb(): Promise<string> {
    const { mainDbPath } = await this.getDatabasePaths();
    try {
      const stat = await fs.stat(mainDbPath);
      return `Read ${mainDbPath} (modified ${stat.mtime.toISOString()}).`;
    } catch {
      return `Read ${mainDbPath}.`;
    }
  }
}
