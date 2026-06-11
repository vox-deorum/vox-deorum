/**
 * @module infra/production-controller
 *
 * Controls OBS production lifecycle based on game render events.
 * Wraps ObsManager to add segment-based recording driven by two events:
 *
 *   PlayerPanelSwitch  — the game UI switches to show a player's turn
 *   AnimationStarted   — a player's turn animations are estimated to begin
 *
 * Recording mode state machine:
 *
 *   [idle] --PlayerPanelSwitch--> [recording] --grace timer expires--> [idle]
 *                                    ^    |
 *                                    |    | PlayerPanelSwitch (log + extend grace)
 *                                    |    | AnimationStarted  (extend grace)
 *                                    +----+
 *
 *   - PlayerPanelSwitch while idle      → start OBS recording, arm grace timer
 *   - PlayerPanelSwitch while recording → log a "switch" entry, extend grace timer
 *   - AnimationStarted while recording  → extend grace timer
 *   - Grace timer expires (SEGMENT_GRACE_MS with no events) → stop segment
 *
 * Each segment produces a video file whose start timestamp (Unix ms) is logged to
 * `segments.jsonl` in the recording directory. Every JSONL entry carries turn,
 * playerID, and at — timestamps are faithful wall-clock times via Date.now().
 *
 * Livestream mode passes through to ObsManager (start/stop/pause/resume).
 * handleRenderEvent() is a no-op in livestream mode for now.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import type { ObsManager } from './obs-manager.js';
import type { ProductionMode } from '../types/config.js';

const logger = createLogger('ProductionController');

/** Grace period (ms) after the first AnimationStarted before stopping recording. */
const SEGMENT_GRACE_MS = 10_000;

/** A single entry in the segments.jsonl log. */
interface SegmentEntry {
  event: 'start' | 'switch' | 'stop';
  turn: number;
  playerID: number;
  at: number;
  /** OBS output filename, present on "stop" entries. */
  file?: string;
}

/**
 * Controls OBS production (recording or livestream) based on game render events.
 *
 * In recording mode, segments are driven by render events — OBS recording starts
 * on the first PlayerPanelSwitch and stops SEGMENT_GRACE_MS after AnimationStarted.
 * The strategist session routes all production calls through this controller so it
 * never needs to branch on mode itself.
 *
 * In livestream mode, all calls pass through directly to ObsManager.
 */
export class ProductionController {
  /** Whether the controller is accepting render events. */
  private active = false;
  /** Whether OBS is currently recording a segment. */
  private segmentActive = false;
  /** Pending grace-period timer that will stop the segment when it fires. */
  private graceTimer?: ReturnType<typeof setTimeout>;
  /** Path to the segments.jsonl file (set on start, undefined if no recording dir). */
  private logPath?: string;

  // Carry forward the last known turn/player so "stop" entries have context.
  private lastTurn = -1;
  private lastPlayerID = -1;

  constructor(
    private obs: ObsManager,
    private mode: ProductionMode,
  ) {}

  // ── Public API (called by strategist-session) ─────────────────────────

  /**
   * Start the production session.
   * - Recording: activates the controller and opens the JSONL log.
   *   No OBS recording yet — that waits for the first PlayerPanelSwitch.
   * - Livestream: starts OBS streaming immediately.
   */
  async start(): Promise<void> {
    if (this.mode === 'recording') {
      this.active = true;
      this.segmentActive = false;
      this.lastTurn = -1;
      this.lastPlayerID = -1;
      this.openLog();
      logger.info('Production controller activated (recording mode)');
    } else if (this.mode === 'livestream') {
      await this.obs.startProduction();
    }
  }

