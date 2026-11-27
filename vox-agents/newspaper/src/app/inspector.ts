/** Render replay diagnostics only when someone opens the corresponding disclosure. */
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import type { ArchiveIssue } from '../../../src/newspaper/contracts/archive.js';
import type { CandidateCoverage, CheckCoverage } from '../../../src/newspaper/contracts/coverage.js';
import type { PublishedItemRecord } from '../../../src/newspaper/contracts/publication.js';
import type { ReplayState } from '../../../src/newspaper/contracts/replay.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { inlineNodesToText } from '../reader/dom.js';
import { getCheckCoverage, getReplayCoverage, ReplayApiError } from './api.js';
import { formatScore, outcomeLabels } from './coverage-model.js';
import { mountCoverage } from './coverage-view.js';
import { element } from './dom.js';
import type { ReplaySkip } from './replay.js';

/** Losing candidates listed before the rest move behind a disclosure. */
const shownCandidates = 10;

/** A saved check's coverage, or why it could not be read. */
type CheckResult = { coverage: CheckCoverage } | { message: string };

/** Build a disclosure whose contents are only created when first opened. */
function disclosure(label: string, render: (target: HTMLDetailsElement) => void): HTMLDetailsElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.append(summary);

  /** Create details on demand and keep them available while the panel stays mounted. */
  function onToggle(): void {
    if (!details.open) return;
    render(details);
    details.removeEventListener('toggle', onToggle);
  }

  details.addEventListener('toggle', onToggle);
  return details;
}

/** Put structured diagnostic data in a preformatted block. */
function jsonView(value: unknown): HTMLPreElement {
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(value, null, 2);
  return pre;
}

/** Find the editor score of the printed candidate behind a published article. */
function printedScore(record: PublishedItemRecord, check: CheckCoverage | undefined): number | undefined {
  return check?.candidates.find(candidate => candidate.outcome === 'printed'
    && record.templateIds.includes(candidate.template)
    && (!record.subject || candidate.subject === record.subject))?.score;
}

/** Describe one printed article in a single line. */
function articleLine(record: PublishedItemRecord, headline: string, score: number | undefined): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.editionArticle = record.id;
  const title = document.createElement('strong');
  title.textContent = headline;
  const facts = [
    `template ${record.templateIds.join(', ') || 'none'}`,
    `rules ${(record.ruleIds ?? record.triggerIds).join(', ') || 'none'}`,
    record.subject && `subject ${record.subject}`,
    `importance ${formatScore(record.importance)}`,
    score !== undefined && `score ${formatScore(score)}`,
  ].filter(Boolean).join(' · ');
  item.append(title, document.createElement('br'), facts);
  return item;
}

/** Describe one candidate the editor did not print. */
function candidateLine(candidate: CandidateCoverage): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.notPrintedCandidate = candidate.id;
  item.dataset.outcome = candidate.outcome;
  const template = document.createElement('code');
  template.textContent = candidate.template;
  item.append(template, ` on ${candidate.subject}: ${outcomeLabels[candidate.outcome]}, score ${formatScore(candidate.score)}, importance ${formatScore(candidate.importance)}`);
  return item;
}

/** List the strongest losing candidates of one check, with the score printed stories needed. */
function notPrintedView(check: CheckCoverage): HTMLElement {
  const view = document.createElement('div');
  view.dataset.notPrinted = '';
  const losing = check.candidates.filter(candidate => candidate.outcome !== 'printed' && candidate.outcome !== 'merged')
    .sort((a, b) => b.score - a.score);
  const merged = check.candidates.filter(candidate => candidate.outcome === 'merged').length;
  const floor = document.createElement('p');
  floor.textContent = check.printedFloor === null ? 'Nothing printed in this check.'
    : `Printed stories needed a score of at least ${formatScore(check.printedFloor)}.`;
  if (merged) floor.textContent += ` ${merged} more ${merged === 1 ? 'candidate was' : 'candidates were'} merged into printed stories.`;
  view.append(floor);
  if (!losing.length) {
    view.append(Object.assign(document.createElement('p'), { textContent: 'Every candidate in this check was printed.' }));
    return view;
  }
  const list = document.createElement('ol');
  list.className = 'host-not-printed';
  list.append(...losing.slice(0, shownCandidates).map(candidateLine));
  view.append(list);
  const rest = losing.slice(shownCandidates);
  if (rest.length) {
    view.append(disclosure(`Show ${rest.length} more`, details => {
      const more = document.createElement('ol');
      more.className = 'host-not-printed';
      more.start = shownCandidates + 1;
      more.append(...rest.map(candidateLine));
      details.append(more);
    }));
  }
  return view;
}

