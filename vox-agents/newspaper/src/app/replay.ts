/** Connect the recording form and batch generation to the shared reader. */
import { ZodError } from 'zod';
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import { replaySettingsSchema, type ReplaySettings, type ReplayState } from '../../../src/newspaper/contracts/replay.js';
import { publicationPreferencesSchema } from '../../../src/newspaper/contracts/publication.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { advanceReplay, configureReplay, getLatestRecording, getReplayState, inspectReplay, ReplayApiError, saveReplayPreferences } from './api.js';
import { element } from './dom.js';

interface ReplayControlCallbacks {
  /** Accept a configured or restored run, and load its saved editions. */
  onRun(state: ReplayState, openLatest: boolean): Promise<void>;
  /** Add a new edition to the picker without reloading the archive. */
  onPublished(issueId: string, turn: number): void;
  /** Capture the current selection and open the latest edition at completion if unchanged. */
  onBatchStart(): () => Promise<void>;
  /** Set or clear inspected evidence. */
  onEvidence(evidence: NewspaperEvidence | null): void;
  /** Clear or add skip reasons from the batch. */
  onSkip(skip: ReplaySkip | null): void;
  /** Refresh anything that summarizes the run after a batch ends, finished or stopped. */
  onBatchEnd(): void;
  /** Hold votes from the old run while its replacement opens. */
  onConfiguring(configuring: boolean): void;
  /** Wait for earlier votes before a scoped write. */
  flushVotes(): Promise<void>;
}

export interface ReplaySkip {
  turn: number;
  reason: string;
}

const storageKey = 'vox-deorum.newspaper.replay';

/** Read saved settings as a convenience for reopening a store after a server restart. */
function readStored(): ReplaySettings | undefined {
  try {
    const result = replaySettingsSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')?.settings);
    return result.success && result.data.runId ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Remember how to resume the publication store without creating a new run. */
function remember(state: ReplayState): void {
  if (!state.runId) return;
  const settings = { ...state.settings, ...state.preferences, runId: state.runId, outputPath: state.outputPath, mode: 'resume' };
  try {
    localStorage.setItem(storageKey, JSON.stringify({ settings }));
  } catch {
    // Replay still works when browser storage is unavailable.
  }
}

/** Find the published archive addressed by a replay request. */
function scope(state: ReplayState): NewspaperArchiveScope | undefined {
  return state.runId ? { runId: state.runId, receiverPlayerID: state.settings.receiverPlayerID } : undefined;
}

/** Report the first invalid field or the API's readable error. */
function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return issue ? [issue.path.join(' '), issue.message].filter(Boolean).join(': ') : 'Invalid replay settings.';
  }
  return errorMessage(error);
}

