import { stripTags } from '../database/helpers/localized.js';

export interface ReceiverQuestTerm {
  deadline: number;
  type: string;
  condition: string;
  reward?: string;
}

const publicResources = new Set([
  'Aluminum', 'Amber', 'Citrus', 'Coal', 'Cocoa', 'Coffee', 'Copper', 'Cotton', 'Crab', 'Dyes',
  'Furs', 'Gems', 'Glass', 'Gold', 'Horses', 'Incense', 'Iron', 'Ivory', 'Jade', 'Jewelry',
  'Lapis Lazuli', 'Marble', 'Nutmeg', 'Oil', 'Olives', 'Pearls', 'Pepper', 'Perfume', 'Porcelain',
  'Salt', 'Silk', 'Silver', 'Spices', 'Sugar', 'Tea', 'Tobacco', 'Truffles', 'Uranium', 'Whales', 'Wine',
]);

const publicWonders = new Set([
  'Alhambra', 'Angkor Wat', 'Big Ben', 'Borobudur', 'Brandenburg Gate', 'Broadway', 'Chichen Itza',
  'Colossus', 'Cristo Redentor', 'Eiffel Tower', 'Forbidden Palace', 'Globe Theatre', 'Great Firewall',
  'Great Library', 'Great Lighthouse', 'Great Wall', 'Hagia Sophia', 'Hanging Gardens', 'Himeji Castle',
  'Hubble Space Telescope', 'Kremlin', 'Leaning Tower of Pisa', 'Louvre', 'Machu Picchu', 'Mausoleum of Halicarnassus',
  'Neuschwanstein', 'Notre Dame', 'Oracle', 'Panama Canal', 'Parthenon', 'Pentagon', 'Petra', 'Porcelain Tower',
  'Prora', 'Pyramids', 'Red Fort', 'Sistine Chapel', 'Statue of Liberty', 'Statue of Zeus', 'Stonehenge',
  'Sydney Opera House', 'Taj Mahal', 'Temple of Artemis', 'Terracotta Army', 'Uffizi',
]);

const publicNationalWonders = new Set(['Grand Temple', "Scrivener's Office"]);

const publicGreatPeople = new Set([
  'Great Admiral', 'Great Engineer', 'Great General', 'Great Merchant', 'Great Musician',
  'Great Scientist', 'Great Writer',
]);

const rewardYields = new Set([
  'Influence', 'Gold', 'Science', 'Culture', 'Faith', 'Golden Age Points',
  'Food in Capital', 'Production in Capital', 'Happiness in Capital', 'Tourism with all known Civilizations',
  'Great People Points in Capital', 'Great Person Points in all Cities',
  'Great General Points', 'Great Admiral Points', 'Experience for all Military Units',
]);

const fixedObjectives = new Map([
  ['They want you to start a land or sea trade route to their city.', {
    type: 'Establish a trade route', condition: 'Start a land or sea trade route to the city-state.',
  }],
  ['Diplomatic Missions are temporarily more effective.', {
    type: 'Diplomatic mission bonus', condition: 'Use diplomatic missions while they are more effective.',
  }],
  ['Protect them from a barbarian horde! If there are barbarians next to the city when the quest ends, the city will be sacked!', {
    type: 'Protect the city-state', condition: 'Keep barbarians away from the city when the quest ends.',
  }],
]);

/**
 * Read one seat's stored quest lines, accepting a raw tooltip or the normalized string array.
 * Headings and blank lines are dropped so an emptied listing becomes an empty array.
 */
function seatLines(value: unknown): string[] | undefined {
  const lines = typeof value === 'string'
    ? [value]
    : Array.isArray(value) && value.every((line): line is string => typeof line === 'string') ? value : undefined;
  if (!lines) return undefined;
  return lines.flatMap(line => (stripTags(line) ?? '').split(/\r?\n/))
    .map(line => line.replace(/^(Global Quests:|Personal Quests:|Other Information:)\s*/i, '').trim())
    .filter(line => line.length > 0);
}

/** Compare the full listings without letting differences in display formatting prove attribution. */
function listingSignature(lines: string[]): string {
  return lines.join('').normalize('NFC').replace(/[\s*•]/g, '').toLowerCase();
}

/** Read only fully matched reward bullets starting at the tooltip's reward heading. */
function questReward(text: string, entireText = false): string | undefined {
  const heading = /^\s*Potential Quest Reward:\s*/.exec(text);
  if (!heading) return undefined;
  const body = text.slice(heading[0].length);
  const bullets = (entireText ? body : body.split(/\n(?!\s*\*)/, 1)[0]).trim();
  if (!bullets.startsWith('*')) return undefined;
  const rewards: string[] = [];
  for (const bullet of bullets.slice(1).split('*')) {
    const match = /^\s*([1-9]\d{0,9})\s+(.+?)\s*$/.exec(bullet);
    if (!match) return undefined;
    if (rewardYields.has(match[2])) {
      rewards.push(`${match[1]} ${match[2]}`);
      continue;
    }
    const juggernaut = /^Juggernaut (Units?)\s*\((0|[1-9]\d{0,9}) Bonus XP\)$/.exec(match[2]);
    if (!juggernaut || (juggernaut[1] === 'Unit') !== (match[1] === '1')) return undefined;
    rewards.push(`${match[1]} Juggernaut ${juggernaut[1]} (${juggernaut[2]} Bonus XP)`);
  }
  return rewards.join(', ');
}

