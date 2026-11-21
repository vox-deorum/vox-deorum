/** Summarize a receiver's published issues for the `press` global and `printed` helper. */
import type { PublicationState, PublishedItemRecord } from '../../contracts/publication.js';
import type { NewspaperPress, NewspaperPrintedArticle } from '../facts/index.js';
import { ruleSubjectKey } from './subjects.js';

/** Record one article in a printed-article index, keeping the latest turn and article count. */
function addPrinted(
  index: Record<string, NewspaperPrintedArticle>,
  key: string,
  item: PublishedItemRecord,
): void {
  const previous = index[key];
  index[key] = {
    turn: previous === undefined ? item.turn : Math.max(previous.turn, item.turn),
    count: (previous?.count ?? 0) + 1,
  };
}

/** Build prior issue memory once from the incoming publication state. */
export function buildPress(state: PublicationState): NewspaperPress {
  const rules: Record<string, NewspaperPrintedArticle> = Object.create(null);
  const subjects: Record<string, NewspaperPrintedArticle> = Object.create(null);
  for (const issue of state.issues)
    for (const item of issue.items) {
      const ruleIds = new Set(item.ruleIds ?? []);
      for (const ruleId of ruleIds) addPrinted(rules, ruleId, item);
      const subjectKeys = item.ruleSubjects?.map(({ ruleId, subject }) => ruleSubjectKey(ruleId, subject)) ??
        (item.subject === undefined ? [] : [...ruleIds].map(ruleId => ruleSubjectKey(ruleId, item.subject!)));
      for (const key of new Set(subjectKeys)) addPrinted(subjects, key, item);
    }
  return {
    issues: state.issues.length,
    lastIssueTurn: state.issues.length ? Math.max(...state.issues.map((issue) => issue.turn)) : null,
    rules,
    subjects,
  };
}
