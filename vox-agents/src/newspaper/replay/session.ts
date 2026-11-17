import { queryNewspaperEvidence } from '../../../../mcp-server/dist/newspaper/queries.js';
import type { NewspaperEvidenceRequest } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { newspaperArchiveQuerySchema, newspaperArchiveScopeSchema } from '../../../../mcp-server/dist/newspaper/protocol.js';
import { randomUUID } from 'node:crypto';
import { getGameMetadataValue } from '../../knowledge/database.js';
import { resolveGameSpeedMultiplier } from '../../knowledge/game-speed.js';
import { errorMessage } from '../../utils/errors.js';
import { replaySettingsSchema, replayStateSchema, replayPreferencesRequestSchema, type ReplayEvidenceResponse, type ReplaySpeed, type ReplayState } from '../contracts/replay.js';
import { archiveVoteRequestSchema, type ArchiveIssue, type ArchiveList } from '../contracts/archive.js';
import { createInitialPublicationState, publicationStateSchema, type PublicationState } from '../contracts/publication.js';
import { loadEditorialConfig } from '../editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../editorial/config/schema.js';
import { runEditorialCheck } from '../editorial/check.js';
import { openReplayDatabase, replaySourceIdentity, readReplayIdentities } from './database.js';
import { ReplayStore, ReplayStoreConflictError, resolveReplayOutput } from './store.js';

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
  check?: typeof runEditorialCheck;
}

