import path from 'node:path';

/** Local recording and isolated output settings accepted by the replay command. */
export interface NewspaperCliOptions {
  database: string;
  output: string;
  player: number;
  from: number;
  to: number;
  every: number;
  comparison: number;
  config?: string;
  renderTurns: number[];
}

export const newspaperCliHelp = `Generate offline newspaper examples from a saved recording.

Usage: npm run newspaper -w vox-agents -- --database <recording.sqlite> --output <directory> --player <0-21> --to <turn>

  --database <path>       Existing recording, opened read-only
  --output <directory>    New or empty directory for replay.sqlite, JSON and index.html
  --player <0-21>         Receiving player ID
  --from <turn>           First check, default 0
  --to <turn>             Final check (inclusive)
  --every <turns>         Publication frequency in Standard turns, default 5
  --comparison <turns>    Comparison window in recorded turns, default 10
  --config <directory>   Editorial catalogue overlay directory
  --render-turns <list>   Comma-separated published turns to capture as PNGs
  --help                 Show this help

Replay checks run sequentially from --from through --to, preserving editorial history.
The command builds MCP queries and, for PNG capture, reader assets automatically.
PNG capture requires installed Edge or Chrome.
Relative paths resolve from the directory where npm was invoked.
`;

/** Parse an explicit nonnegative integer without accepting partial or rounded values. */
function integer(value: string, flag: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires an integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${flag} must be between ${minimum} and ${maximum}.`);
  return number;
}

/** Validate command flags before opening any recording or creating output files. */
export function parseNewspaperOptions(args: string[], directory = process.env.INIT_CWD ?? process.cwd()): NewspaperCliOptions | undefined {
  const allowed = new Set(['database', 'output', 'player', 'from', 'to', 'every', 'comparison', 'config', 'render-turns']);
  const values = new Map<string, string>();
  if (args.length === 1 && args[0] === '--help') return undefined;
  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index];
    const key = argument.startsWith('--') ? argument.slice(2) : '';
    if (!allowed.has(key)) throw new Error(`Unknown option ${argument}. Use --help for usage.`);
    if (values.has(key)) throw new Error(`Option ${argument} was supplied twice.`);
    const value = args[index + 1];
    if (!value?.trim() || value.startsWith('--')) throw new Error(`Option ${argument} requires a value.`);
    values.set(key, value);
  }
  for (const required of ['database', 'output', 'player', 'to']) {
    if (!values.has(required)) throw new Error(`Missing --${required}. Use --help for usage.`);
  }
  const from = integer(values.get('from') ?? '0', '--from');
  const to = integer(values.get('to')!, '--to');
  if (from > to) throw new Error('--from must be at most --to.');
  const renderTurns = values.has('render-turns')
    ? [...new Set(values.get('render-turns')!.split(',').map(value => integer(value.trim(), '--render-turns')))]
    : [];
  if (renderTurns.some(turn => turn < from || turn > to)) throw new Error('--render-turns must fall within --from and --to.');
  return {
    database: path.resolve(directory, values.get('database')!), output: path.resolve(directory, values.get('output')!),
    player: integer(values.get('player')!, '--player', 0, 21), from, to,
    every: integer(values.get('every') ?? '5', '--every', 1),
    comparison: integer(values.get('comparison') ?? '10', '--comparison'),
    ...(values.has('config') ? { config: path.resolve(directory, values.get('config')!) } : {}), renderTurns,
  };
}
