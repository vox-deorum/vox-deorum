/**
 * Fill the front and the sections in one loop: take the best remaining story, put it on the
 * first page with room, merge combined reports, and repeat until the stories run out.
 */
import type { FeedbackRecord, PublicationState } from '../../contracts/publication.js';
import type { EditorialConfig } from '../config/schema.js';
import { frontBriefCount, pageAccepts, pageComplete, pageMaxStories, planPage } from '../presentation/page-plan.js';
import { candidateFeedback } from './feedback.js';
import type { StoryMerger } from './merge.js';
import type { EditorialCandidate } from './templates.js';

type Page = EditorialConfig['pages'][number];

/** Why the editor placed or passed over a candidate. */
export type SelectionOutcome = 'selected' | 'outranked' | 'conflict' | 'printed-before' | 'not-positive' | 'no-variants';

/** One page and the stories placed on it, in placement order. */
export interface FilledPage {
  page: Page;
  stories: EditorialCandidate[];
}

export interface PageFill {
  /** The front first, then the kept sections in page order. */
  pages: FilledPage[];
  /** Whether the front holds a complete page. */
  frontComplete: boolean;
  /** Each original candidate's score when the editor considered it. */
  scores: { id: string; score: number; selected: boolean }[];
  /** Each original candidate's outcome; `selected` stories in a dropped section were not printed. */
  outcomes: Map<string, SelectionOutcome>;
}

export interface FillInput {
  candidates: readonly EditorialCandidate[];
  state: PublicationState;
  config: EditorialConfig;
  feedback: FeedbackRecord;
  turn: number;
  /** Sections eligible for this issue; the front page comes from the configuration. */
  sections: readonly Page[];
  merge?: StoryMerger;
}

/** Track editions' printed fingerprints and developments already covered by a merge. */
export function publishedFingerprints(state: PublicationState): Set<string> {
  return new Set(state.issues.flatMap(issue =>
    issue.items.flatMap(item => [item.fingerprint, ...(item.coveredFingerprints ?? [])])
  ));
}

/** Points a story loses for its rules' printed stories in earlier issues, fading each turn. */
export function ruleFatigue(
  ruleIds: readonly string[], state: PublicationState, turn: number, defaults: EditorialConfig['defaults'],
): number {
  if (!defaults.ruleFatigue) return 0;
  let total = 0;
  for (const issue of state.issues) {
    const fade = defaults.decayPerTurn ** Math.max(0, turn - issue.turn);
    for (const item of issue.items)
      if (item.ruleIds?.some(id => ruleIds.includes(id))) total += defaults.ruleFatigue * fade;
  }
  return total;
}

/** Compare page IDs without using the reader's locale or UTF-16 surrogate order. */
function comparePageIds(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = left[index].codePointAt(0)! - right[index].codePointAt(0)!;
    if (order) return order;
  }
  return left.length - right.length;
}

/**
 * Fill pages from the best stories. When merges leave the front short with nothing to refill
 * it, turn off the lowest-priority merge template in use and fill again.
 */
export async function fillPages(input: FillInput): Promise<PageFill> {
  const priority = new Map(input.config.templates.map(template => [template.id, template.merge?.priority ?? 0]));
  const disabled = new Set<string>();
  let result = await fillOnce(input, input.merge, disabled);
  while (!result.fill.frontComplete && result.mergeTemplates.length) {
    const weakest = [...result.mergeTemplates].sort((a, b) =>
      priority.get(a)! - priority.get(b)! || b.localeCompare(a))[0];
    disabled.add(weakest);
    result = await fillOnce(input, input.merge, disabled);
  }
  return result.fill;
}

