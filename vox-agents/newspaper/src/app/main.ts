/**
 * Browser host for the shared newspaper reader.
 *
 * The host supplies fixture selection, an archive stub, action inspection, and
 * a small editorial metadata panel. It intentionally stays outside the
 * publication so the reader can also run in the game export page.
 */
import type { IssueDocument } from "../../../src/newspaper/contracts/issue.js";
import type { ReaderAction, ReaderState } from "../../../src/newspaper/contracts/reader.js";
import { errorMessage } from "../../../src/utils/errors.js";
import { parseIssueDocument } from "../../../src/newspaper/renderer/validation.js";
import { createReaderState } from "../../../src/newspaper/renderer/state.js";
import { renderFixtureInspector, renderLinkDetail, renderDetailPlaceholder, renderReaderState, renderEvidence } from "./inspector.js";
import { mountReplayControls } from "./replay.js";
import { mountReader, type ReaderHandle } from "../reader/mount.js";
import "./styles.css";

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
    renderLinkDetail(currentIssue, action);
  }
  renderInspector();
}

/** Refresh fixture inspection from the currently mounted reader. */
function renderInspector(): void {
  renderFixtureInspector(currentIssue, reader?.getState(), lastAction);
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
    if (reader) renderReaderState(reader.getState());
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
  mountReplayControls(requireElement<HTMLFormElement>("#replay-form"), renderEvidence);
  const requested = new URLSearchParams(window.location.search).get("fixture");
  const fixture = fixtures.find((entry) => entry.id === requested) ?? fixtures[0];
  fixtureSelect.value = fixture.id;
  renderDetailPlaceholder();
  void mountFixture(fixture);
}

start();
