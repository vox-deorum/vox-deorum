/** Story DOM construction and vote presentation shared by reader and export modes. */
import type {
  EvidenceTable,
  IssueItem,
  IssuePage,
} from "../../../src/newspaper/contracts/issue.js";
import type { RendererFamily } from "../../../src/newspaper/contracts/design.js";
import type { VoteValue } from "../../../src/newspaper/contracts/reader.js";
import { getNewspaperAsset, newspaperVoteIconAssets } from "../../../src/newspaper/renderer/assets.js";
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
  designId: RendererFamily;
  publicationDesignId: string;
  assetBaseUrl: string;
  vote: VoteValue;
}

/** Build one story with the layout chosen by its page. */
export function renderStory(
  item: IssueItem,
  page: IssuePage,
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

  if (designId === "feed") article.append(renderAvatar(item));

  const content = createElement("div", "vd-story-content");
  // A register entry has two cells: its heading and its account.
  const registerEntry = context.publicationDesignId === "port-register" && page.layout === "ordinary";
  const headingGroup = registerEntry ? createElement("div", "vd-register-heading") : content;
  const heading = createElement("h2", "vd-headline");
  heading.id = headingId;
  appendInlineNodes(heading, item.headline, item.id, bindReaderAction);
  headingGroup.append(heading);

  if (item.subheadline) {
    const subheadline = createElement("p", "vd-deck");
    appendInlineNodes(subheadline, item.subheadline, item.id, bindReaderAction);
    headingGroup.append(subheadline);
  }

  if (item.byline) {
    const byline = createElement("p", "vd-byline");
    appendInlineNodes(byline, item.byline, item.id, bindReaderAction);
    headingGroup.append(byline);
  }

  const prose = createElement("div", "vd-prose");
  appendParagraphs(prose, item.body, item.id, bindReaderAction);
  const footer = renderStoryFooter(item, vote, designId, assetBaseUrl);
  const cover = lead && context.publicationDesignId === "national-review";
  const image = renderStoryImage(item, assetBaseUrl);
  if (cover && image) {
    image.classList.add("vd-cover-art");
    content.prepend(image);
  }
  const figure = cover ? null : image;

  if (lead && page.layout === "breaking" && figure) {
    const columns = createElement("div", "vd-breaking-columns");
    const main = createElement("div", "vd-column-main");
    main.append(prose, footer);
    columns.append(main, figure);
    content.append(columns);
  } else if (lead && page.layout === "analysis" && item.evidenceTable) {
    const columns = createElement("div", "vd-analysis-columns");
    const main = createElement("div", "vd-column-main");
    main.append(prose, footer);
    columns.append(main, renderEvidence(item.evidenceTable, figure));
    content.append(columns);
  } else {
    const account = registerEntry ? createElement("div", "vd-register-account") : content;
    account.append(prose);
    if (figure) account.append(figure);
    account.append(footer);
    if (registerEntry) content.append(headingGroup, account);
  }

  article.append(content);
  return article;
}

/** Build the feed avatar, using the headline initial when needed. */
function renderAvatar(item: IssueItem): HTMLElement {
  const avatar = createElement("div", `vd-avatar vd-avatar--${item.avatar?.tone ?? "slate"}`);
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent =
    item.avatar?.initials ?? inlineNodesToText(item.headline).trim().slice(0, 1).toUpperCase();
  return avatar;
}

/** Build the figure for an item image, or null when no image is registered. */
function renderStoryImage(item: IssueItem, assetBaseUrl: string): HTMLElement | null {
  if (!item.image) return null;
  const url = resolveAssetUrl(assetBaseUrl, item.image.assetId);
  if (!url) return null;
  const asset = getNewspaperAsset(item.image.assetId);
  const figure = createElement("figure", "vd-story-art");
  const image = createElement("img");
  image.src = url;
  image.alt = item.image.altText;
  if (asset?.width) image.width = asset.width;
  if (asset?.height) image.height = asset.height;
  figure.append(image);
  if (item.image.caption) figure.append(createElement("figcaption", undefined, item.image.caption));
  return figure;
}

/** Build a story footer with an earlier-report link and reversible votes. */
function renderStoryFooter(
  item: IssueItem,
  vote: VoteValue,
  designId: RendererFamily,
  assetBaseUrl: string,
): HTMLElement {
  const footer = createElement("footer", "vd-story-footer");
  const links = createElement("div", "vd-story-links");

  if (item.earlierReport) {
    const earlierReportLink = createElement("a", "vd-text-link", item.earlierReport.label);
    earlierReportLink.href = "#";
    bindReaderAction(earlierReportLink, {
      type: "follow-link",
      itemId: item.id,
      target: item.earlierReport.target,
    });
    links.append(earlierReportLink);
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
    if (row.hasMissingValues) tableRow.className = "vd-missing";
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

  if (evidence.footnote) {
    aside.append(createElement("p", "vd-evidence-note", evidence.footnote));
  }
  if (figure) aside.append(figure);
  return aside;
}

/** Refresh the pressed state and icon on every vote button for one item. */
export function applyVoteState(
  container: HTMLElement,
  itemId: string,
  value: VoteValue,
  designId: RendererFamily,
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
