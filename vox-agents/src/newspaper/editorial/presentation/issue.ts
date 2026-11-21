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
import type { EditorialConfig, EditorialDesign, AuthoredVariant } from '../config/schema.js';
import type { EditorialTerms } from '../config/expressions.js';
import { resolveVariantStyle } from '../config/styles.js';
import { pressRunDesignDraw, pressRunLayoutDraw } from '../shared/determinism.js';
import { chooseWeighted } from '../shared/weights.js';
import { uniqueSources } from '../shared/sources.js';
import {
  placeholderPattern, substitute, resolveLinkTarget, type EditorialCandidate
} from '../selection/templates.js';
import type { PresentationWeights } from './eligibility.js';
import { resolveMasthead, resolvePrintableTermText, termTextSources } from './masthead.js';
import type { MastheadRuleSelection } from './masthead-rules.js';

/** Render authored placeholders into text nodes and explicitly declared typed links. */
export function renderAuthoredText(
  text: string,
  values: EditorialCandidate['values'],
  variant: AuthoredVariant
): InlineText {
  const nodes: InlineText = [];
  let cursor = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    const position = match.index!;
    if (position > cursor) nodes.push({ type: 'text', text: text.slice(cursor, position) });
    const link = variant.links.find((entry) => entry.placeholder === match[1]);
    if (link)
      nodes.push({
        type: 'link',
        text: substitute(link.label, values),
        target: resolveLinkTarget(link.target, values),
      });
    else
      nodes.push({
        type: 'text',
        text: substitute(match[0], values),
      });
    cursor = position + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) });
  return nodes.length ? nodes : [{ type: 'text', text }];
}

/** Require a printable masthead and both ordinary and breaking layouts for every eligible design. */
function eligibleDesigns(
  config: EditorialConfig,
  weights: PresentationWeights,
  terms: EditorialTerms,
): EditorialDesign[] {
  const eligible = config.designs.filter((design) =>
    (weights.get(design) ?? 0) > 0 && resolveMasthead(design, terms) !== undefined
  );
  for (const design of eligible) {
    for (const variant of ['ordinary', 'breaking'])
      if (
        !design.layouts.some(
          (layout) => layout.variant === variant && (weights.get(layout) ?? 0) > 0
        )
      ) {
        throw new Error(`Eligible design ${design.id} has no available ${variant} layout.`);
      }
  }
  return eligible;
}

/** Choose a design using legacy stickiness and the original shared presentation draw. */
export function chooseDesign(
  config: EditorialConfig,
  weights: PresentationWeights,
  previousId: string | null,
  random: () => number,
  terms: EditorialTerms = new Map()
): EditorialDesign | undefined {
  const eligible = eligibleDesigns(config, weights, terms);
  const strongest = Math.max(
    0,
    ...eligible.map((design) => weights.get(design)!)
  );
  const previous = eligible.find((design) => design.id === previousId);
  if (
    previous &&
    weights.get(previous)! >= strongest * config.defaults.designStickiness
  )
    return previous;
  return chooseWeighted(eligible, (design) => weights.get(design)!, random);
}

const protectedIssues = 3;
const maximumIssues = 6;

