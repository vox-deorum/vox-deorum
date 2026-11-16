import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveIssue } from '../contracts/archive.js';
import type { InlineText, IssueItem } from '../contracts/issue.js';
import type { ReplayState } from '../contracts/replay.js';
import { replaySourceIdentity } from '../replay/database.js';
import { ReplaySession } from '../replay/session.js';
import type { NewspaperCliOptions } from './options.js';
import { renderNewspaperExamples, type NewspaperPng } from './render.js';

/** One completed check and its saved debugging files. */
interface CheckSummary {
  turn: number;
  status: 'published' | 'skipped';
  reason?: string;
  audit: string;
  issue?: string;
  issueId?: string;
  articleCount: number;
  configurationId: string;
}

/** Portable index of the source, effective schedule and every completed editorial check. */
export interface NewspaperRunManifest {
  schemaVersion: 1;
  runId: 'examples';
  status: 'running' | 'complete' | 'failed';
  source: { path: string; sha256: string };
  options: NewspaperCliOptions;
  configuration: { directory: string | null; ids: string[] };
  session?: ReplayState;
  counts: { checks: number; published: number; skipped: number; articles: number };
  checks: CheckSummary[];
  images: NewspaperPng[];
  missingRenderTurns: { turn: number; reason: string }[];
  error?: string;
}

/** Escape all authored and recorded text before placing it in the static report. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Present inline prose while retaining typed destination details and article navigation. */
function inlineHtml(nodes: InlineText): string {
  return nodes.map(node => {
    if (node.type === 'break') return '<br>';
    const text = escapeHtml(node.text);
    if (node.type === 'strong') return `<strong>${text}</strong>`;
    if (node.type === 'emphasis') return `<em>${text}</em>`;
    if (node.type === 'link') {
      const title = escapeHtml(JSON.stringify(node.target));
      if (node.target.type === 'article') return `<a href="#article-${encodeURIComponent(node.target.itemId)}" title="${title}">${text}</a>`;
      return `<span title="${title}">${text}</span>`;
    }
    return text;
  }).join('');
}

