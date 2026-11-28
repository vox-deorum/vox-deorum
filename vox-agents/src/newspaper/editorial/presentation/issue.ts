/** Independent deterministic authored-prose and visual-presentation choices. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import {
  newspaperIssueSchemaVersion,
  type IssueDocument,
  type IssueItem,
  type InlineText,
  type IssueReceiver,
} from '../../contracts/issue.js';
import type { DesignSelection, PublicationState } from '../../contracts/publication.js';
import { variantStyleKinds, type VariantStyle } from '../../contracts/style.js';
import type { RuleDevelopment } from '../../contracts/triggers.js';
import type { EditorialConfig, EditorialDesign, AuthoredVariant } from '../config/schema.js';
import type { EditorialTerms } from '../config/expressions.js';
import { resolveVariantStyle } from '../config/styles.js';
import type { NewspaperFactModel } from '../facts/index.js';
import { pressRunDesignDraw, pressRunLayoutDraw } from '../shared/determinism.js';
import { chooseWeighted } from '../shared/weights.js';
import { uniqueSources } from '../shared/sources.js';
import {
  placeholderPattern, placeholderName, substitute, resolveLinkTarget, type EditorialCandidate
} from '../selection/templates.js';
import { fittingFrontLayouts, prepareFrontLayouts, type FrontLayouts, type PresentationWeights } from './eligibility.js';
import type { FilledPage } from '../selection/fill.js';
import { pageComplete, planPage } from './page-plan.js';
import { resolveMasthead, resolvePrintableTermText, termTextSources } from './masthead.js';
import type { MastheadRuleSelection } from './masthead-rules.js';

/** Render authored placeholders as text or links, marking names for the reader. */
export function renderAuthoredText(
  text: string,
  values: EditorialCandidate['values'],
  variant: AuthoredVariant,
  names?: readonly string[],
): InlineText {
  const nodes: InlineText = [];
  let cursor = 0;
  let precedingText = '';
  for (const match of text.matchAll(placeholderPattern)) {
    const position = match.index!;
    if (position > cursor) {
      const literal = text.slice(cursor, position);
      nodes.push({ type: 'text', text: literal });
      precedingText += literal;
    }
    const key = placeholderName(match[1]);
    const link = variant.links.find((entry) => entry.placeholder === key);
    const name = names?.includes(key) ? { isName: true as const } : {};
    const printed = substitute(link?.label ?? match[0], values, precedingText);
    if (link)
      nodes.push({
        type: 'link',
        text: printed,
        target: resolveLinkTarget(link.target, values),
        ...name,
      });
    else
      nodes.push({
        type: 'text',
        text: printed,
        ...name,
      });
    precedingText += printed;
    cursor = position + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) });
  return nodes.length ? nodes : [{ type: 'text', text }];
}

const protectedIssues = 3;
const maximumIssues = 6;

/** Keep a competitive incumbent through three issues and force it out after six when an alternative fits. */
export function choosePressRunDesign(
  eligibleDesigns: readonly EditorialDesign[],
  weights: PresentationWeights,
  state: PublicationState,
  random: () => number,
): { design: EditorialDesign | undefined; audit: DesignSelection } {
  const eligible = [...eligibleDesigns];
  // Use a fixed code point order so catalogue ordering and the process locale cannot change the draw.
  eligible.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const strongest = Math.max(0, ...eligible.map((design) => weights.get(design)!));
  const competitive = eligible.filter((design) => weights.get(design)! >= strongest / 2);
  const previousId = state.issues.at(-1)?.designId ?? null;
  let priorRunLength = 0;
  if (previousId !== null) {
    for (let offset = 1; offset <= maximumIssues; offset++) {
      if (state.issues.at(-offset)?.designId !== previousId) break;
      priorRunLength++;
    }
  }
  const incumbent = competitive.find((design) => design.id === previousId);
  const keep = incumbent !== undefined && priorRunLength < protectedIssues;
  const forceSwitch = incumbent !== undefined && priorRunLength === maximumIssues && competitive.length > 1;
  let reason: DesignSelection['reason'];
  if (!eligible.length) reason = 'no-eligible';
  else if (keep) reason = 'protected';
  else if (forceSwitch) reason = 'run-limit';
  else if (incumbent) reason = 'weighted';
  else if (previousId === null) reason = 'opening';
  else reason = eligible.some((design) => design.id === previousId) ? 'weak-incumbent' : 'ineligible-incumbent';
  const pool = keep ? [] : competitive.filter((design) => !forceSwitch || design !== incumbent);
  const drawWeights = new Map(pool.map((design) => [design, weights.get(design)!]));
  return {
    design: keep ? incumbent : chooseWeighted(pool, (design) => drawWeights.get(design)!, random),
    audit: {
      previousId, priorRunLength, reason,
      candidates: eligible.map((design) => ({
        id: design.id, rawWeight: weights.get(design)!, drawWeight: drawWeights.get(design) ?? 0,
      })),
    },
  };
}

