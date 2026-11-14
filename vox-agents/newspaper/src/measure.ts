/**
 * DOM measurement for the shared renderer.
 *
 * All geometry is converted to CSS pixels. Region-relative rectangles are used
 * for interaction maps, while each capture plan records the document origin of
 * its region so the Node worker can take screenshots without guessing offsets.
 */
import { newspaperVoteIconAssets } from "../../src/newspaper/renderer/assets.js";
import type {
  ActionGeometry,
  CapturePlan,
  CaptureStrip,
  Rect,
  RenderProfile,
  RenderRegion,
  TabGeometry,
  VoteSlotGeometry,
} from "../../src/newspaper/renderer/types.js";
import type { NewspaperDesignId } from "../../src/newspaper/contracts/issue.js";
import { getReaderAction } from "./actions.js";

/** Wait for the browser to complete two layout passes. */
export function nextLayoutFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Wait for fonts and images in a mounted reader, without failing on a missing asset. */
export async function waitForMedia(root: HTMLElement): Promise<void> {
  // Layout discovers font faces used by a newly visible page before fonts.ready is read.
  await nextLayoutFrame();
  try {
    await document.fonts.ready;
  } catch {
    // A missing font must not prevent the reader from becoming usable.
  }

  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
      try {
        await image.decode();
      } catch {
        // A missing or broken image keeps its reserved box.
      }
    }),
  );

  await nextLayoutFrame();
}

/** Convert a viewport rectangle to a rectangle relative to a region. */
function toRegionRect(rect: DOMRect, regionRect: DOMRect): Rect {
  return {
    x: rect.left - regionRect.left,
    y: rect.top - regionRect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Collect the individual line rectangles for one interactive element. */
function collectElementRects(element: Element, regionRect: DOMRect): Rect[] {
  return Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => toRegionRect(rect, regionRect));
}

/** Build the bounded strip plan for one expanded region. */
export function measureRegion(region: HTMLElement, profile: RenderProfile): CapturePlan {
  const regionRect = region.getBoundingClientRect();
  const size = { width: regionRect.width, height: regionRect.height };
  const maxStripHeight = Math.max(1, Math.floor(profile.maxTextureHeight / profile.rasterScale));
  const strips: CaptureStrip[] = [];

  for (let y = 0; y < size.height; y += maxStripHeight) {
    const visibleHeight = Math.min(maxStripHeight, size.height - y);
    strips.push({
      index: strips.length,
      clip: { x: 0, y, width: size.width, height: visibleHeight },
      visibleHeight,
      pixelWidth: Math.round(size.width * profile.rasterScale),
      pixelHeight: Math.round(visibleHeight * profile.rasterScale),
    });
  }

  return {
    origin: {
      x: regionRect.left + window.scrollX,
      y: regionRect.top + window.scrollY,
    },
    size,
    strips,
  };
}

/** Read all bound controls inside a region and return their line rectangles. */
export function collectActionGeometry(
  regionElement: HTMLElement,
  region: RenderRegion,
): ActionGeometry[] {
  const regionRect = regionElement.getBoundingClientRect();
  const result: ActionGeometry[] = [];

  for (const element of Array.from(regionElement.querySelectorAll("[data-vd-action-id]"))) {
    const actionId = (element as HTMLElement).dataset.vdActionId;
    const action = getReaderAction(element);
    if (!actionId || !action) continue;
    const rects = collectElementRects(element, regionRect);
    if (rects.length === 0) continue;
    result.push({ actionId, region, action, rects });
  }

  return result;
}

/** Read tab labels and rectangles relative to the header region. */
export function collectTabGeometry(headerElement: HTMLElement): TabGeometry[] {
  const headerRect = headerElement.getBoundingClientRect();
  const tabs: TabGeometry[] = [];

  for (const element of Array.from(headerElement.querySelectorAll<HTMLElement>('[role="tab"]'))) {
    const pageId = element.dataset.vdPageId;
    if (!pageId) continue;
    const rects = collectElementRects(element, headerRect);
    if (rects.length === 0) continue;
    tabs.push({
      pageId,
      label: element.textContent ?? "",
      rect: rects[0],
    });
  }

  return tabs;
}

/** Read dynamic vote slots and their neutral and selected icon asset ids. */
export function collectVoteSlots(
  pageElement: HTMLElement,
  region: RenderRegion,
  designId: NewspaperDesignId,
): VoteSlotGeometry[] {
  const regionRect = pageElement.getBoundingClientRect();
  const slots: VoteSlotGeometry[] = [];

  for (const element of Array.from(
    pageElement.querySelectorAll<HTMLElement>("[data-vd-vote-item][data-vd-vote-value]"),
  )) {
    const itemId = element.dataset.vdVoteItem;
    const value = element.dataset.vdVoteValue;
    if (!itemId || (value !== "up" && value !== "down")) continue;
    const rects = collectElementRects(element, regionRect);
    if (rects.length === 0) continue;
    const icons = newspaperVoteIconAssets[designId][value];
    slots.push({
      itemId,
      value,
      region,
      rect: rects[0],
      neutralAssetId: icons.neutral,
      selectedAssetId: icons.selected,
    });
  }

  return slots;
}