/** Render actual article prose, tables and its retained evidence references. */
function articleHtml(item: IssueItem, archive: ArchiveIssue): string {
  const record = archive.articles.find(article => article.id === item.id);
  const table = item.evidenceTable;
  return `<article id="article-${encodeURIComponent(item.id)}"><h4>${inlineHtml(item.headline)}</h4>
${item.subheadline ? `<p>${inlineHtml(item.subheadline)}</p>` : ''}
${item.body.map(paragraph => `<p>${inlineHtml(paragraph)}</p>`).join('\n')}
${table ? `<table><caption>${escapeHtml(table.title)}: ${escapeHtml(table.description)}</caption><thead><tr>${table.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr><th>${escapeHtml(row.label)}</th>${row.values.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>${table.footnote ? `<p>${escapeHtml(table.footnote)}</p>` : ''}` : ''}
<p><small>${inlineHtml(item.sourceNote)}</small></p>
${item.earlierReport ? `<p><a href="#article-${encodeURIComponent(item.earlierReport.target.itemId)}">${escapeHtml(item.earlierReport.label)}</a></p>${item.earlierReport.summary.map(paragraph => `<p>${inlineHtml(paragraph)}</p>`).join('')}` : ''}
${record ? `<details><summary>Article evidence and editorial identity</summary><p>${escapeHtml(record.evidenceSummary)}</p><pre>${escapeHtml(JSON.stringify({ tags: record.tags, templateIds: record.templateIds, triggerIds: record.triggerIds, sources: record.sources }, null, 2))}</pre></details>` : ''}</article>`;
}

/** Build a script-free report that can be opened directly from the output directory. */
export function newspaperReportHtml(manifest: NewspaperRunManifest, issues: ArchiveIssue[]): string {
  const sections = issues.map(archive => {
    const issue = archive.issue;
    const turn = issue.cutoff.turn;
    const images = manifest.images.filter(image => image.turn === turn);
    return `<section id="turn-${turn}"><h2>Turn ${turn}: ${escapeHtml(issue.publication.title)}</h2>
<p>${escapeHtml(issue.receiver.label)} | ${escapeHtml(issue.publication.designId)} | <a href="issue-${turn}.json">Issue JSON</a> | <a href="audit-${turn}.json">Editorial audit and article sources</a></p>
${images.map(image => `<p><a href="${image.file}">PNG: ${escapeHtml(image.pageId)}</a></p><img src="${image.file}" alt="Turn ${turn}, ${escapeHtml(image.pageId)}">`).join('\n')}
<nav>${issue.pages.map(page => `<h3>${escapeHtml(page.label)} (${escapeHtml(page.layout)})</h3><ul>${page.itemIds.map(id => issue.items.find(item => item.id === id)).filter((item): item is IssueItem => item !== undefined).map(item => `<li><a href="#article-${encodeURIComponent(item.id)}">${escapeHtml(item.headline.map(node => node.type === 'break' ? ' ' : node.text).join(''))}</a></li>`).join('')}</ul>`).join('\n')}</nav>
${issue.items.map(item => articleHtml(item, archive)).join('\n')}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vox Deorum newspaper replay</title>
<style>body{max-width:1100px;margin:2rem auto;padding:0 1rem;font:17px/1.6 Georgia,serif;color:#242424;background:#faf9f5}section{border-top:2px solid #777;margin-top:2rem}article{border-bottom:1px solid #ccc;padding-bottom:1rem}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4rem}a{color:#235789}</style>
<body><h1>Vox Deorum newspaper replay</h1><p>Status: ${manifest.status}. ${manifest.counts.published} issues, ${manifest.counts.skipped} skipped checks, ${manifest.counts.articles} articles.</p>
<p>Source: ${escapeHtml(manifest.source.path)}<br>Player ${manifest.options.player}; turns ${manifest.options.from} to ${manifest.options.to}; frequency ${manifest.options.every} Standard turns; comparison ${manifest.options.comparison} recorded turns.</p>
${manifest.session ? `<p>Resolved frequency: ${manifest.session.publicationIntervalTurns} recorded turns. Pace: ${escapeHtml(manifest.session.speed.label)}.</p>` : ''}
<p><a href="run.json">Run manifest</a> | <a href="replay.sqlite">Persistent replay database</a></p>
${manifest.error ? `<p>${escapeHtml(manifest.error)}</p>` : ''}
${manifest.missingRenderTurns.length ? `<h2>Requested turns without images</h2><ul>${manifest.missingRenderTurns.map(entry => `<li>Turn ${entry.turn}: ${escapeHtml(entry.reason)}</li>`).join('')}</ul>` : ''}
<h2>Checks</h2><ul>${manifest.checks.map(check => `<li>Turn ${check.turn}: ${check.issue ? `<a href="#turn-${check.turn}">${check.status}</a>` : check.status}${check.reason ? ` (${escapeHtml(check.reason)})` : ''} | <a href="${check.audit}">audit</a></li>`).join('')}</ul>
${sections}</body></html>\n`;
}

/** Write readable JSON without permitting artifact collisions on first creation. */
async function saveJson(filename: string, value: unknown, exclusive = false): Promise<void> {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: exclusive ? 'wx' : 'w' });
}

/** Generate a sequential replay, its immutable issue artifacts and optional browser examples. */
export async function runNewspaperReplay(options: NewspaperCliOptions, signal?: AbortSignal): Promise<NewspaperRunManifest> {
  const sourcePath = await realpath(options.database);
  if (!(await stat(sourcePath)).isFile()) throw new Error('--database must name an existing recording file.');
  await mkdir(options.output, { recursive: true });
  if ((await readdir(options.output)).length) throw new Error(`Output directory is not empty: ${options.output}. Choose a new or empty directory to preserve existing results.`);
  const manifest: NewspaperRunManifest = {
    schemaVersion: 1, runId: 'examples', status: 'running', source: { path: sourcePath, sha256: await replaySourceIdentity(sourcePath) }, options,
    configuration: { directory: options.config ?? null, ids: [] },
    counts: { checks: 0, published: 0, skipped: 0, articles: 0 }, checks: [], images: [], missingRenderTurns: [],
  };
  const manifestPath = path.join(options.output, 'run.json');
  await saveJson(manifestPath, manifest, true);
  const session = new ReplaySession();
  const issues: ArchiveIssue[] = [];
  try {
    signal?.throwIfAborted();
    if (options.config && !(await stat(options.config)).isDirectory()) throw new Error('--config must name an existing catalogue overlay directory.');
    let state = await session.configure({
      databasePath: sourcePath, receiverPlayerID: options.player, fromTurn: options.from, toTurn: options.to,
      publicationInterval: options.every, durationUnit: 'recordedTurns', comparisonTurns: options.comparison,
      frequencyStandardTurns: options.every, editorialConfigDirectory: options.config, llmEnabled: false,
      publicationEnabled: true, outputPath: path.join(options.output, 'replay.sqlite'), runId: manifest.runId, mode: 'new',
    });
    manifest.session = state;
    while (!state.cursor.finished) {
      signal?.throwIfAborted();
      const result = await session.advance();
      state = result.session;
      manifest.session = state;
      if (!result.check) throw new Error('Replay returned no saved editorial check.');
      const { check } = result;
      const turn = check.decision.cutoffTurn;
      const summary: CheckSummary = { turn, status: check.status, reason: check.reason, audit: `audit-${turn}.json`, articleCount: 0, configurationId: check.decision.configurationId };
      let articles: ArchiveIssue['articles'] | undefined;
      if (check.status === 'published' && check.issue) {
        const archive = await session.getIssue(check.issue.issueId);
        summary.issue = `issue-${turn}.json`;
        summary.issueId = archive.issue.issueId;
        summary.articleCount = archive.issue.items.length;
        await saveJson(path.join(options.output, summary.issue), archive.issue, true);
        articles = archive.articles;
        issues.push(archive);
      }
      await saveJson(path.join(options.output, summary.audit), { status: check.status, reason: check.reason, decision: check.decision, articles }, true);
      manifest.checks.push(summary);
      manifest.counts.checks += 1;
      manifest.counts[check.status] += 1;
      manifest.counts.articles += summary.articleCount;
      if (!manifest.configuration.ids.includes(summary.configurationId)) manifest.configuration.ids.push(summary.configurationId);
      await saveJson(manifestPath, manifest);
    }
    signal?.throwIfAborted();
    for (const turn of options.renderTurns) {
      const check = manifest.checks.find(entry => entry.turn === turn);
      if (!check?.issue) manifest.missingRenderTurns.push({ turn, reason: check ? check.reason ?? 'The editorial check was skipped.' : 'No check fell on this recorded turn at the resolved publication frequency.' });
    }
    const requestedIssues = issues.filter(archive => options.renderTurns.includes(archive.issue.cutoff.turn));
    if (requestedIssues.length) await renderNewspaperExamples(requestedIssues, options.output, signal, manifest.images);
    signal?.throwIfAborted();
    manifest.status = 'complete';
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      await session.close();
      signal?.throwIfAborted();
    } catch (error) {
      if (manifest.status !== 'failed') {
        manifest.status = 'failed';
        manifest.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }
    finally {
      await saveJson(manifestPath, manifest);
      await writeFile(path.join(options.output, 'index.html'), newspaperReportHtml(manifest, issues));
    }
  }
  return manifest;
}