/** Put the planned lead first and keep a different subject second on the front page. */
function orderStories(
  stories: readonly EditorialCandidate[],
  leadId: string | undefined,
  diversifySubjects: boolean,
): EditorialCandidate[] {
  const first = stories.find(story => story.id === leadId) ?? stories[0];
  if (!first) return [];
  const second = diversifySubjects
    ? stories.find(story => story !== first && story.subject !== first.subject)
    : undefined;
  return [first, ...(second ? [second] : []), ...stories.filter(story => story !== first && story !== second)];
}

export interface PresentationResult {
  issue: IssueDocument;
  variants: Record<string, string>;
  styles: Record<string, VariantStyle>;
  layouts: Record<string, string>;
  itemCandidates: Map<string, EditorialCandidate>;
  mastheadSources: NewspaperSourceReference[];
  mastheadRuleId?: string;
}

/** Date developments from their explicit observation, event or incident, then supporting evidence. */
export function developmentObservationTurns(
  developments: readonly RuleDevelopment[], facts: NewspaperFactModel,
): Map<string, number> {
  const subjectTurns = new Map<string, number>([
    ...facts.events.map(({ id, turn }) => [`event/${id}`, turn] as const),
    ...facts.incidents.map(({ id, turn }) => [`incident/${id}`, turn] as const),
  ]);
  /** Read an authored observation date or the date of the subject itself. */
  function turnFor({ subject, values }: Pick<RuleDevelopment, 'subject' | 'values'>): number {
    const turn = values.observedTurn;
    return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0 && turn <= facts.turn
      ? turn : subjectTurns.get(subject) ?? -1;
  }
  return new Map(developments.map(development => {
    const { matches } = development.values;
    const turn = Array.isArray(matches) ? Math.max(...matches.map(turnFor)) : turnFor(development);
    return [development.id, turn >= 0 ? turn :
      development.sources.reduce((latest, source) => Math.max(latest, source.turn), -1)];
  }));
}

/** Order one page's stories behind its planned lead. */
function ordered(stories: readonly EditorialCandidate[], front: boolean) {
  const leadId = planPage(stories, front).leadId;
  return { stories: orderStories(stories, leadId, front), hasLead: leadId !== undefined };
}

