/**
 * @module infra/vox-session
 *
 * Abstract base class for session management.
 * Provides common lifecycle management and state tracking for all session types.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SessionConfig } from '../types/config.js';
import { SessionState, SessionStatus } from '../types/api.js';

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

  /**
   * The session's current game turn — updated from the game's own PlayerDoneTurn /
   * GameSwitched notifications, so it tracks live game progression rather than a
   * decision-point snapshot. Undefined before the first turn notification.
   */
  getTurn(): number | undefined {
    return this.turn;
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