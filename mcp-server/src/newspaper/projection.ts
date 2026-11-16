import type { Selectable } from 'kysely';
import type { PlayerInformation } from '../knowledge/schema/public.js';
import type { CityInformation, GameEvent, PlayerSummary } from '../knowledge/schema/timed.js';
import { projectCityReportFields, projectPlayerReportFields } from '../knowledge/helpers/report-projection.js';
import { diplomaticEventSubjects, matchesSubjects, type EventSubjects } from '../knowledge/helpers/event-subjects.js';
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

/** Private deal terms, reported to a party or when the receiver has strong insight into every party. */
export interface DealTermsConfig {
  /** Party ID fields. Terms need every party known, and the receiver among them or above the diplomat threshold. */
  partyFields: string[];
  /** Diplomat points the receiver needs with every party to read terms of a deal it is not in. */
  diplomatPoints: number;
  /** Readable term lists, copied only when every entry is text. */
  textFields: string[];
  /** Scalar term fields such as durations. */
  scalarFields: string[];
  /** Structured traded items and the subjects each item names. */
  items: {
    field: string;
    fields: string[];
    playerField: string;
    /** Item types whose team field names a third party the receiver must know. */
    teamItemTypes: string[];
    teamField: string;
  };
}

/** How one supported event type becomes newspaper evidence. Event types without a config are never reported. */
export interface NewspaperEventConfig {
  /** Payload fields copied into evidence. Unlisted payload fields never enter editorial input. */
  fields: string[];
  /** Player and team ID fields naming the event's subjects, which the receiver must have met. */
  subjects: EventSubjects;
  /** Report the event when the receiver or its team is a subject, even if another subject is unmet. */
  reportWhenInvolved?: boolean;
  /** Extra gate: full receiver access to this subject player, or at least this many diplomat points with them. */
  insight?: { playerField: string; diplomatPoints: number };
  /** Nested city labels, keyed by payload object, with the payload field naming that city's owner. */
  cities?: Record<string, string>;
  /** Private terms, copied only when the deal policy allows. */
  dealTerms?: DealTermsConfig;
}

/** Subjects for events naming a single player. */
const playerSubject: EventSubjects = { playerIdFields: ['PlayerID'] };
/** Subjects for events naming a single team. */
const teamSubject: EventSubjects = { playerIdFields: [], teamIdFields: ['TeamID'] };

