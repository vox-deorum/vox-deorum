import type { Selectable } from 'kysely';
import type { PlayerInformation } from '../knowledge/schema/public.js';
import type { CityInformation, GameEvent, PlayerSummary } from '../knowledge/schema/timed.js';
import { projectCityReportFields, projectPlayerReportFields } from '../knowledge/helpers/report-projection.js';
import { diplomaticEventSubjects, matchesEventSubject, type EventSubjects } from '../knowledge/helpers/event-subjects.js';
import { pickFields } from '../utils/fields.js';
import type { NewspaperEvent, NewspaperSnapshot, NewspaperSourceReference } from './evidence.js';

/** Historical access context supplied by the query, never by live getters. */
export interface NewspaperProjectionContext {
  receiverPlayerID: number;
  summaries: Selectable<PlayerSummary>[];
  players: Selectable<PlayerInformation>[];
}

const ownPlayerFields = [
  'Score', 'Era', 'Cities', 'Population', 'Territory', 'Gold', 'GoldPerTurn', 'HappinessPercentage',
  'GoldenAge', 'TourismPerTurn', 'CulturePerTurn', 'FaithPerTurn', 'SciencePerTurn', 'Technologies',
  'CurrentResearch', 'NextPolicyTurns', 'PolicyBranches', 'FoundedReligion', 'MajorityReligion',
  'OutgoingTradeRoutes', 'IncomingTradeRoutes'
] as const;
const foreignPlayerFields = ['Era', 'Cities', 'Population', 'CulturePerTurn', 'TourismPerTurn',
  'Technologies', 'PolicyBranches', 'FoundedReligion', 'MajorityReligion'] as const;

/** Capture original row identity and dates before metadata is discarded. */
function source(table: NewspaperSourceReference['table'], row: { ID: number; Turn: number; CreatedAt: number }): NewspaperSourceReference {
  return { table, id: row.ID, turn: row.Turn, createdAt: row.CreatedAt };
}

/** Read recorded access without the live visibility helper's missing-summary fallback. */
function visibility(row: Record<string, unknown> | undefined, receiver: number): number | undefined {
  const level = row?.[`Player${receiver}`];
  return typeof level === 'number' ? level : undefined;
}

/** Check dated contact, treating the barbarian slot as known without a national summary. */
function knowsPlayer(id: unknown, context: NewspaperProjectionContext): boolean {
  return id === 63 || (typeof id === 'number' && (visibility(context.summaries.find(row => row.Key === id), context.receiverPlayerID) ?? 0) > 0);
}

/** Get recorded diplomat strength only from a fully accessible receiver snapshot. */
function diplomatPoints(target: number, context: NewspaperProjectionContext): number {
  const receiver = context.summaries.find(row => row.Key === context.receiverPlayerID);
  if (visibility(receiver, context.receiverPlayerID) !== 2) return 0;
  return receiver?.DiplomatPoints?.[`Player${target}`] ?? 0;
}

/** Select small national facts and condition values under the row's recorded access. */
export function projectNewspaperPlayer(row: Selectable<PlayerSummary>, context: NewspaperProjectionContext): NewspaperSnapshot | undefined {
  const reference = source('PlayerSummaries', row);
  const level = visibility(row, context.receiverPlayerID);
  if (level !== 1 && level !== 2) return undefined;
  const own = row.Key === context.receiverPlayerID;
  const info = context.players.find(player => player.Key === row.Key);
  const points = diplomatPoints(row.Key, context);
  const selected = pickFields(row, own ? ownPlayerFields : foreignPlayerFields);
  const values: Record<string, unknown> = projectPlayerReportFields(selected, level, points, info?.IsMajor === 1);
  if (!Object.keys(values).length) return undefined;
  return { source: reference, subjectID: row.Key, values };
}

/** Select raw city facts under recorded basic or full access, preserving sentinel and boolean values. */
export function projectNewspaperCity(row: Selectable<CityInformation>, context: NewspaperProjectionContext): NewspaperSnapshot | undefined {
  const reference = source('CityInformations', row);
  const level = visibility(row, context.receiverPlayerID);
  if (level !== 1 && level !== 2) return undefined;
  const { Key: _key, ...values } = projectCityReportFields(row, level);
  return { source: reference, subjectID: row.Key, values };
}

