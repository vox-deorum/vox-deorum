/**
 * Replay controls for opening, resuming, branching, checking, and preferences.
 *
 * The form owns its own serialized validation and local restore data. The host
 * wires evidence and saved-issue inspection through callbacks so controls stay
 * independent of the reader shell.
 */
import { ZodError, type z } from 'zod';
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import { replaySettingsSchema, type replayCheckSchema, type ReplaySettings, type ReplayState } from '../../../src/newspaper/contracts/replay.js';
import { publicationPreferencesSchema, type PublicationPreferences } from '../../../src/newspaper/contracts/publication.js';
import { errorMessage } from '../../../src/utils/errors.js';
import {
  advanceReplay,
  configureReplay,
  getReplayState,
  inspectReplay,
  ReplayApiError,
  saveReplayPreferences,
} from './api.js';

/** Host callbacks used by replay controls. */
export interface ReplayControlCallbacks {
  /** Show or clear inspected evidence. */
  onEvidence(evidence: NewspaperEvidence | null): void;
  /** Report the current server session after any accepted operation. */
  onSession(state: ReplayState): void;
  /** Show or clear the editorial check returned by an advance. */
  onCheck(check: z.infer<typeof replayCheckSchema> | null): void;
  /** Notify the host that a generated issue may now appear in the archive. */
  onPublished(): void;
  /** Drain pending votes before a replay operation reads or changes editorial state. */
  beforeOperation(): Promise<void>;
  /** Prevent new reader actions while replay operations are in progress. */
  onBusy(busy: boolean): void;
}

/** Controls exposed to the host after mounting. */
export interface ReplayControls {
  /** Return the current server-backed session, or null before one exists. */
  getSession(): ReplayState | null;
  /** Apply a session returned by another scoped operation such as a vote save. */
  showSession(state: ReplayState): void;
  /** Show an error without changing the current session. */
  reportError(message: string): void;
  /** Show a status message without changing the current session. */
  reportStatus(message: string): void;
}

/** Locally stored settings used to refill the resume form after a restart. */
interface StoredReplay {
  settings: ReplaySettings;
  runId: string;
  outputPath: string;
}

const storageKey = 'vox-deorum.newspaper.replay';

/** Return a named input or select from the replay form. */
function field<T extends HTMLInputElement | HTMLSelectElement>(form: HTMLFormElement, name: string): T {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) return element as T;
  throw new Error(`Missing replay field ${name}.`);
}

/** Read a trimmed text value from the form. */
function textValue(form: HTMLFormElement, name: string): string {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value.trim() : '';
}

/** Read an optional trimmed text value from the form. */
function optionalText(form: HTMLFormElement, name: string): string | undefined {
  const value = textValue(form, name);
  return value ? value : undefined;
}

/** Read a numeric value from the form. */
function numberValue(form: HTMLFormElement, name: string): number {
  return Number(textValue(form, name));
}

/** Format validation and API failures for the status area. */
function formatError(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? 'Invalid replay settings.';
  return errorMessage(error);
}

/** Build validated settings from the current form values. */
function readOpenSettings(form: HTMLFormElement): ReplaySettings {
  const outputPath = optionalText(form, 'outputPath');
  const runId = optionalText(form, 'runId');
  const mode = textValue(form, 'mode');
  const identity = {
    databasePath: textValue(form, 'databasePath'),
    receiverPlayerID: numberValue(form, 'receiverPlayerID'),
    ...(outputPath ? { outputPath } : {}),
    ...(runId ? { runId } : {}),
    mode,
  };
  if (mode === 'resume') {
    // The server restores the saved schedule; disabled form values cannot replace it.
    return replaySettingsSchema.parse({
      ...identity, publicationEnabled: true, fromTurn: 0, toTurn: 0,
      publicationInterval: 1, comparisonTurns: 0, durationUnit: 'recordedTurns',
    });
  }
  const override = optionalText(form, 'speedMultiplierOverride');
  const branchFromRunId = optionalText(form, 'branchFromRunId');
  const editorialConfigDirectory = optionalText(form, 'editorialConfigDirectory');
  const frequency = optionalText(form, 'frequencyStandardTurns');
  const llm = optionalText(form, 'llmEnabled');
  return replaySettingsSchema.parse({
    ...identity,
    fromTurn: numberValue(form, 'fromTurn'),
    toTurn: numberValue(form, 'toTurn'),
    publicationInterval: numberValue(form, 'publicationInterval'),
    durationUnit: textValue(form, 'durationUnit'),
    comparisonTurns: numberValue(form, 'comparisonTurns'),
    ...(frequency ? { frequencyStandardTurns: Number(frequency) } : {}),
    ...(llm !== undefined ? { llmEnabled: llm === 'true' } : {}),
    publicationEnabled: textValue(form, 'publicationEnabled') !== 'false',
    ...(override ? { speedMultiplierOverride: Number(override) } : {}),
    ...(mode === 'branch' && branchFromRunId ? { branchFromRunId } : {}),
    ...(editorialConfigDirectory ? { editorialConfigDirectory } : {}),
  });
}

