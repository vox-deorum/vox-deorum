/** Inspect fixture publications, replay checks, and permitted evidence outside the shared reader. */
import { newspaperScreenLabels, type IssueDocument, type LinkTarget } from "../../../src/newspaper/contracts/issue.js";
import type { ReaderAction, ReaderState } from "../../../src/newspaper/contracts/reader.js";
import {
  eventReportTurn, type NewspaperEvidence, type NewspaperSnapshot, type NewspaperEvent,
  type NewspaperDiplomacySnapshot, type NewspaperDiplomacyGap, type NewspaperTacticalZone,
} from "../../../../mcp-server/dist/newspaper/evidence.js";
import type { z } from "zod";
import type { replayCheckSchema } from "../../../src/newspaper/contracts/replay.js";
import type { PublishedItemRecord } from "../../../src/newspaper/contracts/publication.js";
import { inlineNodesToText, paragraphsToText } from "../reader/dom.js";

/** Locate an inspector panel in the application shell. */
function panel(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing inspector panel ${id}.`);
  return element;
}

const actionLog = panel("action-log");
const stateView = panel("state-view");
const issueView = panel("issue-view");
const pageItems = panel("page-items");
const detailView = panel("detail-view");
const checkView = panel("check-view");
const decisionView = panel("decision-view");

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

/** Show the destination of a link and any earlier report summary carried by the issue. */
export function renderLinkDetail(currentIssue: IssueDocument | null, action: Extract<ReaderAction, { type: "follow-link" }>): void {
  detailView.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Link destination";
  const destination = document.createElement("p");
  destination.textContent = describeTarget(action.target);
  detailView.append(heading, destination);

  if (!currentIssue) return;
  const item = currentIssue.items.find((entry) => entry.id === action.itemId);
  if (!item?.earlierReport) return;
  if (action.target.type !== "article") return;
  if (action.target.itemId !== item.earlierReport.target.itemId) return;

  const earlierHeading = document.createElement("h3");
  earlierHeading.textContent = item.earlierReport.label;
  const earlierBody = document.createElement("p");
  earlierBody.textContent = paragraphsToText(item.earlierReport.summary);
  detailView.append(earlierHeading, earlierBody);
}

/** Reset the detail panel to its empty state. */
export function renderDetailPlaceholder(): void {
  detailView.replaceChildren();
  const note = document.createElement("p");
  note.textContent = "Follow a link or an earlier report to inspect its destination here.";
  detailView.append(note);
}

/** Show a readable detail message when a link cannot be opened. */
export function renderDetailMessage(title: string, message: string): void {
  detailView.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = title;
  const note = document.createElement("p");
  note.textContent = message;
  detailView.append(heading, note);
}

/** Show the published issue or skip reason returned by one replay check. */
export function renderCheck(check: z.infer<typeof replayCheckSchema> | null, openIssue: (issueId: string) => void): void {
  checkView.replaceChildren();
  if (!check) {
    const note = document.createElement("p");
    note.textContent = "No check yet.";
    checkView.append(note);
    return;
  }

  const summary = document.createElement("p");
  if (check.status === "skipped") {
    summary.textContent = `Check skipped: ${check.reason ?? "no reason recorded"}.`;
    checkView.append(summary);
    return;
  }

  const issue = check.issue;
  const issueId = issue?.issueId;
  const cutoff = issue ? ` at ${issue.cutoff.label}` : "";
  summary.textContent = issueId ? `Published issue ${issueId}${cutoff}.` : `Published an issue${cutoff}.`;
  checkView.append(summary);

  if (issue) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Open ${issue.issueId}`;
    button.addEventListener("click", () => openIssue(issue.issueId));
    checkView.append(button);
  }
  if (check.reason) {
    const reason = document.createElement("p");
    reason.textContent = check.reason;
    checkView.append(reason);
  }
}

/** Show the editorial decision kept with a check or a saved issue. */
export function renderDecision(decision: unknown): void {
  decisionView.textContent = decision === undefined || decision === null
    ? "No decision recorded."
    : JSON.stringify(decision, null, 2);
}