/** Supported public event fields; unlisted payload fields never enter editorial input. */
const publicEventFields: Record<string, string[]> = {
  DeclareWar: ['OriginatingPlayerID', 'TargetTeamID', 'IsAggressor'],
  MakePeace: ['OriginatingPlayerID', 'TargetTeamID'],
  DealMade: ['FromPlayerID', 'ToPlayerID', 'StartTurn'],
  TeamMeet: ['CurrentTeamID', 'OtherTeamID'],
  CityCaptureComplete: ['OldOwnerID', 'NewOwnerID', 'CityID', 'CityX', 'CityY', 'Population', 'IsConquest'],
  CityFlipped: ['OldOwnerID', 'NewOwnerID', 'CityID'],
  PlayerLiberated: ['LiberatingPlayerID', 'LiberatedPlayerID', 'CityID'],
  PlayerTradeRouteCompleted: ['OriginPlayerID', 'DestinationPlayerID', 'OriginCityID', 'DestinationCityID', 'Domain', 'ConnectionType'],
  PlayerPlunderedTradeRoute: ['PlunderingPlayerID', 'OriginOwnerID', 'DestinationOwnerID', 'PlunderGoldValue'],
  TeamSetEra: ['TeamID', 'NewEra'],
  TeamTechResearched: ['TeamID', 'TechID', 'ChangeAmount'],
  TeamSetHasTech: ['TeamID', 'TechID', 'HasTech'],
  PlayerAdoptPolicy: ['PlayerID', 'PolicyID'],
  PlayerAdoptPolicyBranch: ['PlayerID', 'BranchType'],
  IdeologySwitched: ['PlayerID', 'OldBranchType', 'NewBranchType'],
  PantheonFounded: ['PlayerID', 'CityID', 'ReligionType', 'BeliefType'],
  ReligionFounded: ['PlayerID', 'HolyCityID', 'ReligionID'],
  ReligionEnhanced: ['PlayerID', 'ReligionID', 'FirstEnhancerBelief', 'SecondEnhancerBelief'],
  ReligionReformed: ['PlayerID', 'ReligionID', 'ReformationBelief'],
  CityConvertsReligion: ['OwnerID', 'ReligionID', 'CityX', 'CityY']
};

const ownerFields: Record<string, string> = {
  City: 'OwnerID', HolyCity: 'PlayerID', OriginCity: 'OriginPlayerID', DestinationCity: 'DestinationPlayerID'
};
const eventOwnerFields: Record<string, Record<string, string>> = {
  CityCaptureComplete: { City: 'NewOwnerID' },
  CityFlipped: { City: 'NewOwnerID' },
  PantheonFounded: { City: 'PlayerID' },
  PlayerPlunderedTradeRoute: { OriginCity: 'OriginOwnerID', DestinationCity: 'DestinationOwnerID' }
};

/** Resolve subject metadata for the supported technology, policy, and religion payloads. */
function eventSubjects(type: string): EventSubjects {
  if (diplomaticEventSubjects[type]) return diplomaticEventSubjects[type];
  if (type.startsWith('Team')) return { playerIdFields: [], teamIdFields: ['TeamID'] };
  return { playerIdFields: [type === 'CityConvertsReligion' ? 'OwnerID' : 'PlayerID'] };
}

/** Require historical contact with every member before returning a team's enriched identity. */
function knowsTeam(id: unknown, context: NewspaperProjectionContext): boolean {
  const members = context.players.filter(player => player.TeamID === id);
  return members.length > 0 && members.every(player => knowsPlayer(player.Key, context));
}

/** Retain only a known player's enriched public identity, without nested private fields. */
function playerIdentity(value: unknown, id: unknown, context: NewspaperProjectionContext): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (!knowsPlayer(id, context)) return undefined;
  return pickFields(row, ['Name', 'Civilization']);
}

