/**
 * Central orchestrator for all knowledge-related operations.
 * Monitors game state changes and manages persistence.
 */

import { createLogger } from '../utils/logger.js';
import { bridgeManager, gameDatabase, MCPServer } from '../server.js';
import { enumMappingTables, type TableChecksum } from '../database/manager.js';
import { GameIdentity, syncGameIdentity } from './getters/game-identity.js';
import { KnowledgeStore } from './store.js';
import path from 'path';
import { MaxMajorCivs } from './schema/base.js';
import { LuaFunction } from '../bridge/lua-function.js';
import type { GameEvent as BridgeGameEvent } from '../bridge/manager.js';

const logger = createLogger('KnowledgeManager');
const RENDER_PREFIX = 'Render:';

export function extractRenderEventForStorage(
  data: Pick<BridgeGameEvent, 'type' | 'payload'>
) {
  if (typeof data.type !== 'string' || !data.type.startsWith(RENDER_PREFIX)) {
    return null;
  }

  const event = data.type.slice(RENDER_PREFIX.length);
  const { time, turn, ...payload } = data.payload;

  return {
    time: time as number,
    turn: turn as number,
    event,
    payload,
  };
}

export class KnowledgeManager {
  private gameIdentity?: GameIdentity;
  private knowledgeStore?: KnowledgeStore;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private dllConnected: boolean = false;
  private mappingsReady?: Promise<boolean>;
  private tableChecksums?: LuaFunction;

  private config = {
    databasePath: 'data/',
    autoSaveInterval: 30000,
  };

  /**
   * Setup event listeners for SSE and Bridge Service events
   */
  async initialize() {
    bridgeManager.on('connected', () => {
      logger.info('Bridge Service connected');
      this.checkGameContext();
    });
    bridgeManager.on('gameEvent', async (data) => {
      logger.debug(`Game event received: ${data.id ?? "unknown"} of ${data.type}`, data);
      if (data.type == "dll_status") {
        if (data.payload.connected === true) {
          // Change the status
          this.dllConnected = true;
          await this.checkGameContext();
          // A check started before the DLL was up may have failed for lack of a game; try once more now that it is
          if (this.mappingsReady === undefined) await this.checkGameContext();
          // Hold everything back when the mappings don't match the live game
          if (!(await this.mappingsReady)) return;
          // Register analytical functions
          const eventVisibility = await LuaFunction.fromFile(
            'event-visibility.lua',
            '!PostProcessGameEvent',
            ['eventType', 'payload'],
            { '${MaxMajorCivs}': String(MaxMajorCivs) }
          ).register();
          if (!eventVisibility) logger.error("Failed to register the event visibility analysis function!");
          // Send the notification
          MCPServer.getInstance().sendNotification("DLLConnected", -1, -1, -1);
        } else if (this.dllConnected) {
          this.dllConnected = false;
          // A reload or a different game may change the tables, so rebuild the mappings on the next connection
          this.mappingsReady = undefined;
          this.knowledgeStore?.setResyncing();
          MCPServer.getInstance().sendNotification("DLLDisconnected", -1, -1, -1);
        }
      } else if (this.knowledgeStore) {
        const renderEvent = extractRenderEventForStorage(data);
        if (renderEvent) {
          await this.knowledgeStore.insertRenderEvent(
            renderEvent.time,
            renderEvent.turn,
            renderEvent.event,
            renderEvent.payload
          );
          // Forward render events as MCP notifications for downstream consumers (e.g., OBS segment recording)
          MCPServer.getInstance().sendNotification(
            renderEvent.event,
            typeof renderEvent.payload.playerID === "number" ? renderEvent.payload.playerID : -1,
            renderEvent.turn,
            -1,
            renderEvent.payload
          );
        } else {
          // Stored events are named through the enum mappings: wait while they load, drop events after a mismatch
          if (!(await this.mappingsReady)) return;
          await this.knowledgeStore?.handleGameEvent(data.id, data.type, data.payload, data.visibility, data.extraPayload);
        }
      }
    });
    this.startAutoSave();
  }

  /**
   * Check game context and detect changes
   */
  private async checkGameContext(): Promise<boolean> {
    // Never switch to a game (and start agents) before the mappings match it
    if (!(await this.ensureEnumMappings())) return false;
    try {
      const gameIdentity = await syncGameIdentity();
      if (gameIdentity && gameIdentity.gameId !== this.gameIdentity?.gameId) {
        logger.info(`Game context change detected: ${this.gameIdentity?.gameId ?? "(empty)"} -> ${gameIdentity.gameId}`);
        await this.switchGameContext(gameIdentity);
        return true;
      } else return false;
    } catch (error) {
      logger.error('Error checking game context:', error);
      return false;
    }
  }

  /**
   * Build the enum mappings once per DLL connection, now that a live game exists to check them against
   * @returns true when the mappings match the live game
   */
  private ensureEnumMappings(): Promise<boolean> {
    this.mappingsReady ??= this.loadEnumMappings();
    return this.mappingsReady;
  }

