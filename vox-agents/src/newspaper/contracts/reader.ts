/** Reader interaction and persisted state contracts, independent of rendering. */
import { z } from "zod";
import { linkTargetSchema, type IssueDocument, type LinkTarget } from "./issue.js";

/** Vote values kept in reader state. */
export const newspaperVoteValues = ["up", "down", "none"] as const;

/** Reader action kinds. */
export const newspaperActionTypes = ["select-page", "vote", "follow-link"] as const;

/** A reversible coverage preference. */
export type VoteValue = (typeof newspaperVoteValues)[number];

/** Actions emitted by the shared browser reader. */
export type ReaderAction =
  | { type: "select-page"; pageId: string; previousPageId: string | null }
  | { type: "vote"; itemId: string; value: VoteValue; previousValue: VoteValue }
  | { type: "follow-link"; itemId: string; target: LinkTarget };

/** Reading state owned by the reader and persisted by its host. */
export interface ReaderState {
  activePageId: string;
  scrollByPage: Record<string, number>;
  votes: Record<string, VoteValue>;
}

/** Schema for one selection action. */
export const selectPageActionSchema = z.object({
  type: z.literal("select-page"),
  pageId: z.string().min(1),
  previousPageId: z.string().min(1).nullable(),
});

/** Schema for one vote action. */
export const voteActionSchema = z.object({
  type: z.literal("vote"),
  itemId: z.string().min(1),
  value: z.enum(newspaperVoteValues),
  previousValue: z.enum(newspaperVoteValues),
});

/** Schema for one link action. */
export const followLinkActionSchema = z.object({
  type: z.literal("follow-link"),
  itemId: z.string().min(1),
  target: linkTargetSchema,
});

/** Schema for every reader action. */
export const readerActionSchema = z.discriminatedUnion("type", [
  selectPageActionSchema,
  voteActionSchema,
  followLinkActionSchema,
]);

/** Schema for persisted reader state. */
export const readerStateSchema = z.object({
  activePageId: z.string().min(1),
  scrollByPage: z.record(z.string(), z.number().finite().nonnegative()),
  votes: z.record(z.string(), z.enum(newspaperVoteValues)),
});

/** Parse a reader action or throw a validation error. */
export function parseReaderAction(input: unknown): ReaderAction {
  return readerActionSchema.parse(input);
}

/** Parse persisted reader state or throw a validation error. */
export function parseReaderState(input: unknown): ReaderState {
  return readerStateSchema.parse(input);
}

/** Validate a reader action against the issue that produced it. */
export function validateReaderAction(issue: IssueDocument, input: unknown): ReaderAction {
  const action = parseReaderAction(input);
  if (action.type === "select-page") {
    if (!issue.pages.some((page) => page.id === action.pageId)) {
      throw new Error(`Unknown page "${action.pageId}".`);
    }
    return action;
  }
  if (!issue.items.some((item) => item.id === action.itemId)) {
    throw new Error(`Unknown item "${action.itemId}".`);
  }
  return action;
}

/** Validate persisted state against the pages and items of one issue. */
export function validateReaderState(issue: IssueDocument, input: unknown): ReaderState {
  const state = parseReaderState(input);
  if (!issue.pages.some((page) => page.id === state.activePageId)) {
    throw new Error(`Unknown active page "${state.activePageId}".`);
  }
  const pageIds = new Set(issue.pages.map((page) => page.id));
  for (const pageId of Object.keys(state.scrollByPage)) {
    if (!pageIds.has(pageId)) {
      throw new Error(`Scroll state references unknown page "${pageId}".`);
    }
  }
  const itemIds = new Set(issue.items.map((item) => item.id));
  for (const itemId of Object.keys(state.votes)) {
    if (!itemIds.has(itemId)) {
      throw new Error(`Vote state references unknown item "${itemId}".`);
    }
  }
  return state;
}