/** Withhold every representation of deal terms when an item names an unknown player or third-party team. */
function knownDealSubjects(payload: Record<string, unknown>, context: NewspaperProjectionContext): boolean {
  const items = Array.isArray(payload.TradedItems) ? payload.TradedItems : [];
  return items.every(subject => {
    if (!subject || typeof subject !== 'object') return false;
    const row = subject as Record<string, unknown>;
    return knowsPlayer(row.FromPlayerID, context) &&
      (!['ThirdPartyWar', 'ThirdPartyPeace'].includes(row.ItemType as string) || knowsTeam(row.Data1, context));
  });
}

/** Copy the recorded structured item fields after the whole deal passes the subject gate. */
function tradeItems(value: unknown): unknown {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return [pickFields(row, ['FromPlayerID', 'ItemType', 'Data1', 'Data2', 'Data3', 'Duration'])];
  });
}

/** Project supported events using dated contact and one policy for every representation of deal terms. */
export function projectNewspaperEvent(row: Selectable<GameEvent>, context: NewspaperProjectionContext): NewspaperEvent | undefined {
  const reference = source('GameEvents', row);
  const fields = publicEventFields[row.Type];
  if (!fields || (visibility(row, context.receiverPlayerID) ?? 0) < 1) return undefined;
  const payload = row.Payload;
  const subjects = eventSubjects(row.Type);
  const receiverTeam = context.players.find(player => player.Key === context.receiverPlayerID)?.TeamID;
  const involvedWar = row.Type === 'DeclareWar' && matchesEventSubject(row.Type, payload, context.receiverPlayerID, receiverTeam);
  if (!involvedWar && (
    subjects.playerIdFields.some(field => field in payload && !knowsPlayer(payload[field], context)) ||
    subjects.teamIdFields?.some(field => field in payload && !knowsTeam(payload[field], context))
  )) return undefined;
  if (row.Type === 'PlayerAdoptPolicy' && typeof payload.PlayerID === 'number' &&
    visibility(context.summaries.find(summary => summary.Key === payload.PlayerID), context.receiverPlayerID) !== 2 &&
    diplomatPoints(payload.PlayerID, context) < 200) return undefined;

  const values: Record<string, unknown> = pickFields(payload, fields);
  // Enriched subjects are optional. Unknown identities never accompany a public event.
  for (const field of subjects.playerIdFields) {
    const key = field.replace(/ID$/, '');
    const identity = playerIdentity(payload[key], payload[field], context);
    if (identity) values[key] = identity;
  }
  // Keep supported nested city labels only with an explicitly known recorded owner.
  for (const key of ['City', 'HolyCity', 'OriginCity', 'DestinationCity']) {
    const city = payload[key] as Record<string, unknown> | null;
    if (!city || typeof city !== 'object') continue;
    const ownerField = eventOwnerFields[row.Type]?.[key] ?? ownerFields[key];
    if (knowsPlayer(payload[ownerField], context)) values[key] = pickFields(city, ['Name', 'City']);
  }
  if (row.Type === 'DealMade') {
    const parties = [payload.FromPlayerID, payload.ToPlayerID];
    const subjectsKnown = knownDealSubjects(payload, context);
    const termsPermitted = subjectsKnown && parties.every(id => knowsPlayer(id, context)) && (
      parties.includes(context.receiverPlayerID) || parties.every(id => diplomatPoints(id as number, context) >= 800)
    );
    if (termsPermitted) {
      for (const key of ['FromGives', 'ToGives']) {
        const terms = payload[key];
        if (terms === null) values[key] = null;
        else if (Array.isArray(terms) && terms.every(term => typeof term === 'string')) values[key] = [...terms];
        // Lua's empty arrays can be recorded as empty objects.
        else if (terms && typeof terms === 'object' && Object.keys(terms).length === 0) values[key] = {};
      }
      for (const key of ['TurnsRemaining', 'Duration', 'EndTurn', 'PeaceTreatyType']) {
        if (key in payload && (payload[key] === null || typeof payload[key] !== 'object')) values[key] = payload[key];
      }
      if ('TradedItems' in payload) {
        const items = tradeItems(payload.TradedItems);
        if (items !== undefined) values.TradedItems = items;
      }
    }
  }
  return { source: reference, type: row.Type, values };
}
