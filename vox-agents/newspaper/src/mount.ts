/**
 * Shared newspaper reader.
 *
 * mountReader is the only entry point used by the browser host and the export
 * bridge. It builds the publication from structured data, keeps one vote map
 * for all pages, and returns a readiness promise plus a disposal method.
 */
import type {
  IssueDocument,
  ReaderAction,
  ReaderState,
  RenderProfile,
} from "../../src/newspaper/contracts/types.js";
import {
  computeRenderLayout,
  defaultMaxTextureEdge,
  defaultRasterScale,
  defaultReaderViewport,
  defaultTextScale,
  newspaperDesignDefaults,
} from "../../src/newspaper/ui/layout.js";
import { getNewspaperAsset } from "../../src/newspaper/ui/assets.js";
import { renderStory, applyVoteState } from "./story.js";
import {
  parseIssueDocument,
  parseReaderState,
  parseRenderProfile,
  validateRenderProfileForDesign,
} from "../../src/newspaper/contracts/validation.js";
import {
  getVote,
  normalizeReaderState,
  setActivePage,
  setPageScroll,
  toggleVote,
} from "../../src/newspaper/ui/state.js";
import { bindReaderAction, getReaderAction } from "./actions.js";
import { createElement, resolveAssetUrl } from "./dom.js";
import { waitForMedia } from "./measure.js";
import "./reader.css";

/** Options used by the browser reader and the fixed export bridge. */
export interface ReaderMountOptions {
  mode?: "reader" | "export";
  profile?: RenderProfile;
  assetBaseUrl?: string;
}

/** Handle returned to a host that mounts a publication. */
export interface ReaderHandle {
  ready: Promise<void>;
  dispose(): void;
  getState(): ReaderState;
  getActivePageId(): string;
  selectPage(pageId: string): void;
}

let instanceCounter = 0;

/** Return a unique prefix for element ids inside one reader instance. */
function nextInstancePrefix(): string {
  instanceCounter += 1;
  return `vd-reader-${instanceCounter}`;
}

/** Build a reader profile from design defaults when a host has no export profile. */
function defaultProfile(designId: keyof typeof newspaperDesignDefaults): RenderProfile {
  const defaults = newspaperDesignDefaults[designId];
  return {
    viewportWidth: window.innerWidth || defaultReaderViewport.width,
    viewportHeight: window.innerHeight || defaultReaderViewport.height,
    contentWidth: defaults.contentWidth,
    textScale: defaultTextScale,
    rasterScale: defaultRasterScale,
    maxTextureWidth: defaultMaxTextureEdge,
    maxTextureHeight: defaultMaxTextureEdge,
    scrollbarGutter: defaults.scrollbarGutter,
  };
}

