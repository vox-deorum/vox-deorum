/** Switch between mockups and recorded editions in the same newspaper reader. */
import type { NewspaperArchiveIndex, NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import type { ArchiveIssue } from '../../../src/newspaper/contracts/archive.js';
import { newspaperScreenLabels, type IssueDocument, type LinkTarget } from '../../../src/newspaper/contracts/issue.js';
import type { ReaderAction, ReaderState, VoteValue } from '../../../src/newspaper/contracts/reader.js';
import type { ReplayState } from '../../../src/newspaper/contracts/replay.js';
import { createReaderState } from '../../../src/newspaper/renderer/state.js';
import { parseIssueDocument } from '../../../src/newspaper/renderer/validation.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { mountReader, type ReaderHandle } from '../reader/mount.js';
import { getReplayIssue, listReplayIssues, saveReplayVote } from './api.js';
import { mountRecordedAppearance } from './appearance.js';
import { element } from './dom.js';
import { createDiagnostics } from './inspector.js';
import { mountMockupControls } from './mockups.js';
import { mountReplayControls } from './replay.js';
import './styles.css';

type Source = 'mockups' | 'recorded';
type SavedView = { detail: ArchiveIssue; archive: NewspaperArchiveScope };

const readerRoot = element('#reader-root');
const note = element('#reader-note');
const mockupMode = element('#mockups-mode');
const recordedMode = element('#recorded-mode');
const editionPicker = element<HTMLSelectElement>('#recorded-edition');
const recordedAppearance = element<HTMLFieldSetElement>('#recorded-appearance');
const diagnostics = createDiagnostics(element<HTMLDetailsElement>('#replay-diagnostics'));

let source: Source = 'mockups';
let replay: ReplayState | undefined;
let visible: SavedView | undefined;
let reader: ReaderHandle | undefined;
let mockupIssue: IssueDocument | undefined;
let mockupState: ReaderState | undefined;
let recordedPosition: { issueId: string; state: ReaderState } | undefined;
let selectedEdition = '';
let latestEdition = '';
let configuring = false;
let loadVersion = 0;
let readingVersion = 0;
let voteTail = Promise.resolve();
const failedVotes = new Set<SavedView>();

/** Remove the current paper and display an optional empty state. */
function clearReader(message?: string): void {
  reader?.dispose();
  reader = undefined;
  visible = undefined;
  diagnostics.setEdition(undefined);
  if (message) {
    const placeholder = document.createElement('p');
    placeholder.className = 'host-reader-empty';
    placeholder.textContent = message;
    readerRoot.replaceChildren(placeholder);
  } else readerRoot.replaceChildren();
}

/** Mount the display issue and keep diagnostics tied to the original archive entry. */
async function showIssue(issue: IssueDocument, state: ReaderState, saved?: SavedView): Promise<void> {
  let mounted: ReaderHandle | undefined;
  try {
    reader?.dispose();
    mounted = mountReader(readerRoot, issue, state, handleAction);
    reader = mounted;
    if (visible?.detail !== saved?.detail) diagnostics.setEdition(saved?.detail);
    visible = saved;
    await mounted.ready;
  } catch (error) {
    if (!mounted || reader === mounted) clearReader(errorMessage(error, 'The issue could not be displayed.'));
  }
}

const styleRecordedIssue = mountRecordedAppearance(() => {
  if (source === 'recorded' && visible && reader) {
    void showIssue(styleRecordedIssue(visible.detail.issue), reader.getState(), visible);
  }
});

/** Read the active archive's scoped identifiers. */
function activeArchive(): NewspaperArchiveScope | undefined {
  return replay?.runId ? { runId: replay.runId, receiverPlayerID: replay.settings.receiverPlayerID } : undefined;
}

/** Translate stored votes into the reader's vote states. */
function readerVotes(votes: ArchiveIssue['votes']): Record<string, VoteValue> {
  const result: Record<string, VoteValue> = {};
  for (const [itemId, value] of Object.entries(votes)) {
    if (value !== 0) result[itemId] = value === 1 ? 'up' : 'down';
  }
  return result;
}

/** Wait until all votes already queued by the reader have been sent in order. */
async function flushVotes(): Promise<void> {
  let pending: Promise<void>;
  do {
    pending = voteTail;
    await pending;
  } while (pending !== voteTail);
}

/** Save a vote in order without letting its session snapshot overwrite generation progress. */
function persistVote(saved: SavedView, action: Extract<ReaderAction, { type: 'vote' }>): void {
  const value = action.value === 'up' ? 1 : action.value === 'down' ? -1 : 0;
  const pending = voteTail.then(async () => {
    try {
      await saveReplayVote({ ...saved.archive, itemId: action.itemId, value });
    } catch (error) {
      failedVotes.add(saved);
      note.textContent = `Vote was not saved: ${errorMessage(error)}`;
    }
    if (voteTail !== pending) return;
    const target = visible;
    if (target && failedVotes.has(target)) {
      const { detail, archive } = target;
      const updated = await getReplayIssue(detail.issue.issueId, archive.runId, archive.receiverPlayerID);
      if (voteTail !== pending) return;
      if (target === visible) reader?.replaceVotes(readerVotes(updated.votes));
    }
    failedVotes.clear();
  }).catch(error => {
    note.textContent = `Votes could not be reloaded: ${errorMessage(error)}`;
  });
  voteTail = pending;
}

/** Move to the linked article in the right section and focus its headline. */
function focusArticle(issue: IssueDocument, itemId: string): void {
  const page = issue.pages.find(candidate => candidate.itemIds.includes(itemId));
  if (!page || !reader) {
    note.textContent = 'This article is unavailable in the edition.';
    return;
  }
  reader.selectPage(page.id);
  const headline = readerRoot.querySelector<HTMLElement>(`[data-vd-region="page"]:not([hidden]) [data-item-id="${CSS.escape(itemId)}"] .vd-headline`);
  if (!headline) return;
  headline.tabIndex = -1;
  headline.focus();
}

/** Open one saved issue and discard responses for a previous selection or run. */
async function openSaved(issueId: string, itemId?: string): Promise<void> {
  const archive = activeArchive();
  if (!archive || source !== 'recorded' || configuring) return;
  const version = ++loadVersion;
  selectedEdition = issueId;
  editionPicker.value = issueId;
  try {
    await flushVotes();
    if (version !== loadVersion) return;
    const detail = await getReplayIssue(issueId, archive.runId, archive.receiverPlayerID);
    if (version !== loadVersion) return;
    note.textContent = '';
    const position = recordedPosition?.issueId === issueId ? recordedPosition.state : undefined;
    await showIssue(styleRecordedIssue(detail.issue), createReaderState(detail.issue, {
      ...position, votes: readerVotes(detail.votes),
    }), { detail, archive });
    if (itemId && version === loadVersion && visible?.detail === detail
      && document.activeElement === document.body) focusArticle(detail.issue, itemId);
  } catch (error) {
    if (version !== loadVersion) return;
    selectedEdition = visible?.detail.issue.issueId ?? '';
    editionPicker.value = selectedEdition;
    note.textContent = errorMessage(error, 'The saved edition could not be opened.');
  }
}

/** Describe game destinations that have no browser action. */
function gameDestination(target: Exclude<LinkTarget, { type: 'article' }>): string {
  if (target.type === 'city') return `City ${target.cityId}`;
  if (target.type === 'civilization') return `Civilization ${target.civilizationId}`;
  if (target.type === 'trade-relationship') return `Trade with civilization ${target.partnerCivilizationId}`;
  return newspaperScreenLabels[target.screen];
}

/** Persist recorded votes and route earlier reports through the same edition picker. */
function handleAction(action: ReaderAction): void {
  readingVersion += 1;
  if (action.type === 'vote' && visible && !configuring) persistVote(visible, action);
  if (action.type !== 'follow-link') return;
  if (action.target.type === 'article') {
    if (visible?.detail.issue.issueId === action.target.issueId) focusArticle(visible.detail.issue, action.target.itemId);
    else if (visible && !configuring) void openSaved(action.target.issueId, action.target.itemId);
    else note.textContent = 'This earlier report is unavailable in the preview.';
  } else {
    note.textContent = `${gameDestination(action.target)} opens in Civilization V.`;
  }
}

/** Update options without replacing the focused select or moving the current edition. */
function showEditions(issues: NewspaperArchiveIndex[]): void {
  latestEdition = issues[0]?.issueId ?? '';
  const placeholder = new Option(issues.length ? 'Choose an edition' : 'No editions yet', '');
  placeholder.disabled = issues.length > 0;
  editionPicker.replaceChildren(placeholder, ...issues.map(issue =>
    new Option(`Turn ${issue.cutoffTurn}`, issue.issueId)
  ));
  editionPicker.value = selectedEdition;
  if (!editionPicker.value) editionPicker.selectedIndex = 0;
  editionPicker.disabled = !issues.length || configuring;
}

/** Refresh the saved editions for the active run, latest cutoff first. */
async function refreshEditions(): Promise<void> {
  const run = replay;
  const archive = activeArchive();
  if (!archive) return;
  const { issues } = await listReplayIssues(archive.runId, archive.receiverPlayerID);
  if (run !== replay) return;
  showEditions(issues.sort((a, b) => b.cutoffTurn - a.cutoffTurn));
}

const mockups = mountMockupControls(
  issue => {
    mockupIssue = issue;
    mockupState = undefined;
    if (source === 'mockups') {
      ++loadVersion;
      void showIssue(issue, createReaderState(issue));
    }
  },
  async fixture => {
    const version = ++loadVersion;
    try {
      const response = await fetch(new URL(`fixtures/${fixture}.json`, document.baseURI));
      if (!response.ok) throw new Error('This fixture is available in the developer source checkout.');
      const issue = parseIssueDocument(await response.json());
      if (version === loadVersion) {
        mockupIssue = issue;
        await showIssue(issue, createReaderState(issue));
      }
    } catch (error) {
      if (version === loadVersion) {
        mockups.showSample();
        return errorMessage(error, 'The fixture could not be loaded.');
      }
    }
    return undefined;
  },
);

const restoreRecording = mountReplayControls({
  async onRun(state, openLatest) {
    const version = readingVersion;
    replay = state;
    diagnostics.setRun(state);
    selectedEdition = '';
    recordedPosition = undefined;
    showEditions([]);
    if (source === 'recorded') {
      ++loadVersion;
      clearReader('No editions yet. Generate from a recording or resume a saved run.');
    }
    await refreshEditions();
    if (openLatest && latestEdition && version === readingVersion && source === 'recorded') await openSaved(latestEdition);
  },
  onPublished(issueId, turn) {
    latestEdition = issueId;
    const placeholder = editionPicker.options[0];
    placeholder.text = 'Choose an edition';
    placeholder.disabled = true;
    editionPicker.add(new Option(`Turn ${turn}`, issueId), 1);
    editionPicker.disabled = false;
  },
  onBatchStart() {
    const version = readingVersion;
    return async () => {
      if (version === readingVersion && source === 'recorded' && latestEdition && selectedEdition !== latestEdition
        && !readerRoot.contains(document.activeElement)) await openSaved(latestEdition);
    };
  },
  onEvidence: diagnostics.setEvidence,
  onSkip: diagnostics.addSkip,
  onBatchEnd: diagnostics.refreshCoverage,
  onConfiguring: setConfiguring,
  flushVotes,
});

/** Prevent old-run writes while replacing its scope, while keeping the paper readable. */
function setConfiguring(active: boolean): void {
  configuring = active;
  editionPicker.disabled = active || !latestEdition;
  recordedAppearance.disabled = active;
  readerRoot.querySelectorAll<HTMLButtonElement>('button[data-vd-vote-value]').forEach(button => {
    button.disabled = active;
  });
}

/** Resize the common shell to the selected source and restore its publication. */
function selectSource(next: Source): void {
  if (source === next) return;
  if (source === 'mockups') mockupState = reader?.getState();
  else if (visible && reader) recordedPosition = { issueId: visible.detail.issue.issueId, state: reader.getState() };
  source = next;
  readingVersion += 1;
  loadVersion += 1;
  mockupMode.setAttribute('aria-pressed', String(source === 'mockups'));
  recordedMode.setAttribute('aria-pressed', String(source === 'recorded'));
  element('#mockup-controls').hidden = source !== 'mockups';
  element('#recorded-controls').hidden = source !== 'recorded';
  diagnostics.setVisible(source === 'recorded');
  note.textContent = '';
  if (source === 'mockups') {
    if (mockupIssue) void showIssue(mockupIssue, mockupState ?? createReaderState(mockupIssue));
    else mockups.showSample();
    return;
  }
  clearReader(latestEdition ? 'Opening saved edition…' : 'No editions yet. Generate from a recording or resume a saved run.');
  restoreRecording();
  const issueId = selectedEdition || latestEdition;
  if (issueId) void openSaved(issueId);
}

mockupMode.addEventListener('click', () => selectSource('mockups'));
recordedMode.addEventListener('click', () => selectSource('recorded'));
editionPicker.addEventListener('change', () => {
  readingVersion += 1;
  if (editionPicker.value) void openSaved(editionPicker.value);
});
readerRoot.addEventListener('wheel', () => { readingVersion += 1; }, { passive: true });
readerRoot.addEventListener('touchmove', () => { readingVersion += 1; }, { passive: true });

const fixture = new URLSearchParams(location.search).get('fixture');
mockups.start(fixture);
