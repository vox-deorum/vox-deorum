/** Reader interaction and persisted state contracts, independent of rendering. */
import { z } from "zod";
import { linkTargetSchema, type IssueDocument } from "./issue.js";

/** Vote values kept in reader state. */
export const newspaperVoteValues = ["up", "down", "none"] as const;

/** Reader action kinds. */
export const newspaperActionTypes = ["select-page", "vote", "follow-link"] as const;

/** Schema for a reversible coverage preference. */
export const voteValueSchema = z.enum(newspaperVoteValues);
/** A reversible coverage preference. */
export type VoteValue = z.infer<typeof voteValueSchema>;

/** Schema for one selection action. */
export const selectPageActionSchema = z.object({
  /** Identifies a page selection action. */
  type: z.literal("select-page"),
  /** Page selected by the reader. */
  pageId: z.string().min(1),
  /** Previously selected page, or null before any selection. */
  previousPageId: z.string().min(1).nullable(),
});
/** A page selection emitted by the reader. */
export type SelectPageAction = z.infer<typeof selectPageActionSchema>;

/** Schema for one vote action. */
export const voteActionSchema = z.object({
  /** Identifies a coverage preference action. */
  type: z.literal("vote"),
  /** Item whose coverage preference changed. */
  itemId: z.string().min(1),
  /** New coverage preference. */
  value: voteValueSchema,
  /** Coverage preference before the action. */
  previousValue: voteValueSchema,
});
/** A coverage preference emitted by the reader. */
export type VoteAction = z.infer<typeof voteActionSchema>;

/** Schema for one link action. */
export const followLinkActionSchema = z.object({
  /** Identifies a link navigation action. */
  type: z.literal("follow-link"),
  /** Item containing the link. */
  itemId: z.string().min(1),
  /** Destination requested by the reader. */
  target: linkTargetSchema,
});
/** A link navigation emitted by the reader. */
export type FollowLinkAction = z.infer<typeof followLinkActionSchema>;

/** Schema for every reader action. */
export const readerActionSchema = z.discriminatedUnion("type", [
  /** Select a page. */
  selectPageActionSchema,
  /** Change an item's coverage preference. */
  voteActionSchema,
  /** Follow a typed link. */
  followLinkActionSchema,
]);
/** Actions emitted by the shared browser reader. */
export type ReaderAction = z.infer<typeof readerActionSchema>;

/** Schema for persisted reader state. */
export const readerStateSchema = z.object({
  /** Page currently selected by the reader. */
  activePageId: z.string().min(1),
  /** Saved scroll offset for each visited page. */
  scrollByPage: z.record(z.string(), z.number().finite().nonnegative()),
  /** Saved coverage preference for each item. */
  votes: z.record(z.string(), voteValueSchema),
});
/** Reading state owned by the reader and persisted by its host. */
export type ReaderState = z.infer<typeof readerStateSchema>;

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
