/**
 * Browser host for the shared newspaper reader.
 *
 * The host supplies fixture selection, an archive stub, action inspection, and
 * a small editorial metadata panel. It intentionally stays outside the
 * publication so the reader can also run in the game export page.
 */
import {
  newspaperScreenLabels,
  type IssueDocument,
  type LinkTarget,
} from "../../src/newspaper/contracts/issue.js";
import type { ReaderAction, ReaderState } from "../../src/newspaper/contracts/reader.js";
import { errorMessage } from "../../src/utils/errors.js";
import { parseIssueDocument } from "../../src/newspaper/renderer/validation.js";
import { createReaderState } from "../../src/newspaper/renderer/state.js";
import { inlineNodesToText, paragraphsToText } from "./dom.js";
import { mountReader, type ReaderHandle } from "./mount.js";
import "./host.css";

interface FixtureEntry {
  id: string;
  label: string;
  description: string;
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
    id: "modern-ordinary",
    label: "Modern ordinary",
    description: "The compact feed with avatars and a shared economy vote.",
  },
];

let currentFixture = fixtures[0];
let currentIssue: IssueDocument | null = null;
let reader: ReaderHandle | null = null;
let lastAction: ReaderAction | null = null;
let mountGeneration = 0;

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
const actionLog = requireElement<HTMLElement>("#action-log");
const stateView = requireElement<HTMLElement>("#state-view");
const issueView = requireElement<HTMLElement>("#issue-view");
const pageItems = requireElement<HTMLElement>("#page-items");
const detailView = requireElement<HTMLElement>("#detail-view");
const archiveDialog = requireElement<HTMLDialogElement>("#archive-dialog");
const archiveList = requireElement<HTMLElement>("#archive-list");
const archiveClose = requireElement<HTMLButtonElement>("#archive-close");

/** Mount one fixture and replace any previous reader instance. */
async function mountFixture(entry: FixtureEntry, initialState?: ReaderState): Promise<void> {
  const generation = ++mountGeneration;
  reader?.dispose();
  reader = null;
  currentIssue = null;
  try {
    const response = await fetch(new URL(`fixtures/${entry.id}.json`, document.baseURI));
    if (!response.ok)
      throw new Error("Fixture data is available in the developer source checkout.");
    const issue = parseIssueDocument(await response.json());
    if (generation !== mountGeneration) return;
    const state = initialState ?? createReaderState(issue);
    currentFixture = entry;
    currentIssue = issue;
    lastAction = null;
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
    renderInspector();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = errorMessage(error, "The fixture could not be loaded.");
    readerRoot.replaceChildren(message);
  }
}

/** Handle one typed action from the publication. */
function handleAction(action: ReaderAction): void {
  lastAction = action;
  if (action.type === "follow-link") {
    renderLinkDetail(action);
  }
  renderInspector();
}

/** Describe a typed link destination in plain language. */
function describeTarget(target: LinkTarget): string {
  if (target.type === "city") return `City: ${target.cityId}`;
  if (target.type === "civilization") return `Civilization: ${target.civilizationId}`;
  if (target.type === "trade-relationship") {
    return `Trade relationship with ${target.partnerCivilizationId} (${target.direction})`;
  }
  if (target.type === "screen") return newspaperScreenLabels[target.screen];
  return `Earlier report in issue ${target.issueId}, item ${target.itemId}`;
}

/** Show the destination of a link and any history text carried by the issue. */
function renderLinkDetail(action: Extract<ReaderAction, { type: "follow-link" }>): void {
  detailView.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Link destination";
  const destination = document.createElement("p");
  destination.textContent = describeTarget(action.target);
  detailView.append(heading, destination);

  if (!currentIssue) return;
  const item = currentIssue.items.find((entry) => entry.id === action.itemId);
  if (!item?.history || item.history.target.type !== "article") return;
  if (action.target.type !== "article") return;
  if (action.target.itemId !== item.history.target.itemId) return;

  const earlierHeading = document.createElement("h3");
  earlierHeading.textContent = item.history.label;
  const earlierBody = document.createElement("p");
  earlierBody.textContent = paragraphsToText(item.history.body);
  detailView.append(earlierHeading, earlierBody);
}

/** Reset the detail panel to its empty state. */
function renderDetailPlaceholder(): void {
  detailView.replaceChildren();
  const note = document.createElement("p");
  note.textContent = "Follow a link or an earlier report to inspect its destination here.";
  detailView.append(note);
}

