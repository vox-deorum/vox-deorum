/**
 * Read one seat's stored quest lines, accepting a raw tooltip or the normalized string array.
 * Headings and blank lines are dropped so an emptied listing becomes an empty array.
 */
function seatLines(value: unknown): string[] | undefined {
  const lines = typeof value === 'string'
    ? value.split(/\r?\n|\[NEWLINE\]/)
    : Array.isArray(value) && value.every((line): line is string => typeof line === 'string') ? value : undefined;
  if (!lines) return undefined;
  return lines.map(line => line.replace(/^(Global Quests:|Personal Quests:|Other Information:)\s*/i, '').trim())
    .filter(line => line.length > 0);
}

/**
 * Find the English numeric countdowns the quest tooltip records.
 * Current tooltips use "(Turns remaining: 3)"; older wording can put the number first.
 */
function countdownTurns(text: string): number[] {
  const turns: number[] = [];
  for (const match of text.matchAll(/\(turns remaining:\s*(\d{1,4})\s*\)|\b(\d{1,4})\s+(turns?)\s+remaining\b/gi)) {
    const remaining = Number(match[1] ?? match[2]);
    if (match[3] && (remaining === 0 || (match[3].toLowerCase() === 'turns') !== (remaining !== 1))) continue;
    turns.push(remaining);
  }
  return turns;
}

/**
 * Project the receiving major's quest deadlines from one city-state summary.
 *
 * The summary keys every major seat, but the non-EUI status helper reports the active
 * player's tooltip under each key. Attribution therefore requires at least two seats,
 * a receiver seat, and distinct text. The result is the receiver's countdowns added to
 * the observation turn, sorted and deduplicated, so the absolute deadline is an
 * approximation of the recorded countdown. An explicit empty receiver listing returns
 * an empty array; any unreadable or unverified listing returns undefined. No tooltip
 * text leaves this function.
 */
export function projectReceiverQuestDeadlines(
  quests: unknown, receiverId: number, observedTurn: number
): number[] | undefined {
  if (!Number.isSafeInteger(receiverId) || receiverId < 0 ||
      !Number.isSafeInteger(observedTurn) || observedTurn < 0) return undefined;
  if (!quests || typeof quests !== 'object' || Array.isArray(quests)) return undefined;
  const seats = new Map<number, string[]>();
  for (const [key, value] of Object.entries(quests)) {
    const match = /^Player(0|[1-9]\d*)$/.exec(key);
    if (!match) continue;
    const playerId = Number(match[1]);
    if (String(playerId) !== match[1]) continue;
    const lines = seatLines(value);
    if (lines !== undefined) seats.set(playerId, lines);
  }
  const receiver = seats.get(receiverId);
  if (receiver === undefined) return undefined;
  // The shadowed helper repeats the entire tooltip in every seat. Actual shared quests can repeat individual lines.
  const listing = receiver.join('\n');
  if (![...seats.values()].some(lines => lines.join('\n') !== listing)) return undefined;
  if (!listing || (receiver.length === 1 &&
      listing.startsWith('There are currently no quests this city-state has given to you.'))) return [];
  const deadlines = new Set<number>();
  for (const line of receiver) for (const remaining of countdownTurns(line)) {
    const deadline = observedTurn + remaining;
    if (Number.isSafeInteger(deadline) && deadline >= observedTurn) deadlines.add(deadline);
  }
  return deadlines.size ? [...deadlines].sort((a, b) => a - b) : undefined;
}
