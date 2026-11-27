/** Pure page policy shared by page filling, presentation, and validation. */

/** A story considered for one newspaper page. */
export interface PageEntry {
  id: string;
  urgent: boolean;
  importance: number;
}

/** The lead and style for one page. */
export interface PagePlan {
  leadId: string | undefined;
  breaking: boolean;
}

/** Briefs the front page holds besides an optional lead. */
export const frontBriefCount = 4;
/** Fewest briefs a section may print. */
export const sectionMinBriefs = 2;
/** Most briefs a section may print besides an optional lead. */
export const sectionMaxBriefs = 4;
/** Most stories any page holds: its full briefs plus a lead. */
export const pageMaxStories = 5;
/** Raw-importance gap that makes a nonurgent story a discretionary lead. */
export const leadImportanceMargin = 15;

/** Find the highest-importance story when it clearly beats the runner-up. */
function discretionaryLead(entries: readonly PageEntry[]): PageEntry | undefined {
  if (entries.length < 2) return undefined;
  let leader = entries[0];
  let runnerUp: PageEntry | undefined;
  for (const entry of entries.slice(1)) {
    if (entry.importance > leader.importance) {
      runnerUp = leader;
      leader = entry;
    } else if (!runnerUp || entry.importance > runnerUp.importance) {
      runnerUp = entry;
    }
  }
  if (!runnerUp || leader.importance - runnerUp.importance < leadImportanceMargin) return undefined;
  return leader;
}

/**
 * Decide a page's lead. The first urgent story leads a breaking front. Otherwise a story
 * that clearly outranks the rest leads a full front of five, or a section of three or more.
 */
export function planPage(entries: readonly PageEntry[], front: boolean): PagePlan {
  const urgentLead = front ? entries.find(entry => entry.urgent) : undefined;
  const allowed = front ? entries.length === frontBriefCount + 1 : entries.length > sectionMinBriefs;
  const lead = urgentLead ?? (allowed ? discretionaryLead(entries) : undefined);
  return { leadId: lead?.id, breaking: urgentLead !== undefined };
}

/** Check whether a page's brief count, outside its lead, fits its range. */
export function briefsFit(briefs: number, front: boolean): boolean {
  return front ? briefs === frontBriefCount : briefs >= sectionMinBriefs && briefs <= sectionMaxBriefs;
}

/** Check whether a page's stories form a complete, printable page. */
export function pageComplete(entries: readonly PageEntry[], front: boolean): boolean {
  const lead = planPage(entries, front).leadId;
  return briefsFit(entries.length - (lead === undefined ? 0 : 1), front);
}

/** Check whether a page has room for one more story; a fifth story needs the five to have a lead. */
export function pageAccepts(entries: readonly PageEntry[], entry: PageEntry, front: boolean): boolean {
  const next = [...entries, entry];
  if (next.length < pageMaxStories) return true;
  return next.length === pageMaxStories && planPage(next, front).leadId !== undefined;
}