/** Keep a competitive incumbent through three issues and force it out after six when an alternative fits. */
export function choosePressRunDesign(
  config: EditorialConfig,
  weights: PresentationWeights,
  state: PublicationState,
  random: () => number,
  terms: EditorialTerms = new Map(),
): { design: EditorialDesign | undefined; audit: DesignSelection } {
  const eligible = eligibleDesigns(config, weights, terms);
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

export interface PresentationResult {
  issue: IssueDocument;
  variants: Record<string, string>;
  styles: Record<string, VariantStyle>;
  layouts: Record<string, string>;
  itemCandidates: Map<string, EditorialCandidate>;
  mastheadSources: NewspaperSourceReference[];
  mastheadRuleId?: string;
}

/** Write canonical articles, prioritize immediate threats, and adapt section pages to available content. */
export async function presentIssue(input: {
  checkId: string;
  issueId: string;
  campaignId: string;
  timelineId: string;
  receiver: IssueReceiver;
  turn: number;
  selected: EditorialCandidate[];
  state: PublicationState;
  config: EditorialConfig;
  weights: PresentationWeights;
  proseRandom: () => number;
  presentationRandom: () => number;
  recordDesignSelection?: (audit: DesignSelection) => void;
  terms?: EditorialTerms;
  selectMasthead?: (design: EditorialDesign) => Promise<MastheadRuleSelection | undefined>;
}): Promise<PresentationResult | undefined> {
  const { config, weights, state } = input;
  const terms = input.terms ?? new Map();
  const pressRun = config.defaults.designSelection === 'pressRun';
  const choice = pressRun
    ? choosePressRunDesign(config, weights, state, () => pressRunDesignDraw(input.checkId), terms)
    : undefined;
  if (choice) input.recordDesignSelection?.(choice.audit);
  const design = choice
    ? choice.design
    : chooseDesign(config, weights, state.previousDesignId, input.presentationRandom, terms);
  if (!design || !input.selected.length) return undefined;
  const selectedMasthead = input.selectMasthead ? await input.selectMasthead(design) : undefined;
  const masthead = selectedMasthead ?? resolveMasthead(design, terms, config.defaults.publicationTitle);
  if (!masthead) return undefined;
  const mastheadSources = [...masthead.sources];
  const variants: Record<string, string> = {};
  const styles: Record<string, VariantStyle> = {};
  const styleCounts = new Map(variantStyleKinds.map(kind => [kind, new Map<string, number>()] as const));
  const itemCandidates = new Map<string, EditorialCandidate>();
  const items: IssueItem[] = [];
  for (const [index, candidate] of input.selected.entries()) {
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
    if (!variant) continue;
    const id = `${input.issueId}/item/${index + 1}`;
    variants[id] = variant.id;
    const style = resolveVariantStyle(variant);
    styles[id] = style;
    for (const kind of variantStyleKinds) {
      const counts = styleCounts.get(kind)!;
      counts.set(style[kind], (counts.get(style[kind]) ?? 0) + 1);
    }
    itemCandidates.set(id, {
      ...candidate,
      sources: uniqueSources([...candidate.sources, ...(candidate.variantSources[variant.id] ?? [])]),
    });
    const prior = candidate.seriesKeys
      .map((key) => state.series[key])
      .filter((value) => value !== undefined)
      .sort((a, b) => b.lastPublishedTurn - a.lastPublishedTurn)[0];
    const earlier =
      prior &&
      state.issues.flatMap((issue) => issue.items).find((item) => item.id === prior.lastItemId);
    items.push({
      id,
      tags: candidate.tags,
      seriesKeys: candidate.seriesKeys,
      headline: renderAuthoredText(variant.headline, candidate.values, variant),
      ...(variant.subheadline === undefined
        ? {}
        : { subheadline: renderAuthoredText(variant.subheadline, candidate.values, variant) }),
      ...(variant.byline === undefined
        ? {}
        : { byline: renderAuthoredText(variant.byline, candidate.values, variant) }),
      body: variant.body.map((paragraph) =>
        renderAuthoredText(paragraph, candidate.values, variant)
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
  if (!items.length) return undefined;
  const pages: IssueDocument['pages'] = [];
  const frontItemIds = new Set<string>();
  const layouts: Record<string, string> = {};
  // Front pages sort first so later sections can skip items already displayed there.
  const pageDefinitions = config.pages
    .filter((page) => (weights.get(page) ?? 0) > 0)
    .sort(
      (a, b) => Number(b.front) - Number(a.front) || a.order - b.order || a.id.localeCompare(b.id)
    );
  for (const page of pageDefinitions) {
    let members = page.front
      ? [...items]
      : items.filter((item) => item.tags.some((tag) => page.tags.includes(tag)));
    if (page.front) {
      const lead = members[0];
      const leadSubject = itemCandidates.get(lead.id)!.subject;
      const varied = members
        .slice(1)
        .find((item) => itemCandidates.get(item.id)!.subject !== leadSubject);
      if (varied)
        members = [lead, varied, ...members.filter((item) => item !== lead && item !== varied)];
      members = members.slice(0, config.defaults.frontPageItems);
      for (const item of members) frontItemIds.add(item.id);
    }
    if (!members.length || (!page.front && members.length < page.minimum)) continue;
    if (!page.front && members.every((item) => frontItemIds.has(item.id))) continue;
    const urgent = page.front && members.some((item) => itemCandidates.get(item.id)?.urgent);
    const choices = design.layouts.filter(
      (layout) => urgent ? layout.variant === 'breaking' : layout.variant !== 'breaking'
    );
    const layout = chooseWeighted(
      choices,
      (choice) => weights.get(choice) ?? 0,
      pressRun ? () => pressRunLayoutDraw(input.checkId, design.id, page.id) : input.presentationRandom
    );
    if (!layout) throw new Error(`No eligible layout for page ${page.id}.`);
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
      itemIds: members.map((item) => item.id),
    });
  }
  // Remove authored items that no eligible page displays, along with their variant and candidate mappings.
  const displayed = new Set(pages.flatMap((page) => page.itemIds));
  const visibleItems = items.filter((item) => displayed.has(item.id));
  for (const id of itemCandidates.keys()) if (!displayed.has(id)) itemCandidates.delete(id);
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
        ...(masthead.motto === undefined ? {} : { motto: masthead.motto }),
        designId: design.id,
        designVersion: design.version,
        presentation: structuredClone(design.presentation),
      },
      pages,
      items: visibleItems,
    },
    variants: Object.fromEntries(Object.entries(variants).filter(([id]) => displayed.has(id))),
    styles: Object.fromEntries(Object.entries(styles).filter(([id]) => displayed.has(id))),
    layouts,
    itemCandidates,
    mastheadSources: uniqueSources(mastheadSources),
    ...(selectedMasthead === undefined ? {} : { mastheadRuleId: selectedMasthead.rule.id }),
  };
}
