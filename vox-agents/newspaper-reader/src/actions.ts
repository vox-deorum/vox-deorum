/**
 * Action bindings for rendered controls.
 *
 * A WeakMap keeps the typed action next to its element without serializing
 * duplicate data into the page. Export measurement and click handling both read
 * the same binding.
 */
import type { ReaderAction } from "../../src/newspaper/contracts/types.js";

const actionByElement = new WeakMap<Element, ReaderAction>();
let actionCounter = 0;

/** Return a stable id for one interactive element in the current mount. */
export function nextActionId(): string {
  actionCounter += 1;
  return `vd-action-${actionCounter}`;
}

/** Bind a typed action to an element and expose the id for measurement. */
export function bindReaderAction(element: HTMLElement, action: ReaderAction): void {
  element.dataset.vdActionId = nextActionId();
  actionByElement.set(element, action);
}

/** Read the typed action bound to an element. */
export function getReaderAction(element: Element): ReaderAction | undefined {
  return actionByElement.get(element);
}
