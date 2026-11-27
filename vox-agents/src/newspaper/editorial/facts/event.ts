import { eventReportTurn, type NewspaperEvent, type NewspaperSnapshot,
  type NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { isRecord } from '../../../utils/guards.js';
import { uniqueSources } from '../shared/sources.js';
import { classifyDeal, coveringDeal } from './deal.js';
import { eventCityTargets, eventConfig, eventPlot, recordedId, resolveEventCity } from './event-city.js';
import { fact, recordedFact, reference, rowSources, type FactBuildContext, type FactField, type FactObject } from './model.js';

const actingPlayerFields: Readonly<Record<string, string>> = {
  DeclareWar: 'OriginatingPlayerID', MakePeace: 'OriginatingPlayerID', DealMade: 'FromPlayerID',
  SetAlly: 'MinorPlayerID', MinorAlliesChanged: 'MinorPlayerID', MinorFriendsChanged: 'MinorPlayerID',
  CityCaptureComplete: 'NewOwnerID', CityFlipped: 'NewOwnerID', PlayerLiberated: 'LiberatingPlayerID',
  CombatResult: 'AttackingPlayerID', UnitKilledInCombat: 'KillerPlayerID',
  PlayerTradeRouteCompleted: 'OriginPlayerID', PlayerPlunderedTradeRoute: 'PlunderingPlayerID',
  UnitPrekill: 'OwnerID',
};

/** Named great person events and the development their recorded name reports. */
const namedPersonKinds: Readonly<Record<string, string>> = {
  UnitCreated: 'born', GreatPersonExpended: 'expended', UnitPrekill: 'died',
};

type SubjectSources = Map<string, readonly NewspaperSourceReference[]>;
type TeamEvidence = { players: Set<number>; bySummaryId: Map<number, number> };
const involvedSubjectsByContext = new WeakMap<FactBuildContext, WeakMap<NewspaperEvent, SubjectSources>>();
const teamEvidenceByContext = new WeakMap<FactBuildContext, TeamEvidence>();

/** Convert a projected payload field to camel case, including acronyms such as ID. */
function camelCase(field: string): string {
  return field.replace(/^[A-Z]+(?=[A-Z][a-z]|$)|^[A-Z]/, value => value.toLowerCase())
    .replace(/ID$/, 'Id');
}

/** Make a yes-or-no fact only from a recorded boolean or its numeric equivalent. */
export function recordedBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return undefined;
}

/** Keep structured permitted deal terms available under the same naming convention. */
function payloadValue(field: string, value: unknown): unknown {
  if (field === 'Person') return typeof value === 'string' && value.trim() ? value : undefined;
  if (/^Is[A-Z]/.test(field) || ['Starting', 'HasTech', 'Passed', 'WithGold', 'WithFaith'].includes(field)) {
    return value === null ? null : recordedBoolean(value);
  }
  if (['FromGives', 'ToGives'].includes(field) && isRecord(value) && !Object.keys(value).length) return [];
  if (field === 'TradedItems' && Array.isArray(value)) return value.map(item => isRecord(item)
    ? Object.fromEntries(Object.entries(item).map(([name, detail]) => [camelCase(name), detail])) : item);
  return value;
}

/** Index team facts tied to readable player observations or static identity metadata. */
function teamEvidence(context: FactBuildContext): TeamEvidence {
  const existing = teamEvidenceByContext.get(context);
  if (existing) return existing;
  const players = new Set(Object.keys(context.metadata.playerIdentities ?? {}).map(Number));
  const bySummaryId = new Map<number, number>();
  const diplomacy = context.evidence.diplomacy;
  for (const row of [...(diplomacy?.baseline ?? []), ...(diplomacy?.history ?? [])]) {
    players.add(row.subjectID);
    bySummaryId.set(row.source.id, row.teamID);
  }
  const index = { players, bySummaryId };
  teamEvidenceByContext.set(context, index);
  return index;
}

/** Read team membership only from the dated player row or its recorded identity. */
export function observedTeamId(row: NewspaperSnapshot, context: FactBuildContext): number | undefined {
  return context.metadata.playerIdentities?.[row.subjectID]?.teamId ?? teamEvidence(context).bySummaryId.get(row.source.id);
}

/** Recognize a team from a dated member, without inferring who else belonged to it. */
function teamSources(value: unknown, turn: number, context: FactBuildContext): NewspaperSourceReference[] | undefined {
  const id = recordedId(value);
  if (id === undefined) return undefined;
  if (context.metadata.playerIdentities?.[context.receiverId]?.teamId === id) {
    const observed = context.playerAt(context.receiverId, turn);
    return observed ? rowSources(observed) : [];
  }
  for (const player of teamEvidence(context).players) {
    const observed = context.playerAt(player, turn);
    if (observed && observedTeamId(observed, context) === id) return rowSources(observed);
  }
  return undefined;
}