/** Run the placement loop once, then repair the front and trim the sections. */
async function fillOnce(
  input: FillInput, merge: StoryMerger | undefined, disabled: ReadonlySet<string>,
): Promise<{ fill: PageFill; mergeTemplates: string[] }> {
  const { candidates, state, config, feedback, turn } = input;
  const { defaults } = config;
  const frontPage = config.pages.find(page => page.front)!;
  const pages = [frontPage, ...input.sections.filter(page => !page.front).sort(
    (a, b) => a.order - b.order || comparePageIds(a.id, b.id),
  )];
  const outcomes = new Map<string, SelectionOutcome>();
  const scores = new Map<string, number>();
  const published = publishedFingerprints(state);
  const remaining = candidates.filter((candidate) => {
    if (published.has(candidate.fingerprint)) outcomes.set(candidate.id, 'printed-before');
    else if (!candidate.variants.length) outcomes.set(candidate.id, 'no-variants');
    else return true;
    return false;
  });
  const fatigue = new Map(candidates.map(candidate => [candidate.id, ruleFatigue(candidate.ruleIds, state, turn, defaults)]));
  const usedSeries = new Set<string>();
  const usedTriggers = new Set<string>();
  const usedConflicts = new Set<string>();
  const usedTags = new Set<string>();
  const placed: { story: EditorialCandidate; page: number }[] = [];
  /** Stories the front refused only to keep its subjects mixed, kept in case nothing else fills it. */
  const reserve: EditorialCandidate[] = [];
  let merged: EditorialCandidate[] = [];

  /** Check whether a placed story already covers any of this candidate's subjects. */
  const conflicts = (candidate: EditorialCandidate) =>
    candidate.seriesKeys.some(key => usedSeries.has(key)) ||
    candidate.triggerIds.some(id => usedTriggers.has(id)) ||
    (candidate.conflictKeys ?? []).some(key => usedConflicts.has(key));

  /** Record a placed story's keys and tags so later stories can see them. */
  const claim = (candidate: EditorialCandidate) => {
    outcomes.set(candidate.id, 'selected');
    candidate.seriesKeys.forEach(key => usedSeries.add(key));
    candidate.triggerIds.forEach(id => usedTriggers.add(id));
    candidate.conflictKeys?.forEach(key => usedConflicts.add(key));
    candidate.tags.forEach(tag => usedTags.add(tag));
  };

  /** Score a candidate against what this issue already holds and what earlier issues printed. */
  const score = (candidate: EditorialCandidate): number => {
    const memory = Math.max(0, ...candidate.seriesKeys.map(key => state.series[key]?.importance ?? 0));
    const fresh = candidate.seriesKeys.every(key => !state.series[key]);
    const variety = candidate.tags.some(tag => !usedTags.has(tag));
    const repeats = placed.filter(({ story }) => story.ruleIds.some(id => candidate.ruleIds.includes(id))).length;
    return (
      candidate.importance +
      memory * defaults.seriesWeight +
      candidate.weight +
      (fresh ? defaults.noveltyBonus : 0) +
      (variety ? defaults.varietyBonus : 0) +
      candidateFeedback(candidate.seriesKeys, candidate.tags, feedback) -
      repeats * defaults.rulePenalty -
      fatigue.get(candidate.id)!
    );
  };

  /** Score a placed story; a merged story counts as its strongest member. */
  const storyScore = (story: EditorialCandidate): number =>
    story.mergedCandidateIds ? Math.max(...story.mergedCandidateIds.map(id => scores.get(id) ?? 0)) : scores.get(story.id) ?? 0;

  /** List each page's stories, with a merged story in its members' first slot, front first. */
  const layout = (): EditorialCandidate[][] => {
    const host = new Map<string, number>();
    for (const story of merged) {
      const members = placed.filter(({ story: member }) => story.mergedCandidateIds!.includes(member.id));
      const first = members.reduce((best, member) => member.page < best.page ? member : best);
      host.set(first.story.id, merged.indexOf(story));
    }
    const owned = new Set(merged.flatMap(story => story.mergedCandidateIds!));
    const view: EditorialCandidate[][] = pages.map(() => []);
    for (const { story, page } of placed) {
      const index = host.get(story.id);
      if (index !== undefined) view[page].push(merged[index]);
      else if (!owned.has(story.id)) view[page].push(story);
    }
    return view;
  };

  /** Check whether a page can take this story now. */
  const fits = (index: number, stories: readonly EditorialCandidate[], candidate: EditorialCandidate): boolean => {
    const front = index === 0;
    if (!front && !candidate.tags.some(tag => pages[index].tags.includes(tag))) return false;
    if (!pageAccepts(stories, candidate, front)) return false;
    // The front's last slots go to another subject when every front story so far shares this one.
    return !front || stories.length + 1 < frontBriefCount || stories.some(story => story.subject !== candidate.subject);
  };

  while (remaining.length) {
    const view = layout();
    if (view.every(stories => stories.length >= pageMaxStories)) break;
    const current = new Map(remaining.map(candidate => [candidate.id, score(candidate)]));
    remaining.sort((left, right) =>
      Number(right.urgent) - Number(left.urgent) ||
      current.get(right.id)! - current.get(left.id)! ||
      left.id.localeCompare(right.id));
    const candidate = remaining.shift()!;
    const value = current.get(candidate.id)!;
    scores.set(candidate.id, value);
    if (conflicts(candidate)) {
      outcomes.set(candidate.id, 'conflict');
      continue;
    }
    if (!candidate.urgent && value <= 0) {
      outcomes.set(candidate.id, 'not-positive');
      continue;
    }
    const target = view.findIndex((stories, index) => fits(index, stories, candidate));
    if (target < 0) {
      outcomes.set(candidate.id, 'outranked');
      if (pageAccepts(view[0], candidate, true)) reserve.push(candidate);
      continue;
    }
    placed.push({ story: candidate, page: target });
    claim(candidate);
    if (merge) {
      // An urgent merged report must sit on the front, where it can lead.
      merged = await merge(placed.map(({ story }) => story), story => !disabled.has(story.templateIds[0]) &&
        (!story.urgent || placed.some(({ story: member, page }) => page === 0 && story.mergedCandidateIds!.includes(member.id))));
    }
  }
  for (const candidate of candidates) {
    if (!scores.has(candidate.id)) scores.set(candidate.id, score(candidate));
    if (!outcomes.has(candidate.id)) outcomes.set(candidate.id, 'outranked');
  }

  const view = layout();
  repairFront(view, pages, storyScore, {
    stories: reserve, usable: story => !conflicts(story), claim,
  });
  // A section's lone story joins another started section that takes its tags, so two half-empty sections become one.
  for (let index = 1; index < view.length; index++) {
    if (view[index].length !== 1) continue;
    const [story] = view[index];
    const target = view.findIndex((stories, other) => other > 0 && other !== index && stories.length > 0 &&
      story.tags.some(tag => pages[other].tags.includes(tag)) && pageAccepts(stories, story, false));
    if (target > 0) view[target].push(view[index].pop()!);
  }
  const sections = pages.slice(1)
    .map((page, index) => ({ page, stories: view[index + 1], order: index }))
    .filter(entry => pageComplete(entry.stories, false))
    .sort((a, b) => sum(b.stories, storyScore) - sum(a.stories, storyScore) || a.order - b.order)
    .slice(0, defaults.sections)
    .sort((a, b) => a.order - b.order);
  // Stories from dropped sections move, best first, to a kept section that takes their tags.
  const kept = new Set(sections.map(({ order }) => order + 1));
  const dropped = view.slice(1).flatMap((stories, index) => kept.has(index + 1) ? [] : stories)
    .sort((a, b) => storyScore(b) - storyScore(a));
  for (const story of dropped) {
    const home = sections.find(({ page, stories }) =>
      story.tags.some(tag => page.tags.includes(tag)) && pageAccepts(stories, story, false));
    home?.stories.push(story);
  }
  const filled = [{ page: frontPage, stories: view[0] }, ...sections.map(({ page, stories }) => ({ page, stories }))];
  const printed = new Set(filled.flatMap(({ stories }) => stories.flatMap(story => story.mergedCandidateIds ?? [story.id])));
  return {
    mergeTemplates: [...new Set(merged.map(story => story.templateIds[0]))],
    fill: {
      pages: filled,
      frontComplete: pageComplete(view[0], true),
      outcomes,
      scores: candidates.map(candidate => ({
        id: candidate.id, score: scores.get(candidate.id)!, selected: printed.has(candidate.id),
      })),
    },
  };
}

