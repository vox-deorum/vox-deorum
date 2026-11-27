/** Render the template coverage hierarchy: groups, then templates, then rule funnels. */
import type { CoverageStage, RunCoverage, RunRuleCoverage, TemplateCoverage } from '../../../src/newspaper/contracts/coverage.js';
import {
  countStages,
  coverageTags,
  defaultControls,
  filterTemplates,
  groupLabel,
  groupTemplates,
  outcomeLabels,
  ruleFunnelLine,
  scoreVersusFloor,
  stageCountLabels,
  stageLabels,
  stopReason,
  stopStep,
  stagesWorstFirst,
  templateReason,
  unprintedOutcomes,
  type CoverageControls,
  type CoverageGroup,
  type Grouping,
} from './coverage-model.js';
import { element } from './dom.js';

const storageKey = 'vox-deorum.newspaper.coverage';

/** Create an element with an optional class and text. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Fill a disclosure when it is first opened, or right away if it starts open. */
function fillOnOpen(details: HTMLDetailsElement, fill: () => void): void {
  let filled = false;
  /** Build the contents once. */
  function once(): void {
    if (filled || !details.open) return;
    filled = true;
    fill();
  }
  details.addEventListener('toggle', once);
  once();
}

/** Read the viewer's saved controls, falling back to the defaults. */
function readControls(): CoverageControls {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!saved || typeof saved !== 'object') return { ...defaultControls };
    return {
      grouping: ['desk', 'stage', 'tag'].includes(saved.grouping) ? saved.grouping : defaultControls.grouping,
      tag: typeof saved.tag === 'string' ? saved.tag : '',
      stage: stagesWorstFirst.includes(saved.stage) ? saved.stage : '',
      search: '',
      hidePrinted: saved.hidePrinted === true,
    };
  } catch {
    return { ...defaultControls };
  }
}

/** Remember the viewer's controls, except the transient search text. */
function saveControls(controls: CoverageControls): void {
  try {
    const { search: _search, ...kept } = controls;
    localStorage.setItem(storageKey, JSON.stringify(kept));
  } catch {
    // Coverage still works when browser storage is unavailable.
  }
}

/** Draw a small stacked bar with one segment per non-empty stage. */
function stageBar(counts: Record<CoverageStage, number>): HTMLSpanElement {
  const bar = make('span', 'host-coverage-bar');
  bar.setAttribute('aria-hidden', 'true');
  for (const stage of stagesWorstFirst) {
    if (!counts[stage]) continue;
    const segment = make('span');
    segment.dataset.stage = stage;
    segment.style.flexGrow = String(counts[stage]);
    segment.title = `${stageLabels[stage]}: ${counts[stage]}`;
    bar.append(segment);
  }
  return bar;
}

/** List the non-empty stage counts, worst first, as compact text. */
function stageCounts(counts: Record<CoverageStage, number>): string {
  return stagesWorstFirst.filter(stage => counts[stage]).map(stage => `${counts[stage]} ${stageCountLabels[stage]}`).join(' · ');
}

/** Build a stage badge for a template row. */
function stageBadge(stage: CoverageStage): HTMLSpanElement {
  const badge = make('span', 'host-stage', stageLabels[stage]);
  badge.dataset.stage = stage;
  return badge;
}

/** Show one rule's run-wide funnel and its most common stop reasons. */
function ruleFunnel(id: string, rule: RunRuleCoverage | undefined): HTMLElement {
  const block = make('div', 'host-coverage-rule');
  block.dataset.coverageRule = id;
  const title = make('p', 'host-coverage-rule-title');
  title.append(make('code', undefined, id));
  if (rule?.subject) title.append(` (${rule.subject})`);
  if (rule?.disabled) title.append(' · turned off');
  block.append(title);
  if (!rule) {
    block.append(make('p', undefined, 'This rule has no coverage data.'));
    return block;
  }
  block.append(make('p', undefined, ruleFunnelLine(rule)));
  if (!rule.stops.length || rule.disabled) return block;
  const table = make('table', 'host-coverage-stops');
  table.append(make('thead'), make('tbody'));
  const head = make('tr');
  head.append(make('th', undefined, 'Step'), make('th', undefined, 'Result'), make('th', undefined, 'Reached'), make('th', undefined, 'Stopped'));
  table.tHead!.append(head);
  // Rows follow the order the rule applies its steps, so the last row is the deepest hurdle.
  for (const stop of rule.stops) {
    const tr = make('tr');
    tr.dataset.coverageStop = stop.key;
    const step = make('td', undefined, stopStep(stop));
    if (stop.source) step.append(make('br'), make('code', undefined, stop.source));
    tr.append(step, make('td', undefined, stopReason(stop)), make('td', undefined, String(stop.reached)), make('td', undefined, String(stop.count)));
    table.tBodies[0].append(tr);
  }
  block.append(table);
  return block;
}

