/**
 * Browser host for the shared newspaper reader.
 *
 * The host supplies fixture selection, replay controls, generated issue
 * archiving, vote persistence, action inspection, and a small editorial
 * metadata panel. It stays outside the publication so the reader can also run
 * in the game export page.
 */
import type { IssueDocument } from "../../../src/newspaper/contracts/issue.js";
import type { z } from "zod";
import type { NewspaperArchiveScope } from "../../../../mcp-server/dist/newspaper/protocol.js";
import type { replayCheckSchema, ReplayState } from "../../../src/newspaper/contracts/replay.js";
import type { PublishedItemRecord } from "../../../src/newspaper/contracts/publication.js";
import type { ReaderAction, ReaderState, VoteValue } from "../../../src/newspaper/contracts/reader.js";
import { errorMessage } from "../../../src/utils/errors.js";
import { parseIssueDocument } from "../../../src/newspaper/renderer/validation.js";
import { createReaderState } from "../../../src/newspaper/renderer/state.js";
import {
  renderFixtureInspector,
  renderLinkDetail,
  renderDetailPlaceholder,
  renderDetailMessage,
  renderReaderState,
  renderEvidence,
  renderCheck,
  renderDecision,
} from "./inspector.js";
import { mountReplayControls, type ReplayControls } from "./replay.js";
import {
  getReplayIssue,
  listReplayIssues,
  saveReplayVote,
} from "./api.js";
import { mountReader, type ReaderHandle } from "../reader/mount.js";
import "./styles.css";

interface FixtureEntry {
  id: string;
  label: string;
  description: string;
}

/** One mounted publication with the origin needed to reopen or vote on it. */
interface IssueView {
  kind: "fixture" | "saved";
  issue: IssueDocument;
  scope: NewspaperArchiveScope | null;
  votes: Record<string, number>;
  articles: PublishedItemRecord[];
}

const fixtures: FixtureEntry[] = [
  {
    id: "victorian-ordinary",
    label: "Victorian ordinary",
    description: "Two pages, a wrapped trade link, and one shared vote.",
  },
  {
    id: "victorian-breaking",
    label: "Victorian breaking",
    description: "A dominant war report and a second page with the same vote.",
  },
  {
    id: "victorian-analysis",
    label: "Victorian analysis",
    description: "A quieter lead with an evidence table and missing observation.",
  },
  {
    id: "wire-ordinary",
    label: "Modern ordinary",
    description: "The compact feed with avatars and a shared economy vote.",
  },
];

let currentIssue: IssueDocument | null = null;
let currentView: IssueView | null = null;
let reader: ReaderHandle | null = null;
let replay: ReplayControls | null = null;
let currentSession: ReplayState | null = null;
let lastAction: ReaderAction | null = null;
let mountGeneration = 0;
let archiveGeneration = 0;
let voteTail: Promise<void> = Promise.resolve();
let pendingVotes = 0;
let restoreVotesAfterQueue = false;
let replayBusy = false;