/** Find the last story that passes a test. */
function lastIndex(stories: readonly EditorialCandidate[], test: (story: EditorialCandidate) => boolean): number {
  for (let index = stories.length - 1; index >= 0; index--) if (test(stories[index])) return index;
  return -1;
}

/** Add up the scores of a page's stories. */
function sum(stories: readonly EditorialCandidate[], storyScore: (story: EditorialCandidate) => number): number {
  return stories.reduce((total, story) => total + storyScore(story), 0);
}

/** Unplaced stories the front may still use, with the checks to place one. */
interface FrontReserve {
  stories: EditorialCandidate[];
  usable: (story: EditorialCandidate) => boolean;
  claim: (story: EditorialCandidate) => void;
}

/**
 * Keep the front printable after merges and subject rules moved stories around: give it a
 * second subject from a section when one exists, then top it up with the best section or
 * reserve stories. Reserve stories share the front's subject, since another subject would
 * have taken the slot.
 */
function repairFront(
  view: EditorialCandidate[][], pages: readonly Page[], storyScore: (story: EditorialCandidate) => number,
  reserve: FrontReserve,
): void {
  const front = view[0];
  /** Find the best section story that passes a test, with its page index; reserve stories use page -1. */
  const best = (test: (story: EditorialCandidate) => boolean, withReserve = false) => {
    let found: { page: number; story: EditorialCandidate } | undefined;
    /** Keep the higher-scoring of the current find and this story. */
    const consider = (page: number, story: EditorialCandidate) => {
      if (test(story) && (!found || storyScore(story) > storyScore(found.story))) found = { page, story };
    };
    for (let page = 1; page < view.length; page++) for (const story of view[page]) consider(page, story);
    if (withReserve) for (const story of reserve.stories) if (reserve.usable(story)) consider(-1, story);
    return found;
  };
  /** Remove a story from its section, or place it from the reserve. */
  const take = ({ page, story }: { page: number; story: EditorialCandidate }) => {
    if (page < 0) {
      reserve.stories.splice(reserve.stories.indexOf(story), 1);
      reserve.claim(story);
    } else view[page].splice(view[page].indexOf(story), 1);
  };
  const subjects = new Set(front.map(story => story.subject));
  const other = subjects.size === 1 ? best(story => !subjects.has(story.subject)) : undefined;
  if (other) {
    take(other);
    if (!pageComplete(front, true) && pageAccepts(front, other.story, true)) front.push(other.story);
    else {
      // Swap out the last brief; it returns to the freed section when it belongs there.
      const leadId = planPage(front, true).leadId;
      const index = lastIndex(front, story => story.id !== leadId);
      const [out] = front.splice(index, 1, other.story);
      const section = view[other.page];
      if (out.tags.some(tag => pages[other.page].tags.includes(tag)) && pageAccepts(section, out, false)) section.push(out);
      // A five-story front needs a lead; drop to four briefs when the swap removed it.
      if (front.length === frontBriefCount + 1 && planPage(front, true).leadId === undefined) {
        const extra = lastIndex(front, story => story !== other.story);
        front.splice(extra, 1);
      }
    }
  }
  while (!pageComplete(front, true)) {
    const next = best(story => pageAccepts(front, story, true), true);
    if (!next) break;
    take(next);
    front.push(next.story);
  }
}