/** Build validated preferences from the current form values. */
function readPreferences(form: HTMLFormElement): PublicationPreferences {
  if (!optionalText(form, 'frequencyStandardTurns') || !optionalText(form, 'llmEnabled')) {
    throw new Error('Choose a frequency and an LLM editor setting before saving preferences.');
  }
  return publicationPreferencesSchema.parse({
    frequencyStandardTurns: numberValue(form, 'frequencyStandardTurns'),
    llmEnabled: textValue(form, 'llmEnabled') === 'true',
  });
}

/** Fill the form with settings from one session or stored resume data. */
function fillForm(
  form: HTMLFormElement,
  settings: ReplaySettings,
  runId: string,
  outputPath: string,
  mode: 'new' | 'resume',
  preferences?: PublicationPreferences,
): void {
  field(form, 'databasePath').value = settings.databasePath;
  field(form, 'publicationEnabled').value = String(settings.publicationEnabled !== false);
  field(form, 'receiverPlayerID').value = String(settings.receiverPlayerID);
  field(form, 'fromTurn').value = String(settings.fromTurn);
  field(form, 'toTurn').value = String(settings.toTurn);
  field(form, 'publicationInterval').value = String(settings.publicationInterval);
  field(form, 'comparisonTurns').value = String(settings.comparisonTurns);
  field(form, 'durationUnit').value = settings.durationUnit;
  field(form, 'speedMultiplierOverride').value = settings.speedMultiplierOverride === undefined
    ? '' : String(settings.speedMultiplierOverride);
  field(form, 'mode').value = mode;
  field(form, 'runId').value = runId;
  field(form, 'branchFromRunId').value = settings.branchFromRunId ?? '';
  field(form, 'outputPath').value = outputPath;
  field(form, 'editorialConfigDirectory').value = settings.editorialConfigDirectory ?? '';
  const frequency = preferences?.frequencyStandardTurns ?? settings.frequencyStandardTurns;
  const llm = preferences?.llmEnabled ?? settings.llmEnabled;
  field(form, 'frequencyStandardTurns').value = frequency === undefined ? '' : String(frequency);
  field(form, 'llmEnabled').value = llm === undefined ? '' : String(llm);
}

/** Save the latest session settings so a restarted server can refill the resume form. */
function writeStored(state: ReplayState): void {
  if (!state.runId) return;
  try {
    const settings: ReplaySettings = {
      ...state.settings,
      mode: 'resume',
      runId: state.runId,
      ...(state.outputPath ? { outputPath: state.outputPath } : {}),
      ...(state.preferences
        ? {
          frequencyStandardTurns: state.preferences.frequencyStandardTurns,
          llmEnabled: state.preferences.llmEnabled,
        }
        : {}),
    };
    localStorage.setItem(storageKey, JSON.stringify({
      settings,
      runId: state.runId,
      outputPath: state.outputPath ?? '',
    }));
  } catch {
    return;
  }
}

/** Read locally stored resume settings, ignoring stale or malformed data. */
function readStored(): StoredReplay | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const settings = replaySettingsSchema.safeParse(record.settings);
    if (!settings.success) return null;
    if (typeof record.runId !== 'string' || !record.runId.trim()) return null;
    return {
      settings: settings.data,
      runId: record.runId.trim(),
      outputPath: typeof record.outputPath === 'string' ? record.outputPath : settings.data.outputPath ?? '',
    };
  } catch {
    return null;
  }
}

