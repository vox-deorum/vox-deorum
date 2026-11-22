import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createReplayCliOptions, laterIssueLinkingTo, savedArchives } from '../../../helpers/newspaper-cli-replay.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';
import type { NewspaperCliOptions } from '../../../../src/newspaper/cli/options.js';
import { newspaperReportHtml, runNewspaperReplay, type NewspaperRunManifest } from '../../../../src/newspaper/cli/replay.js';
import { issueDocumentSchema } from '../../../../src/newspaper/contracts/issue.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import * as renderer from '../../../../src/newspaper/cli/render.js';

/** Count the disclosures still open at a position in the report markup. */
function enclosingDisclosures(html: string, index: number): number {
  const before = html.slice(0, index);
  return before.split('<details').length - before.split('</details>').length;
}

describe('newspaper replay command artifacts', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let options: NewspaperCliOptions;
  beforeEach(async () => {
    recording = await createReplayRecording('Epic', [6]);
    options = await createReplayCliOptions(recording.filename);
    vi.spyOn(renderer, 'renderNewspaperExamples').mockRejectedValue(new Error('Unexpected preview rendering in a mock replay test.'));
  });
  afterEach(async () => { vi.restoreAllMocks(); await recording.cleanup(); });

  it('should export editorial audits and save editions for resume without changing the source', async () => {
    const result = await runNewspaperReplay(options);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest).toEqual(result);
    expect(manifest.status).toBe('complete');
    expect(manifest.checks.map(check => check.turn)).toEqual([6, 14, 18]);
    expect(manifest.counts.published).toBeGreaterThan(0);
    expect(manifest.counts.checks).toBe(manifest.counts.published + manifest.counts.skipped);
    expect(manifest.missingRenderTurns).toEqual([{ turn: 7, reason: expect.any(String) }]);
    expect(manifest.images).toEqual([]);
    const session = new ReplaySession();
    try {
      const resumed = await session.configure({ ...manifest.session!.settings, mode: 'resume' });
      expect(resumed.cursor).toMatchObject({ cutoffTurn: 18, finished: true });
      const { issues } = await session.listIssues();
      expect(issues.map(issue => issue.issueId)).toEqual(manifest.checks.flatMap(check => check.issueId ? [check.issueId] : []));
      for (const summary of manifest.checks) {
        const audit = JSON.parse(await readFile(path.join(options.output, summary.audit), 'utf8'));
        expect(audit).toMatchObject({
          status: summary.status,
          decision: {
            cutoffTurn: summary.turn, configurationId: summary.configurationId,
            configurationSnapshot: expect.any(Object),
            triggerAudit: expect.arrayContaining([expect.objectContaining({ rule: expect.any(String) })]),
          },
        });
        if (summary.issue) {
          const issue = issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, summary.issue), 'utf8')));
          const archive = await session.getIssue(summary.issueId!);
          expect(issue).toEqual(archive.issue);
          expect(archive).not.toHaveProperty('decision');
          expect(audit.articles).toEqual(archive.articles);
          expect(archive.articles.map(article => article.id)).toEqual(archive.issue.items.map(item => item.id));
          const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
          expect(html).toContain(`href="${summary.audit}"`);
          expect(html).toContain(`id="turn-${summary.turn}"`);
          for (const item of issue.items) expect(html.split(`id="article-${encodeURIComponent(item.id)}"`)).toHaveLength(2);
          archive.issue.items[0].body = [[{ type: 'text', text: '<script>alert("unsafe")</script>' }]];
          archive.issue.items[0].byline = [{ type: 'text', text: 'By the <Arts> desk' }];
          const escaped = newspaperReportHtml(manifest, [archive]);
          expect(escaped).toContain('&lt;script&gt;');
          expect(escaped).toContain('By the &lt;Arts&gt; desk');
          expect(escaped).not.toContain('<script>alert');
        }
      }
    } finally { await session.close(); }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should show rendered pages before any disclosure and keep diagnostics and issue text collapsed', async () => {
    const manifest = await runNewspaperReplay({ ...options, renderTurns: [] });
    const [earlier] = await savedArchives(manifest);
    const later = laterIssueLinkingTo(earlier);
    const image = { turn: later.issue.cutoff.turn, pageId: later.issue.pages[0].id, file: 'later-page-1.png' };
    const html = newspaperReportHtml({ ...manifest, images: [image] }, [earlier, later]);
    const imageAt = html.indexOf(`src="${image.file}"`);
    expect(imageAt).toBeGreaterThan(-1);
    expect(imageAt).toBeLessThan(html.indexOf('<details'));
    expect(enclosingDisclosures(html, imageAt)).toBe(0);
    expect(html.indexOf(`id="turn-${later.issue.cutoff.turn}"`)).toBeLessThan(html.indexOf(`id="turn-${earlier.issue.cutoff.turn}"`));
    for (const check of manifest.checks) expect(enclosingDisclosures(html, html.indexOf(`href="${check.audit}"`))).toBeGreaterThan(0);
    for (const item of [...earlier.issue.items, ...later.issue.items]) {
      const parts = html.split(`id="article-${encodeURIComponent(item.id)}"`);
      expect(parts).toHaveLength(2);
      expect(enclosingDisclosures(html, parts[0].length)).toBeGreaterThan(0);
    }
    for (const archive of [earlier, later]) expect(html).toContain(`href="issue-${archive.issue.cutoff.turn}.json"`);
    expect(enclosingDisclosures(html, html.indexOf('href="run.json"'))).toBe(0);
    expect(html).toContain(`href="#article-${encodeURIComponent(earlier.issue.items[0].id)}"`);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('should reject a reused output directory and leave its saved artifacts unchanged', async () => {
    await runNewspaperReplay({ ...options, renderTurns: [] });
    const before = await readFile(path.join(options.output, 'run.json'));
    await expect(runNewspaperReplay(options)).rejects.toThrow();
    expect(await readFile(path.join(options.output, 'run.json'))).toEqual(before);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should preserve a failed run report when the configuration directory is missing', async () => {
    await expect(runNewspaperReplay({ ...options, config: path.join(options.output, 'missing-config') })).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: expect.any(String), counts: { checks: 0 } });
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain('href="run.json"');
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should record failure when session cleanup fails after publication', async () => {
    const cleanupError = new Error('Controlled cleanup failure');
    const close = ReplaySession.prototype.close;
    vi.spyOn(ReplaySession.prototype, 'close').mockImplementationOnce(async function (this: ReplaySession) {
      await close.call(this);
      throw cleanupError;
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [] })).rejects.toBe(cleanupError);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: cleanupError.message });
    expect(manifest.counts.published).toBeGreaterThan(0);
    for (const check of manifest.checks) {
      expect(JSON.parse(await readFile(path.join(options.output, check.audit), 'utf8')).decision.cutoffTurn).toBe(check.turn);
      if (check.issue) expect(issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, check.issue), 'utf8'))).issueId).toBe(check.issueId);
    }
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain(manifest.error);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should preserve the original failure when cleanup also fails', async () => {
    const primaryError = new Error('Controlled replay failure');
    const advance = ReplaySession.prototype.advance;
    vi.spyOn(ReplaySession.prototype, 'advance')
      .mockImplementationOnce(function (this: ReplaySession) { return advance.call(this); })
      .mockRejectedValueOnce(primaryError);
    const close = ReplaySession.prototype.close;
    const closing = vi.spyOn(ReplaySession.prototype, 'close').mockImplementationOnce(async function (this: ReplaySession) {
      await close.call(this);
      throw new Error('Controlled cleanup failure');
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [] })).rejects.toBe(primaryError);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: primaryError.message });
    expect(closing).toHaveBeenCalledOnce();
    expect(manifest.counts.published).toBeGreaterThan(0);
    for (const check of manifest.checks) {
      expect(JSON.parse(await readFile(path.join(options.output, check.audit), 'utf8')).decision.cutoffTurn).toBe(check.turn);
      if (check.issue) expect(issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, check.issue), 'utf8'))).issueId).toBe(check.issueId);
    }
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain(primaryError.message);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should retain completed PNG records and report links when a later render fails', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    vi.spyOn(renderer, 'renderNewspaperExamples').mockImplementationOnce(async (issues, directory, _signal, images = []) => {
      const issue = issues[0].issue;
      const image = { turn: issue.cutoff.turn, pageId: issue.pages[0].id, file: `issue-${issue.cutoff.turn}-page-1.png` };
      await writeFile(path.join(directory, image.file), png);
      images.push(image);
      throw new Error('Next page failed to render.');
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [6] })).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest.status).toBe('failed');
    expect(manifest.images).toHaveLength(1);
    expect(await readFile(path.join(options.output, manifest.images[0].file))).toEqual(png);
    const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
    expect(html).toContain(`src="${manifest.images[0].file}"`);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should retain a failed checkpoint and close the session when cancelled after a check', async () => {
    const controller = new AbortController();
    const advance = ReplaySession.prototype.advance;
    vi.spyOn(ReplaySession.prototype, 'advance').mockImplementationOnce(async function (this: ReplaySession, scope?: unknown, requireScope = false) {
      const result = await advance.call(this, scope, requireScope);
      controller.abort(new Error('Cancelled after one check.'));
      return result;
    });
    const close = vi.spyOn(ReplaySession.prototype, 'close');
    await expect(runNewspaperReplay(options, controller.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest).toMatchObject({ status: 'failed', counts: { checks: 1 }, session: { cursor: { cutoffTurn: 6 } } });
    const resumed = new ReplaySession();
    try {
      await resumed.configure({ ...manifest.session!.settings, mode: 'resume' });
      expect((await resumed.advance()).session.cursor.cutoffTurn).toBe(14);
    } finally { await resumed.close(); }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });
});
