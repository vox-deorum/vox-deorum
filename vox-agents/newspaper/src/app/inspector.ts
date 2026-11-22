/** Render replay diagnostics only when someone opens the corresponding disclosure. */
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { ArchiveIssue } from '../../../src/newspaper/contracts/archive.js';
import { inlineNodesToText } from '../reader/dom.js';
import { element } from './dom.js';
import type { ReplaySkip } from './replay.js';

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

/** Keep current-cutoff evidence separate from the facts that accompanied a saved edition. */
export function createDiagnostics(panel: HTMLDetailsElement) {
  const skipView = element('#check-view');
  const articles = element('#page-items');
  const cutoff = element('#evidence-view');
  let skips: ReplaySkip[] = [];
  let edition: ArchiveIssue | undefined;
  let evidence: NewspaperEvidence | null = null;

  /** Show the current batch's skipped turns and their recorded reasons. */
  function renderSkips(): void {
    if (!panel.open || panel.hidden) return;
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

  /** Expose the stored article sources for the paper on screen. */
  function renderEdition(): void {
    if (!panel.open || panel.hidden) return;
    articles.replaceChildren();
    if (!edition) {
      articles.textContent = 'Open a recorded edition to see its sources.';
      return;
    }
    const { issue, articles: records } = edition;
    const byId = new Map(issue.items.map(item => [item.id, item]));
    for (const record of records) {
      const item = byId.get(record.id);
      articles.append(disclosure(item ? inlineNodesToText(item.headline) : record.id, details => {
        const note = document.createElement('p');
        note.textContent = record.evidenceSummary;
        const sources = jsonView({ templates: record.templateIds, triggers: record.triggerIds, sources: record.sources });
        sources.dataset.articleSources = record.id;
        details.append(note, sources);
      }));
    }
  }

  /** Show only the evidence selected by the explicit current cutoff inspection. */
  function renderCutoff(): void {
    if (!panel.open || panel.hidden) return;
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

  /** Refresh the trailing panels when they become visible. */
  function refresh(): void {
    renderSkips();
    renderEdition();
    renderCutoff();
  }

  panel.addEventListener('toggle', refresh);
  return {
    /** Show the trailing disclosure only in Recorded mode. */
    setVisible(visible: boolean): void {
      panel.hidden = !visible;
      if (visible) refresh();
    },
    /** Stage the selected edition's stored data for inspection. */
    setEdition(selected: ArchiveIssue | undefined): void {
      edition = selected;
      renderEdition();
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
