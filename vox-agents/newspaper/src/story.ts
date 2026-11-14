/** Story DOM construction and vote presentation shared by reader and export modes. */
import type {
  EvidenceTable,
  NewspaperDesignId,
  NewspaperItem,
  NewspaperPage,
} from "../../src/newspaper/contracts/issue.js";
import type { VoteValue } from "../../src/newspaper/contracts/reader.js";
import { getNewspaperAsset, newspaperVoteIconAssets } from "../../src/newspaper/renderer/assets.js";
import { bindReaderAction } from "./actions.js";
import {
  appendInlineNodes,
  appendParagraphs,
  createElement,
  inlineNodesToText,
  resolveAssetUrl,
} from "./dom.js";

/** Values needed to render a story without owning reader state or lifecycle. */
export interface StoryRenderContext {
  instancePrefix: string;
  designId: NewspaperDesignId;
  assetBaseUrl: string;
  vote: VoteValue;
}

/** Build one story with the layout chosen by its page. */
export function renderStory(
  item: NewspaperItem,
  page: NewspaperPage,
  lead: boolean,
  context: StoryRenderContext,
): HTMLElement {
  const { instancePrefix, designId, assetBaseUrl, vote } = context;
  const article = createElement(
    "article",
    `vd-story ${lead ? "vd-story--lead" : "vd-story--brief"}`,
  );
  article.dataset.itemId = item.id;
  const headingId = `${instancePrefix}-heading-${page.id}-${item.id}`;
  article.setAttribute("aria-labelledby", headingId);

  if (designId === "modern") article.append(renderAvatar(item));

  const content = createElement("div", "vd-story-content");
  const heading = createElement("h2", "vd-headline");
  heading.id = headingId;
  appendInlineNodes(heading, item.headline, item.id, bindReaderAction);
  content.append(heading);

  if (item.deck) {
    const deck = createElement("p", "vd-deck");
    appendInlineNodes(deck, item.deck, item.id, bindReaderAction);
    content.append(deck);
  }

  const prose = createElement("div", "vd-prose");
  appendParagraphs(prose, item.body, item.id, bindReaderAction);
  const footer = renderStoryFooter(item, vote, designId, assetBaseUrl);
  const figure = renderStoryImage(item, assetBaseUrl);

  if (lead && page.layout === "breaking" && figure) {
    const columns = createElement("div", "vd-breaking-columns");
    const main = createElement("div", "vd-column-main");
    main.append(prose, footer);
    columns.append(main, figure);
    content.append(columns);
  } else if (lead && page.layout === "analysis" && item.evidence) {
    const columns = createElement("div", "vd-analysis-columns");
    const main = createElement("div", "vd-column-main");
    main.append(prose, footer);
    columns.append(main, renderEvidence(item.evidence, figure));
    content.append(columns);
  } else {
    content.append(prose);
    if (figure) content.append(figure);
    content.append(footer);
  }

  article.append(content);
  return article;
}

/** Build the modern feed avatar, using the headline initial when needed. */
function renderAvatar(item: NewspaperItem): HTMLElement {
  const avatar = createElement("div", `vd-avatar vd-avatar--${item.avatar?.tone ?? "slate"}`);
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent =
    item.avatar?.letter ?? inlineNodesToText(item.headline).trim().slice(0, 1).toUpperCase();
  return avatar;
}

/** Build the figure for an item image, or null when no image is registered. */
function renderStoryImage(item: NewspaperItem, assetBaseUrl: string): HTMLElement | null {
  if (!item.assetId) return null;
  const url = resolveAssetUrl(assetBaseUrl, item.assetId);
  if (!url) return null;
  const asset = getNewspaperAsset(item.assetId);
  const figure = createElement("figure", "vd-story-art");
  const image = createElement("img");
  image.src = url;
  image.alt = item.assetAlt ?? "";
  if (asset?.width) image.width = asset.width;
  if (asset?.height) image.height = asset.height;
  figure.append(image);
  return figure;
}

/** Build a story footer with an earlier-report link and reversible votes. */
function renderStoryFooter(
  item: NewspaperItem,
  vote: VoteValue,
  designId: NewspaperDesignId,
  assetBaseUrl: string,
): HTMLElement {
  const footer = createElement("footer", "vd-story-footer");
  const links = createElement("div", "vd-story-links");

  if (item.history) {
    const historyLink = createElement("a", "vd-text-link", item.history.label);
    historyLink.href = "#";
    bindReaderAction(historyLink, {
      type: "follow-link",
      itemId: item.id,
      target: item.history.target,
    });
    links.append(historyLink);
  }

  const votes = createElement("div", "vd-votes");
  votes.setAttribute("role", "group");
  votes.setAttribute("aria-label", `Coverage preference: ${inlineNodesToText(item.headline)}`);

  for (const value of ["up", "down"] as const) {
    const button = createElement("button", "vd-vote");
    button.type = "button";
    button.dataset.vdVoteItem = item.id;
    button.dataset.vdVoteValue = value;
    button.setAttribute(
      "aria-label",
      `${value === "up" ? "More" : "Less"} coverage like: ${inlineNodesToText(item.headline)}`,
    );
    button.title = value === "up" ? "More like this" : "Less like this";
    const icon = createElement("img", "vd-vote-icon");
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    icon.width = 20;
    icon.height = 20;
    button.append(icon);
    votes.append(button);
  }

  footer.append(links, votes);
  applyVoteState(footer, item.id, vote, designId, assetBaseUrl);
  return footer;
}

/** Render an analysis evidence table beside the lead text. */
function renderEvidence(evidence: EvidenceTable, figure: HTMLElement | null): HTMLElement {
  const aside = createElement("aside", "vd-evidence");
  const table = createElement("table");
  const caption = createElement("caption");
  caption.append(createElement("strong", undefined, evidence.title));
  caption.append(createElement("span", "vd-evidence-description", evidence.description));
  table.append(caption);

  const head = createElement("thead");
  const headRow = createElement("tr");
  for (const column of evidence.columns) {
    const cell = createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = createElement("tbody");
  for (const row of evidence.rows) {
    const tableRow = createElement("tr");
    if (row.missing) tableRow.className = "vd-missing";
    const label = createElement("th");
    label.scope = "row";
    label.textContent = row.label;
    tableRow.append(label);
    for (const value of row.values) {
      const cell = createElement("td");
      cell.textContent = value;
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(body);
  aside.append(table);

  if (evidence.note) {
    aside.append(createElement("p", "vd-evidence-note", evidence.note));
  }
  if (figure) aside.append(figure);
  return aside;
}

/** Refresh the pressed state and icon on every vote button for one item. */
export function applyVoteState(
  container: HTMLElement,
  itemId: string,
  value: VoteValue,
  designId: NewspaperDesignId,
  assetBaseUrl: string,
): void {
  for (const button of Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-vd-vote-item]"),
  )) {
    if (button.dataset.vdVoteItem !== itemId) continue;
    const direction = button.dataset.vdVoteValue;
    if (direction !== "up" && direction !== "down") continue;
    const selected = value === direction;
    button.setAttribute("aria-pressed", String(selected));
    const icon = button.querySelector<HTMLImageElement>("img");
    if (!icon) continue;
    const assetId = newspaperVoteIconAssets[designId][direction][selected ? "selected" : "neutral"];
    const url = resolveAssetUrl(assetBaseUrl, assetId);
    if (url) icon.src = url;
  }
}