/** Recognize complete objectives immediately before a countdown, with no custom names or free text. */
function questObjective(text: string): { start: number; type: string; condition: string } | undefined {
  const match = /(They want you to [^.\n]+\.|Diplomatic Missions are temporarily more effective\.|Protect them from a barbarian horde! If there are barbarians next to the city when the quest ends, the city will be sacked!)\s*$/.exec(text);
  if (!match) return undefined;
  const prefix = text.slice(0, match.index);
  const linePrefix = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (!/^\s*\*?\s*$/.test(linePrefix) &&
      !questReward(prefix.trimEnd().replace(/\*$/, ''), true)) return undefined;
  const start = /\*\s*$/.test(prefix) ? prefix.lastIndexOf('*') : match.index;
  const fixed = fixedObjectives.get(match[1]);
  if (fixed) return { start, ...fixed };
  const resource = /^They want you to connect (.+) to your trade network\.$/.exec(match[1])?.[1];
  if (resource && publicResources.has(resource)) {
    return { start, type: 'Connect a resource', condition: `Connect ${resource} to your trade network.` };
  }
  const wonder = /^They want you to build (.+)\.$/.exec(match[1])?.[1];
  if (wonder && publicWonders.has(wonder)) return { start, type: 'Build a wonder', condition: `Build ${wonder}.` };
  if (wonder?.startsWith('the ') && publicNationalWonders.has(wonder.slice(4))) {
    return { start, type: 'Build a national wonder', condition: `Build ${wonder}.` };
  }
  const person = /^They want you to generate a (.+)\.$/.exec(match[1])?.[1];
  if (person && publicGreatPeople.has(person)) {
    return { start, type: 'Generate a Great Person', condition: `Generate a ${person}.` };
  }
  return undefined;
}

/**
 * Project the receiving major's quest deadlines and recognized terms from one city-state summary.
 *
 * The summary keys every major seat, but the non-EUI status helper reports the active
 * player's tooltip under each key. Attribution therefore requires at least two seats,
 * a receiver seat, and distinct text. The result is the receiver's countdowns added to
 * the observation turn, sorted and deduplicated, so the absolute deadline is an
 * approximation of the recorded countdown. An explicit empty receiver listing returns
 * empty arrays; any unreadable or unverified listing returns undefined.
 */
export function projectReceiverQuests(
  quests: unknown, receiverId: number, observedTurn: number
): { deadlines: number[]; terms: ReceiverQuestTerm[] } | undefined {
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
  const signature = listingSignature(receiver);
  if (![...seats.values()].some(lines => listingSignature(lines) !== signature)) return undefined;
  const listing = receiver.join('\n');
  if (!listing || (receiver.length === 1 &&
      listing.startsWith('There are currently no quests this city-state has given to you.'))) return { deadlines: [], terms: [] };
  const deadlines = new Set<number>();
  const terms: ReceiverQuestTerm[] = [];
  // Split even at rejected countdowns so their surrounding text cannot attach to a neighboring quest.
  const countdowns = [...listing.matchAll(/\(turns remaining:[^()\n]*\)|\b\d+[ \t]+turns?[ \t]+remaining\b/gi)];
  const chunks = countdowns.map((match, index) => {
    const previous = countdowns[index - 1];
    return listing.slice(previous ? previous.index + previous[0].length : 0, match.index);
  });
  const objectives = chunks.map(questObjective);
  for (const [index, countdown] of countdowns.entries()) {
    const match = /^(?:\(turns remaining:[ \t]*(\d{1,4})[ \t]*\)|(\d{1,4})[ \t]+(turns?)[ \t]+remaining)$/i.exec(countdown[0]);
    if (!match) continue;
    const remaining = Number(match[1] ?? match[2]);
    if (match[3] && (remaining === 0 || (match[3].toLowerCase() === 'turns') !== (remaining !== 1))) continue;
    const deadline = observedTurn + remaining;
    if (!Number.isSafeInteger(deadline)) continue;
    deadlines.add(deadline);
    const objective = objectives[index];
    if (!objective) continue;
    const following = chunks[index + 1] ?? listing.slice(countdown.index + countdown[0].length);
    const reward = questReward(following.slice(0, objectives[index + 1]?.start));
    terms.push({ deadline, type: objective.type, condition: objective.condition, ...(reward && { reward }) });
  }
  return deadlines.size ? { deadlines: [...deadlines].sort((a, b) => a - b), terms } : undefined;
}

/** Project just the deadlines for callers that do not need recognized quest terms. */
export function projectReceiverQuestDeadlines(
  quests: unknown, receiverId: number, observedTurn: number
): number[] | undefined {
  return projectReceiverQuests(quests, receiverId, observedTurn)?.deadlines;
}
