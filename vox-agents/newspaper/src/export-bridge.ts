/**
 * Fixed browser bridge used by the Node export worker.
 *
 * The worker can rely on this small surface across renderer changes. Every
 * method returns plain JSON values, with rectangles in CSS pixels. The export
 * page stays scrolled to the document origin so viewport and document
 * coordinates agree.
 */
import { computeRenderLayout } from "../../src/newspaper/ui/layout.js";
import { getNewspaperAsset, newspaperVoteIconAssets } from "../../src/newspaper/ui/assets.js";
import {
  newspaperRendererVersion,
  type ExportMountResult,
  type HeaderMeasurement,
  type IssueDocument,
  type NewspaperExportBridge,
  type PageMeasurement,
  type RenderLayoutMetrics,
  type RenderProfile,
} from "../../src/newspaper/contracts/types.js";
import {
  parseIssueDocument,
  parseRenderProfile,
  validateRenderProfileForDesign,
} from "../../src/newspaper/contracts/validation.js";
import { createReaderState } from "../../src/newspaper/ui/state.js";
import { mountReader, type ReaderHandle } from "./mount.js";
import {
  collectActionGeometry,
  collectTabGeometry,
  collectVoteSlots,
  measureRegion,
  nextLayoutFrame,
  waitForMedia,
} from "./measure.js";

let handle: ReaderHandle | null = null;
let issue: IssueDocument | null = null;
let profile: RenderProfile | null = null;
let layout: RenderLayoutMetrics | null = null;
let voteIcon: HTMLImageElement | null = null;

/** Return the mounted export root or fail with a clear message. */
function exportRoot(): HTMLElement {
  const root = document.getElementById("newspaper-export-root");
  if (!root) throw new Error("The export root is missing.");
  return root;
}

/** Return the current export state or fail with a clear message. */
function mountedState(): {
  issueDocument: IssueDocument;
  renderProfile: RenderProfile;
  renderLayout: RenderLayoutMetrics;
  reader: ReaderHandle;
} {
  if (!issue || !profile || !layout || !handle) {
    throw new Error("The newspaper export bridge is not mounted.");
  }
  return {
    issueDocument: issue,
    renderProfile: profile,
    renderLayout: layout,
    reader: handle,
  };
}

/** Mount an issue for export and wait for fonts, images, and layout. */
async function mount(issueInput: unknown, profileInput: unknown): Promise<ExportMountResult> {
  const nextIssue = parseIssueDocument(issueInput);
  const nextProfile = parseRenderProfile(profileInput);
  validateRenderProfileForDesign(nextProfile, nextIssue.publication.designId);

  dispose();

  const root = exportRoot();
  window.scrollTo(0, 0);
  const state = createReaderState(nextIssue);
  const nextHandle = mountReader(root, nextIssue, state, () => undefined, {
    mode: "export",
    profile: nextProfile,
    assetBaseUrl: document.baseURI,
  });
  await nextHandle.ready;
  await nextLayoutFrame();
  window.scrollTo(0, 0);

  issue = nextIssue;
  profile = nextProfile;
  layout = computeRenderLayout(nextIssue.publication.designId, nextProfile);
  handle = nextHandle;
  document.documentElement.dataset.newspaperExport = "ready";

  return {
    rendererVersion: newspaperRendererVersion,
    issueId: nextIssue.issueId,
    campaignId: nextIssue.campaignId,
    timelineId: nextIssue.timelineId,
    designId: nextIssue.publication.designId,
    designVersion: nextIssue.publication.designVersion,
    pageIds: nextIssue.pages.map((page) => page.id),
    layout,
  };
}

/** Measure the masthead and tab region in its neutral export state. */
async function measureHeader(): Promise<HeaderMeasurement> {
  const current = mountedState();
  const root = exportRoot();
  const header = root.querySelector<HTMLElement>('[data-vd-region="header"]');
  if (!header) throw new Error("The export header is missing.");
  await nextLayoutFrame();
  return {
    region: { kind: "header" },
    layout: current.renderLayout,
    capture: measureRegion(header, current.renderProfile),
    actions: collectActionGeometry(header, { kind: "header" }),
    tabs: collectTabGeometry(header),
  };
}

