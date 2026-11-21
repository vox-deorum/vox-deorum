import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveIssue } from '../contracts/archive.js';
import type { InlineText, IssueDocument, IssueItem } from '../contracts/issue.js';
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
    const nameClass = node.isName ? ' class="vd-name"' : '';
    if (node.type === 'link') {
      const title = escapeHtml(JSON.stringify(node.target));
      if (node.target.type === 'article') return `<a${nameClass} href="#article-${encodeURIComponent(node.target.itemId)}" title="${title}">${text}</a>`;
      return `<span${nameClass} title="${title}">${text}</span>`;
    }
    return node.isName ? `<span${nameClass}>${text}</span>` : text;
  }).join('');
}

/** Render actual article prose, tables and its retained evidence references. */
function articleHtml(item: IssueItem, archive: ArchiveIssue): string {
  const record = archive.articles.find(article => article.id === item.id);
  const table = item.evidenceTable;
  return `<article id="article-${encodeURIComponent(item.id)}"><h4>${inlineHtml(item.headline)}</h4>
${item.subheadline ? `<p>${inlineHtml(item.subheadline)}</p>` : ''}
${item.body.map(paragraph => `<p>${inlineHtml(paragraph)}</p>`).join('\n')}
${item.byline ? `<p><small>${inlineHtml(item.byline)}</small></p>` : ''}
${table ? `<table><caption>${escapeHtml(table.title)}: ${escapeHtml(table.description)}</caption><thead><tr>${table.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr><th>${escapeHtml(row.label)}</th>${row.values.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>${table.footnote ? `<p>${escapeHtml(table.footnote)}</p>` : ''}` : ''}
<p><small>${inlineHtml(item.sourceNote)}</small></p>
${item.earlierReport ? `<p><a href="#article-${encodeURIComponent(item.earlierReport.target.itemId)}">${escapeHtml(item.earlierReport.label)}</a></p>${item.earlierReport.summary.map(paragraph => `<p>${inlineHtml(paragraph)}</p>`).join('')}` : ''}
${record ? `<details><summary>Article evidence and editorial identity</summary><p>${escapeHtml(record.evidenceSummary)}</p><pre>${escapeHtml(JSON.stringify({ tags: record.tags, templateIds: record.templateIds, triggerIds: record.triggerIds, sources: record.sources }, null, 2))}</pre></details>` : ''}</article>`;
}

/** Join inline nodes into plain text for headings and labels. */
function inlineText(nodes: InlineText): string {
  return nodes.map(node => node.type === 'break' ? ' ' : node.text).join('');
}

/** Show an issue's receiver, size and saved JSON files on one line. */
function issueMetaHtml(issue: IssueDocument): string {
  const turn = issue.cutoff.turn;
  return `<p class="meta"><span>${escapeHtml(issue.receiver.label)}</span><span>${escapeHtml(issue.publication.designId)}</span><span>${issue.items.length} articles</span><a href="issue-${turn}.json">Issue JSON</a><a href="audit-${turn}.json">Editorial audit and article sources</a></p>`;
}

/** Present the issue's page contents followed by every article with its evidence. */
function issueTextHtml(archive: ArchiveIssue): string {
  const issue = archive.issue;
  const contents = issue.pages.map(page => {
    const items = page.itemIds.map(id => issue.items.find(item => item.id === id)).filter((item): item is IssueItem => item !== undefined);
    return `<h3>${escapeHtml(page.label)} (${escapeHtml(page.layout)})</h3><ul>${items.map(item => `<li><a href="#article-${encodeURIComponent(item.id)}">${escapeHtml(inlineText(item.headline))}</a></li>`).join('')}</ul>`;
  }).join('\n');
  return `<div class="text"><nav>${contents}</nav>
${issue.items.map(item => articleHtml(item, archive)).join('\n')}</div>`;
}

/** Show a rendered issue's pages first and keep its text and evidence behind a disclosure. */
function renderedIssueHtml(archive: ArchiveIssue, images: NewspaperPng[]): string {
  const issue = archive.issue;
  const turn = issue.cutoff.turn;
  const pages = images.map(image => {
    const label = escapeHtml(issue.pages.find(page => page.id === image.pageId)?.label ?? image.pageId);
    const file = escapeHtml(image.file);
    return `<figure><a href="${file}"><img src="${file}" alt="Turn ${turn}, ${label}" decoding="async"></a><figcaption>${label}</figcaption></figure>`;
  }).join('\n');
  return `<section class="issue" id="turn-${turn}"><h2>Turn ${turn}: ${escapeHtml(issue.publication.title)}</h2>
${issueMetaHtml(issue)}
<div class="pages">${pages}</div>
<details><summary>Issue text and editorial evidence</summary>${issueTextHtml(archive)}</details></section>`;
}

/** Collapse an issue without page images into one line that expands to its text and evidence. */
function unrenderedIssueHtml(archive: ArchiveIssue): string {
  const issue = archive.issue;
  const turn = issue.cutoff.turn;
  return `<details class="issue" id="turn-${turn}"><summary>Turn ${turn}: ${escapeHtml(issue.publication.title)} (${issue.items.length} articles)</summary>
${issueMetaHtml(issue)}${issueTextHtml(archive)}</details>`;
}

/** Collapse the run source, settings and every editorial check into one disclosure. */
function diagnosticsHtml(manifest: NewspaperRunManifest): string {
  const { options, session } = manifest;
  return `<details class="section"><summary>Run settings and editorial checks (${manifest.counts.checks} checks, ${manifest.counts.skipped} skipped)</summary><div class="text">
<p>Source: ${escapeHtml(manifest.source.path)}<br>SHA-256: ${escapeHtml(manifest.source.sha256)}</p>
<p>Player ${options.player}; turns ${options.from} to ${options.to}; frequency ${options.every} Standard turns; comparison ${options.comparison} recorded turns.</p>
${session ? `<p>Resolved frequency: ${session.publicationIntervalTurns} recorded turns. Pace: ${escapeHtml(session.speed.label)}.</p>` : ''}
${manifest.configuration.ids.length ? `<p>Editorial configurations: ${manifest.configuration.ids.map(escapeHtml).join(', ')}</p>` : ''}
<ul>${manifest.checks.map(check => `<li>Turn ${check.turn}: ${check.issue ? `<a href="#turn-${check.turn}">${check.status}</a>` : check.status}${check.reason ? ` (${escapeHtml(check.reason)})` : ''} | <a href="${escapeHtml(check.audit)}">audit</a></li>`).join('')}</ul></div></details>`;
}

/** Open every collapsed section around a linked issue or article, including repeat clicks on the current link. */
const revealLinkedScript = `<script>
/* Decode a typed address fragment, keeping it unchanged when it is not valid percent encoding. */
function decodeFragment(id) {
  try { return decodeURIComponent(id); } catch (error) { return id; }
}
/* Open the disclosures that contain the element named by the address fragment, then show it. */
function revealLinked() {
  var id = location.hash.slice(1);
  var target = id && (document.getElementById(id) || document.getElementById(decodeFragment(id)));
  if (!target) return;
  for (var node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
  target.scrollIntoView();
}
addEventListener('hashchange', revealLinked);
/* A link to the fragment already in the address bar fires no hashchange, so reveal it directly. */
document.addEventListener('click', function (event) {
  var link = event.target instanceof Element && event.target.closest('a[href^="#"]');
  if (link && link.hash === location.hash) revealLinked();
});
revealLinked();
</script>`;

/** Build the report: rendered pages first, then collapsed run diagnostics and unrendered issue text. */
export function newspaperReportHtml(manifest: NewspaperRunManifest, issues: ArchiveIssue[]): string {
  const imagesFor = (archive: ArchiveIssue) => manifest.images.filter(image => image.turn === archive.issue.cutoff.turn);
  const rendered = issues.filter(archive => imagesFor(archive).length > 0);
  const unrendered = issues.filter(archive => imagesFor(archive).length === 0);
  const { options, counts } = manifest;
  const missing = manifest.missingRenderTurns.length
    ? `<p class="meta">Requested turns without pages: ${manifest.missingRenderTurns.map(entry => `turn ${entry.turn} (${escapeHtml(entry.reason)})`).join('; ')}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vox Deorum newspaper replay</title>
<style>
body{margin:0;padding:1.5rem clamp(1rem,3vw,2.5rem) 3rem;font:17px/1.6 Georgia,serif;color:#242424;background:#ebe9e3}
header,main{max-width:2060px;margin:0 auto}
h1{margin:0;font-size:1.5rem}
h2{margin:0;font-size:1.2rem}
.meta{display:flex;flex-wrap:wrap;gap:.2rem 1.1rem;margin:.3rem 0 0;font:14px/1.5 system-ui,sans-serif;color:#555}
.error{color:#8a1c1c;font:600 15px/1.5 system-ui,sans-serif}
.issue{margin-top:2.5rem}
.pages{display:flex;flex-wrap:wrap;align-items:flex-start;gap:1.5rem;margin-top:1rem}
.pages figure{flex:1 1 760px;max-width:1000px;margin:0}
.pages img{display:block;width:100%;height:auto;background:#fff;box-shadow:0 2px 10px rgb(0 0 0 / 18%)}
figcaption{margin-top:.4rem;font:13px/1.4 system-ui,sans-serif;color:#555}
details{margin-top:1rem}
.section{margin-top:3rem;padding-top:1rem;border-top:1px solid #bbb}
summary{cursor:pointer;color:#235789;font:15px/1.5 system-ui,sans-serif}
details.issue{margin-top:.5rem}
.text{max-width:48rem}
article{margin-top:1.25rem;padding-top:.75rem;border-top:1px solid #ccc}
article:target{outline:2px solid #d9a93f;outline-offset:6px}
.vd-name{text-decoration-line:underline;text-decoration-thickness:1px;text-underline-offset:.17em}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4rem}
a{color:#235789}
</style></head>
<body><header><h1>Vox Deorum newspaper replay</h1>
<p class="meta"><span>Player ${options.player}</span><span>Turns ${options.from} to ${options.to}</span><span>Status: ${manifest.status}</span><span>${counts.published} issues, ${counts.articles} articles</span><a href="run.json">Run manifest</a><a href="replay.sqlite">Persistent replay database</a></p>
${manifest.error ? `<p class="error" role="alert">${escapeHtml(manifest.error)}</p>` : ''}</header>
<main>${rendered.length ? rendered.map(archive => renderedIssueHtml(archive, imagesFor(archive))).join('\n') : '<p class="meta">No pages were rendered in this run.</p>'}
${missing}
${diagnosticsHtml(manifest)}
${unrendered.length ? `<details class="section"><summary>Issues without rendered pages (${unrendered.length})</summary>${unrendered.map(unrenderedIssueHtml).join('\n')}</details>` : ''}</main>
${revealLinkedScript}</body></html>\n`;
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
  let failure: { cause: unknown } | undefined;
  /** Keep the original failure if session cleanup also fails. */
  function recordFailure(error: unknown): void {
    if (failure) return;
    failure = { cause: error };
    manifest.status = 'failed';
    manifest.error = error instanceof Error ? error.message : String(error);
  }
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
    recordFailure(error);
  } finally {
    try {
      await session.close();
      signal?.throwIfAborted();
    } catch (error) {
      recordFailure(error);
    }
    await saveJson(manifestPath, manifest);
    await writeFile(path.join(options.output, 'index.html'), newspaperReportHtml(manifest, issues));
  }
  if (failure) throw failure.cause;
  return manifest;
}
