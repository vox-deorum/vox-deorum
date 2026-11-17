/** Independent deterministic authored-prose and visual-presentation choices. */
import {
  newspaperIssueSchemaVersion,
  type IssueDocument,
  type IssueItem,
  type InlineText,
  type IssueReceiver,
} from '../../contracts/issue.js';
import type { PublicationState } from '../../contracts/publication.js';
import type { EditorialConfig, EditorialDesign, AuthoredVariant } from '../config/schema.js';
import { evaluateCondition, type ConditionContext } from '../shared/conditions.js';
import { chooseWeighted, selectionWeight } from '../shared/weights.js';
import { substitute, resolveLinkTarget, type EditorialCandidate } from '../selection/templates.js';

/** Render authored placeholders into text nodes and explicitly declared typed links. */
export function renderAuthoredText(
  text: string,
  values: EditorialCandidate['values'],
  variant: AuthoredVariant
): InlineText {
  const nodes: InlineText = [];
  let cursor = 0;
  const pattern = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
  for (const match of text.matchAll(pattern)) {
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
        text: values[match[1]] === undefined ? match[0] : String(values[match[1]]),
      });
    cursor = position + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) });
  return nodes.length ? nodes : [{ type: 'text', text }];
}

/** Choose a design with eligible positive layouts and retain the earlier identity while competitive. */
export function chooseDesign(
  config: EditorialConfig,
  context: ConditionContext,
  previousId: string | null,
  random: () => number
): EditorialDesign | undefined {
  const eligible = config.designs.filter(
    (design) =>
      evaluateCondition(design.condition, context) === true &&
      selectionWeight(design.weight, context) > 0
  );
  for (const design of eligible) {
    for (const variant of ['ordinary', 'breaking'])
      if (
        !design.layouts.some(
          (layout) =>
            layout.variant === variant &&
            evaluateCondition(layout.condition, context) === true &&
            selectionWeight(layout.weight, context) > 0
        )
      ) {
        throw new Error(`Eligible design ${design.id} has no available ${variant} layout.`);
      }
  }
  const strongest = Math.max(
    0,
    ...eligible.map((design) => selectionWeight(design.weight, context))
  );
  const previous = eligible.find((design) => design.id === previousId);
  if (
    previous &&
    selectionWeight(previous.weight, context) >= strongest * config.defaults.designStickiness
  )
    return previous;
  return chooseWeighted(eligible, (design) => selectionWeight(design.weight, context), random);
}

export interface PresentationResult {
  issue: IssueDocument;
  variants: Record<string, string>;
  layouts: Record<string, string>;
  itemCandidates: Map<string, EditorialCandidate>;
}

/** Write canonical articles, prioritize immediate threats, and adapt section pages to available content. */
export function presentIssue(input: {
  issueId: string;
  campaignId: string;
  timelineId: string;
  receiver: IssueReceiver;
  turn: number;
  selected: EditorialCandidate[];
  state: PublicationState;
  config: EditorialConfig;
  context: ConditionContext;
  proseRandom: () => number;
  presentationRandom: () => number;
}): PresentationResult | undefined {
  const { config, context, state } = input;
  const design = chooseDesign(config, context, state.previousDesignId, input.presentationRandom);
  if (!design || !input.selected.length) return undefined;
  const variants: Record<string, string> = {};
  const itemCandidates = new Map<string, EditorialCandidate>();
  const items: IssueItem[] = [];
  for (const [index, candidate] of input.selected.entries()) {
    const candidateContext = { ...context, values: { ...context.values, ...candidate.values } };
    const variant = chooseWeighted(
      candidate.variants,
      (choice) => selectionWeight(choice.weight, candidateContext),
      input.proseRandom
    );
    if (!variant) continue;
    const id = `${input.issueId}/item/${index + 1}`;
    variants[id] = variant.id;
    itemCandidates.set(id, candidate);
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
      body: variant.body.map((paragraph) =>
        renderAuthoredText(paragraph, candidate.values, variant)
      ),
      sourceNote: [{ type: 'text', text: candidate.summary }],
      ...(earlier
        ? {
            earlierReport: {
              label: 'Earlier report',
              target: { type: 'article' as const, issueId: earlier.issueId, itemId: earlier.id },
              summary: [[{ type: 'text' as const, text: earlier.evidenceSummary }]],
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
    .filter((page) => evaluateCondition(page.condition, context) === true)
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
      (layout) =>
        evaluateCondition(layout.condition, context) === true &&
        (urgent ? layout.variant === 'breaking' : layout.variant !== 'breaking')
    );
    const layout = chooseWeighted(
      choices,
      (choice) => selectionWeight(choice.weight, context),
      input.presentationRandom
    );
    if (!layout) throw new Error(`No eligible layout for page ${page.id}.`);
    layouts[page.id] = layout.id;
    pages.push({
      id: page.id,
      label: design.pageLabels[page.id] ?? page.label,
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
        title: design.title || config.defaults.publicationTitle,
        designId: design.id,
        designVersion: design.version,
        presentation: structuredClone(design.presentation),
      },
      pages,
      items: visibleItems,
    },
    variants: Object.fromEntries(Object.entries(variants).filter(([id]) => displayed.has(id))),
    layouts,
    itemCandidates,
  };
}