/** Show the funnel counts, editor outcomes and rules of one template. */
function templateDetail(template: TemplateCoverage, rules: ReadonlyMap<string, RunRuleCoverage>): HTMLElement {
  const body = make('div', 'host-coverage-detail');
  const placement = `Desk ${template.desk}${template.tags.length ? ` · tags ${template.tags.join(', ')}` : ''}`;
  body.append(make('p', 'host-coverage-muted', placement));
  const { funnel } = template;
  const steps: [number, string][] = [
    [funnel.partial, 'partial matches'], [funnel.matched, 'full matches'], [funnel.unprintable, 'unprintable'],
    [funnel.ineligible, 'template when false'], [funnel.zeroWeight, 'zero template weight'],
    [funnel.noVariants, 'no eligible variant'],
    [funnel.candidates, 'sent to the editor'], [template.printed, 'checks printed'],
  ];
  const list = make('ul', 'host-coverage-funnel');
  list.dataset.coverageFunnel = '';
  for (const [count, label] of steps) {
    const item = make('li');
    item.append(make('strong', undefined, String(count)), ` ${label}`);
    list.append(item);
  }
  body.append(list);
  const outcomes = unprintedOutcomes(template);
  if (outcomes.length) {
    const text = outcomes.map(([outcome, count]) => `${outcomeLabels[outcome]} ${count}`).join(', ');
    const line = make('p', undefined, `Editor outcomes: ${text}.`);
    line.dataset.coverageOutcomes = '';
    body.append(line);
  }
  const score = scoreVersusFloor(template);
  if (score) body.append(make('p', undefined, score));
  if (template.printedTurns.length) body.append(make('p', undefined, `Printed at turns ${template.printedTurns.join(', ')}.`));
  for (const id of template.rules) body.append(ruleFunnel(id, rules.get(id)));
  return body;
}

