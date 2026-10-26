/** Export the current game notes from every seat workspace database in a folder. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from '../../vox-agents/src/utils/workspace/workspace-store.js';
import { diskSink } from '../../vox-agents/src/utils/workspace/materialize.js';

const usage = 'Usage: node --import tsx scripts/utilities/extract-agent-notes.ts <input-folder> <output-folder>';

/** Find SQLite databases recursively, keeping their relative folders in a stable order. */
function databaseFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return databaseFiles(target);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.db') ? [target] : [];
  }).sort();
}

/** Export only game notes from a consistent view of the current workspace head. */
function extractNotes(database: string, output: string): { commit: number; files: string[] } {
  const store = WorkspaceStore.open(database, { readonly: true });
  try {
    return store.readTransaction(() => {
      const commit = store.head();
      const sink = diskSink(output);
      const files: string[] = [];
      const entries = [...store.manifest(commit)]
        .filter(([name]) => name === 'game' || name.startsWith('game/'))
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      for (const [name, entry] of entries) {
        if (entry.type !== 'file') continue;
        sink.file(name, store.readBlob(entry.hash), entry.mode, entry.mtime);
        files.push(name);
      }
      for (const [name, entry] of entries.reverse()) {
        if (entry.type === 'dir') sink.directory(name, entry.mode, entry.mtime);
      }
      return { commit, files };
    });
  } finally {
    store.close();
  }
}

/** Extract a folder of databases into a new or empty destination and record every result. */
export function extractAgentNotes(inputFolder: string, outputFolder: string) {
  const input = fs.realpathSync(inputFolder);
  const output = path.resolve(outputFolder);
  const databases = databaseFiles(input);
  if (!databases.length) throw new Error(`No .db files found in ${input}`);
  diskSink(output);
  const results = databases.map(database => {
    const source = path.relative(input, database).split(path.sep).join('/');
    const destination = source.replace(/\.db$/i, '');
    try {
      if (!WorkspaceStore.hasStore(database)) return { source, status: 'skipped' as const };
      const notes = extractNotes(database, path.join(output, destination));
      return { source, status: 'exported' as const, destination, ...notes };
    } catch (error) {
      return { source, status: 'error' as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const summary = {
    input,
    output,
    databases: databases.length,
    exported: results.filter(result => result.status === 'exported').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    errors: results.filter(result => result.status === 'error').length,
    files: results.reduce((total, result) => total + (result.status === 'exported' ? result.files.length : 0), 0),
    results,
  };
  fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

/** Run the extraction command and report failures with a nonzero exit status. */
function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (args.length !== 2) throw new Error(usage);
  const summary = extractAgentNotes(args[0], args[1]);
  process.stdout.write(`Exported ${summary.files} files from ${summary.exported} databases; skipped ${summary.skipped}; errors ${summary.errors}.\n${summary.output}\n`);
  if (summary.errors) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`extract-agent-notes: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
