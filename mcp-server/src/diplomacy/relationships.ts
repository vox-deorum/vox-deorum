/** Raw proximity labels the recorder uses for a full major entry. */
export type Proximity = 'Neighbors' | 'Close' | 'Far' | 'Distant';

/** Relationship facts parsed from the recorded national summary format. */
export interface PublicRelationship {
  state: 'war' | 'peace' | 'unknown';
  warScore?: number;
  warWeariness?: number;
  proximity?: Proximity;
  influence?: number;
  protected?: boolean;
  defensivePact?: true;
  peaceTreaty?: true;
  friendship?: true;
  ally?: true;
  vassal?: 'voluntary' | 'capitulated';
  master?: 'voluntary' | 'capitulated';
  denouncedThem?: boolean;
  denouncedByThem?: true;
  openBordersTo?: boolean;
}

/** Convert a recorded distance label, omitting the recorder's Unknown placeholder. */
function proximityLabel(label: string): Proximity | undefined {
  return label === 'Neighbors' || label === 'Close' || label === 'Far' || label === 'Distant' ? label : undefined;
}

/** Parse the recorded relationship; each caller applies the appropriate visibility rules. */
export function parseRelationship(value: unknown): PublicRelationship {
  const result: PublicRelationship = { state: 'unknown' };
  const entries = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(entries) || !entries.length || !entries.every(entry => typeof entry === 'string')) return result;
  let complete = false;
  let recognized = false;
  let unknownWar = false;
  for (const entry of entries as string[]) {
    const status = entry.replace(/ \(Influence: .*$/, '');
    const cityState = /^(?:War|Permanent War|War - Peace Currently Blocked|Ally|Friends|Neutral) \(Influence: (-?\d+), Distance: (Neighbors|Close|Far|Distant|Unknown)(, Protected)?\)$/.exec(entry);
    if (cityState && Number.isSafeInteger(Number(cityState[1]))) {
      result.influence = Number(cityState[1]);
      const proximity = proximityLabel(cityState[2]);
      if (proximity) result.proximity = proximity;
      result.protected = cityState[3] !== undefined;
    }

    const war = /^War \(Our Score: (-?\d+)%; Our War Weariness: (-?\d+)%\)$/.exec(entry);
    if (war || ['War', 'Permanent War', 'War - Peace Currently Blocked'].includes(status)) {
      result.state = 'war';
      if (war) {
        const score = Number(war[1]);
        const weariness = Number(war[2]);
        if (Math.abs(score) <= 100) result.warScore = score;
        if (weariness >= 0 && weariness <= 100) result.warWeariness = weariness;
      }
    } else if (['Ally', 'Friends', 'Neutral'].includes(status)) {
      if (status === 'Ally') result.ally = true;
      if (status === 'Ally' || status === 'Friends') result.friendship = true;
    } else if (entry === 'Defensive Pact') {
      result.defensivePact = true;
    } else if (entry === 'Peace Treaty') {
      result.peaceTreaty = true;
    } else if (entry === 'Declaration of Friendship') {
      result.friendship = true;
    } else if (entry === 'Open Borders') {
      result.openBordersTo = true;
    } else if (entry === 'Denounced Them') {
      result.denouncedThem = true;
    } else if (entry === 'They Denounced Us') {
      result.denouncedByThem = true;
    } else if (entry === 'Research Agreement') {
      recognized = true;
      continue;
    } else if (/^(?:War|Permanent War)(?: |$)/.test(entry)) {
      unknownWar = true;
      continue;
    } else {
      const vassal = /^Our (Vassal|Master) \((Voluntary|Capitulated)\)$/.exec(entry);
      const distance = /^Distance: (Neighbors|Close|Far|Distant|Unknown)$/.exec(entry);
      if (vassal) {
        result[vassal[1] === 'Vassal' ? 'vassal' : 'master'] = vassal[2] === 'Voluntary' ? 'voluntary' : 'capitulated';
      } else if (distance) {
        const proximity = proximityLabel(distance[1]);
        if (proximity) result.proximity = proximity;
        // The recorder includes this line in every complete major list.
        complete = Array.isArray(value);
      } else {
        continue;
      }
    }
    recognized = true;
  }
  if (recognized && !unknownWar && result.state !== 'war') result.state = 'peace';
  if (complete) {
    result.denouncedThem ??= false;
    result.openBordersTo ??= false;
  }
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