/** Mount controls and return a lazy initializer for the Recorded tab. */
export function mountReplayControls(callbacks: ReplayControlCallbacks): () => void {
  const form = element<HTMLFormElement>('#replay-form');
  const fieldsets = [...form.querySelectorAll('fieldset')];
  const status = element<HTMLOutputElement>('#replay-status');
  const errorView = element('[data-replay-error]');
  const generate = element<HTMLButtonElement>('#replay-generate');
  const resume = element<HTMLButtonElement>('#replay-resume');
  const proceed = element<HTMLButtonElement>('#replay-continue');
  const stop = element<HTMLButtonElement>('#replay-stop');
  const inspect = element<HTMLButtonElement>('[data-replay="inspect"]');
  const savePreferences = element<HTMLButtonElement>('[data-replay="save-preferences"]');
  const recording = element<HTMLDetailsElement>('#recording-details');
  let current: ReplayState | undefined;
  let busy = false;
  let batching = false;
  let stopRequested = false;
  let restoreStopFocus = false;
  let started = false;
  let editedDatabasePath = false;

  /** Return a named input or select from the replay form. */
  function field(name: string): HTMLInputElement | HTMLSelectElement {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) return control;
    throw new Error(`Missing replay field ${name}.`);
  }

  /** Read the trimmed value of a form control. */
  function value(name: string): string {
    return field(name).value.trim();
  }

  /** Keep actions aligned with the current run and settings. */
  function updateControls(): void {
    for (const fieldset of fieldsets) fieldset.disabled = busy;
    const branchFrom = field('branchFromRunId');
    branchFrom.disabled = value('mode') !== 'branch';
    branchFrom.required = !branchFrom.disabled;
    const evidenceOnly = value('publicationEnabled') === 'false';
    element('[data-evidence-interval]').hidden = !evidenceOnly;
    field('publicationInterval').disabled = !evidenceOnly;
    generate.disabled = busy;
    resume.disabled = busy;
    proceed.hidden = !current || current.cursor.finished;
    proceed.disabled = busy;
    stop.hidden = !batching;
    stop.disabled = stopRequested;
    inspect.disabled = busy || !current;
    savePreferences.disabled = busy || !current?.runId;
  }

  /** Translate the form into new, branch, or resume settings. */
  function readSettings(resuming: boolean): ReplaySettings {
    if (!value('databasePath') || !value('receiverPlayerID')) throw new Error('Enter a recording path and player.');
    const identity = {
      databasePath: value('databasePath'),
      receiverPlayerID: Number(value('receiverPlayerID')),
      outputPath: value('outputPath') || undefined,
    };
    if (resuming) {
      if (!value('runId')) throw new Error('Enter the run ID to resume.');
      return replaySettingsSchema.parse({
        ...identity, mode: 'resume', runId: value('runId'), publicationEnabled: true,
        fromTurn: 0, toTurn: 0, publicationInterval: 1, comparisonTurns: 0, durationUnit: 'recordedTurns',
      });
    }
    const frequency = value('frequencyStandardTurns');
    const llm = value('llmEnabled');
    const override = value('speedMultiplierOverride');
    return replaySettingsSchema.parse({
      ...identity,
      mode: value('mode'),
      branchFromRunId: value('mode') === 'branch' ? value('branchFromRunId') : undefined,
      fromTurn: Number(value('fromTurn')),
      toTurn: Number(value('toTurn')),
      publicationEnabled: value('publicationEnabled') !== 'false',
      publicationInterval: Number(value('publicationInterval')),
      durationUnit: value('durationUnit'),
      comparisonTurns: Number(value('comparisonTurns')),
      frequencyStandardTurns: frequency ? Number(frequency) : undefined,
      llmEnabled: llm ? llm === 'true' : undefined,
      speedMultiplierOverride: override ? Number(override) : undefined,
      editorialConfigDirectory: value('editorialConfigDirectory') || undefined,
    });
  }

  /** Refill settings from the store without locking them to a past run. */
  function fillForm(settings: ReplaySettings): void {
    const values = {
      databasePath: settings.databasePath,
      receiverPlayerID: settings.receiverPlayerID,
      fromTurn: settings.fromTurn,
      toTurn: settings.toTurn,
      publicationEnabled: settings.publicationEnabled !== false,
      publicationInterval: settings.publicationInterval,
      durationUnit: settings.durationUnit,
      comparisonTurns: settings.comparisonTurns,
      speedMultiplierOverride: settings.speedMultiplierOverride,
      mode: 'new',
      runId: settings.runId,
      branchFromRunId: undefined,
      outputPath: settings.outputPath,
      editorialConfigDirectory: settings.editorialConfigDirectory,
      frequencyStandardTurns: settings.frequencyStandardTurns,
      llmEnabled: settings.llmEnabled,
    };
    for (const [name, entry] of Object.entries(values)) field(name).value = entry === undefined ? '' : String(entry);
  }

  /** Serialize recording controls so form actions cannot overlap the active batch. */
  async function run(operation: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    updateControls();
    errorView.hidden = true;
    try {
      await operation();
    } catch (error) {
      errorView.textContent = formatError(error);
      errorView.hidden = false;
    } finally {
      busy = false;
      updateControls();
    }
  }

  /** Adopt a run and list its editions before starting new work. */
  async function setRun(state: ReplayState, openLatest: boolean, refill: boolean): Promise<void> {
    current = state;
    if (refill) fillForm({ ...state.settings, ...state.preferences, runId: state.runId, outputPath: state.outputPath });
    else {
      field('runId').value = state.runId ?? '';
      field('outputPath').value = state.outputPath ?? '';
    }
    remember(state);
    callbacks.onEvidence(null);
    callbacks.onSkip(null);
    updateControls();
    await callbacks.onRun(state, openLatest);
  }

  /** Summarize the position and schedule of an open recording. */
  function describe(state: ReplayState): string {
    const cutoff = state.cursor.cutoffTurn === null ? 'Ready for first check' : `Checked through turn ${state.cursor.cutoffTurn}`;
    return `${cutoff}${state.cursor.finished ? ' (complete)' : ''}. Every ${state.publicationIntervalTurns} recorded turns.`;
  }

  /** Check cutoffs one at a time, preserving each successful check if stopped. */
  async function batch(state: ReplayState, finish: () => Promise<void>): Promise<void> {
    batching = true;
    stopRequested = false;
    restoreStopFocus = false;
    callbacks.onSkip(null);
    callbacks.onEvidence(null);
    updateControls();
    let checked = 0;
    let published = 0;
    const label = state.runId ? 'editions' : 'evidence checks';
    const finalTurn = state.settings.toTurn;
    const nextTurn = state.cursor.cutoffTurn === null ? state.settings.fromTurn : Math.min(finalTurn, state.cursor.cutoffTurn + state.publicationIntervalTurns);
    status.textContent = `Checking turn ${nextTurn} of ${finalTurn}…`;
    try {
      while (!state.cursor.finished && !stopRequested) {
        await callbacks.flushVotes();
        if (stopRequested) break;
        const result = await advanceReplay(scope(state));
        state = result.session;
        current = state;
        checked += 1;
        const turn = state.cursor.cutoffTurn;
        if (result.check?.status === 'skipped' && turn !== null) {
          callbacks.onSkip({ turn, reason: result.check.reason ?? 'No reason recorded.' });
        }
        if (result.check?.status === 'published') {
          published += 1;
          if (result.check.issueId && turn !== null) callbacks.onPublished(result.check.issueId, turn);
        }
        status.textContent = `${stopRequested ? 'Stopping. ' : ''}Checked turn ${turn} of ${finalTurn} · ${state.runId ? published : checked} ${label}.`;
      }
      const prefix = state.cursor.finished ? 'Complete' : 'Stopped';
      const outcome = state.runId
        ? published === 0 ? 'No editions published.' : `${published} ${published === 1 ? 'edition' : 'editions'} published.`
        : `${checked} evidence ${checked === 1 ? 'check' : 'checks'} completed.`;
      status.textContent = `${prefix} · ${outcome}`;
      if (published) await finish();
    } catch (error) {
      status.textContent = `Generation paused after ${checked} ${checked === 1 ? 'check' : 'checks'}.`;
      throw error;
    } finally {
      const restoreFocus = restoreStopFocus || document.activeElement === stop;
      batching = false;
      updateControls();
      if (checked) callbacks.onBatchEnd();
      if (restoreFocus) requestAnimationFrame(() => {
        if (stop === document.activeElement || document.body === document.activeElement) {
          (proceed.hidden ? generate : proceed).focus({ preventScroll: true });
        }
      });
    }
  }

  form.addEventListener('invalid', event => {
    if (!(event.target instanceof HTMLElement)) return;
    for (let node = event.target.parentElement; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
  }, true);
  form.addEventListener('change', updateControls);
  field('databasePath').addEventListener('input', () => { editedDatabasePath = true; });

  /** Offer an archive path without replacing a typed path or delaying the form. */
  async function suggestRecording(): Promise<void> {
    try {
      const path = await getLatestRecording();
      if (path && !current && !editedDatabasePath && !value('databasePath')) field('databasePath').value = path;
    } catch {
      // A missing or unreadable archive still allows manual entry.
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const focusedResume = event.submitter === resume && document.activeElement === resume;
    void run(async () => {
      const resuming = event.submitter === resume;
      const settings = readSettings(resuming);
      const finish = callbacks.onBatchStart();
      status.textContent = resuming ? 'Opening saved editions…' : 'Opening recording…';
      let state: ReplayState;
      callbacks.onConfiguring(true);
      try {
        await callbacks.flushVotes();
        state = await configureReplay(settings);
      } catch (error) {
        status.textContent = current ? describe(current) : 'Choose a recording to get started.';
        throw error;
      } finally {
        callbacks.onConfiguring(false);
      }
      await setRun(state, resuming, resuming);
      if (resuming) {
        recording.open = false;
        if (focusedResume && (document.activeElement === document.body || document.activeElement === resume)) {
          recording.querySelector('summary')?.focus({ preventScroll: true });
        }
        status.textContent = describe(current!);
      } else {
        recording.open = false;
        await batch(current!, finish);
      }
    });
  });

  proceed.addEventListener('click', () => {
    void run(async () => {
      if (current && !current.cursor.finished) await batch(current, callbacks.onBatchStart());
    });
  });

  stop.addEventListener('click', () => {
    restoreStopFocus = document.activeElement === stop;
    stopRequested = true;
    status.textContent = 'Stopping after the current check…';
    updateControls();
  });

  inspect.addEventListener('click', () => {
    void run(async () => {
      if (!current) return;
      const result = await inspectReplay(scope(current));
      callbacks.onEvidence(result.evidence);
    });
  });

  savePreferences.addEventListener('click', () => {
    void run(async () => {
      const archive = current && scope(current);
      if (!archive) return;
      const frequency = value('frequencyStandardTurns');
      const llm = value('llmEnabled');
      if (!frequency || !llm) throw new Error('Choose a frequency and whether to allow LLM editing.');
      const preferences = publicationPreferencesSchema.parse({
        frequencyStandardTurns: Number(frequency), llmEnabled: llm === 'true',
      });
      current = await saveReplayPreferences({ ...archive, ...preferences });
      remember(current);
      status.textContent = describe(current);
    });
  });

  updateControls();

  return function restoreRecording(): void {
    if (started) return;
    started = true;
    void run(async () => {
      try {
        const state = await getReplayState();
        await setRun(state, true, true);
        status.textContent = describe(state);
      } catch (error) {
        if (!(error instanceof ReplayApiError) || error.status !== 409) throw error;
        const saved = readStored();
        if (saved) {
          fillForm(saved);
          updateControls();
          status.textContent = 'Saved settings are ready. Open Recording and choose Resume.';
        } else {
          recording.open = true;
          status.textContent = 'Choose a recording to get started.';
          void suggestRecording();
        }
      }
    });
  };
}
