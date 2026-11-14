/**
 * Small DOM helpers for the shared newspaper renderer.
 *
 * Article prose is built with text nodes and explicit elements. No structured
 * content is ever assigned through innerHTML, so generated text cannot supply
 * scripts, styles, or arbitrary URLs.
 */
import { getNewspaperAsset } from "../../src/newspaper/ui/assets.js";
import { type InlineNode, type ReaderAction } from "../../src/newspaper/contracts/types.js";

/** Callback used to register an interactive element with the reader. */
export type ActionBinder = (element: HTMLElement, action: ReaderAction) => void;

/** Create an element with an optional class and text. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Resolve a registered asset path against the reader's asset base URL. */
export function resolveAssetUrl(assetBaseUrl: string, assetId: string): string | undefined {
  const asset = getNewspaperAsset(assetId);
  if (!asset) return undefined;
  return new URL(asset.path, assetBaseUrl).href;
}

/** Convert inline nodes to plain text for labels and host inspectors. */
export function inlineNodesToText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "break") return " ";
      return node.text;
    })
    .join("");
}

/** Convert paragraphs to plain text with a blank line between paragraphs. */
export function paragraphsToText(paragraphs: InlineNode[][]): string {
  return paragraphs.map((paragraph) => inlineNodesToText(paragraph)).join("\n\n");
}

/** Append inline nodes to a container, binding links through the reader. */
export function appendInlineNodes(
  container: HTMLElement,
  nodes: InlineNode[],
  itemId: string,
  bindAction: ActionBinder,
): void {
  for (const node of nodes) {
    if (node.type === "break") {
      container.append(document.createElement("br"));
      continue;
    }
    if (node.type === "strong") {
      container.append(createElement("strong", undefined, node.text));
      continue;
    }
    if (node.type === "emphasis") {
      container.append(createElement("em", undefined, node.text));
      continue;
    }
    if (node.type === "link") {
      const link = createElement("a", "vd-inline-link", node.text);
      link.href = "#";
      bindAction(link, { type: "follow-link", itemId, target: node.target });
      container.append(link);
      continue;
    }
    container.append(document.createTextNode(node.text));
  }
}

/** Append paragraphs of inline nodes to a container. */
export function appendParagraphs(
  container: HTMLElement,
  paragraphs: InlineNode[][],
  itemId: string,
  bindAction: ActionBinder,
): void {
  for (const paragraph of paragraphs) {
    const element = createElement("p");
    appendInlineNodes(element, paragraph, itemId, bindAction);
    container.append(element);
  }
}