/** Refresh the action log, reader state, issue metadata, and page items. */
function renderInspector(): void {
  const currentState = reader?.getState();
  actionLog.textContent = lastAction ? JSON.stringify(lastAction, null, 2) : "No actions yet.";
  stateView.textContent = currentState ? JSON.stringify(currentState, null, 2) : "No state.";

  if (!currentIssue) {
    issueView.textContent = "No issue mounted.";
    pageItems.replaceChildren();
    return;
  }

  issueView.textContent = [
    `Issue: ${currentIssue.issueId}`,
    `Publication: ${currentIssue.publication.title}`,
    `Design: ${currentIssue.publication.designId} ${currentIssue.publication.designVersion}`,
    `Cutoff: ${currentIssue.cutoff.label}`,
    `Receiver: ${currentIssue.receiver.label} (player ${currentIssue.receiver.playerId})`,
    `Pages: ${currentIssue.pages.map((page) => page.label).join(", ")}`,
    `Items: ${currentIssue.items.length}`,
  ].join("\n");

  renderPageItems();
}

/** Show the editorial fields kept out of the reading surface. */
function renderPageItems(): void {
  pageItems.replaceChildren();
  const currentState = reader?.getState();
  if (!currentIssue || !currentState) return;
  const activePageId = currentState.activePageId;
  const page = currentIssue.pages.find((entry) => entry.id === activePageId);
  if (!page) return;

  for (const itemId of page.itemIds) {
    const item = currentIssue.items.find((entry) => entry.id === itemId);
    if (!item) continue;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = inlineNodesToText(item.headline);
    const tags = document.createElement("p");
    tags.textContent = `Tags: ${item.tags.join(", ") || "none"}`;
    const series = document.createElement("p");
    series.textContent = `Series: ${item.seriesKeys.join(", ") || "none"}`;
    const record = document.createElement("p");
    record.textContent = `Record: ${inlineNodesToText(item.record)}`;
    details.append(summary, tags, series, record);
    pageItems.append(details);
  }
}

/** Build the fixture selector and archive stub entries. */
function buildFixtureControls(): void {
  fixtureSelect.replaceChildren();
  for (const fixture of fixtures) {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = fixture.label;
    fixtureSelect.append(option);
  }

  archiveList.replaceChildren();
  for (const fixture of fixtures) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "host-archive-entry";
    const label = document.createElement("strong");
    label.textContent = fixture.label;
    const description = document.createElement("span");
    description.textContent = fixture.description;
    button.append(label, description);
    button.addEventListener("click", () => {
      archiveDialog.close();
      fixtureSelect.value = fixture.id;
      void selectFixture(fixture.id);
    });
    archiveList.append(button);
  }
}

/** Select a fixture by id and mount it with fresh reading state. */
async function selectFixture(id: string): Promise<void> {
  const fixture = fixtures.find((entry) => entry.id === id) ?? fixtures[0];
  await mountFixture(fixture);
  renderInspector();
}

/** Reset the current issue to its first page and no votes. */
async function resetReadingState(): Promise<void> {
  if (!currentIssue) return;
  await mountFixture(currentFixture, createReaderState(currentIssue));
  renderInspector();
}

/** Mount the fixture chosen in the selector. */
fixtureSelect.addEventListener("change", () => {
  void selectFixture(fixtureSelect.value);
});

/** Show scroll changes from the reader without rebuilding the metadata controls. */
readerRoot.addEventListener("scroll", () => {
  requestAnimationFrame(() => {
    if (reader) stateView.textContent = JSON.stringify(reader.getState(), null, 2);
  });
}, true);

/** Open the fixture archive stub. */
archiveButton.addEventListener("click", () => {
  archiveDialog.showModal();
});

/** Close the archive stub from its own button. */
archiveClose.addEventListener("click", () => {
  archiveDialog.close();
});

/** Return focus to the archive control after the dialog closes. */
archiveDialog.addEventListener("close", () => {
  archiveButton.focus({ preventScroll: true });
});

/** Rebuild the current issue with fresh reading state. */
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
  buildFixtureControls();
  const requested = new URLSearchParams(window.location.search).get("fixture");
  const fixture = fixtures.find((entry) => entry.id === requested) ?? fixtures[0];
  fixtureSelect.value = fixture.id;
  renderDetailPlaceholder();
  void mountFixture(fixture);
}

start();