/** Involvement can make an event public even when one of its named subjects is still unknown. */
export function involvedSubjectSources(event: NewspaperEvent, context: FactBuildContext): SubjectSources | undefined {
  const config = eventConfig(event.type);
  if (config?.reportWhenInvolved !== true) return undefined;
  let cache = involvedSubjectsByContext.get(context);
  if (!cache) {
    cache = new WeakMap();
    involvedSubjectsByContext.set(context, cache);
  }
  const existing = cache.get(event);
  if (existing) return existing;
  const result: SubjectSources = new Map();
  const turn = event.source.turn;
  for (const field of config.subjects.playerIdFields) {
    const value = event.values[field];
    const id = recordedId(value);
    const observed = id === undefined ? undefined : context.playerAt(id, turn);
    if (observed) result.set(field, rowSources(observed));
    else if (value === -1 || id === 63 || id === context.receiverId) result.set(field, []);
  }
  for (const field of config.subjects.teamIdFields ?? []) {
    const sources = teamSources(event.values[field], turn, context);
    if (sources) result.set(field, sources);
  }
  cache.set(event, result);
  return result;
}

/** A player link requires both dated permission and a known player at the cutoff. */
export function eventPlayerFact(value: unknown, event: NewspaperEvent, context: FactBuildContext,
  sources: readonly NewspaperSourceReference[] = rowSources(event)): FactField | undefined {
  const id = recordedId(value);
  if (id === undefined || !context.players.some(player => player.subjectID === id)) return undefined;
  const observed = context.playerAt(id, event.source.turn);
  return observed ? fact(reference('player', id), [...sources, ...rowSources(observed)]) : undefined;
}

/** Build permitted fields, semantic subject references, and cutoff distance for one event. */
export function buildEventFacts(event: NewspaperEvent, context: FactBuildContext): FactObject {
  const { type, values } = event;
  const config = eventConfig(type);
  const sources = rowSources(event);
  const fields: Record<string, FactField> = Object.assign(Object.create(null), {
    type: fact(type, sources), turn: fact(eventReportTurn(event), sources)
  });
  const playerFields = config?.subjects.playerIdFields ?? [];
  const involved = involvedSubjectSources(event, context);
  const subjectFields = new Set([...playerFields, ...(config?.subjects.teamIdFields ?? [])]);
  // Enriched labels in the evidence are not substitutes for resolved subject references.
  const labelFields = new Set([...playerFields.map(field => field.slice(0, -2)), ...Object.keys(config?.cities ?? {})]);
  for (const [key, raw] of Object.entries(values)) {
    if (labelFields.has(key)) continue;
    const subjectSources = involved && subjectFields.has(key) ? involved.get(key) : [];
    if (!subjectSources) continue;
    const value = recordedFact(payloadValue(key, raw), subjectSources.length ? [...sources, ...subjectSources] : sources);
    if (value) fields[camelCase(key)] = value;
  }
  const namedKind = namedPersonKinds[type];
  if (fields.person && namedKind) fields.kind = fact(namedKind, sources);
  const deal = classifyDeal(event, context.receiverId);
  if (deal) {
    const projected = recordedFact(deal, sources);
    if (projected) fields.deal = projected;
  }
  const coveredBy = coveringDeal(event, context);
  if (coveredBy) fields.coveredByDeal = fact(coveredBy.source.id, [...sources, ...rowSources(coveredBy)]);
  const actingField = actingPlayerFields[type] ?? (playerFields.length === 1 ? playerFields[0] : undefined);
  for (const field of playerFields) {
    const player = eventPlayerFact(values[field], event, context, sources);
    if (!player) continue;
    fields[camelCase(field.slice(0, -2))] = player;
    if (field === actingField) fields.player = player;
  }
  // A single projected TeamID names the team that owns the event. Diplomatic events with
  // separately named team roles keep their own acting player above.
  const teamFields = config?.subjects.teamIdFields ?? [];
  if (teamFields.length === 1 && teamFields[0] === 'TeamID') {
    const teamId = recordedId(values.TeamID);
    if (teamId !== undefined) {
      const members = context.players.flatMap(({ subjectID }) => {
        const observed = context.playerAt(subjectID, event.source.turn);
        return observed && observedTeamId(observed, context) === teamId ? [observed] : [];
      });
      if (members.length) {
        const proof = uniqueSources([...sources, ...members.flatMap(rowSources)]);
        const links = members.map(member => reference('player', member.subjectID));
        fields.players = fact(links, proof);
        if (links.length === 1 && !fields.player) fields.player = fact(links[0], proof);
      }
    }
  }

  const { main, named } = eventCityTargets(event);
  for (const target of named) {
    const city = resolveEventCity(event, target, context);
    if (city && target.field) {
      const linked = fact(reference('city', city.subjectID), [...sources, ...rowSources(city)]);
      fields[camelCase(target.field)] = linked;
      if (target === main) fields.city = linked;
    }
  }
  if (main && !main.field) {
    const city = resolveEventCity(event, main, context);
    if (city) fields.city = fact(reference('city', city.subjectID), [...sources, ...rowSources(city)]);
  }
  const plot = eventPlot(event);
  if (plot) {
    fields.plot = fact({ x: fact(plot.x, sources), y: fact(plot.y, sources) }, sources);
    const { own } = context.distanceFromPlot(plot);
    if (own) fields.distance = fact({ own: fact(own.value, [...sources, ...own.sources ?? []]) }, sources);
  }
  fields.id = fact(event.source.id, sources);
  return fields;
}