/** Mount an issue into a root element and return its ready and disposal handle. */
export function mountReader(
  root: HTMLElement,
  issueInput: unknown,
  stateInput: unknown,
  onAction: (action: ReaderAction) => void,
  options: ReaderMountOptions = {},
): ReaderHandle {
  const issue = parseIssueDocument(issueInput);
  const designId = issue.publication.designId;
  const mode = options.mode ?? "reader";
  const profile = options.profile ? parseRenderProfile(options.profile) : defaultProfile(designId);
  validateRenderProfileForDesign(profile, designId);

  const layout = computeRenderLayout(designId, profile);
  const assetBaseUrl = options.assetBaseUrl ?? document.baseURI;
  const instancePrefix = nextInstancePrefix();
  const itemById = new Map(issue.items.map((item) => [item.id, item]));
  const pageElements = new Map<string, HTMLElement>();
  const tabElements = new Map<string, HTMLButtonElement>();

  let state = normalizeReaderState(issue, parseReaderState(stateInput));
  let disposed = false;

  const publication = createElement("div", "vd-publication");
  const header = createElement("header", "vd-header");
  header.dataset.vdRegion = "header";

  const masthead = createElement("div", "vd-masthead");
  const title = createElement("h1", "vd-title", issue.publication.title);
  masthead.append(title);

  if (issue.publication.ornamentAssetId) {
    const ornament = createOrnamentImage(issue, assetBaseUrl);
    if (ornament) masthead.append(ornament);
  }

  const tabs = createElement("nav", "vd-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "News sections");

  for (const page of issue.pages) {
    const tab = createElement("button", "vd-tab", page.label);
    tab.type = "button";
    tab.id = `${instancePrefix}-tab-${page.id}`;
    tab.dataset.vdPageId = page.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `${instancePrefix}-page-${page.id}`);
    bindReaderAction(tab, {
      type: "select-page",
      pageId: page.id,
      previousPageId: null,
    });
    tabs.append(tab);
    tabElements.set(page.id, tab);
  }

  header.append(masthead, tabs);
  publication.append(header);

  const pageViewport = createElement("div", "vd-page-viewport");
  for (const page of issue.pages) {
    const section = createElement("section", "vd-page");
    section.id = `${instancePrefix}-page-${page.id}`;
    section.dataset.vdRegion = "page";
    section.dataset.vdPageId = page.id;
    section.dataset.layout = page.layout;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", `${instancePrefix}-tab-${page.id}`);
    section.tabIndex = 0;

    const content = createElement("div", "vd-page-content");
    const storyList = createElement("div", "vd-storylist");
    storyList.dataset.layout = page.layout;

    page.itemIds.forEach((itemId, index) => {
      const item = itemById.get(itemId);
      if (!item) return;
      storyList.append(
        renderStory(item, page, index === 0, {
          instancePrefix,
          designId,
          assetBaseUrl,
          vote: getVote(state, item.id),
        }),
      );
    });

    content.append(storyList, renderEndRule(issue, assetBaseUrl));
    section.append(content);
    section.hidden = page.id !== state.activePageId;
    section.addEventListener(
      "scroll",
      () => {
        if (section.hidden || disposed) return;
        state = setPageScroll(state, page.id, section.scrollTop);
      },
      { passive: true },
    );

    pageViewport.append(section);
    pageElements.set(page.id, section);
  }

  publication.append(pageViewport);
  root.replaceChildren(publication);
  root.classList.add("vd-newspaper");
  root.dataset.design = designId;
  root.dataset.mode = mode;
  root.dataset.issueId = issue.issueId;
  root.style.setProperty("--vd-content-width", `${layout.contentWidth}px`);
  root.style.setProperty("--vd-paper-padding", `${layout.paperPadding}px`);
  root.style.setProperty("--vd-scrollbar-gutter", `${layout.scrollbarGutter}px`);
  root.style.setProperty("--vd-region-width", `${layout.regionWidth}px`);
  root.style.setProperty("--vd-viewport-height", `${layout.viewportHeight}px`);
  root.style.setProperty("--vd-text-scale", String(layout.textScale));

  updatePageVisibility();

  /** Change the visible page and restore that page's scroll position. */
  function selectPage(pageId: string, announce: boolean): void {
    if (disposed || !pageElements.has(pageId)) return;
    const previousPageId = state.activePageId;
    if (previousPageId === pageId) return;

    const previous = pageElements.get(previousPageId);
    if (previous && !previous.hidden) {
      state = setPageScroll(state, previousPageId, previous.scrollTop);
    }

    state = setActivePage(state, pageId);
    updatePageVisibility();
    const next = pageElements.get(pageId);
    if (next) next.scrollTop = state.scrollByPage[pageId] ?? 0;

    if (announce) {
      onAction({ type: "select-page", pageId, previousPageId });
    }
  }

  /** Show only the active page and keep every tab metric stable. */
  function updatePageVisibility(): void {
    for (const [pageId, element] of pageElements) {
      element.hidden = pageId !== state.activePageId;
    }
    for (const [pageId, tab] of tabElements) {
      const selected = pageId === state.activePageId;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  /** Toggle a vote and refresh every copy of the item on every page. */
  function handleVote(button: HTMLElement): void {
    const itemId = button.dataset.vdVoteItem;
    const value = button.dataset.vdVoteValue;
    if (!itemId || (value !== "up" && value !== "down")) return;

    const previousValue = getVote(state, itemId);
    state = toggleVote(state, itemId, value);
    const nextValue = getVote(state, itemId);
    applyVoteState(root, itemId, nextValue, designId, assetBaseUrl);
    onAction({ type: "vote", itemId, value: nextValue, previousValue });
  }

  /** Route a click to a vote, a tab, or a typed link. */
  function handleClick(event: MouseEvent): void {
    if (disposed || !(event.target instanceof Element)) return;

    const voteButton = event.target.closest<HTMLElement>("[data-vd-vote-item]");
    if (voteButton && root.contains(voteButton)) {
      event.preventDefault();
      handleVote(voteButton);
      return;
    }

    const actionElement = event.target.closest<HTMLElement>("[data-vd-action-id]");
    if (!actionElement || !root.contains(actionElement)) return;
    const action = getReaderAction(actionElement);
    if (!action) return;
    event.preventDefault();

    if (action.type === "select-page") {
      selectPage(action.pageId, true);
      return;
    }
    onAction(action);
  }

  /** Let arrow, Home, and End keys move between tabs with one tab stop. */
  function handleTabKeydown(event: KeyboardEvent): void {
    const tabList = Array.from(tabElements.values());
    const currentIndex = tabList.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;

    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabList.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabList.length) % tabList.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabList.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextTab = tabList[nextIndex];
    const pageId = nextTab.dataset.vdPageId;
    if (!pageId) return;
    selectPage(pageId, true);
    nextTab.focus({ preventScroll: true });
  }

  root.addEventListener("click", handleClick);
  tabs.addEventListener("keydown", handleTabKeydown);

  const ready = waitForMedia(publication).then(() => {
    if (disposed) return;
    const active = pageElements.get(state.activePageId);
    if (active) active.scrollTop = state.scrollByPage[state.activePageId] ?? 0;
  });

  return {
    ready,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeEventListener("click", handleClick);
      tabs.removeEventListener("keydown", handleTabKeydown);
      if (publication.parentElement !== root) return;
      root.replaceChildren();
      root.classList.remove("vd-newspaper");
      delete root.dataset.design;
      delete root.dataset.mode;
      delete root.dataset.issueId;
      for (const property of [
        "--vd-content-width",
        "--vd-paper-padding",
        "--vd-scrollbar-gutter",
        "--vd-region-width",
        "--vd-viewport-height",
        "--vd-text-scale",
      ]) {
        root.style.removeProperty(property);
      }
    },
    getState(): ReaderState {
      return {
        activePageId: state.activePageId,
        scrollByPage: { ...state.scrollByPage },
        votes: { ...state.votes },
      };
    },
    getActivePageId(): string {
      return state.activePageId;
    },
    selectPage(pageId: string): void {
      selectPage(pageId, false);
    },
  };
}

/** Create the publication ornament, hidden from assistive technology. */
function createOrnamentImage(issue: IssueDocument, assetBaseUrl: string): HTMLElement | null {
  const assetId = issue.publication.ornamentAssetId;
  if (!assetId) return null;
  const url = resolveAssetUrl(assetBaseUrl, assetId);
  if (!url) return null;
  const asset = getNewspaperAsset(assetId);
  const image = createElement("img", "vd-ornament");
  image.src = url;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  if (asset?.width) image.width = asset.width;
  if (asset?.height) image.height = asset.height;
  return image;
}

/** Create the closing rule, using the publication ornament when one exists. */
function renderEndRule(issue: IssueDocument, assetBaseUrl: string): HTMLElement {
  const rule = createElement("div", "vd-end-rule");
  rule.setAttribute("aria-hidden", "true");
  const ornament = createOrnamentImage(issue, assetBaseUrl);
  if (ornament) {
    ornament.classList.remove("vd-ornament");
    ornament.classList.add("vd-end-ornament");
    rule.append(ornament);
  }
  return rule;
}
