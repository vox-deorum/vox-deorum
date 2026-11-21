import path from 'node:path';
import { parseNewspaperOptions } from '../../src/newspaper/cli/options.js';
import type { NewspaperRunManifest } from '../../src/newspaper/cli/replay.js';
import type { ArchiveIssue } from '../../src/newspaper/contracts/archive.js';
import { ReplaySession } from '../../src/newspaper/replay/session.js';
import { writeReplayPublicationCatalogue } from './newspaper-replay.js';

/** Prepare the catalogue and command options shared by the CLI replay tests. */
export async function createReplayCliOptions(filename: string) {
  const catalogue = await writeReplayPublicationCatalogue(filename);
  return parseNewspaperOptions(['--database', filename, '--output', path.join(path.dirname(filename), 'examples'),
    '--config', catalogue, '--player', '0', '--from', '6', '--to', '18', '--render-turns', '7'])!;
}

/** Read the published archives saved by a completed replay run. */
export async function savedArchives(manifest: NewspaperRunManifest): Promise<ArchiveIssue[]> {
  const session = new ReplaySession();
  try {
    await session.configure({ ...manifest.session!.settings, mode: 'resume' });
    const archives: ArchiveIssue[] = [];
    for (const check of manifest.checks) if (check.issueId) archives.push(await session.getIssue(check.issueId));
    return archives;
  } finally { await session.close(); }
}

/** Copy a saved issue to a later turn whose first article links back to the first article of the original. */
export function laterIssueLinkingTo(earlier: ArchiveIssue): ArchiveIssue {
  const later = structuredClone(earlier);
  const turn = earlier.issue.cutoff.turn + 100;
  const rename = (id: string) => `${id}/later`;
  later.issue.issueId = rename(earlier.issue.issueId);
  later.issue.cutoff = { turn, label: `Turn ${turn}` };
  later.issue.items = later.issue.items.map(item => ({ ...item, id: rename(item.id) }));
  later.issue.pages = later.issue.pages.map(page => ({ ...page, itemIds: page.itemIds.map(rename) }));
  later.articles = later.articles.map(article => ({ ...article, id: rename(article.id) }));
  later.issue.items[0].earlierReport = {
    label: 'Earlier report',
    target: { type: 'article', issueId: earlier.issue.issueId, itemId: earlier.issue.items[0].id },
    summary: [[{ type: 'text', text: 'Earlier summary' }]],
  };
  return later;
}