  /**
   * Handle a game render event for segment control.
   * Expects the MCP notification shape: canonical turn/player metadata at the
   * top level and event-specific render fields nested under `data`.
   * - Recording: drives start/stop of OBS recording segments.
   * - Livestream: no-op for now (may add scene switching later).
   */
  async handleRenderEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    if (this.mode !== 'recording' || !this.active || !this.obs.isOperational()) return;

    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new Error(`Invalid render event payload for ${event}: expected data object`);
    }
    if (typeof payload.turn !== 'number') {
      throw new Error(`Invalid render event payload for ${event}: expected numeric turn`);
    }
    if (typeof payload.playerID !== 'number') {
      throw new Error(`Invalid render event payload for ${event}: expected numeric playerID`);
    }

    const eventData = payload.data as Record<string, unknown>;
    const turn = payload.turn;
    const playerID = payload.playerID;

    // Minor civs (and barbarians, flagged as minor by the Lua listener) don't drive
    // segment state transitions — but we still log their PlayerPanelSwitch inside an
    // active segment so the log reflects who appeared on-screen. Nothing else: no
    // grace extension, no segment start/stop, no lastTurn/lastPlayerID mutation.
    if (eventData?.isMinorCiv === true) {
      if (this.segmentActive && event === 'PlayerPanelSwitch') {
        this.logEntry({ event: 'switch', turn, playerID, at: Date.now() });
      }
      return;
    }

    if (event === 'PlayerPanelSwitch') {
      if (!this.segmentActive) {
        // Transition: idle → recording
        await this.startSegment(turn, playerID);
      } else {
        // Already recording — log that a new player panel appeared.
        this.lastTurn = turn;
        this.lastPlayerID = playerID;
        this.logEntry({ event: 'switch', turn, playerID, at: Date.now() });
      }
      // PlayerPanelSwitch extends the grace window.
      this.scheduleStop();
    } else if (event === 'AnimationStarted') {
      // Every AnimationStarted extends the grace window.
      if (this.segmentActive) {
        this.scheduleStop();
      }
    }
  }

  /**
   * Suspend recording (e.g., game crash). Stops the active segment immediately
   * but keeps the controller active so future render events can start new segments.
   * - Livestream: pauses the stream.
   */
  async suspend(): Promise<void> {
    if (this.mode === 'recording') {
      this.cancelGrace();
      if (this.segmentActive) await this.stopSegment();
    } else if (this.mode === 'livestream') {
      await this.obs.pauseProduction();
    }
  }

  /**
   * Resume after suspension.
   * - Recording: no-op — the next PlayerPanelSwitch will start a new segment.
   * - Livestream: resumes the stream.
   */
  async resume(): Promise<void> {
    if (this.mode === 'livestream') {
      await this.obs.resumeProduction();
    }
  }

  /**
   * Stop the production session entirely. Stops any active segment and
   * deactivates the controller.
   */
  async stop(): Promise<void> {
    if (this.mode === 'recording') {
      this.cancelGrace();
      if (this.segmentActive) await this.stopSegment();
      this.active = false;
      logger.info('Production controller stopped');
    } else if (this.mode === 'livestream') {
      await this.obs.stopProduction();
    }
  }

  // ── Private: segment lifecycle ────────────────────────────────────────

  /** Start a new OBS recording segment and log a "start" entry. */
  private async startSegment(turn: number, playerID: number): Promise<void> {
    this.cancelGrace();
    if (this.segmentActive) return;

    const timestamp = Date.now();
    try {
      await this.obs.startProduction();
      this.segmentActive = true;
      this.lastTurn = turn;
      this.lastPlayerID = playerID;
      this.logEntry({ event: 'start', turn, playerID, at: timestamp });
      logger.info(`Segment started (turn ${turn}, player ${playerID})`);
    } catch (error) {
      logger.warn('Failed to start segment:', error);
    }
  }

  /** Stop the current OBS recording segment and log a "stop" entry with the filename. */
  private async stopSegment(): Promise<void> {
    if (!this.segmentActive) return;

    try {
      const outputPath = await this.obs.stopProduction();
      const file = outputPath ? path.basename(outputPath) : undefined;
      this.logEntry({
        event: 'stop',
        turn: this.lastTurn,
        playerID: this.lastPlayerID,
        at: Date.now(),
        ...(file && { file }),
      });
      this.segmentActive = false;
      logger.debug('Segment stopped');
    } catch (error) {
      logger.warn('Failed to stop segment:', error);
      this.segmentActive = false;
    }
  }

  /**
   * (Re)schedule a segment stop after the grace period. Cancels any existing
   * timer first so repeated calls from PlayerPanelSwitch/AnimationStarted
   * extend the grace window rather than stacking.
   */
  private scheduleStop(): void {
    this.cancelGrace();
    this.graceTimer = setTimeout(async () => {
      this.graceTimer = undefined;
      await this.stopSegment();
    }, SEGMENT_GRACE_MS);
  }

  /** Cancel the pending grace-period stop timer, if any. */
  private cancelGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }

  // ── Private: JSONL segment log ────────────────────────────────────────

  /** Open (or truncate) the segments.jsonl file in the recording directory. */
  private openLog(): void {
    const dir = this.obs.getRecordingDirectory();
    if (!dir) {
      logger.warn('No recording directory — segment log will not be written');
      return;
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      this.logPath = path.join(dir, 'segments.jsonl');
      fs.writeFileSync(this.logPath, '');
      logger.info(`Segment log opened: ${this.logPath}`);
    } catch (error) {
      logger.warn('Failed to open segment log:', error);
    }
  }

  /** Append a single JSONL entry (crash-resilient via appendFileSync). */
  private logEntry(entry: SegmentEntry): void {
    if (!this.logPath) return;
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch (error) {
      logger.warn('Failed to write segment log entry:', error);
    }
  }
}