/** Return a required element or fail with a clear message. */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing host element ${selector}.`);
  return element;
}

const fixtureSelect = requireElement<HTMLSelectElement>("#fixture-select");
const archiveButton = requireElement<HTMLButtonElement>("#archive-button");
const resetButton = requireElement<HTMLButtonElement>("#reset-button");
const readerRoot = requireElement<HTMLElement>("#reader-root");
const archiveDialog = requireElement<HTMLDialogElement>("#archive-dialog");
const archiveList = requireElement<HTMLElement>("#archive-list");
const archiveStatus = requireElement<HTMLElement>("#archive-status");
const archiveClose = requireElement<HTMLButtonElement>("#archive-close");

/** Translate saved server votes to the reader's up, down, and neutral values. */
function readerVotes(votes: Record<string, number>): Record<string, VoteValue> {
  const result: Record<string, VoteValue> = {};
  for (const [itemId, value] of Object.entries(votes)) {
    if (value === 1) result[itemId] = "up";
    else if (value === -1) result[itemId] = "down";
  }
  return result;
}

/** Tell whether a session still belongs to the scope that requested work. */
function sameScope(state: ReplayState, scope: NewspaperArchiveScope): boolean {
  return state.runId === scope.runId && state.settings.receiverPlayerID === scope.receiverPlayerID;
}

/** Show a readable reader error after a failed mount. */
function renderReaderError(message: string): void {
  const paragraph = document.createElement("p");
  paragraph.setAttribute("role", "alert");
  paragraph.textContent = message;
  readerRoot.replaceChildren(paragraph);
}

/** Mount one publication and keep only the latest requested mount. */
async function mountDocument(issue: IssueDocument, state: ReaderState, view: IssueView): Promise<void> {
  const generation = ++mountGeneration;
  reader?.dispose();
  reader = null;
  currentIssue = issue;
  currentView = view;
  lastAction = null;
  try {
    const nextReader = mountReader(readerRoot, issue, state, handleAction);
    reader = nextReader;
    await nextReader.ready;
    if (generation !== mountGeneration) {
      nextReader.dispose();
      return;
    }
    renderInspector();
    if (!lastAction) renderDetailPlaceholder();
  } catch (error) {
    if (generation !== mountGeneration) return;
    reader?.dispose();
    reader = null;
    currentIssue = null;
    currentView = null;
    renderInspector();
    renderReaderError(errorMessage(error, "The issue could not be mounted."));
  }
}

/** Mount one fixture and replace any previous reader instance. */
async function mountFixture(entry: FixtureEntry, initialState?: ReaderState): Promise<void> {
  const generation = ++mountGeneration;
  reader?.dispose();
  reader = null;
  currentIssue = null;
  currentView = null;
  try {
    const response = await fetch(new URL(`fixtures/${entry.id}.json`, document.baseURI));
    if (!response.ok)
      throw new Error("Fixture data is available in the developer source checkout.");
    const issue = parseIssueDocument(await response.json());
    if (generation !== mountGeneration) return;
    await mountDocument(issue, initialState ?? createReaderState(issue), {
      kind: "fixture",
      issue,
      scope: null,
      votes: {},
      articles: [],
    });
  } catch (error) {
    if (generation !== mountGeneration) return;
    reader = null;
    currentIssue = null;
    currentView = null;
    renderInspector();
    renderReaderError(errorMessage(error, "The fixture could not be loaded."));
  }
}

/** Open a stored issue through the archive without running another check. */
async function openSavedIssue(issueId: string): Promise<void> {
  const session = currentSession;
  if (!session?.runId) throw new Error("Open a publication run before reading a saved issue.");
  const scope: NewspaperArchiveScope = {
    runId: session.runId,
    receiverPlayerID: session.settings.receiverPlayerID,
  };
  const generation = ++mountGeneration;
  await flushVotes();
  if (generation !== mountGeneration) return;
  const detail = await getReplayIssue(issueId, scope.runId, scope.receiverPlayerID);
  if (generation !== mountGeneration) return;
  if (!currentSession || !sameScope(currentSession, scope)) {
    throw new Error("The replay run changed before that issue loaded.");
  }
  if (archiveDialog.open) archiveDialog.close();
  const view: IssueView = {
    kind: "saved",
    issue: detail.issue,
    scope,
    votes: { ...detail.votes },
    articles: detail.articles,
  };
  const state = createReaderState(detail.issue, { votes: readerVotes(detail.votes) });
  await mountDocument(detail.issue, state, view);
  if (currentView === view) renderDecision(detail.decision);
}

/** Reload server votes after a failed save without losing reading position. */
async function restoreVotes(view: IssueView): Promise<void> {
  if (currentView !== view || currentIssue !== view.issue || !view.scope) return;
  const previous = reader?.getState();
  const detail = await getReplayIssue(view.issue.issueId, view.scope.runId, view.scope.receiverPlayerID);
  if (currentView !== view) return;
  view.votes = { ...detail.votes };
  await mountDocument(view.issue, createReaderState(view.issue, {
    activePageId: previous?.activePageId,
    scrollByPage: previous?.scrollByPage,
    votes: readerVotes(view.votes),
  }), view);
}

/** Wait for every vote already accepted by the browser to reach the server. */
async function flushVotes(): Promise<void> {
  let pending: Promise<void>;
  do {
    pending = voteTail;
    await pending;
  } while (pending !== voteTail);
}

/** Save one reader vote in order and put the reader back on failure. */
function persistVote(action: Extract<ReaderAction, { type: "vote" }>): void {
  const view = currentView;
  if (!view || view.kind !== "saved" || !view.scope) return;
  const scope = view.scope;
  const value: -1 | 0 | 1 = action.value === "up" ? 1 : action.value === "down" ? -1 : 0;
  pendingVotes += 1;
  voteTail = voteTail.then(async () => {
    try {
      const state = await saveReplayVote({
        itemId: action.itemId,
        value,
        runId: scope.runId,
        receiverPlayerID: scope.receiverPlayerID,
      });
      if (!sameScope(state, scope)) {
        throw new Error("The server returned a different replay run.");
      }
      view.votes[action.itemId] = value;
      if (currentSession && sameScope(currentSession, scope)) replay?.showSession(state);
    } catch (error) {
      replay?.reportError(`Vote was not saved: ${errorMessage(error)}`);
      restoreVotesAfterQueue = true;
    } finally {
      pendingVotes -= 1;
      if (pendingVotes === 0 && restoreVotesAfterQueue) {
        restoreVotesAfterQueue = false;
        const visible = currentView;
        readerRoot.inert = true;
        try {
          if (visible?.kind === "saved") await restoreVotes(visible);
        } finally {
          readerRoot.inert = replayBusy;
        }
      }
    }
  }).catch(error => {
    replay?.reportError(`Vote was not saved: ${errorMessage(error)}`);
  });
}

/** Handle one typed action from the publication. */
function handleAction(action: ReaderAction): void {
  lastAction = action;
  if (action.type === "follow-link") {
    if (
      action.target.type === "article"
      && currentView?.kind === "saved"
      && action.target.issueId !== currentIssue?.issueId
    ) {
      void openSavedIssue(action.target.issueId).catch(error =>
        renderDetailMessage("Earlier report unavailable", errorMessage(error)));
      renderInspector();
      return;
    }
    renderLinkDetail(currentIssue, action);
  }
  if (action.type === "vote") persistVote(action);
  renderInspector();
}

/** Refresh fixture inspection from the currently mounted reader. */
function renderInspector(): void {
  renderFixtureInspector(currentIssue, reader?.getState(), lastAction, currentView?.articles);
}

/** Show the issue or skip reason returned by an advance, with its decision. */
function handleCheck(check: z.infer<typeof replayCheckSchema> | null): void {
  renderCheck(check, issueId => {
    void openSavedIssue(issueId).catch(error => {
      if (archiveDialog.open) archiveStatus.textContent = errorMessage(error);
      else replay?.reportError(errorMessage(error));
    });
  });
  renderDecision(check?.decision ?? null);
}

/** Build one archive entry with a label and supporting description. */
function archiveEntry(label: string, description: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "host-archive-entry";
  const title = document.createElement("strong");
  title.textContent = label;
  const detail = document.createElement("span");
  detail.textContent = description;
  button.append(title, detail);
  button.addEventListener("click", onClick);
  return button;
}

/** List fixtures and the generated issues scoped to the current run and receiver. */
async function refreshArchive(): Promise<void> {
  const generation = ++archiveGeneration;
  archiveList.replaceChildren();

  const fixtureHeading = document.createElement("h3");
  fixtureHeading.textContent = "Fixtures";
  archiveList.append(fixtureHeading);
  for (const fixture of fixtures) {
    archiveList.append(archiveEntry(fixture.label, fixture.description, () => {
      archiveDialog.close();
      fixtureSelect.value = fixture.id;
      void selectFixture(fixture.id);
    }));
  }

  const issueHeading = document.createElement("h3");
  issueHeading.textContent = "Generated issues";
  archiveList.append(issueHeading);

  const session = currentSession;
  if (!session?.runId) {
    archiveStatus.textContent = "Open a publication run to list generated issues.";
    return;
  }

  const scope: NewspaperArchiveScope = { runId: session.runId, receiverPlayerID: session.settings.receiverPlayerID };
  archiveStatus.textContent = "Loading generated issues.";
  try {
    const result = await listReplayIssues(scope.runId, scope.receiverPlayerID);
    if (generation !== archiveGeneration) return;
    if (!currentSession || !sameScope(currentSession, scope)) {
      archiveStatus.textContent = "The replay run changed while the archive loaded. Open it again.";
      return;
    }
    if (result.issues.length === 0) {
      archiveStatus.textContent = "This replay run has no generated issues yet.";
      return;
    }
    archiveStatus.textContent = `${result.issues.length} generated ${result.issues.length === 1 ? "issue" : "issues"}.`;
    for (const issue of result.issues) {
      archiveList.append(archiveEntry(
        issue.title || issue.issueId,
        `Cutoff turn ${issue.cutoffTurn}, ${issue.itemCount} items, run ${issue.runId}`,
        () => {
          void openSavedIssue(issue.issueId).catch(error => {
            archiveStatus.textContent = errorMessage(error);
          });
        },
      ));
    }
  } catch (error) {
    if (generation !== archiveGeneration) return;
    archiveStatus.textContent = errorMessage(error);
  }
}

/** Build the fixture selector. */
function buildFixtureSelect(): void {
  fixtureSelect.replaceChildren();
  for (const fixture of fixtures) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = fixture.label;
    fixtureSelect.append(option);
  }
}

/** Select a fixture by id and mount it with fresh reading state. */
async function selectFixture(id: string): Promise<void> {
  const fixture = fixtures.find((entry) => entry.id === id) ?? fixtures[0];
  await mountFixture(fixture);
  renderInspector();
}

/** Reset the current issue to its first page while keeping saved server votes. */
async function resetReadingState(): Promise<void> {
  await flushVotes();
  const issue = currentIssue;
  const view = currentView;
  if (!issue || !view) return;
  const state = createReaderState(issue, { votes: readerVotes(view.votes) });
  await mountDocument(issue, state, view);
  renderInspector();
}

/** Mount the fixture chosen in the selector. */
fixtureSelect.addEventListener("change", () => {
  void selectFixture(fixtureSelect.value);
});

/** Show scroll changes from the reader without rebuilding the metadata controls. */
readerRoot.addEventListener("scroll", () => {
  requestAnimationFrame(() => {
    if (reader) renderReaderState(reader.getState());
  });
}, true);

/** Open the archive and load the generated issues for the active run. */
archiveButton.addEventListener("click", () => {
  archiveDialog.showModal();
  void refreshArchive();
});

/** Close the archive from its own button. */
archiveClose.addEventListener("click", () => {
  archiveDialog.close();
});

/** Return focus to the archive control after the dialog closes. */
archiveDialog.addEventListener("close", () => {
  archiveButton.focus({ preventScroll: true });
});

/** Rebuild the current issue with fresh reading state while keeping saved votes. */
resetButton.addEventListener("click", () => {
  void resetReadingState();
});

/** Release the mounted reader when the page is left. */
window.addEventListener("pagehide", () => {
  mountGeneration += 1;
  reader?.dispose();
});

/** Start the host from the requested fixture or the first fixture. */
function start(): void {
  buildFixtureSelect();
  renderDetailPlaceholder();
  replay = mountReplayControls(requireElement<HTMLFormElement>("#replay-form"), {
    onEvidence: evidence => renderEvidence(evidence),
    onSession: state => {
      if (currentSession && (currentSession.runId !== state.runId || currentSession.settings.receiverPlayerID !== state.settings.receiverPlayerID)) {
        mountGeneration += 1;
        archiveGeneration += 1;
        if (currentView?.kind === "saved") {
          reader?.dispose();
          reader = null;
          currentIssue = null;
          currentView = null;
          renderInspector();
          renderReaderError("Open an issue from this run's archive to continue reading.");
        }
      }
      currentSession = state;
    },
    onCheck: check => handleCheck(check),
    onPublished: () => {
      if (archiveDialog.open) void refreshArchive();
    },
    beforeOperation: flushVotes,
    onBusy: busy => {
      replayBusy = busy;
      readerRoot.inert = busy;
    },
  });
  handleCheck(null);
  const requested = new URLSearchParams(window.location.search).get("fixture");
  const fixture = fixtures.find((entry) => entry.id === requested) ?? fixtures[0];
  fixtureSelect.value = fixture.id;
  void mountFixture(fixture);
}

start();
