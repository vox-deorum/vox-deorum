/**
 * @module utils/workspace/journal
 *
 * The game journal: `/workspace/game/journal.md`, an ordinary note file that agents may append to.
 * The workspace adds a `### Turn N` heading to each turn's appends, and the notes message at the
 * start of a run shows only the newest whole entries.
 */

/** Store path of the journal. */
export const journalStorePath = 'game/journal.md';

/** Characters of journal entries the notes message shows; the newest entry is always shown. */
export const journalWindow = 10000;

/** A turn heading line the workspace writes. */
const turnHeading = /^### Turn (\d+)\s*$/;

/** A Markdown heading line of level 1 to 3. */
const shallowHeading = /^#{1,3}(?=\s)/;

/** A fenced code block delimiter line. */
const fence = /^\s*(```|~~~)/;

/** Each line of a text and whether it is inside a fenced code block, counting the fence lines. */
function scanLines(text: string): Array<{ line: string; fenced: boolean }> {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (fence.test(line)) fenced = !fenced;
    return { line, fenced };
  });
}

/**
 * Split a journal into entries at turn headings outside fenced code. Text before the first heading
 * is one entry. Blank entries are dropped.
 */
function journalEntries(text: string): string[] {
  const entries: string[][] = [[]];
  for (const { line, fenced } of scanLines(text)) {
    if (!fenced && turnHeading.test(line)) entries.push([]);
    entries[entries.length - 1].push(line);
  }
  return entries.map((lines) => lines.join('\n').trim()).filter((entry) => entry !== '');
}

/** The turn of a journal's last entry, or undefined when the last entry has no turn heading. */
function lastTurn(text: string): number | undefined {
  const match = turnHeading.exec(journalEntries(text).at(-1)?.split('\n')[0] ?? '');
  return match ? Number(match[1]) : undefined;
}

/**
 * Demote level 1 to 3 headings to level 4 so they sit below the turn headings. Turn headings and
 * lines inside fenced code blocks are left alone.
 */
function demoteHeadings(text: string): string {
  return scanLines(text)
    .map(({ line, fenced }) => (fenced || turnHeading.test(line) ? line : line.replace(shallowHeading, '####')))
    .join('\n');
}

/**
 * The journal text to store after a command. When the command appended to the journal (the new
 * text starts with the old text), the appended part starts after a blank line, gets its headings
 * demoted and, when the journal does not already end in this turn's entry, a `### Turn N`
 * heading. Any other change, and any change without a known turn, is returned unchanged.
 *
 * @param before - The journal text the command started with, empty when there was none
 * @param after - The journal text the command left
 * @param turn - The command's game turn, or null when unknown
 */
export function stampJournal(before: string, after: string, turn: number | null | undefined): string {
  if (turn === null || turn === undefined || after.length <= before.length || !after.startsWith(before)) return after;
  let appended = demoteHeadings(after.slice(before.length)).replace(/^\n+/, '');
  if (lastTurn(before) !== turn && lastTurn(appended) !== turn) appended = `### Turn ${turn}\n\n${appended}`;
  const separator = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return before + separator + appended;
}

/**
 * Cut an entry to its turn heading and its newest text when it is over the cap, starting at a line
 * break where one is near.
 *
 * @returns The kept text and how many characters of the body were left out
 */
function capEntry(entry: string, cap: number): { text: string; cut: number } {
  if (entry.length <= cap) return { text: entry, cut: 0 };
  const [first, ...rest] = entry.split('\n');
  const heading = turnHeading.test(first) ? `${first}\n\n` : '';
  const body = heading ? rest.join('\n').trimStart() : entry;
  let start = Math.max(0, body.length - Math.max(0, cap - heading.length));
  const lineStart = body.indexOf('\n', start);
  if (lineStart !== -1 && lineStart < body.length - 1) start = lineStart + 1;
  return { text: heading + body.slice(start), cut: start };
}

/** The newest journal entries shown at the start of a run. */
export interface JournalTail {
  content: string;
  /** How many older entries were left out. */
  older: number;
  /** How many characters were cut from the start of the newest entry, which happens only over the cap. */
  cut: number;
}

/**
 * The newest whole entries that fit in the budget, in file order, and the number of older entries.
 * The newest entry is always kept, even when it alone is over the budget; past the cap, only its
 * heading and newest text are kept.
 *
 * @param text - The journal text
 * @param budget - Characters of entries to keep
 * @param cap - Characters of the newest entry to keep when it alone is over the budget
 * @returns Undefined when the journal has no entries
 */
export function journalTail(text: string, budget: number = journalWindow, cap: number = Infinity): JournalTail | undefined {
  const entries = journalEntries(text);
  if (entries.length === 0) return undefined;
  const newest = capEntry(entries[entries.length - 1], cap);
  const kept = [newest.text];
  let size = newest.text.length;
  for (let index = entries.length - 2; index >= 0; index--) {
    size += entries[index].length + 2;
    if (size > budget) break;
    kept.unshift(entries[index]);
  }
  return { content: kept.join('\n\n'), older: entries.length - kept.length, cut: newest.cut };
}