/** Newspaper reporting policy for every supported event type. War and peace share one policy. */
export const newspaperEventConfigs: Record<string, NewspaperEventConfig> = {
  DeclareWar: {
    fields: ['OriginatingPlayerID', 'TargetTeamID', 'IsAggressor'],
    subjects: diplomaticEventSubjects.DeclareWar,
    reportWhenInvolved: true
  },
  MakePeace: {
    fields: ['OriginatingPlayerID', 'TargetTeamID'],
    subjects: diplomaticEventSubjects.MakePeace,
    reportWhenInvolved: true
  },
  DealMade: {
    fields: ['FromPlayerID', 'ToPlayerID', 'StartTurn'],
    subjects: diplomaticEventSubjects.DealMade,
    dealTerms: {
      partyFields: ['FromPlayerID', 'ToPlayerID'],
      diplomatPoints: 800,
      textFields: ['FromGives', 'ToGives'],
      scalarFields: ['TurnsRemaining', 'Duration', 'EndTurn', 'PeaceTreatyType'],
      items: {
        field: 'TradedItems',
        fields: ['FromPlayerID', 'ItemType', 'Data1', 'Data2', 'Data3', 'Duration'],
        playerField: 'FromPlayerID',
        teamItemTypes: ['ThirdPartyWar', 'ThirdPartyPeace'],
        teamField: 'Data1'
      }
    }
  },
  TeamMeet: { fields: ['CurrentTeamID', 'OtherTeamID'], subjects: diplomaticEventSubjects.TeamMeet },
  CityCaptureComplete: {
    fields: ['OldOwnerID', 'NewOwnerID', 'CityID', 'CityX', 'CityY', 'Population', 'IsConquest'],
    subjects: diplomaticEventSubjects.CityCaptureComplete,
    cities: { City: 'NewOwnerID' }
  },
  CityFlipped: {
    fields: ['OldOwnerID', 'NewOwnerID', 'CityID'],
    subjects: diplomaticEventSubjects.CityFlipped,
    cities: { City: 'NewOwnerID' }
  },
  // The liberated city's recorded owner at event time is unknown, so its label is not kept.
  PlayerLiberated: {
    fields: ['LiberatingPlayerID', 'LiberatedPlayerID', 'CityID'],
    subjects: diplomaticEventSubjects.PlayerLiberated
  },
  PlayerTradeRouteCompleted: {
    fields: ['OriginPlayerID', 'DestinationPlayerID', 'OriginCityID', 'DestinationCityID', 'Domain', 'ConnectionType'],
    subjects: diplomaticEventSubjects.PlayerTradeRouteCompleted,
    cities: { OriginCity: 'OriginPlayerID', DestinationCity: 'DestinationPlayerID' }
  },
  PlayerPlunderedTradeRoute: {
    fields: ['PlunderingPlayerID', 'OriginOwnerID', 'DestinationOwnerID', 'PlunderGoldValue'],
    subjects: diplomaticEventSubjects.PlayerPlunderedTradeRoute,
    cities: { OriginCity: 'OriginOwnerID', DestinationCity: 'DestinationOwnerID' }
  },
  TeamSetEra: { fields: ['TeamID', 'NewEra'], subjects: teamSubject },
  TeamTechResearched: { fields: ['TeamID', 'TechID', 'ChangeAmount'], subjects: teamSubject },
  TeamSetHasTech: { fields: ['TeamID', 'TechID', 'HasTech'], subjects: teamSubject },
  PlayerAdoptPolicy: {
    fields: ['PlayerID', 'PolicyID'],
    subjects: playerSubject,
    insight: { playerField: 'PlayerID', diplomatPoints: 200 }
  },
  PlayerAdoptPolicyBranch: { fields: ['PlayerID', 'BranchType'], subjects: playerSubject },
  IdeologySwitched: { fields: ['PlayerID', 'OldBranchType', 'NewBranchType'], subjects: playerSubject },
  PantheonFounded: {
    fields: ['PlayerID', 'CityID', 'ReligionType', 'BeliefType'],
    subjects: playerSubject,
    cities: { City: 'PlayerID' }
  },
  ReligionFounded: {
    fields: ['PlayerID', 'HolyCityID', 'ReligionID'],
    subjects: playerSubject,
    cities: { HolyCity: 'PlayerID' }
  },
  ReligionEnhanced: { fields: ['PlayerID', 'ReligionID', 'FirstEnhancerBelief', 'SecondEnhancerBelief'], subjects: playerSubject },
  ReligionReformed: { fields: ['PlayerID', 'ReligionID', 'ReformationBelief'], subjects: playerSubject },
  CityConvertsReligion: {
    fields: ['OwnerID', 'ReligionID', 'CityX', 'CityY'],
    subjects: { playerIdFields: ['OwnerID'] },
    cities: { City: 'OwnerID' }
  }
};

/** Require historical contact with every member before treating a team as known. */
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

/** Check that the receiver has met every player and team the event names. */
function knowsSubjects(subjects: EventSubjects, payload: Record<string, unknown>, context: NewspaperProjectionContext): boolean {
  return subjects.playerIdFields.every(field => !(field in payload) || knowsPlayer(payload[field], context)) &&
    (subjects.teamIdFields ?? []).every(field => !(field in payload) || knowsTeam(payload[field], context));
}

/** Check the insight gate: full recorded access to the subject player, or enough dated diplomat points. */
function hasInsight(insight: NonNullable<NewspaperEventConfig['insight']>, payload: Record<string, unknown>, context: NewspaperProjectionContext): boolean {
  const subject = payload[insight.playerField];
  if (typeof subject !== 'number') return true;
  return visibility(context.summaries.find(summary => summary.Key === subject), context.receiverPlayerID) === 2 ||
    diplomatPoints(subject, context) >= insight.diplomatPoints;
}

