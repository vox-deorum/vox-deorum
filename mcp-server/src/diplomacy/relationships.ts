/** Public relationship facts parsed from the recorded national summary format. */
export interface PublicRelationship {
  state: 'war' | 'peace' | 'unknown';
  warScore?: number;
  defensivePact?: true;
  peaceTreaty?: true;
  friendship?: true;
  ally?: true;
  vassal?: 'voluntary' | 'capitulated';
  master?: 'voluntary' | 'capitulated';
}

/** Extract public diplomatic facts, discarding influence, weariness, and other private suffixes. */
export function parseRelationship(value: unknown): PublicRelationship {
  const result: PublicRelationship = { state: 'unknown' };
  const entries = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(entries) || !entries.length || !entries.every(entry => typeof entry === 'string')) return result;
  let recognized = false;
  let unknownWar = false;
  for (const entry of entries as string[]) {
    const status = entry.replace(/ \(Influence: .*$/, '');
    const war = /^War \(Our Score: (-?\d+)%; Our War Weariness: -?\d+%\)$/.exec(entry);
    if (war || ['War', 'Permanent War', 'War - Peace Currently Blocked'].includes(status)) {
      result.state = 'war';
      if (war && Math.abs(Number(war[1])) <= 100) result.warScore = Number(war[1]);
      recognized = true;
    } else if (['Ally', 'Friends', 'Neutral'].includes(status)) {
      if (status === 'Ally') result.ally = true;
      if (status === 'Ally' || status === 'Friends') result.friendship = true;
      recognized = true;
    } else if (entry === 'Defensive Pact') {
      result.defensivePact = true;
      recognized = true;
    } else if (entry === 'Peace Treaty') {
      result.peaceTreaty = true;
      recognized = true;
    } else if (entry === 'Declaration of Friendship') {
      result.friendship = true;
      recognized = true;
    } else if (/^(?:War|Permanent War)(?: |$)/.test(entry)) {
      unknownWar = true;
    } else {
      const vassal = /^Our (Vassal|Master) \((Voluntary|Capitulated)\)$/.exec(entry);
      if (vassal) {
        result[vassal[1] === 'Vassal' ? 'vassal' : 'master'] = vassal[2] === 'Voluntary' ? 'voluntary' : 'capitulated';
        recognized = true;
      } else if (/^Distance: \S/.test(entry) || ['Open Borders', 'Research Agreement', 'Denounced Them', 'Denounced By Them'].includes(entry)) {
        recognized = true;
      }
    }
  }
  if (recognized && !unknownWar && result.state !== 'war') result.state = 'peace';
  return result;
}

/** Accept parsed facts as well as the raw entry used by summary consumers. */
function relationshipFacts(value: unknown): PublicRelationship {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'state' in value) return value as PublicRelationship;
  return parseRelationship(value);
}

/** Check whether a raw or parsed relationship explicitly reports war. */
export function isAtWar(value: unknown): boolean {
  return relationshipFacts(value).state === 'war';
}

/** Check whether a raw or parsed relationship reports friendship or a city-state alliance. */
export function isFriend(value: unknown): boolean {
  return relationshipFacts(value).friendship === true;
}

/** Check whether a raw or parsed relationship reports a city-state alliance. */
export function isAlly(value: unknown): boolean {
  return relationshipFacts(value).ally === true;
}

/** Check whether a raw or parsed relationship reports a defensive pact. */
export function hasDefensivePact(value: unknown): boolean {
  return relationshipFacts(value).defensivePact === true;
}

/** Check whether a raw or parsed relationship reports an active peace treaty. */
export function hasPeaceTreaty(value: unknown): boolean {
  return relationshipFacts(value).peaceTreaty === true;
}

/** Check whether the observing player is the target's master. */
export function isMasterOf(value: unknown): boolean {
  return relationshipFacts(value).vassal !== undefined;
}

/** Check whether the observing player is the target's vassal. */
export function isVassalOf(value: unknown): boolean {
  return relationshipFacts(value).master !== undefined;
}