/** Connect replay controls independently of fixture loading or publication generation. */
export function mountReplayControls(
  form: HTMLFormElement,
  callbacks: ReplayControlCallbacks,
): ReplayControls {
  const status = form.querySelector<HTMLOutputElement>('output')!;
  const errorView = form.querySelector<HTMLElement>('[data-replay-error]')!;
  const fieldsets = [...form.querySelectorAll<HTMLFieldSetElement>('fieldset')];
  const preview = form.querySelector<HTMLButtonElement>('[data-replay="inspect"]')!;
  const next = form.querySelector<HTMLButtonElement>('[data-replay="advance"]')!;
  const savePreferences = form.querySelector<HTMLButtonElement>('[data-replay="save-preferences"]')!;
  const mode = field<HTMLSelectElement>(form, 'mode');
  const runId = field<HTMLInputElement>(form, 'runId');
  const branchFrom = field<HTMLInputElement>(form, 'branchFromRunId');
  const purpose = field<HTMLSelectElement>(form, 'publicationEnabled');

  let current: ReplayState | null = null;
  let busy = false;
  let operationGeneration = 0;
  let previousMode = mode.value;
  let nonResumePurpose = purpose.value;

  /** Show a readable error without discarding the current session. */
  function showError(message: string): void {
    errorView.textContent = message;
    errorView.hidden = false;
  }

  /** Clear the previous error before a new operation. */
  function clearError(): void {
    errorView.textContent = '';
    errorView.hidden = true;
  }

  /** Show a plain status message in the form output. */
  function showStatus(message: string): void {
    status.textContent = message;
  }

  /** Keep actions aligned with the current session, publication run, and finished cursor. */
  function updateAvailability(): void {
    preview.disabled = !current;
    next.disabled = !current || current.cursor.finished;
    savePreferences.disabled = !current?.runId;
  }

  /** Keep branch identity and saved settings aligned with the selected opening mode. */
  function syncModeFields(): void {
    branchFrom.disabled = mode.value !== 'branch';
    branchFrom.required = mode.value === 'branch';
    if (mode.value !== 'branch') branchFrom.value = '';
    runId.required = mode.value === 'resume';
    const resuming = mode.value === 'resume';
    if (resuming) {
      if (previousMode !== 'resume') nonResumePurpose = purpose.value;
      purpose.value = 'true';
    } else if (previousMode === 'resume') {
      purpose.value = nonResumePurpose;
    }
    previousMode = mode.value;
    for (const element of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-saved-setting]')) element.disabled = resuming;
    const resumeNote = form.querySelector<HTMLElement>('[data-replay-resume]');
    if (resumeNote) resumeNote.hidden = !resuming;
    const evidenceOnly = purpose.value === 'false';
    const evidenceInterval = form.querySelector<HTMLElement>('[data-evidence-interval]');
    if (evidenceInterval) evidenceInterval.hidden = !evidenceOnly;
  }

  /** Apply one accepted session to the form, status, and host callbacks. */
  function applyState(state: ReplayState, fill: boolean): void {
    current = state;
    callbacks.onSession(state);
    writeStored(state);
    updateAvailability();
    if (fill) {
      fillForm(
        form,
        state.settings,
        state.runId ?? '',
        state.outputPath ?? '',
        state.runId ? 'resume' : 'new',
        state.preferences,
      );
      nonResumePurpose = purpose.value;
    }
    syncModeFields();
    const cutoff = state.cursor.cutoffTurn === null
      ? 'before first check'
      : `turn ${state.cursor.cutoffTurn}`;
    const run = state.runId ? ` Run: ${state.runId}.` : ' No publication run.';
    showStatus(
      `${state.speed.label}, multiplier ${state.speed.multiplier}. `
      + (state.preferences ? `Publication frequency: ${state.preferences.frequencyStandardTurns} Standard turns (${state.publicationIntervalTurns} recorded turns). ` : `Evidence interval: ${state.publicationIntervalTurns} recorded turns. `)
      + `Cutoff: ${cutoff}${state.cursor.finished ? ' (finished)' : ''}.`
      + run,
    );
  }

  /** Disable overlapping browser operations while preserving errors and the current session. */
  async function run(operation: (generation: number) => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    const generation = ++operationGeneration;
    clearError();
    for (const element of fieldsets) element.disabled = true;
    callbacks.onBusy(true);
    try {
      await callbacks.beforeOperation();
      await operation(generation);
    } catch (error) {
      if (generation === operationGeneration) showError(formatError(error));
    } finally {
      busy = false;
      callbacks.onBusy(false);
      for (const element of fieldsets) element.disabled = false;
      updateAvailability();
      syncModeFields();
    }
  }

  /** Parse user settings through the shared browser-safe contract and open the run. */
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run(async generation => {
      const settings = readOpenSettings(form);
      const state = await configureReplay(settings);
      if (generation !== operationGeneration) return;
      applyState(state, true);
      callbacks.onEvidence(null);
      callbacks.onCheck(null);
    });
  });

  /** Keep evidence preview separate from the advancing check action. */
  preview.addEventListener('click', () => {
    void run(async generation => {
      const session = current;
      if (!session) throw new Error('Open a replay run before inspecting evidence.');
      const scope: NewspaperArchiveScope | undefined = session.runId
        ? { runId: session.runId, receiverPlayerID: session.settings.receiverPlayerID }
        : undefined;
      const result = await inspectReplay(scope);
      if (generation !== operationGeneration) return;
      applyState(result.session, false);
      callbacks.onEvidence(result.evidence);
    });
  });

  /** Display each accepted check and any issue or skip reason it returned. */
  next.addEventListener('click', () => {
    void run(async generation => {
      const session = current;
      if (!session) throw new Error('Open a replay run before advancing.');
      const scope: NewspaperArchiveScope | undefined = session.runId
        ? { runId: session.runId, receiverPlayerID: session.settings.receiverPlayerID }
        : undefined;
      const result = await advanceReplay(scope);
      if (generation !== operationGeneration) return;
      applyState(result.session, false);
      callbacks.onEvidence(result.evidence);
      callbacks.onCheck(result.check ?? null);
      if (result.check?.status === 'published') callbacks.onPublished();
      const cutoff = result.session.cursor.cutoffTurn === null
        ? 'selected cutoff'
        : `turn ${result.session.cursor.cutoffTurn}`;
      if (result.check?.status === 'published') {
        showStatus(`Published ${result.check.issue ? `issue ${result.check.issue.issueId}` : 'an issue'} at cutoff ${cutoff}.`);
      } else if (result.check?.status === 'skipped') {
        showStatus(`Check skipped at cutoff ${cutoff}: ${result.check.reason ?? 'no reason recorded'}.`);
      } else {
        showStatus(`Advanced to cutoff ${cutoff}.`);
      }
    });
  });

  /** Save the edited frequency and LLM preferences for the current run. */
  savePreferences.addEventListener('click', () => {
    void run(async generation => {
      if (!current?.runId) throw new Error('Open a publication run before saving preferences.');
      const preferences = readPreferences(form);
      const state = await saveReplayPreferences({
        ...preferences,
        runId: current.runId,
        receiverPlayerID: current.settings.receiverPlayerID,
      });
      if (generation !== operationGeneration) return;
      applyState(state, true);
      showStatus(
        `Preferences saved: ${state.preferences?.frequencyStandardTurns ?? preferences.frequencyStandardTurns} Standard turns, `
        + `LLM ${(state.preferences?.llmEnabled ?? preferences.llmEnabled) ? 'allowed when available' : 'disabled'}.`,
      );
    });
  });

  /** Start new runs and branches with inherited defaults rather than a resumed run's choices. */
  mode.addEventListener('change', () => {
    if (mode.value !== 'resume') {
      field(form, 'frequencyStandardTurns').value = '';
      field(form, 'llmEnabled').value = '';
      runId.value = '';
    } else if (current?.runId) {
      runId.value = current.runId;
      field(form, 'frequencyStandardTurns').value = current.preferences ? String(current.preferences.frequencyStandardTurns) : '';
      field(form, 'llmEnabled').value = current.preferences ? String(current.preferences.llmEnabled) : '';
    }
    syncModeFields();
  });
  purpose.addEventListener('change', syncModeFields);

  /** Restore an existing session after reload, or refill the resume form without mutating it. */
  void run(async () => {
    try {
      const state = await getReplayState();
      applyState(state, true);
    } catch (error) {
      if (error instanceof ReplayApiError && error.status === 409) {
        const stored = readStored();
        if (stored) {
          fillForm(form, stored.settings, stored.runId, stored.outputPath, 'resume');
          syncModeFields();
          showStatus('Saved replay settings are ready. Choose Open recording to resume.');
        } else {
          showStatus('Choose a recording to begin replay.');
        }
        return;
      }
      showStatus(error instanceof ReplayApiError && error.status === 503
        ? 'Start the normal VD server to use replay.'
        : formatError(error));
    }
  });

  syncModeFields();
  updateAvailability();

  return {
    getSession(): ReplayState | null {
      return current;
    },
    showSession(state: ReplayState): void {
      applyState(state, false);
    },
    reportError(message: string): void {
      showError(message);
    },
    reportStatus(message: string): void {
      showStatus(message);
    },
  };
}