/** Own one read-only source and serialize settings, reads, cursor changes, and shutdown. */
export class ReplaySession {
  private db?: Awaited<ReturnType<typeof openReplayDatabase>>;
  private state?: ReplayState;
  private store?: ReplayStore;
  private publication?: PublicationState;
  private config?: EditorialConfig;
  private campaignId?: string;
  private context?: Awaited<ReturnType<typeof readReplayIdentities>>;
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
      let nextStore: ReplayStore | undefined;
      let nextPublication: PublicationState | undefined;
      let nextConfig: EditorialConfig | undefined;
      let nextIdentity: string | undefined;
      let nextContext: Awaited<ReturnType<typeof readReplayIdentities>> | undefined;
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
        if (settings.publicationEnabled !== false) {
          // Resolve aliases before opening SQLite so a recording is never migrated as output.
          const outputPath = resolveReplayOutput(settings.databasePath, settings.outputPath);
          nextIdentity = await replaySourceIdentity(settings.databasePath);
          nextContext = await readReplayIdentities(nextDb, settings.receiverPlayerID);
          nextStore = new ReplayStore(outputPath);
          if (settings.mode === 'resume') {
            const saved = nextStore.load(settings.runId!, settings.receiverPlayerID, nextIdentity);
            nextState = saved.session;
            // The source can move while its verified bytes and saved schedule remain the same.
            nextState.settings.databasePath = settings.databasePath;
            nextState.settings.outputPath = outputPath;
            nextState.outputPath = outputPath;
            nextPublication = saved.publication;
            nextConfig = editorialConfigSchema.parse(saved.configuration);
          } else {
            if (settings.mode === 'branch') nextStore.load(settings.branchFromRunId!, settings.receiverPlayerID, nextIdentity);
            nextConfig = await loadEditorialConfig(settings.editorialConfigDirectory);
            nextPublication = createInitialPublicationState({
              frequencyStandardTurns: settings.frequencyStandardTurns ?? nextConfig.defaults.frequencyStandardTurns,
              llmEnabled: settings.llmEnabled ?? nextConfig.defaults.llmEnabled,
            });
            nextState.runId = settings.runId ?? randomUUID();
            nextState.outputPath = outputPath;
            nextState.preferences = nextPublication.preferences;
            nextState.publicationIntervalTurns = Math.max(1, Math.round(nextPublication.preferences.frequencyStandardTurns * speed.multiplier));
            nextStore.create(nextIdentity, { session: nextState, publication: nextPublication, configuration: nextConfig }, settings.mode === 'branch' ? settings.branchFromRunId : undefined);
          }
        }
      } catch (error) {
        nextStore?.close();
        await nextDb?.destroy();
        throw new ReplaySessionError(errorMessage(error), error instanceof ReplayStoreConflictError ? 409 : 400);
      }
      const previousDb = this.db;
      const previousStore = this.store;
      this.db = undefined;
      this.state = undefined;
      this.store = undefined;
      this.publication = undefined;
      try {
        await previousDb?.destroy();
        previousStore?.close();
      } catch (error) {
        await nextDb.destroy();
        nextStore?.close();
        previousStore?.close();
        throw error;
      }
      this.db = nextDb;
      this.state = nextState;
      this.store = nextStore;
      this.publication = nextPublication;
      this.config = nextConfig;
      this.campaignId = nextIdentity;
      this.context = nextContext;
      return this.snapshot();
    });
  }

  /** Return a detached snapshot so callers cannot alter the queued session's state. */
  getState(): Promise<ReplayState> {
    return this.run(async () => this.snapshot());
  }

  /** Inspect the current window, or the first cutoff before any check, without moving the cursor. */
  evidence(scope?: unknown): Promise<ReplayEvidenceResponse> {
    return this.run(() => { this.checkScope(scope); return this.read(false); });
  }

  /** Query the next cutoff and commit its cursor only after the evidence read succeeds. */
  advance(scope?: unknown, requireScope = false): Promise<ReplayEvidenceResponse> {
    return this.run(() => {
      if (requireScope && this.snapshot().runId) newspaperArchiveScopeSchema.parse(scope);
      this.checkScope(scope);
      return this.read(true);
    });
  }

  /** List immutable editions in this run without querying or regenerating source evidence. */
  listIssues(scope?: unknown): Promise<ArchiveList> {
    return this.run(async () => {
      this.checkScope(scope);
      const state = this.requirePublication();
      return this.store!.list(state.runId!, state.settings.receiverPlayerID);
    });
  }

  /** Reopen stored prose and its original editorial choices. */
  getIssue(issueId: string, scope?: unknown): Promise<ArchiveIssue> {
    return this.run(async () => {
      this.checkScope(scope);
      const state = this.requirePublication();
      const issue = this.store!.get(state.runId!, state.settings.receiverPlayerID, issueId, this.publication!);
      if (!issue) throw new ReplaySessionError('Issue was not found in this replay run.', 404);
      return issue;
    });
  }

  /** Replace a unique article's current vote; clearing removes its contribution exactly. */
  setVote(input: unknown): Promise<ReplayState> {
    return this.run(async () => {
      const vote = archiveVoteRequestSchema.parse(input);
      this.checkScope(vote);
      const state = this.requirePublication();
      const publication = publicationStateSchema.parse(this.publication);
      if (!publication.issues.some(issue => issue.items.some(item => item.id === vote.itemId))) throw new ReplaySessionError('Article was not found in this replay run.', 404);
      if (vote.value === 0) delete publication.votes[vote.itemId];
      else publication.votes[vote.itemId] = vote.value;
      this.store!.save({ session: state, publication, configuration: this.config });
      this.publication = publication;
      return this.snapshot();
    });
  }

  /** Resolve the next frequency from the last completed check while preserving published history. */
  setPreferences(input: unknown): Promise<ReplayState> {
    return this.run(async () => {
      const preferences = replayPreferencesRequestSchema.parse(input);
      this.checkScope(preferences);
      const state = this.requirePublication();
      const publication = publicationStateSchema.parse(this.publication);
      publication.preferences = { frequencyStandardTurns: preferences.frequencyStandardTurns, llmEnabled: preferences.llmEnabled };
      state.preferences = publication.preferences;
      state.publicationIntervalTurns = Math.max(1, Math.round(preferences.frequencyStandardTurns * state.speed.multiplier));
      this.store!.save({ session: state, publication, configuration: this.config });
      this.state = state;
      this.publication = publication;
      return this.snapshot();
    });
  }

  /** Reject new work immediately, drain every accepted operation, then release the source once. */
  close(): Promise<void> {
    this.stopping = true;
    this.closing ??= this.tail.then(async () => {
      const db = this.db;
      this.db = undefined;
      this.state = undefined;
      const store = this.store;
      this.store = undefined;
      this.publication = undefined;
      store?.close();
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
      if (this.store && this.publication && this.config) {
        const existing = this.store.getCheck(state.runId!, state.settings.receiverPlayerID, cutoffTurn);
        if (existing) throw new ReplaySessionError('This cutoff is already completed; resume the saved run.', 409);
        const visiblePlayers = new Set(evidence.players.map(player => String(player.subjectID)));
        visiblePlayers.add(String(state.settings.receiverPlayerID));
        const context = this.context ? {
          ...this.context,
          playerNames: Object.fromEntries(Object.entries(this.context.playerNames).filter(([id]) => visiblePlayers.has(id))),
          playerTeamIds: Object.fromEntries(Object.entries(this.context.playerTeamIds).filter(([id]) => visiblePlayers.has(id))),
          majorPlayerIds: this.context.majorPlayerIds.filter(id => visiblePlayers.has(String(id))),
          standardTurnsPerGameTurn: 1 / state.speed.multiplier,
        } : undefined;
        const result = (this.dependencies.check ?? runEditorialCheck)({
          campaignId: this.campaignId!, timelineId: state.runId!,
          receiver: { playerId: state.settings.receiverPlayerID, label: this.context?.receiverOwnerName ?? `Player ${state.settings.receiverPlayerID}`, civilizationId: this.context?.civilization },
          evidence, state: publicationStateSchema.parse(this.publication), config: this.config, context,
        });
        const check = this.store.commit({ session: state, publication: result.state, configuration: this.config }, result);
        this.publication = result.state;
        this.state = state;
        return { session: this.snapshot(), evidence, check };
      }
      this.state = state;
    }
    return { session: this.snapshot(), evidence };
  }

  /** Reject stale or mismatched browser scopes before any source query or mutation. */
  private checkScope(input?: unknown): void {
    const state = this.snapshot();
    if (input === undefined) return;
    const scope = newspaperArchiveQuerySchema.parse(input);
    if ((scope.runId !== undefined && scope.runId !== state.runId)
      || (scope.receiverPlayerID !== undefined && scope.receiverPlayerID !== state.settings.receiverPlayerID)) {
      throw new ReplaySessionError('The request belongs to a different replay run or receiver.', 409);
    }
  }

  /** Require the offline publication mode for archive and feedback operations. */
  private requirePublication(): ReplayState {
    const state = this.snapshot();
    if (!this.store || !this.publication) throw new ReplaySessionError('Publication storage is disabled for this evidence-only replay.', 409);
    return state;
  }

  /** Validate active state and copy its serialized fields. */
  private snapshot(): ReplayState {
    if (!this.state) throw new ReplaySessionError('Configure a replay recording first.', 409);
    return replayStateSchema.parse(this.state);
  }

  /** Keep accepted operations ordered and let a failed request leave the queue usable. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new ReplaySessionError('Replay is shutting down.', 503));
    const job = this.tail.then(operation).catch(error => {
      if (error instanceof ReplayStoreConflictError) throw new ReplaySessionError(error.message, 409);
      throw error;
    });
    this.tail = job.then(() => undefined, () => undefined);
    return job;
  }
}
