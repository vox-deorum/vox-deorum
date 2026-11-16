import { queryNewspaperEvidence } from '../../../../mcp-server/dist/newspaper/queries.js';
import type { NewspaperEvidenceRequest } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { getGameMetadataValue } from '../../knowledge/database.js';
import { resolveGameSpeedMultiplier } from '../../knowledge/game-speed.js';
import { errorMessage } from '../../utils/errors.js';
import { replaySettingsSchema, replayStateSchema, type ReplayEvidenceResponse, type ReplaySpeed, type ReplayState } from '../contracts/replay.js';
import { openReplayDatabase } from './database.js';

/** A replay failure with an HTTP status meaningful to the local application. */
export class ReplaySessionError extends Error {
  /** Carry a readable failure and its boundary status without exposing implementation objects. */
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Prefer a recognized recording name, then an explicit multiplier, then a labelled assumption. */
export function resolveReplaySpeed(recordedName: string | null, override?: number): ReplaySpeed {
  const recorded = resolveGameSpeedMultiplier({ GameSpeed: recordedName ?? undefined });
  if (recorded !== undefined) return { multiplier: recorded, source: 'recorded', recordedName, label: `Recorded ${recordedName}` };
  if (override !== undefined) return { multiplier: override, source: 'override', recordedName, label: `Override (${override})` };
  return { multiplier: 1, source: 'assumedStandard', recordedName, label: 'Standard assumption' };
}

interface ReplayDependencies {
  open?: typeof openReplayDatabase;
  query?: typeof queryNewspaperEvidence;
}

/** Own one read-only source and serialize settings, reads, cursor changes, and shutdown. */
export class ReplaySession {
  private db?: Awaited<ReturnType<typeof openReplayDatabase>>;
  private state?: ReplayState;
  private tail: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private stopping = false;

  /** Allow controlled query and opener dependencies for lifecycle tests. */
  constructor(private readonly dependencies: ReplayDependencies = {}) {}

  /** Replace the source only after its metadata has been read successfully, resetting the cursor. */
  configure(input: unknown): Promise<ReplayState> {
    return this.run(async () => {
      const settings = replaySettingsSchema.parse(input);
      let nextDb: Awaited<ReturnType<typeof openReplayDatabase>> | undefined;
      let nextState: ReplayState;
      try {
        nextDb = await (this.dependencies.open ?? openReplayDatabase)(settings.databasePath);
        const speed = resolveReplaySpeed(await getGameMetadataValue(nextDb, 'gameSpeed'), settings.speedMultiplierOverride);
        const multiplier = settings.durationUnit === 'standardTurns' ? speed.multiplier : 1;
        nextState = replayStateSchema.parse({
          settings, speed,
          publicationIntervalTurns: Math.max(1, Math.round(settings.publicationInterval * multiplier)),
          comparisonTurns: Math.round(settings.comparisonTurns * multiplier),
          cursor: { cutoffTurn: null, previousCheckTurn: settings.fromTurn - 1, finished: false },
        });
      } catch (error) {
        await nextDb?.destroy();
        throw new ReplaySessionError(errorMessage(error));
      }
      const previousDb = this.db;
      this.db = undefined;
      this.state = undefined;
      try {
        await previousDb?.destroy();
      } catch (error) {
        await nextDb.destroy();
        throw error;
      }
      this.db = nextDb;
      this.state = nextState;
      return this.snapshot();
    });
  }

  /** Return a detached snapshot so callers cannot alter the queued session's state. */
  getState(): Promise<ReplayState> {
    return this.run(async () => this.snapshot());
  }

  /** Inspect the current window, or the first cutoff before any check, without moving the cursor. */
  evidence(): Promise<ReplayEvidenceResponse> {
    return this.run(() => this.read(false));
  }

  /** Query the next cutoff and commit its cursor only after the evidence read succeeds. */
  advance(): Promise<ReplayEvidenceResponse> {
    return this.run(() => this.read(true));
  }

  /** Reject new work immediately, drain every accepted operation, then release the source once. */
  close(): Promise<void> {
    this.stopping = true;
    this.closing ??= this.tail.then(async () => {
      const db = this.db;
      this.db = undefined;
      this.state = undefined;
      await db?.destroy();
    });
    return this.closing;
  }

  /** Read shared MCP evidence with recorded-turn bounds and no live refresh or writes. */
  private async read(advance: boolean): Promise<ReplayEvidenceResponse> {
    const state = this.snapshot();
    if (advance && state.cursor.finished) throw new ReplaySessionError('Replay has reached its final turn.', 409);
    const cutoff = state.cursor.cutoffTurn;
    const cutoffTurn = advance && cutoff !== null
      ? Math.min(state.settings.toTurn, cutoff + state.publicationIntervalTurns)
      : cutoff ?? state.settings.fromTurn;
    const previousCheckTurn = advance ? cutoff ?? state.settings.fromTurn - 1 : state.cursor.previousCheckTurn;
    const request: NewspaperEvidenceRequest = {
      receiverPlayerID: state.settings.receiverPlayerID, previousCheckTurn, cutoffTurn,
      ...(state.comparisonTurns > 0 ? { comparisonRange: { fromTurn: Math.max(0, cutoffTurn - state.comparisonTurns), toTurn: cutoffTurn } } : {}),
    };
    const evidence = await (this.dependencies.query ?? queryNewspaperEvidence)(this.db!, request);
    if (advance) {
      state.cursor = { cutoffTurn, previousCheckTurn, finished: cutoffTurn === state.settings.toTurn };
      this.state = state;
    }
    return { session: this.snapshot(), evidence };
  }

  /** Validate active state and copy its serialized fields. */
  private snapshot(): ReplayState {
    if (!this.state) throw new ReplaySessionError('Configure a replay recording first.', 409);
    return replayStateSchema.parse(this.state);
  }

  /** Keep accepted operations ordered and let a failed request leave the queue usable. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new ReplaySessionError('Replay is shutting down.', 503));
    const job = this.tail.then(operation);
    this.tail = job.then(() => undefined, () => undefined);
    return job;
  }
}