/** Refresh the action log, reader state, issue metadata, and page items. */
export function renderFixtureInspector(currentIssue: IssueDocument | null, currentState: ReaderState | undefined, lastAction: ReaderAction | null, articles: PublishedItemRecord[] = []): void {
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

  renderPageItems(currentIssue, currentState, articles);
}

/** Show the editorial fields kept out of the reading surface. */
function renderPageItems(currentIssue: IssueDocument | null, currentState: ReaderState | undefined, articles: PublishedItemRecord[]): void {
  pageItems.replaceChildren();
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
    const sourceNote = document.createElement("p");
    sourceNote.textContent = `Source note: ${inlineNodesToText(item.sourceNote)}`;
    details.append(summary, tags, series, sourceNote);
    const article = articles.find(entry => entry.id === item.id);
    if (article) {
      const templates = document.createElement("p");
      templates.textContent = `Templates: ${article.templateIds.join(", ")}`;
      const evidence = document.createElement("p");
      evidence.textContent = `Evidence: ${article.evidenceSummary}`;
      const sources = document.createElement("pre");
      sources.dataset.articleSources = item.id;
      sources.textContent = JSON.stringify({ triggers: article.triggerIds, sources: article.sources }, null, 2);
      details.append(templates, evidence, sources);
    }
    pageItems.append(details);
  }
}

/** Update scroll state without rebuilding the fixture metadata controls. */
export function renderReaderState(state: ReaderState): void {
  stateView.textContent = JSON.stringify(state, null, 2);
}

/** Show selected values and their original source identity without requiring any generated issue. */
export function renderEvidence(evidence: NewspaperEvidence | null): void {
  const root = panel("evidence-view");
  const sourceView = panel("source-view");
  root.replaceChildren();
  sourceView.textContent = "Select an evidence row to inspect its source and permitted values.";
  if (!evidence) return;
  const request = document.createElement("pre");
  request.textContent = JSON.stringify(evidence.request, null, 2);
  root.append(request);
  if (evidence.limitations?.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Evidence limitations";
    const limitations = document.createElement("ul");
    limitations.dataset.evidenceLimitations = "";
    for (const limitation of evidence.limitations) {
      const item = document.createElement("li");
      item.textContent = limitation;
      limitations.append(item);
    }
    root.append(heading, limitations);
  }
  type EvidenceRow = NewspaperSnapshot | NewspaperEvent | NewspaperDiplomacySnapshot | NewspaperDiplomacyGap | NewspaperTacticalZone;
  const groups: [string, EvidenceRow[]][] = [
    ["Players", evidence.players], ["Cities", evidence.cities],
    ["Tactical zones", evidence.tacticalZones ?? []],
    ["Earlier players", evidence.comparisons.players], ["Earlier cities", evidence.comparisons.cities],
    ["Events", evidence.events],
    ["Earlier diplomacy", evidence.diplomacy?.baseline ?? []], ["Diplomacy history", evidence.diplomacy?.history ?? []],
    ["Diplomacy gaps", evidence.diplomacy?.gaps ?? []],
  ];
  for (const [label, rows] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = `${label} (${rows.length})`;
    root.append(heading);
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      const identity = "zoneID" in row ? `zone ${row.zoneID}${row.city ? ` (${row.city})` : ""}`
        : "subjectID" in row ? `subject ${row.subjectID}` : row.type;
      const turn = "type" in row ? eventReportTurn(row) : row.source.turn;
      const sourceTurn = turn === row.source.turn ? "" : `, source turn ${row.source.turn}`;
      button.textContent = `${identity}, turn ${turn}${sourceTurn}, row ${row.source.id}`;
      /** Navigate to the referenced row's identity and the values permitted by the evidence query. */
      button.addEventListener("click", () => {
        sourceView.textContent = JSON.stringify(row, null, 2);
        sourceView.scrollIntoView({ block: "nearest" });
      });
      root.append(button);
    }
  }
}
