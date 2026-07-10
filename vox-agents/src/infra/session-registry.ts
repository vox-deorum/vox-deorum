/**
 * @module infra/session-registry
 *
 * Registry for managing active VoxSession instances.
 * Ensures only one game session is active at a time while supporting
 * multiple session types for future extensibility.
 */

import { VoxSession } from './vox-session.js';
import { createLogger } from '../utils/logger.js';

/**
 * Registry for managing active VoxSession instances.
 * Ensures only one game session is active at a time.
 */
class SessionRegistry {
  private logger = createLogger('SessionRegistry');

  /** All registered sessions by ID */
  private sessions: Map<string, VoxSession> = new Map();

  /** The single active game session (strategist type) */
  private activeSession?: VoxSession;

  /**
   * Register a new session.
   * For strategist sessions, ensures only one is active.
   *
   * @param session - The VoxSession to register
   * @throws Error if a game session is already active
   */
  public register(session: VoxSession): void {
    // Prevent multiple game sessions
    if (this.activeSession && session.config.type === 'strategist') {
      throw new Error('A game session is already active');
    }

    this.sessions.set(session.id, session);

    // Track the active game session
    if (session.config.type === 'strategist') {
      this.activeSession = session;
    }

    this.logger.info(`Registered session ${session.id} (type: ${session.config.type}, total: ${this.sessions.size})`);
  }

  /**
   * Unregister a session by ID.
   *
   * @param sessionId - The ID of the session to unregister
   * @returns true if the session was found and unregistered, false otherwise
   */
  public unregister(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    // Clear active session reference if it's being unregistered
    if (session === this.activeSession) {
      this.activeSession = undefined;
    }

    const deleted = this.sessions.delete(sessionId);

    if (deleted) {
      this.logger.info(`Unregistered session ${sessionId} (remaining: ${this.sessions.size})`);
    } else {
      this.logger.warn(`Attempted to unregister non-existent session ${sessionId}`);
    }

    return deleted;
  }

  /**
   * Get the currently active game session.
   *
   * @returns The active VoxSession or undefined if none
   */
  public getActive(): VoxSession | undefined {
    return this.activeSession;
  }

  /**
   * Check if there is an active game session.
   *
   * @returns true if there is an active session, false otherwise
   */
  public hasActiveSession(): boolean {
    return this.activeSession !== undefined;
  }
}

// Export singleton instance
export const sessionRegistry = new SessionRegistry();

// Export type for testing or extension
export type { SessionRegistry };