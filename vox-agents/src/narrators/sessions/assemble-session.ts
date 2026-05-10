/**
 * @module narrators/sessions/assemble-session
 *
 * Stage 1 of the narrator pipeline: parses segments.jsonl and the game's
 * knowledge DB to produce workspace/episodes.json.
 * No LLM — pure data transformation.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Kysely, Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../../../../mcp-server/dist/knowledge/schema/index.js';
import type { PlayerInformation } from '../../../../mcp-server/dist/knowledge/schema/index.js';
import { MaxMajorCivs } from '../../../../mcp-server/dist/knowledge/schema/index.js';
import { VoxSession } from '../../infra/vox-session.js';
import { createLogger } from '../../utils/logger.js';
import {
  openReadonlyGameDb,
  resolveKnowledgePath,
  getWinner,
  getPlayerStrategistMetadata,
} from '../../utils/telemetry/knowledge-db.js';
import { agentRegistry } from '../../infra/agent-registry.js';
import type { Strategist } from '../../strategist/strategist.js';
import { NarratorWorkspace } from '../workspace.js';
import { parseAndDecompose } from '../utils/episode-parser.js';
import { formatWorldCongress } from '../utils/world-congress.js';
import type { AssembleConfig, Episode, Episodes } from '../types.js';
import type { SessionStatus } from '../../types/api.js';

const logger = createLogger('AssembleSession');

export class AssembleSession extends VoxSession<AssembleConfig> {
  private workspace: NarratorWorkspace;

  constructor(config: AssembleConfig) {
    super(config);
    this.workspace = new NarratorWorkspace(config.workspace);
  }

  async start(): Promise<void> {
    this.onStateChange('running');
    this.gameID = this.config.gameID;

    let db: Kysely<KnowledgeDatabase> | undefined;

    try {
      // 1. Prepare workspace
      this.workspace.ensureDir();

      // 2. Validate recording directory
      const segmentsPath = path.join(this.config.recordingDir, 'segments.jsonl');
      if (!fs.existsSync(segmentsPath)) {
        throw new Error(`segments.jsonl not found at ${segmentsPath}`);
      }

      // 3. Resolve knowledge DB path
      const knowledgePath = resolveKnowledgePath(
        this.config.knowledgePath,
        this.config.gameID,
      );

      // 4. Write workspace context for later stages
      this.workspace.writeContext({
        gameID: this.config.gameID,
        knowledgePath,
        recordingDir: path.resolve(this.config.recordingDir),
      });

      // 5. Open knowledge DB
      db = openReadonlyGameDb(knowledgePath) ?? undefined;
      if (!db) {
        throw new Error(`Failed to open knowledge DB at ${knowledgePath}`);
      }

      // 6. Query PlayerInformations
      const playerInfoRows = await db
        .selectFrom('PlayerInformations')
        .selectAll()
        .execute();

      const playerInfoMap = new Map<number, Selectable<PlayerInformation>>();
      const minorCivIDs = new Set<number>();
      for (const row of playerInfoRows) {
        playerInfoMap.set(row.Key, row);
        if (!row.IsMajor) {
          minorCivIDs.add(row.Key);
        }
      }

      // 7. Parse segments.jsonl into episodes
      const segmentsContent = fs.readFileSync(segmentsPath, 'utf-8');
      const episodes = parseAndDecompose(segmentsContent, minorCivIDs);
      logger.info(`Parsed ${episodes.length} episodes from segments.jsonl`);

      if (episodes.length === 0) {
        logger.warn('No valid episodes found in segments.jsonl');
      }

      // 8. Batch-query GameEvents and populate eventCounts
      await this.populateEventCounts(db, episodes);

      // 9. Query game metadata (winner)
      const winner = await getWinner(db);

      // 10. Extract player types
      const playerTypes = await this.extractPlayerTypes(db, playerInfoMap);

      // 11. Compute totalTurns
      const totalTurns = episodes.length > 0
        ? Math.max(...episodes.map((e) => e.turn))
        : 0;

      // 12. Assemble and write output
      const output: Episodes = {
        gameID: this.config.gameID,
        totalTurns,
        players: playerInfoRows,
        playerTypes,
        ...(winner && { winner }),
        episodes,
      };

      this.workspace.writeEpisodes(output);
      logger.info(`Stage 1 complete: ${episodes.length} episodes, ${totalTurns} turns`);
      this.onStateChange('stopped');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Assemble failed: ${message}`);
      this.onStateChange('error', message);
      throw error;
    } finally {
      if (db) await db.destroy();
    }
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    this.onStateChange('stopped');
  }

  getStatus(): SessionStatus {
    return {
      id: this.id,
      type: this.config.type,
      state: this.state,
      config: this.config,
      startTime: this.startTime,
      gameID: this.gameID,
      error: this.errorMessage,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Batch-query all GameEvents for relevant turns and populate episode eventCounts.
   * For minor civ episodes, also extracts World Congress info from VictoryProgress
   * and ResolutionResult GameEvents into a pre-formatted string.
   */
  private async populateEventCounts(
    db: Kysely<KnowledgeDatabase>,
    episodes: Episode[],
  ): Promise<void> {
    // Collect unique turns
    const turns = [...new Set(episodes.map((e) => e.turn))];
    if (turns.length === 0) return;

    // Batch-query all events for these turns
    const events = await db
      .selectFrom('GameEvents')
      .selectAll()
      .where('Turn', 'in', turns)
      .execute();

    // Build lookup: (turn, playerID) → eventType → count
    // Also collect ResolutionResult events per turn for World Congress voting results
    const eventBuckets = new Map<string, Record<string, number>>();
    const resolutionEventsByTurn = new Map<number, Record<string, unknown>[]>();

    for (const event of events) {
      if (event.Type === 'ResolutionResult') {
        let arr = resolutionEventsByTurn.get(event.Turn);
        if (!arr) {
          arr = [];
          resolutionEventsByTurn.set(event.Turn, arr);
        }
        arr.push(event.Payload as Record<string, unknown>);
      }

      // Check which players can see this event via Player{N} visibility flags
      for (let pid = 0; pid < MaxMajorCivs; pid++) {
        const visibility = (event as any)[`Player${pid}`];
        if (typeof visibility === 'number' && visibility >= 1) {
          const key = `${event.Turn}:${pid}`;
          if (!eventBuckets.has(key)) {
            eventBuckets.set(key, {});
          }
          const bucket = eventBuckets.get(key)!;
          bucket[event.Type] = (bucket[event.Type] || 0) + 1;
        }
      }
    }

    // Determine which turns need World Congress data (turns with minor civ episodes)
    const minorCivTurns = new Set<number>();
    for (const episode of episodes) {
      if (episode.playerID === -1) minorCivTurns.add(episode.turn);
    }

    const wcStringByTurn = await this.fetchWorldCongressData(
      db,
      minorCivTurns,
      resolutionEventsByTurn,
    );

    // Apply to episodes
    for (const episode of episodes) {
      if (episode.playerID === -1) {
        const wc = wcStringByTurn.get(episode.turn);
        if (wc) episode.worldCongress = wc;
      } else {
        const key = `${episode.turn}:${episode.playerID}`;
        const counts = eventBuckets.get(key);
        if (counts) {
          episode.eventCounts = counts;
        }
      }
    }

    logger.info(
      `Processed ${events.length} events across ${turns.length} turns`
    );
  }

  /**
   * Fetch VictoryProgress.DiplomaticVictory for each minor civ turn and combine
   * with ResolutionResult events into pre-formatted World Congress summary strings.
   */
  private async fetchWorldCongressData(
    db: Kysely<KnowledgeDatabase>,
    turns: Set<number>,
    resolutionEventsByTurn: Map<number, Record<string, unknown>[]>,
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (turns.size === 0) return result;

    // VictoryProgress is global (Key=0) and mutable — query latest version per turn
    const turnList = [...turns];
    const rows = await db
      .selectFrom('VictoryProgress')
      .select(['Turn', 'DiplomaticVictory'])
      .where('Key', '=', 0)
      .where('Turn', 'in', turnList)
      .where('ID', 'in',
        db.selectFrom('VictoryProgress')
          .select((eb) => eb.fn.max('ID').as('ID'))
          .where('Key', '=', 0)
          .where('Turn', 'in', turnList)
          .groupBy(['Key', 'Turn'])
      )
      .execute();

    for (const row of rows) {
      const dipl = row.DiplomaticVictory;
      const events = resolutionEventsByTurn.get(row.Turn) ?? [];
      const formatted = formatWorldCongress(dipl, events);
      if (formatted) result.set(row.Turn, formatted);
    }

    // Also handle turns that have ResolutionResult events but no VictoryProgress row
    for (const [turn, events] of resolutionEventsByTurn) {
      if (!turns.has(turn) || result.has(turn)) continue;
      const formatted = formatWorldCongress(null, events);
      if (formatted) result.set(turn, formatted);
    }

    return result;
  }

  /**
   * Extract player type labels from GameMetadata + agent registry.
   * For each major player: look up strategist name and model from GameMetadata,
   * then resolve display name from the agent registry.
   */
  private async extractPlayerTypes(
    db: Kysely<KnowledgeDatabase>,
    playerInfoMap: Map<number, Selectable<PlayerInformation>>,
  ): Promise<Record<number, string>> {
    const playerTypes: Record<number, string> = {};

    for (const [playerID, info] of playerInfoMap) {
      if (!info.IsMajor) continue;

      const { strategist: strategistName, model: modelName } =
        await getPlayerStrategistMetadata(db, playerID);

      if (strategistName) {
        const agent = agentRegistry.get(strategistName);
        const displayName = agent
          ? (agent as unknown as Strategist).displayName
          : strategistName;

        if (modelName && modelName !== 'VPAI') {
          playerTypes[playerID] = `${displayName} (${modelName})`;
        } else {
          playerTypes[playerID] = displayName;
        }
      } else {
        playerTypes[playerID] = 'Vox Populi AI';
      }
    }

    return playerTypes;
  }
}
