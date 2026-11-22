/** Pure page policy shared by placement, merge fitting, and validation. */

/** A story considered for one newspaper page. */
export interface PageEntry {
  id: string;
  urgent: boolean;
  importance: number;
}

/** The lead, style, and required story count for one page. */
export interface PagePlan {
  leadId: string | undefined;
  breaking: boolean;
  count: number;
}

/** Briefs required before an optional lead is added to a front page. */
export const frontBriefCount = 4;
/** Briefs required before an optional lead is added to an inside page. */
export const sectionBriefCount = 2;
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

/** Decide whether a page has a lead and how many stories it needs before layout selection. */
export function planPage(entries: readonly PageEntry[], front: boolean): PagePlan {
  const urgentLead = front ? entries.find(entry => entry.urgent) : undefined;
  const lead = urgentLead ?? discretionaryLead(entries);
  return {
    leadId: lead?.id,
    breaking: urgentLead !== undefined,
    count: (front ? frontBriefCount : sectionBriefCount) + (lead ? 1 : 0),
  };
}