  /**
   * Reload the enum mappings and verify them with the live game's table checksums.
   * Without a game to ask, it gives up quietly and retries on the next connection.
   * A mismatch pauses the game and stays failed until the DLL reconnects.
   */
  private async loadEnumMappings(): Promise<boolean> {
    try {
      this.tableChecksums ??= LuaFunction.fromFile('get-table-checksums.lua', 'getTableChecksums', ['tableNames']);
      const response = await this.tableChecksums.execute(enumMappingTables.map(([tableName]) => tableName).join(','));
      if (!response.success) {
        logger.warn('Could not read table checksums from the game, retrying on the next connection', response.error);
        this.mappingsReady = undefined;
        return false;
      }

      await gameDatabase.reloadMappings(response.result as Record<string, TableChecksum>);
      return true;
    } catch (error) {
      logger.error(`Enum mappings do not match the live game, pausing the game: ${error instanceof Error ? error.message : String(error)}`);
      // Stop advertising the previous game: its store would be read with mappings that don't fit the live game
      await this.closeGameContext();
      await bridgeManager.pauseGame();
      return false;
    }
  }

  /**
   * Whether the enum mappings are verified for the current DLL connection, waiting if a check is in progress.
   * Clients should only be pointed at a game when this is true.
   */
  async isGameVerified(): Promise<boolean> {
    return (await this.mappingsReady) ?? false;
  }

  /**
   * Save and close the current game's store, leaving no active game
   */
  private async closeGameContext(): Promise<void> {
    await this.saveKnowledge();
    if (this.knowledgeStore) {
      await this.knowledgeStore.close();
      this.knowledgeStore = undefined;
    }
    this.gameIdentity = undefined;
  }

  /**
   * Switch to a new game context
   */
  private async switchGameContext(identity: GameIdentity): Promise<void> {
    await this.closeGameContext();

    // Load knowledge store
    this.gameIdentity = identity;
    await this.loadKnowledge(identity.gameId);
    this.updateActivePlayer();

    // Notify our clients
    MCPServer.getInstance().sendNotification("GameSwitched", -1, this.getTurn(), 
        parseInt(await this.getStore().getMetadata("lastID") ?? "-1"), { gameID: identity.gameId });
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      this.saveKnowledge();
    }, this.config.autoSaveInterval);
  }

  /**
   * Save current knowledge to database
   */
  async saveKnowledge(): Promise<void> {
    if (!this.gameIdentity || !this.knowledgeStore) return;
    
    logger.debug(`Saving knowledge for game: ${this.gameIdentity.gameId}`);
    
    try {
      // Update last save timestamp
      await this.knowledgeStore.setMetadata('turn', this.gameIdentity.turn.toString());
      await this.knowledgeStore.setMetadata('lastSave', Date.now().toString());
      await this.knowledgeStore.saveKnowledge();
    } catch (error) {
      logger.error('Failed to save knowledge:', error);
    }
  }

  /**
   * Load knowledge for a specific game
   */
  async loadKnowledge(gameId: string): Promise<void> {
    logger.debug(`Loading knowledge for game: ${gameId}`);
    
    try {
      // Create new KnowledgeStore instance
      this.knowledgeStore = new KnowledgeStore();
      
      // Build database path based on game ID
      const dbPath = path.join(this.config.databasePath, `${gameId}.db`);
      
      // Initialize the store with the database
      await this.knowledgeStore.initialize(dbPath, gameId);
      
      // Log successful load
      const lastSave = await this.knowledgeStore.getMetadata('lastSave');
      if (lastSave) {
        logger.info(`Loaded knowledge from save at: ${new Date(parseInt(lastSave)).toISOString()}`);
      }
      
    } catch (error) {
      logger.error('Failed to load knowledge:', error);
      this.knowledgeStore = undefined;
    }
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down KnowledgeManager');

    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    await this.saveKnowledge();
    
    // Close knowledge store
    if (this.knowledgeStore) {
      await this.knowledgeStore.close();
      this.knowledgeStore = undefined;
    }
  }
  
  /**
   * Get current knowledge store instance (for testing or direct access)
   */
  getStore(): KnowledgeStore {
    if (!this.knowledgeStore) {
      throw new Error('KnowledgeStore not initialized. Call loadKnowledge() first.');
    }
    return this.knowledgeStore;
  }

  /**
   * Get current game turn
   */
  getTurn(): number {
    return this.gameIdentity?.turn ?? -1;
  }

  /**
   * Get current active player ID
   */
  getActivePlayerId(): number {
    return this.gameIdentity?.activePlayerId ?? -1;
  }

  /**
   * Get current game ID
   */
  getGameId(): string {
    return this.gameIdentity?.gameId ?? "";
  }

  /**
   * Update current game turn
   */
  updateTurn(turn: number) {
    if (this.gameIdentity && turn > this.gameIdentity.turn) {
      this.gameIdentity.turn = turn;
      logger.warn(`Game turn progressed to ${turn}`)
    }
  }

  /**
   * Update the active player (no longer handles pause/unpause)
   */
  updateActivePlayer(newID?: number) {
    if (!this.gameIdentity) return;
    const changed = newID !== undefined && newID !== this.gameIdentity.activePlayerId;
    if (changed) {
      this.gameIdentity.activePlayerId = newID;
      logger.info(`Active player changed to: ${this.getActivePlayerId()}`);
    }
  }
}
