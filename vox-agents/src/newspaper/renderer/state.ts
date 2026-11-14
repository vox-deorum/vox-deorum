/**
 * Pure reader state transitions.
 *
 * Votes are keyed by item id, so every page that shows the same item reads and
 * writes the same preference. The renderer owns one state object and updates it
 * through these helpers instead of keeping per-page copies.
 */
import { newspaperVoteValues, type ReaderState, type VoteValue } from "../contracts/reader.js";
import type { IssueDocument } from "../contracts/issue.js";

/** Tell whether a value is a valid vote value. */
export function isVoteValue(value: unknown): value is VoteValue {
  return typeof value === "string" && (newspaperVoteValues as readonly string[]).includes(value);
}

/** Return the first page id, which the issue schema and editor keep as the front page. */
function firstPageId(issue: IssueDocument): string {
  return issue.pages[0].id;
}

/** Build a reader state for an issue, keeping only known pages and items. */
export function createReaderState(
  issue: IssueDocument,
  initial?: Partial<ReaderState>,
): ReaderState {
  const pageIds = new Set(issue.pages.map((page) => page.id));
  const itemIds = new Set(issue.items.map((item) => item.id));
  const activePageId =
    initial?.activePageId && pageIds.has(initial.activePageId)
      ? initial.activePageId
      : firstPageId(issue);

  const scrollByPage: Record<string, number> = Object.create(null);
  for (const [pageId, offset] of Object.entries(initial?.scrollByPage ?? {})) {
    if (!pageIds.has(pageId) || !Number.isFinite(offset)) continue;
    scrollByPage[pageId] = Math.max(0, offset);
  }

  const votes: Record<string, VoteValue> = Object.create(null);
  for (const [itemId, value] of Object.entries(initial?.votes ?? {})) {
    if (!itemIds.has(itemId) || !isVoteValue(value)) continue;
    votes[itemId] = value;
  }

  return { activePageId, scrollByPage, votes };
}

/** Rebuild a state so stale page and item ids from another issue cannot leak in. */
export function normalizeReaderState(issue: IssueDocument, state: ReaderState): ReaderState {
  return createReaderState(issue, state);
}

/** Select a page, preserving the previous selection when it is the same page. */
export function setActivePage(state: ReaderState, pageId: string): ReaderState {
  if (state.activePageId === pageId) return state;
  return { ...state, activePageId: pageId };
}

/** Store a page's scroll offset without changing other pages. */
export function setPageScroll(state: ReaderState, pageId: string, offset: number): ReaderState {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  if (state.scrollByPage[pageId] === safeOffset) return state;
  return {
    ...state,
    scrollByPage: Object.assign(Object.create(null), state.scrollByPage, {
      [pageId]: safeOffset,
    }),
  };
}

/** Assign a vote value to an item, keeping other item votes unchanged. */
export function setVote(state: ReaderState, itemId: string, value: VoteValue): ReaderState {
  if (value === "none") {
    if (!Object.hasOwn(state.votes, itemId)) return state;
    const votes = { ...state.votes };
    delete votes[itemId];
    return { ...state, votes };
  }
  if (state.votes[itemId] === value) return state;
  return { ...state, votes: { ...state.votes, [itemId]: value } };
}

/** Toggle a vote, so choosing the active value again clears the preference. */
export function toggleVote(state: ReaderState, itemId: string, value: "up" | "down"): ReaderState {
  return setVote(state, itemId, getVote(state, itemId) === value ? "none" : value);
}

/** Read an item's vote, treating an absent entry as no preference. */
export function getVote(state: ReaderState, itemId: string): VoteValue {
  return Object.hasOwn(state.votes, itemId) ? state.votes[itemId] : "none";
}
