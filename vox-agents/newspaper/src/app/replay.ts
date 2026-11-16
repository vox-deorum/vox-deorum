import { replaySettingsSchema, type ReplayState } from '../../../src/newspaper/contracts/replay.js';
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { advanceReplay, configureReplay, getReplayState, inspectReplay, ReplayApiError } from './api.js';

/** Connect replay controls independently of fixture loading or publication generation. */
export function mountReplayControls(form: HTMLFormElement, inspect: (evidence: NewspaperEvidence | null) => void): void {
  const status = form.querySelector<HTMLOutputElement>('output')!;
  const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
  const preview = form.querySelector<HTMLButtonElement>('[data-replay="inspect"]')!;
  const next = form.querySelector<HTMLButtonElement>('[data-replay="advance"]')!;

  /** Report the recorded cutoff and resolved pace without assuming an issue exists. */
  function showState(value: ReplayState): void {
    preview.disabled = false;
    next.disabled = value.cursor.finished;
    status.textContent = `${value.speed.label}, multiplier ${value.speed.multiplier}. `
      + `Interval: ${value.publicationIntervalTurns} recorded turns. `
      + `Cutoff: ${value.cursor.cutoffTurn ?? 'before first check'}${value.cursor.finished ? ' (finished)' : ''}.`;
  }

  /** Disable overlapping browser operations while preserving errors and the current cursor. */
  async function run(operation: () => Promise<void>): Promise<void> {
    fieldset.disabled = true;
    try { await operation(); }
    catch (error) { status.textContent = errorMessage(error); }
    finally { fieldset.disabled = false; }
  }

  /** Parse user settings through the same browser-safe contract as the server. */
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    void run(async () => {
      const override = String(values.get('speedMultiplierOverride') ?? '').trim();
      const settings = replaySettingsSchema.parse({
        databasePath: values.get('databasePath'),
        receiverPlayerID: Number(values.get('receiverPlayerID')),
        fromTurn: Number(values.get('fromTurn')), toTurn: Number(values.get('toTurn')),
        publicationInterval: Number(values.get('publicationInterval')),
        comparisonTurns: Number(values.get('comparisonTurns')),
        durationUnit: values.get('durationUnit'),
        ...(override ? { speedMultiplierOverride: Number(override) } : {}),
      });
      showState(await configureReplay(settings));
      inspect(null);
    });
  });

  /** Keep evidence preview separate from the advancing check action. */
  preview.addEventListener('click', () => {
    void run(async () => {
      const result = await inspectReplay();
      showState(result.session);
      inspect(result.evidence);
    });
  });

  /** Display each accepted check directly in the source inspector. */
  next.addEventListener('click', () => {
    void run(async () => {
      const result = await advanceReplay();
      showState(result.session);
      inspect(result.evidence);
    });
  });

  /** Restore an existing in-memory session after reload; fixture-only hosts can lack replay routes. */
  void run(async () => {
    let state: ReplayState;
    try { state = await getReplayState(); }
    catch (error) {
      status.textContent = error instanceof ReplayApiError && error.status === 409
        ? 'Choose a recording to begin replay.'
        : 'Start the normal VD server to use replay.';
      return;
    }
    for (const [key, value] of Object.entries(state.settings)) {
      const input = form.elements.namedItem(key);
      if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = String(value);
    }
    showState(state);
  });
}