/** Keep current-cutoff evidence separate from the facts that accompanied a saved edition. */
export function createDiagnostics(panel: HTMLDetailsElement) {
  const skipView = element('#check-view');
  const articles = element('#page-items');
  const cutoff = element('#evidence-view');
  const coverageSection = element('#coverage-section');
  const evidenceSection = element('#evidence-section');
  const coverage = mountCoverage();
  const checks = new Map<string, CheckResult>();
  let skips: ReplaySkip[] = [];
  let edition: ArchiveIssue | undefined;
  let evidence: NewspaperEvidence | null = null;
  let run: NewspaperArchiveScope | undefined;
  let hasRun = false;
  let coverageVersion = 0;
  let editionVersion = 0;

  coverage.showMessage('Generate editions or resume a saved run to see where templates stop.');

  /** Report whether the panel is on screen. */
  function shown(): boolean {
    return panel.open && !panel.hidden;
  }

  /** Read run-wide coverage for the active publication run. */
  async function renderCoverage(): Promise<void> {
    if (!shown()) return;
    const version = ++coverageVersion;
    if (!run) {
      coverage.showMessage(hasRun ? 'This replay does not publish editions, so there is no template coverage.'
        : 'Generate editions or resume a saved run to see where templates stop.');
      return;
    }
    try {
      const result = await getReplayCoverage(run.runId, run.receiverPlayerID);
      if (version === coverageVersion) coverage.show(result);
    } catch (error) {
      if (version === coverageVersion) coverage.showMessage(`Template coverage is unavailable: ${errorMessage(error)}`, true);
    }
  }

  /** Read one check's coverage once per run, remembering checks that have none. */
  async function readCheck(scope: NewspaperArchiveScope, turn: number): Promise<CheckResult> {
    const key = `${scope.runId}\n${scope.receiverPlayerID}\n${turn}`;
    const cached = checks.get(key);
    if (cached) return cached;
    try {
      const result = { coverage: await getCheckCoverage(turn, scope.runId, scope.receiverPlayerID) };
      checks.set(key, result);
      return result;
    } catch (error) {
      if (error instanceof ReplayApiError && error.status === 404) {
        const result = { message: 'This check has no saved coverage. It was made before coverage was recorded.' };
        checks.set(key, result);
        return result;
      }
      return { message: `Coverage for this check is unavailable: ${errorMessage(error)}` };
    }
  }

  /** Show the current batch's skipped turns and their recorded reasons. */
  function renderSkips(): void {
    if (!shown()) return;
    if (!skips.length) {
      skipView.textContent = 'No skipped checks in this batch.';
      return;
    }
    const list = document.createElement('ul');
    for (const skip of skips) {
      const item = document.createElement('li');
      item.textContent = `Turn ${skip.turn}: ${skip.reason}`;
      list.append(item);
    }
    skipView.replaceChildren(list);
  }

  /** Lay out the printed articles and, once loaded, the candidates that lost. */
  function editionBody(selected: ArchiveIssue, check: CheckResult | undefined): void {
    const { issue, articles: records } = selected;
    const byId = new Map(issue.items.map(item => [item.id, item]));
    const printed = document.createElement('ul');
    printed.className = 'host-edition-articles';
    const known = check && 'coverage' in check ? check.coverage : undefined;
    for (const record of records) {
      const item = byId.get(record.id);
      printed.append(articleLine(record, item ? inlineNodesToText(item.headline) : inlineNodesToText(record.headline), printedScore(record, known)));
    }
    const heading = document.createElement('h3');
    heading.textContent = `Not printed this check (turn ${selected.index.cutoffTurn})`;
    const losing = !check ? Object.assign(document.createElement('p'), { textContent: 'Loading candidates…' })
      : 'coverage' in check ? notPrintedView(check.coverage)
      : Object.assign(document.createElement('p'), { textContent: check.message });
    articles.replaceChildren(printed, heading, losing);
  }

  /** Summarize the paper on screen and the strongest stories that missed it. */
  async function renderEdition(): Promise<void> {
    if (!shown()) return;
    const version = ++editionVersion;
    const selected = edition;
    if (!selected) {
      articles.textContent = 'Open a recorded edition to see its articles.';
      return;
    }
    editionBody(selected, undefined);
    const { runId, receiverPlayerID, cutoffTurn } = selected.index;
    const check = await readCheck({ runId, receiverPlayerID }, cutoffTurn);
    if (version === editionVersion && selected === edition) editionBody(selected, check);
  }

  /** Show only the evidence selected by the explicit current cutoff inspection. */
  function renderCutoff(): void {
    if (!shown()) return;
    cutoff.replaceChildren();
    if (!evidence) return;
    const inspected = evidence;
    const label = document.createElement('p');
    label.textContent = `Inspected cutoff: turn ${inspected.request.cutoffTurn}.`;
    cutoff.append(label);
    if (inspected.limitations?.length) {
      const list = document.createElement('ul');
      list.dataset.evidenceLimitations = '';
      for (const text of inspected.limitations) {
        const item = document.createElement('li');
        item.textContent = text;
        list.append(item);
      }
      cutoff.append(list);
    }
    const groups = [
      ['Players', inspected.players], ['Cities', inspected.cities], ['Events', inspected.events],
      ['Tactical zones', inspected.tacticalZones], ['Receiver technologies', inspected.receiverTechnologies],
      ['Earlier players', inspected.comparisons.players], ['Earlier cities', inspected.comparisons.cities],
      ['Earlier diplomacy', inspected.diplomacy?.baseline], ['Diplomacy history', inspected.diplomacy?.history],
      ['Diplomacy gaps', inspected.diplomacy?.gaps],
      ['Congress baseline', inspected.congress?.baseline ? [inspected.congress.baseline] : []],
      ['Congress observations', inspected.congress?.observations],
    ] as const;
    for (const [name, rows] of groups) {
      if (rows?.length) cutoff.append(disclosure(`${name} (${rows.length})`, details => { details.append(jsonView(rows)); }));
    }
  }

  /** Refresh every section, refetching coverage, when the panel becomes visible. */
  function refresh(): void {
    if (!shown()) return;
    void renderCoverage();
    renderSkips();
    void renderEdition();
    renderCutoff();
  }

  panel.addEventListener('toggle', refresh);
  return {
    /** Show the trailing disclosure only in Recorded mode. */
    setVisible(visible: boolean): void {
      panel.hidden = !visible;
      if (visible) refresh();
    },
    /** Adopt a run: publication runs get coverage, evidence-only replays get the cutoff inspector. */
    setRun(state: ReplayState | undefined): void {
      hasRun = !!state;
      const evidenceOnly = !!state && (!state.runId || state.settings.publicationEnabled === false);
      run = state?.runId && !evidenceOnly ? { runId: state.runId, receiverPlayerID: state.settings.receiverPlayerID } : undefined;
      coverageSection.hidden = evidenceOnly;
      evidenceSection.hidden = !evidenceOnly;
      checks.clear();
      void renderCoverage();
    },
    /** Refetch run-wide coverage, for example after a batch of checks. */
    refreshCoverage(): void {
      void renderCoverage();
    },
    /** Stage the selected edition's stored data for inspection. */
    setEdition(selected: ArchiveIssue | undefined): void {
      edition = selected;
      void renderEdition();
    },
    /** Stage evidence from a manual inspection, or clear it when the cutoff changes. */
    setEvidence(inspected: NewspaperEvidence | null): void {
      evidence = inspected;
      renderCutoff();
    },
    /** Append a skip or clear the last batch. */
    addSkip(skip: ReplaySkip | null): void {
      if (skip) skips.push(skip);
      else skips = [];
      renderSkips();
    },
  };
}