/** Mount the controls and hierarchy of the Template coverage section. */
export function mountCoverage() {
  const summary = element('#coverage-summary');
  const controlsView = element<HTMLFieldSetElement>('#coverage-controls');
  const tree = element('#coverage-tree');
  const grouping = element<HTMLSelectElement>('[data-coverage-control=grouping]');
  const tagFilter = element<HTMLSelectElement>('[data-coverage-control=tag]');
  const stageFilter = element<HTMLSelectElement>('[data-coverage-control=stage]');
  const search = element<HTMLInputElement>('[data-coverage-control=search]');
  const hidePrinted = element<HTMLInputElement>('[data-coverage-control=hide-printed]');
  const controls = readControls();
  const openGroups = new Set<string>();
  const openTemplates = new Set<string>();
  let coverage: RunCoverage | undefined;
  let rules = new Map<string, RunRuleCoverage>();

  stageFilter.append(...stagesWorstFirst.map(stage => new Option(stageLabels[stage], stage)));
  grouping.value = controls.grouping;
  stageFilter.value = controls.stage;
  hidePrinted.checked = controls.hidePrinted;

  /** Describe the covered range, editions and stage totals in one line. */
  function renderSummary(data: RunCoverage): void {
    if (!data.turns) summary.textContent = 'No checks with coverage yet. Generate editions to see where templates stop.';
    else {
      const counts = countStages(data.templates);
      summary.textContent = `Turns ${data.turns.from} to ${data.turns.to}: ${data.checks} ${data.checks === 1 ? 'check' : 'checks'}, `
        + `${data.published} ${data.published === 1 ? 'edition' : 'editions'}. `
        + `${data.templates.length} templates: ${stageCounts(counts)}.`;
    }
    if (data.uncoveredIssues > 0) {
      const count = data.uncoveredIssues;
      summary.append(make('span', 'host-coverage-note',
        ` ${count} earlier ${count === 1 ? 'edition was' : 'editions were'} made before coverage was recorded, so ${count === 1 ? 'it is' : 'they are'} not counted.`));
    }
  }

  /** Offer only the tags present in the data. */
  function renderTagOptions(data: RunCoverage): void {
    const tags = coverageTags(data);
    tagFilter.replaceChildren(new Option('All tags', ''), ...tags.map(tag => new Option(tag, tag)));
    // A saved tag this run lacks would hide every template behind an "All tags" label, so drop it.
    if (!tags.includes(controls.tag)) controls.tag = '';
    if (controls.stage && !stagesWorstFirst.includes(controls.stage)) controls.stage = '';
    tagFilter.value = controls.tag;
    stageFilter.value = controls.stage;
  }

  /** Build one template row whose rule funnels appear when it is expanded. */
  function templateRow(template: TemplateCoverage): HTMLLIElement {
    const item = make('li');
    const details = make('details', 'host-coverage-template');
    details.dataset.coverageTemplate = template.id;
    details.dataset.coverageStage = template.stage;
    details.open = openTemplates.has(template.id);
    const head = make('summary');
    head.append(make('code', undefined, template.id), ' ', stageBadge(template.stage),
      make('span', 'host-coverage-reason', templateReason(template, rules)));
    details.append(head);
    details.addEventListener('toggle', () => {
      if (details.open) openTemplates.add(template.id);
      else openTemplates.delete(template.id);
    });
    fillOnOpen(details, () => details.append(templateDetail(template, rules)));
    item.append(details);
    return item;
  }

  /** Build one group with its totals, stacked bar, and lazily built template rows. */
  function groupView(group: CoverageGroup, kind: Grouping, expand: boolean): HTMLDetailsElement {
    const key = `${kind}:${group.key}`;
    const details = make('details', 'host-coverage-group');
    details.dataset.coverageGroup = group.key;
    if (kind === 'desk') details.dataset.coverageDesk = group.key;
    details.open = expand || openGroups.has(key);
    const head = make('summary');
    const total = group.templates.length;
    head.append(make('span', 'host-coverage-name', groupLabel(group.key, kind)),
      make('span', 'host-coverage-muted', ` ${total} ${total === 1 ? 'template' : 'templates'}, ${group.unprinted} not printed `),
      stageBar(group.counts), make('span', 'host-coverage-counts', stageCounts(group.counts)));
    details.append(head);
    details.addEventListener('toggle', () => {
      if (expand) return;
      if (details.open) openGroups.add(key);
      else openGroups.delete(key);
    });
    fillOnOpen(details, () => {
      const list = make('ul', 'host-coverage-templates');
      list.append(...group.templates.map(templateRow));
      details.append(list);
    });
    return details;
  }

  /** Rebuild the hierarchy from the current data and controls. */
  function renderTree(): void {
    if (!coverage) return;
    rules = new Map(coverage.rules.map(rule => [rule.id, rule]));
    const shown = filterTemplates(coverage, controls);
    const groups = groupTemplates(shown, controls.grouping);
    const count = make('p', 'host-coverage-muted', `Showing ${shown.length} of ${coverage.templates.length} templates.`);
    count.dataset.coverageShown = String(shown.length);
    const expand = controls.search.trim() !== '';
    tree.replaceChildren(count, ...groups.map(group => groupView(group, controls.grouping, expand)));
  }

  /** Apply a control change, remember it, and redraw. */
  function update(): void {
    controls.grouping = grouping.value as Grouping;
    controls.tag = tagFilter.value;
    controls.stage = stageFilter.value as CoverageControls['stage'];
    controls.search = search.value;
    controls.hidePrinted = hidePrinted.checked;
    saveControls(controls);
    renderTree();
  }

  for (const control of [grouping, tagFilter, stageFilter, hidePrinted]) control.addEventListener('change', update);
  search.addEventListener('input', update);

  return {
    /** Show fresh run coverage while keeping the viewer's controls and open rows. */
    show(data: RunCoverage): void {
      coverage = data;
      controlsView.hidden = false;
      summary.removeAttribute('data-coverage-error');
      renderSummary(data);
      renderTagOptions(data);
      renderTree();
    },
    /** Replace the coverage with a plain message, such as an error or an empty run. */
    showMessage(text: string, error = false): void {
      coverage = undefined;
      controlsView.hidden = true;
      summary.textContent = text;
      summary.toggleAttribute('data-coverage-error', error);
      tree.replaceChildren();
    },
  };
}