/** Write canonical articles for filled pages, choosing the design, layouts, and prose. */
export async function presentIssue(input: {
  checkId: string;
  issueId: string;
  campaignId: string;
  timelineId: string;
  receiver: IssueReceiver;
  turn: number;
  /** Recorded observation turns by trigger development ID. */
  observationTurns?: ReadonlyMap<string, number>;
  /** The front first, then the sections, as the editor filled them. */
  pages: readonly FilledPage[];
  state: PublicationState;
  config: EditorialConfig;
  weights: PresentationWeights;
  proseRandom: () => number;
  fittingFronts?: FrontLayouts;
  prepareProse?: (candidates: EditorialCandidate[]) => Promise<EditorialCandidate[]>;
  recordDesignSelection?: (audit: DesignSelection) => void;
  terms?: EditorialTerms;
  selectMasthead?: (design: EditorialDesign) => Promise<MastheadRuleSelection | undefined>;
}): Promise<PresentationResult | undefined> {
  const { config, weights, state } = input;
  const terms = input.terms ?? new Map();
  const [front, ...sections] = input.pages;
  if (!front?.page.front || !pageComplete(front.stories, true)) return undefined;
  const plan = planPage(front.stories, true);
  const fitting = input.fittingFronts ?? fittingFrontLayouts(
    prepareFrontLayouts(config, weights, terms), plan.breaking,
  );
  const { design, audit } = choosePressRunDesign([...fitting.keys()], weights, state, () => pressRunDesignDraw(input.checkId));
  input.recordDesignSelection?.(audit);
  if (!design) return undefined;
  /** Draw each page independently so an omitted tab cannot affect later layouts. */
  const pageDraw = (page: FilledPage['page']) => pressRunLayoutDraw(input.checkId, design.id, page.id);
  /** Use the precomputed positive weights for this design's layout choices. */
  const layoutWeight = (layout: EditorialDesign['layouts'][number]) => weights.get(layout) ?? 0;
  const frontLayout = chooseWeighted(fitting.get(design)!, layoutWeight, () => pageDraw(front.page))!;
  const sectionLayouts = design.layouts.filter(layout => layout.variant !== 'breaking');
  const placement = [
    { page: front.page, layout: frontLayout, ...ordered(front.stories, true) },
    // A section without a layout in this design is left out.
    ...sections.flatMap(({ page, stories }) => {
      const layout = chooseWeighted(sectionLayouts, layoutWeight, () => pageDraw(page));
      return layout ? [{ page, layout, ...ordered(stories, false) }] : [];
    }),
  ];
  const candidates = placement.flatMap(page => page.stories);
  const prose = input.prepareProse ? await input.prepareProse(candidates) : candidates;
  const selectedMasthead = input.selectMasthead ? await input.selectMasthead(design) : undefined;
  const masthead = selectedMasthead ?? resolveMasthead(design, terms, config.defaults.publicationTitle);
  if (!masthead) return undefined;
  const mastheadSources = [...masthead.sources];
  const variants: Record<string, string> = {};
  const styles: Record<string, VariantStyle> = {};
  const styleCounts = new Map(variantStyleKinds.map(kind => [kind, new Map<string, number>()] as const));
  const itemCandidates = new Map<string, EditorialCandidate>();
  const items: IssueItem[] = [];
  const publishedIds = new Map<string, string>();
  for (const [index, candidate] of prose.entries()) {
    const placed = candidates[index];
    const variant = chooseWeighted(
      candidate.variants,
      (choice) => {
        const weight = candidate.variantWeights[choice.id] ?? 0;
        if (!config.styles) return weight;
        const style = resolveVariantStyle(choice);
        const adjusted = variantStyleKinds.reduce((product, kind) => {
          const count = styleCounts.get(kind)!.get(style[kind]) ?? 0;
          return product * config.defaults.styleRepeat[kind] ** count;
        }, weight);
        // An extreme factor must not remove an eligible variant or break the draw.
        return weight > 0 && (adjusted <= 0 || !Number.isFinite(adjusted)) ? weight : adjusted;
      },
      input.proseRandom
    );
    if (!variant) throw new Error('A placed article has no eligible prose.');
    const id = `${input.issueId}/item/${index + 1}`;
    publishedIds.set(placed.id, id);
    variants[id] = variant.id;
    const style = resolveVariantStyle(variant);
    styles[id] = style;
    for (const kind of variantStyleKinds) {
      const counts = styleCounts.get(kind)!;
      counts.set(style[kind], (counts.get(style[kind]) ?? 0) + 1);
    }
    const sources = uniqueSources([...candidate.sources, ...(candidate.variantSources[variant.id] ?? [])]);
    itemCandidates.set(id, { ...candidate, sources });
    const observedTurn = Math.max(...candidate.triggerIds.map(id => input.observationTurns?.get(id) ?? -1));
    const prior = candidate.seriesKeys
      .map((key) => state.series[key])
      .filter((value) => value !== undefined)
      .sort((a, b) => b.lastPublishedTurn - a.lastPublishedTurn)[0];
    const earlier =
      prior &&
      state.issues.flatMap((issue) => issue.items).find((item) => item.id === prior.lastItemId);
    items.push({
      id,
      ...(observedTurn >= 0 ? { observedTurn } : {}),
      tags: candidate.tags,
      seriesKeys: candidate.seriesKeys,
      headline: renderAuthoredText(variant.headline, candidate.values, variant, candidate.names),
      ...(variant.subheadline === undefined
        ? {}
        : { subheadline: renderAuthoredText(variant.subheadline, candidate.values, variant, candidate.names) }),
      ...(variant.byline === undefined
        ? {}
        : { byline: renderAuthoredText(variant.byline, candidate.values, variant, candidate.names) }),
      body: variant.body.map((paragraph) =>
        renderAuthoredText(paragraph, candidate.values, variant, candidate.names)
      ),
      sourceNote: [{ type: 'text', text: `From the editors of ${masthead.title}` }],
      ...(earlier
        ? {
            earlierReport: {
              label: 'Earlier report',
              target: { type: 'article' as const, issueId: earlier.issueId, itemId: earlier.id },
              summary: [earlier.headline],
            },
          }
        : {}),
    });
  }
  const pages: IssueDocument['pages'] = [];
  const layouts: Record<string, string> = {};
  for (const { page, layout, stories, hasLead } of placement) {
    layouts[page.id] = layout.id;
    let label = Object.hasOwn(design.pageLabels, page.id) ? design.pageLabels[page.id] : page.label;
    const ruleLabels = selectedMasthead?.rule.pageLabels;
    const authoredLabel = ruleLabels && Object.hasOwn(ruleLabels, page.id) ? ruleLabels[page.id] : undefined;
    if (authoredLabel !== undefined) {
      const resolvedLabel = resolvePrintableTermText(authoredLabel, terms);
      if (resolvedLabel !== undefined) {
        label = resolvedLabel;
        mastheadSources.push(...termTextSources(authoredLabel, terms));
      }
    }
    pages.push({
      id: page.id,
      label,
      layout: layout.variant,
      hasLead,
      itemIds: stories.map(story => publishedIds.get(story.id)!),
    });
  }
  return {
    issue: {
      schemaVersion: newspaperIssueSchemaVersion,
      issueId: input.issueId,
      campaignId: input.campaignId,
      timelineId: input.timelineId,
      receiver: input.receiver,
      cutoff: { turn: input.turn, label: `Turn ${input.turn}` },
      publication: {
        title: masthead.title,
        ...(design.id === 'coffeehouse-essay' ? { editionNumber: state.issues.length + 1 } : {}),
        ...(masthead.motto === undefined ? {} : { motto: masthead.motto }),
        designId: design.id,
        designVersion: design.version,
        presentation: structuredClone(design.presentation),
      },
      pages,
      items,
    },
    variants,
    styles,
    layouts,
    itemCandidates,
    mastheadSources: uniqueSources(mastheadSources),
    ...(selectedMasthead === undefined ? {} : { mastheadRuleId: selectedMasthead.rule.id }),
  };
}