/** Check that every structured item names a known player and, for third-party items, a known team. */
function knownItemSubjects(items: DealTermsConfig['items'], payload: Record<string, unknown>, context: NewspaperProjectionContext): boolean {
  const rows = Array.isArray(payload[items.field]) ? payload[items.field] as unknown[] : [];
  return rows.every(subject => {
    if (!subject || typeof subject !== 'object') return false;
    const row = subject as Record<string, unknown>;
    return knowsPlayer(row[items.playerField], context) &&
      (!items.teamItemTypes.includes(row.ItemType as string) || knowsTeam(row[items.teamField], context));
  });
}

/** Copy the recorded structured item fields after the whole deal passes the subject gate. */
function copyItems(value: unknown, fields: string[]): unknown {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    return [pickFields(item as Record<string, unknown>, fields)];
  });
}

/** Copy every representation of private terms together, or none of them, under the configured deal policy. */
function copyDealTerms(terms: DealTermsConfig, payload: Record<string, unknown>, values: Record<string, unknown>, context: NewspaperProjectionContext): void {
  const parties = terms.partyFields.map(field => payload[field]);
  const permitted = knownItemSubjects(terms.items, payload, context) && parties.every(id => knowsPlayer(id, context)) && (
    parties.includes(context.receiverPlayerID) || parties.every(id => diplomatPoints(id as number, context) >= terms.diplomatPoints)
  );
  if (!permitted) return;
  for (const key of terms.textFields) {
    const list = payload[key];
    if (list === null) values[key] = null;
    else if (Array.isArray(list) && list.every(term => typeof term === 'string')) values[key] = [...list];
    // Lua's empty arrays can be recorded as empty objects.
    else if (list && typeof list === 'object' && Object.keys(list).length === 0) values[key] = {};
  }
  for (const key of terms.scalarFields) {
    if (key in payload && (payload[key] === null || typeof payload[key] !== 'object')) values[key] = payload[key];
  }
  if (terms.items.field in payload) {
    const items = copyItems(payload[terms.items.field], terms.items.fields);
    if (items !== undefined) values[terms.items.field] = items;
  }
}

/** Project a supported event under its configured policy, using dated contact and recorded access. */
export function projectNewspaperEvent(row: Selectable<GameEvent>, context: NewspaperProjectionContext): NewspaperEvent | undefined {
  const config = newspaperEventConfigs[row.Type];
  if (!config || (visibility(row, context.receiverPlayerID) ?? 0) < 1) return undefined;
  const payload = row.Payload;
  const receiverTeam = context.players.find(player => player.Key === context.receiverPlayerID)?.TeamID;
  const involved = config.reportWhenInvolved === true && matchesSubjects(config.subjects, payload, context.receiverPlayerID, receiverTeam);
  if (!involved && !knowsSubjects(config.subjects, payload, context)) return undefined;
  if (config.insight && !hasInsight(config.insight, payload, context)) return undefined;

  const values: Record<string, unknown> = pickFields(payload, config.fields);
  // Enriched subjects are optional. Unknown identities never accompany a public event.
  for (const field of config.subjects.playerIdFields) {
    const key = field.replace(/ID$/, '');
    const identity = playerIdentity(payload[key], payload[field], context);
    if (identity) values[key] = identity;
  }
  // Keep nested city labels only with an explicitly known recorded owner.
  for (const [key, ownerField] of Object.entries(config.cities ?? {})) {
    const city = payload[key] as Record<string, unknown> | null;
    if (city && typeof city === 'object' && knowsPlayer(payload[ownerField], context)) values[key] = pickFields(city, ['Name', 'City']);
  }
  if (config.dealTerms) copyDealTerms(config.dealTerms, payload, values, context);
  return { source: source('GameEvents', row), type: row.Type, values };
}
