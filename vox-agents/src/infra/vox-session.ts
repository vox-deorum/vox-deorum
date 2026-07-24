/**
 * @module infra/vox-session
 *
 * Abstract base class for session management.
 * Provides common lifecycle management and state tracking for all session types.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SessionConfig } from '../types/config.js';
import type { PlayerAssignment, SessionState, SessionStatus } from '../types/api.js';

/**
 * Abstract base class for all Vox session types.
 * Provides common lifecycle management and state tracking.
 */
export abstract class VoxSession<TConfig extends SessionConfig = SessionConfig> {
  /** Unique session identifier */
  readonly id: string;

  /** Session configuration */
  readonly config: TConfig;

  /** When the session was started */
  readonly startTime: Date;

  /** Current session state */
  protected state: SessionState = 'stopped';

  /** Abort controller for graceful shutdown */
  protected abortController = new AbortController();

  /**
   * Pause flag, orthogonal to `state`: while paused the session's agent loops
   * hold in place (no new LLM runs start) and the game stalls, but the session
   * stays `'running'`. Distinct from stop, which aborts. Survives crash recovery
   * (the strategist loops re-read it), so a recovered game stays stalled.
   */
  protected paused = false;

  /** Error message if session failed */
  protected errorMessage?: string;

  /** Current game ID */
  protected gameID?: string;

  /** Current game turn */
  protected turn?: number;

  /**
   * Create a new VoxSession instance.
   * @param type - Session type identifier
   * @param config - Session configuration
   */
  constructor(config: TConfig) {
    this.id = `${config.type}-${uuidv4().slice(0, 8)}`;
    this.config = config;
    this.startTime = new Date();
  }

  /** Start the session and begin processing */
  abstract start(): Promise<void>;

  /** Stop the session gracefully */
  abstract stop(): Promise<void>;

  /** Get current session status for API responses */
  abstract getStatus(): SessionStatus;

  /** Return the strategist's per-seat agent assignments when the session provides them. */
  getPlayerAssignments(): Record<number, PlayerAssignment> | undefined {
    return undefined;
  }

  /**
   * The session's current game turn — updated from the game's own PlayerDoneTurn /
   * GameSwitched notifications, so it tracks live game progression rather than a
   * decision-point snapshot. Undefined before the first turn notification.
   */
  getTurn(): number | undefined {
    return this.turn;
  }

  /** Whether the session is currently paused (agent loops held in place). */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause the session: freeze the agent loops so no new LLM runs start and the
   * game stalls. Any in-flight run finishes normally. No-op once the session is
   * tearing down.
   */
  pause(): void {
    if (this.state === 'stopping' || this.state === 'stopped') return;
    this.paused = true;
  }

  /** Resume a paused session; agent loops pick their held turns back up. */
  resume(): void {
    this.paused = false;
  }

  /**
   * Called when session state changes.
   * @param newState - The new session state
   * @param error - Optional error message if transitioning to error state
   */
  protected onStateChange(newState: SessionState, error?: string): void {
    this.state = newState;
    if (error) {
      this.errorMessage = error;
    }
    // Could emit events here if needed in the future
  }

}
