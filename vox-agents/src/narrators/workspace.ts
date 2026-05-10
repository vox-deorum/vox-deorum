/**
 * @module narrators/workspace
 *
 * Central workspace manager for the narrator pipeline.
 * Manages shared context (narrator-context.json) and stage I/O files.
 * All stages share this workspace — Stage 1 writes context, later stages read it.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../../mcp-server/dist/knowledge/schema/index.js';
import { openReadonlyGameDb } from '../utils/telemetry/knowledge-db.js';
import { createLogger } from '../utils/logger.js';
import type { NarratorContext, Episodes } from './types.js';

const logger = createLogger('NarratorWorkspace');

const CONTEXT_FILE = 'narrator-context.json';
const EPISODES_FILE = 'episodes.json';

export class NarratorWorkspace {
  constructor(readonly workspacePath: string) {}

  /** Ensure the workspace directory exists */
  ensureDir(): void {
    fs.mkdirSync(this.workspacePath, { recursive: true });
  }

  /** Resolve a filename within the workspace */
  getPath(filename: string): string {
    return path.join(this.workspacePath, filename);
  }

  // ── Context management ───────────────────────────────────────────────

  /** Write the shared game context (called by Stage 1) */
  writeContext(ctx: NarratorContext): void {
    const filePath = this.getPath(CONTEXT_FILE);
    fs.writeFileSync(filePath, JSON.stringify(ctx, null, 2));
    logger.info(`Wrote narrator context to ${filePath}`);
  }

  /** Read the shared game context (called by later stages). Throws if missing. */
  getContext(): NarratorContext {
    const filePath = this.getPath(CONTEXT_FILE);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Narrator context not found at ${filePath}. Run Stage 1 (assemble) first.`
      );
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as NarratorContext;
  }

  /** Check if the context file exists */
  hasContext(): boolean {
    return fs.existsSync(this.getPath(CONTEXT_FILE));
  }

  // ── DB access ────────────────────────────────────────────────────────

  /** Open the game knowledge DB from the stored context path */
  openGameDb(): Kysely<KnowledgeDatabase> {
    const ctx = this.getContext();
    const db = openReadonlyGameDb(ctx.knowledgePath);
    if (!db) {
      throw new Error(`Failed to open knowledge DB at ${ctx.knowledgePath}`);
    }
    return db;
  }

  // ── Stage I/O ────────────────────────────────────────────────────────

  /** Write episodes.json (Stage 1 output) */
  writeEpisodes(episodes: Episodes): void {
    const filePath = this.getPath(EPISODES_FILE);
    fs.writeFileSync(filePath, JSON.stringify(episodes, null, 2));
    logger.info(`Wrote ${episodes.episodes.length} episodes to ${filePath}`);
  }

  /** Read episodes.json, or null if not yet produced */
  readEpisodes(): Episodes | null {
    const filePath = this.getPath(EPISODES_FILE);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Episodes;
  }
}
