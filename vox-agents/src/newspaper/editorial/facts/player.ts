import {
  hasDefensivePact, isAlly, isAtWar, isFriend, isMasterOf, isVassalOf
} from '../../../../../mcp-server/dist/diplomacy/relationships.js';
import {
  eventReportTurn, type NewspaperDiplomacyGap, type NewspaperDiplomacySnapshot, type NewspaperEvent,
  type NewspaperEvidence, type NewspaperSnapshot, type NewspaperTacticalZone
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { matchesSubjects } from '../../../../../mcp-server/dist/knowledge/helpers/event-subjects.js';
import { isRecord } from '../../../utils/guards.js';
import { buildCulturalInfluenceChanges } from './cultural-influence.js';
import { eventConfig } from './event-city.js';
import { involvedSubjectSources, observedTeamId, recordedBoolean } from './event.js';
import {
  fact, recordedFact, reference, rowSources, windowFacts, type FactBuildContext, type FactObject
} from './model.js';

type Relationship = NewspaperDiplomacySnapshot['relationships'][number];
type PlayerFields = { -readonly [Field in keyof FactObject]: FactObject[Field] };
type Observation = { entry: Relationship; row: NewspaperDiplomacySnapshot; reverse?: true };

const playerFields = [
  'Score', 'Era', 'Votes', 'Technologies', 'CurrentResearch', 'PolicyBranches', 'NextPolicyTurns',
  'Cities', 'Population', 'Territory', 'Gold', 'GoldPerTurn', 'HappinessPercentage',
  'GoldenAge', 'Resources', 'OutgoingTradeRoutes', 'IncomingTradeRoutes', 'SciencePerTurn',
  'CulturePerTurn', 'FaithPerTurn', 'TourismPerTurn', 'MilitaryUnits', 'MilitarySupply',
  'MilitaryStrength', 'FoundedReligion', 'MajorityReligion', 'DiplomaticDeals'
] as const;

// An empty or non-numeric number column is a gap in the record, so it stays hidden. Text and map columns keep null for "none".
const playerNumbers = new Set<typeof playerFields[number]>([
  'Score', 'Votes', 'Cities', 'Population', 'Territory', 'Gold', 'GoldPerTurn', 'HappinessPercentage',
  'Technologies', 'NextPolicyTurns', 'SciencePerTurn', 'CulturePerTurn', 'FaithPerTurn', 'TourismPerTurn',
  'MilitaryUnits', 'MilitarySupply', 'MilitaryStrength'
]);

const cityStateFields = new Set<typeof playerFields[number]>([
  'Cities', 'Population', 'Gold', 'GoldPerTurn', 'Technologies', 'Resources'
]);

interface DiplomacyIndex {
  rows: Map<number, NewspaperDiplomacySnapshot>;
  gaps: Map<number, Set<NewspaperDiplomacyGap['kind']>>;
}

const diplomacyIndexes = new WeakMap<NewspaperEvidence, DiplomacyIndex>();

/** Index observations and limitations by their original row, independent of lookup order. */
function diplomacyIndex(evidence: NewspaperEvidence): DiplomacyIndex {
  let index = diplomacyIndexes.get(evidence);
  if (!index) {
    const history = evidence.diplomacy;
    index = {
      rows: new Map([...(history?.baseline ?? []), ...(history?.history ?? [])].map(item => [item.source.id, item])),
      gaps: new Map()
    };
    for (const gap of history?.gaps ?? []) {
      const kinds = index.gaps.get(gap.source.id) ?? new Set<NewspaperDiplomacyGap['kind']>();
      kinds.add(gap.kind);
      index.gaps.set(gap.source.id, kinds);
    }
    diplomacyIndexes.set(evidence, index);
  }
  return index;
}

/** Locate diplomacy from the exact readable summary, so a stale row cannot survive a gap. */
function diplomacyFor(row: NewspaperSnapshot, index: DiplomacyIndex): NewspaperDiplomacySnapshot | undefined {
  const observation = index.rows.get(row.source.id);
  if (observation?.subjectID === row.subjectID && observation.source.turn === row.source.turn) return observation;
  return undefined;
}

/** Find the most recent permitted observations of a pair, in either direction. */
function pairObservations(player: number, other: number, direct?: NewspaperDiplomacySnapshot,
  reciprocal?: NewspaperDiplomacySnapshot): Observation[] {
  const forward = direct?.relationships.find(entry => entry.targetPlayerID === other);
  const backward = reciprocal?.relationships.find(entry => entry.targetPlayerID === player);
  const observations: Observation[] = [];
  if (forward && direct) observations.push({ entry: forward, row: direct });
  if (backward && reciprocal) observations.push({ entry: backward, row: reciprocal, reverse: true });
  const newest = Math.max(...observations.map(({ row }) => row.source.turn));
  return observations.filter(({ row }) => row.source.turn === newest);
}

/** Derive public relationship flags and orient the war score toward the subject. */
function relationFacts(observations: Observation[]): FactObject {
  const sources = observations.map(({ row }) => row.source);
  const war = observations.some(({ entry }) => isAtWar(entry));
  const peace = observations.some(({ entry }) => entry.state === 'peace');
  const vassalOf = observations.some(({ entry, reverse }) => reverse ? isMasterOf(entry) : isVassalOf(entry));
  const masterOf = observations.some(({ entry, reverse }) => reverse ? isVassalOf(entry) : isMasterOf(entry));
  const result: PlayerFields = {
    friend: fact(observations.some(({ entry }) => isFriend(entry)), sources),
    pact: fact(observations.some(({ entry }) => hasDefensivePact(entry)), sources),
    vassalOf: fact(vassalOf && !masterOf, sources),
    masterOf: fact(masterOf && !vassalOf, sources)
  };
  if (war !== peace) result.war = fact(war, sources);
  const score = war && !peace && observations.find(({ entry }) => entry.warScore !== undefined);
  if (score && score.entry.warScore !== undefined)
    result.warScore = fact((score.reverse ? -1 : 1) * score.entry.warScore, [score.row.source]);
  return result;
}

/** Count recorded route entries from a route map; unsupported top-level values stay unknown. */
function outgoingTradeRouteCount(value: unknown): number | undefined {
  return isRecord(value) ? Object.values(value).filter(route => isRecord(route)).length : undefined;
}

/** Build one directed observation for the relationship list and the runner. */
function directedRelationship(entry: Relationship, row: NewspaperDiplomacySnapshot): FactObject {
  const result: PlayerFields = {
    ...relationFacts([{ entry, row }]),
    state: fact(entry.state, [row.source])
  };
  for (const key of ['denouncedThem', 'denouncedByThem', 'openBordersTo', 'proximity',
    'warWeariness', 'influence', 'protected'] as const) {
    if (entry[key] !== undefined) result[key] = fact(entry[key], [row.source]);
  }
  return result;
}

/** Add the target and optional standing flags to a listed directed observation. */
function listedRelationship(entry: Relationship, row: NewspaperDiplomacySnapshot): FactObject {
  const sources = [row.source];
  const result: PlayerFields = {
    ...directedRelationship(entry, row),
    player: fact(reference('player', entry.targetPlayerID), sources)
  };
  if (entry.peaceTreaty === true) result.peaceTreaty = fact(true, sources);
  if (entry.ally === true) result.ally = fact(true, sources);
  if (entry.vassal !== undefined) result.vassal = fact(entry.vassal, sources);
  if (entry.master !== undefined) result.master = fact(entry.master, sources);
  return result;
}

/** Read an ideology branch from the keys of a readable policy-branch map. */
function policyIdeology(value: unknown, ideologies: readonly string[]): string | null | undefined {
  if (value === null) return null;
  // The Lua serializer may store an empty map as an empty array.
  if (Array.isArray(value)) return value.length ? undefined : null;
  if (!isRecord(value)) return undefined;
  for (const branch of Object.keys(value)) if (ideologies.includes(branch)) return branch;
  return null;
}

/** Match the event's allowlisted player or team subjects against identity known on its date. */
function namesPlayer(event: NewspaperEvent, row: NewspaperSnapshot, context: FactBuildContext): boolean {
  const subjects = eventConfig(event.type)?.subjects;
  const observed = context.playerAt(row.subjectID, event.source.turn);
  if (!subjects || !observed) return false;
  const involved = involvedSubjectSources(event, context);
  const permitted = involved ? Object.fromEntries([...involved.keys()].map(field => [field, event.values[field]])) : event.values;
  return matchesSubjects(subjects, permitted, row.subjectID, observedTeamId(observed, context));
}

/** Build player identity, stored fields, and relationships on the snapshot's date. */
export function buildPlayerSnapshotFacts(row: NewspaperSnapshot, context: FactBuildContext): FactObject {
  const id = row.subjectID;
  const sources = rowSources(row);
  const identity = context.metadata.playerIdentities?.[id];
  const index = diplomacyIndex(context.evidence);
  const diplomacy = diplomacyFor(row, index);
  const gaps = index.gaps.get(row.source.id);
  const major = identity?.major ?? diplomacy?.isMajor;
  const teamId = identity?.teamId ?? diplomacy?.teamID;
  const fields: PlayerFields = {
    id: fact(id, sources),
    self: fact(id === context.receiverId, sources)
  };
  for (const [key, value] of Object.entries({
    name: identity?.name,
    leader: identity?.leader,
    teamId,
    major,
    cityState: major === undefined ? undefined : !major,
    human: identity?.human
  })) {
    if (value !== undefined) fields[key] = fact(value, sources);
  }
  for (const key of playerFields) {
    if (major === false && !cityStateFields.has(key)) continue;
    if (playerNumbers.has(key) && !Number.isFinite(row.values[key])) continue;
    const field = recordedFact(row.values[key], sources);
    if (field) fields[key === 'Cities' ? 'cityCount' : key[0].toLowerCase() + key.slice(1)] = field;
  }
  if (major === false && Array.isArray(row.values.QuestDeadlines) &&
      row.values.QuestDeadlines.every(turn => Number.isSafeInteger(turn) && turn >= row.source.turn)) {
    const deadlines = row.values.QuestDeadlines;
    fields.questDeadlines = fact(deadlines, sources);
    fields.questObservationTurn = fact(row.source.turn, sources);
    if (Array.isArray(row.values.QuestTerms)) {
      const terms = row.values.QuestTerms.flatMap(term => {
        if (!isRecord(term) || typeof term.deadline !== 'number' || !deadlines.includes(term.deadline) ||
            typeof term.type !== 'string' || !term.type.trim() ||
            typeof term.condition !== 'string' || !term.condition.trim()) return [];
        return [{
          deadline: term.deadline, type: term.type, condition: term.condition,
          ...(typeof term.reward === 'string' && term.reward.trim() ? { reward: term.reward } : {})
        }];
      });
      const readable = terms.length ? recordedFact(terms, sources) : undefined;
      if (readable) fields.questTerms = readable;
    }
  }
  // Keep the raw route map and infer its readable count from the same row.
  const outgoingRoutes = fields.outgoingTradeRoutes;
  const routeCount = outgoingTradeRouteCount(row.values.OutgoingTradeRoutes);
  if (outgoingRoutes && routeCount !== undefined)
    fields.outgoingTradeRouteCount = fact(routeCount, outgoingRoutes.sources);
  // Covert presence is projected only for known foreign majors. Keep a false reading distinct from absence.
  if (id !== context.receiverId && major === true) {
    for (const [stored, name] of [
      ['OurDiplomatThere', 'ourDiplomatThere'], ['TheirDiplomatHere', 'theirDiplomatHere'],
    ] as const) {
      const value = recordedBoolean(row.values[stored]);
      if (value !== undefined) fields[name] = fact(value, sources);
    }
  }
  const branches = fields.policyBranches;
  if (branches && context.ideologies) {
    const ideology = policyIdeology(branches.value, context.ideologies);
    if (ideology !== undefined) fields.ideology = fact(ideology, branches.sources);
  }
  if (diplomacy && !gaps?.has('missingRelationships')) {
    const entries = diplomacy.relationships.filter(entry => context.playerAt(entry.targetPlayerID, context.turn));
    fields.relationships = fact(entries.map(entry => listedRelationship(entry, diplomacy)), [diplomacy.source]);
  }
  const ally = diplomacy?.majorAllyPlayerID;
  if (diplomacy && (ally === null || (ally !== undefined && context.playerAt(ally, context.turn)))) {
    fields.majorAlly = fact(ally === null ? null : reference('player', ally), [diplomacy.source]);
  }
  const relations: PlayerFields = {};
  // The runner can reconcile either direction at any snapshot date without duplicating rows in history.
  if (diplomacy) for (const entry of diplomacy.relationships) {
    relations[entry.targetPlayerID] = fact(directedRelationship(entry, diplomacy), [diplomacy.source]);
  }
  // A withheld entry cannot establish any particular pair's war state by its absence.
  if (!diplomacy || [...gaps ?? []].some(kind => kind !== 'unknownRelationship'))
    relations.$gap = fact(true, sources);
  fields.relations = fact(relations);
  return fields;
}

/** Build one receiver front observation whose fields cite the recorded row they came from. */
function tacticalZoneFacts(zone: NewspaperTacticalZone): FactObject {
  const sources = [zone.source];
  const fields: PlayerFields = {
    zoneID: fact(zone.zoneID, sources),
    domain: fact(zone.domain, sources),
    posture: fact(zone.posture, sources)
  };
  if (typeof zone.city === 'string' && zone.city.trim()) fields.city = fact(zone.city, sources);
  if (zone.previousPosture) fields.previousPosture = fact(zone.previousPosture.posture, [zone.previousPosture.source]);
  const units = recordedFact(zone.units, sources);
  if (units) fields.units = units;
  return fields;
}

/** Build cutoff player facts from permitted cities, public diplomacy, and dated events. */
export function buildPlayerFacts(row: NewspaperSnapshot, context: FactBuildContext): FactObject {
  const id = row.subjectID;
  const sources = rowSources(row);
  const fields: PlayerFields = { ...buildPlayerSnapshotFacts(row, context) };
  const ownCities = context.cities.filter(city => city.values.OwnerID === id);
  const citySources = ownCities.flatMap(city => rowSources(city));
  fields.cities = fact(ownCities.map(city => reference('city', city.subjectID)), [...sources, ...citySources]);
  const capitals = ownCities.filter(city => city.values.IsCapital === true || city.values.IsCapital === 1);
  if (capitals.length === 1) fields.capital = fact(reference('city', capitals[0].subjectID), rowSources(capitals[0]));
  const distance = id === context.receiverId ? fact(0, sources) : context.playerDistance(ownCities);
  if (distance) fields.distance = distance;
  // Named technology changes and front observations are private and available at the cutoff.
  if (id === context.receiverId) {
    fields.technologyChanges = fact(Object.fromEntries((context.evidence.receiverTechnologies ?? [])
      .filter(tech => tech.source.turn <= context.turn)
      .map(tech => [tech.name, fact(tech.gained, [tech.source])])));
    const zones = (context.evidence.tacticalZones ?? [])
      .filter(zone => zone.source.turn === context.turn)
      .map(tacticalZoneFacts);
    if (zones.length) fields.tacticalZones = fact(zones);
  }
  if (id !== context.receiverId && fields.major?.value === true) {
    const changes = buildCulturalInfluenceChanges(context.evidence, id);
    if (changes) fields.culturalInfluenceChanges = changes;
  }

  const index = diplomacyIndex(context.evidence);
  const diplomacy = diplomacyFor(row, index);
  const observedPairs = new Map(context.players.filter(other => other.subjectID !== id).map(other => {
    const observations = pairObservations(id, other.subjectID, diplomacy, diplomacyFor(other, index));
    return [other.subjectID, observations] as const;
  }).filter(([, observations]) => observations.length));
  const relations = new Map([...observedPairs].map(([other, observations]) => [other, relationFacts(observations)]));
  const wars = [...relations].filter(([, relation]) => relation.war?.value === true).map(([other]) => other);
  // A readable subset can prove fighting. A negative needs a complete, unambiguous observation.
  const canRuleOutWar = diplomacy && !index.gaps.has(row.source.id) &&
    diplomacy.relationships.every(entry => relations.has(entry.targetPlayerID)) &&
    [...relations.values()].every(relation => relation.war !== undefined);
  if (wars.length || canRuleOutWar) {
    const assessedWars = [...relations.values()].flatMap(relation => relation.war?.sources ?? []);
    const warSources = [...(diplomacy ? [diplomacy.source] : []), ...assessedWars];
    fields.atWar = fact(wars.length > 0, warSources);
    fields.wars = fact(wars.map(other => reference('player', other)), warSources);
  }
  const relation = relations.get(context.receiverId);
  const flags = { enemy: 'war', friend: 'friend', vassal: 'vassalOf', master: 'masterOf' };
  for (const [name, key] of Object.entries(flags)) {
    if (id === context.receiverId) fields[name] = fact(false, sources);
    else if (relation?.[key]) fields[name] = relation[key];
  }
  const rawAlly = fields.majorAlly && diplomacy?.majorAllyPlayerID;
  const observedAlly = observedPairs.get(context.receiverId)?.some(({ entry }) => isAlly(entry));
  if (id === context.receiverId) fields.ally = fact(false, sources);
  else if (relation || rawAlly !== undefined) {
    fields.ally = fact(relation?.pact.value === true || rawAlly === context.receiverId ||
      (rawAlly === undefined && observedAlly === true),
    [...(relation?.pact.sources ?? []), ...(fields.majorAlly?.sources ?? [])]);
  }
  fields.events = windowFacts(context.events.filter(event => namesPlayer(event, row, context))
    .map(event => ({
      turn: eventReportTurn(event),
      field: fact(reference('event', event.source.id), rowSources(event))
    })), sources);
  return fields;
}