/** Select one page for a subsequent page measurement. */
async function selectPage(pageId: string): Promise<void> {
  const current = mountedState();
  if (!current.issueDocument.pages.some((page) => page.id === pageId)) {
    throw new Error(`Unknown page "${pageId}".`);
  }
  current.reader.selectPage(pageId);
  await waitForMedia(exportRoot());
  window.scrollTo(0, 0);
}

/** Measure the current page as one expanded strip sequence. */
async function measurePage(): Promise<PageMeasurement> {
  const current = mountedState();
  const root = exportRoot();
  const activePageId = current.reader.getActivePageId();
  const pageElement = Array.from(
    root.querySelectorAll<HTMLElement>('[data-vd-region="page"]'),
  ).find((element) => element.dataset.vdPageId === activePageId);
  if (!pageElement) throw new Error(`The active page "${activePageId}" is missing.`);

  await waitForMedia(pageElement);
  const content = pageElement.querySelector<HTMLElement>(".vd-page-content");
  if (!content) throw new Error("The active page content is missing.");
  const contentRect = content.getBoundingClientRect();
  const contentHeight = contentRect.height;
  if (Math.abs(contentRect.width - current.renderLayout.contentWidth) > 0.5) {
    throw new Error(
      `Measured content width ${contentRect.width} differs from requested width ${current.renderLayout.contentWidth}.`,
    );
  }
  const region = { kind: "page" as const, pageId: activePageId };

  await nextLayoutFrame();
  return {
    region,
    layout: { ...current.renderLayout, contentWidth: contentRect.width },
    capture: measureRegion(pageElement, current.renderProfile),
    contentHeight,
    actions: collectActionGeometry(pageElement, region),
    voteSlots: collectVoteSlots(pageElement, region, current.issueDocument.publication.designId),
  };
}

/** Capture one registered vote icon against the mounted design's paper color. */
async function mountVoteIcon(assetId: string): Promise<void> {
  const current = mountedState();
  const design = current.issueDocument.publication.designId;
  const icons = newspaperVoteIconAssets[design];
  const asset = getNewspaperAsset(assetId);
  if (
    !asset ||
    asset.kind !== "vote-icon" ||
    !Object.values(icons).some((pair) => pair.neutral === assetId || pair.selected === assetId)
  ) {
    throw new Error(`Unknown vote icon "${assetId}" for design "${design}".`);
  }
  const root = exportRoot();
  const paper = getComputedStyle(root).getPropertyValue("--vd-paper");
  const image = document.createElement("img");
  const url = new URL(asset.path, document.baseURI);
  if (url.origin !== location.origin) throw new Error("Vote icons must use local assets.");
  image.src = url.href;
  image.width = 24;
  image.height = 24;
  image.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;display:block;z-index:1;";
  image.style.backgroundColor = paper;
  voteIcon?.remove();
  voteIcon = image;
  root.append(image);
  await image.decode();
  await nextLayoutFrame();
  window.scrollTo(0, 0);
}

/** Remove the mounted reader and clear the export readiness marker. */
function dispose(): void {
  voteIcon?.remove();
  voteIcon = null;
  if (handle) handle.dispose();
  handle = null;
  issue = null;
  profile = null;
  layout = null;
  delete document.documentElement.dataset.newspaperExport;
}

/** The fixed object consumed by the Node export worker. */
export const newspaperExportBridge: NewspaperExportBridge = {
  mount,
  measureHeader,
  selectPage,
  measurePage,
  mountVoteIcon,
  dispose,
};

declare global {
  interface Window {
    voxDeorumNewspaperExport?: NewspaperExportBridge;
  }
}

window.voxDeorumNewspaperExport = newspaperExportBridge;
