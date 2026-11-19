import type { Selectable } from 'kysely';
import type { PlayerInformation } from '../knowledge/schema/public.js';
import type { CityInformation, GameEvent, PlayerSummary } from '../knowledge/schema/timed.js';
import { projectCityReportFields, projectPlayerReportFields } from '../knowledge/helpers/report-projection.js';
import { diplomaticEventSubjects, matchesSubjects, type EventSubjects } from '../knowledge/helpers/event-subjects.js';
import { pickFields } from '../utils/fields.js';
import { parseRelationship } from '../diplomacy/relationships.js';
import type { NewspaperDiplomacyGap, NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperSnapshot, NewspaperSourceReference } from './evidence.js';
import { cityAtEvent, cityOwner, knowsPlayer, source, visibility, type NewspaperCityObservation } from './recorded-city.js';
export type { NewspaperCityObservation } from './recorded-city.js';

type PlayerContact = Pick<Selectable<PlayerSummary>, 'Key'> &
  Partial<Pick<Selectable<PlayerSummary>, keyof PlayerSummary & `Player${number}`>>;

/** City projection needs dated contact, without reading national facts or diplomat strength. */
export interface NewspaperCityProjectionContext {
  receiverPlayerID: number;
  summaries: readonly PlayerContact[];
  players: Selectable<PlayerInformation>[];
  /** Snapshots for dated city joins, including nonvisible rows that prevent reuse of stale evidence. */
  cityHistory?: readonly NewspaperCityObservation[];
  /** Recorded founding, capture, flip and razing events that the receiver may read. */
  cityLifecycle?: readonly Selectable<GameEvent>[];
  /** Dated contact for ownership anchors from earlier turns. */
  knowsLifecyclePlayer?: (event: Selectable<GameEvent>, playerID: number) => boolean;
}

/** Historical access context supplied by the query, never by live getters. */
export interface NewspaperProjectionContext extends NewspaperCityProjectionContext {
  summaries: Selectable<PlayerSummary>[];
  /** Recorded events of the same turn that the receiver may read. */
  turnEvents?: readonly Selectable<GameEvent>[];
}

const ownPlayerFields = [
  'Score', 'Era', 'Cities', 'Population', 'Territory', 'Gold', 'GoldPerTurn', 'HappinessPercentage',
  'GoldenAge', 'TourismPerTurn', 'CulturePerTurn', 'FaithPerTurn', 'SciencePerTurn', 'Technologies',
  'CurrentResearch', 'NextPolicyTurns', 'PolicyBranches', 'FoundedReligion', 'MajorityReligion',
  'OutgoingTradeRoutes', 'IncomingTradeRoutes'
] as const;
const foreignPlayerFields = ['Era', 'Cities', 'Population', 'CulturePerTurn', 'TourismPerTurn',
  'Technologies', 'PolicyBranches', 'FoundedReligion', 'MajorityReligion'] as const;

/** Get recorded diplomat strength only from a fully accessible receiver snapshot. */
function diplomatPoints(target: number, context: NewspaperProjectionContext): number {
  const receiver = context.summaries.find(row => row.Key === context.receiverPlayerID);
  if (visibility(receiver, context.receiverPlayerID) !== 2) return 0;
  return receiver?.DiplomatPoints?.[`Player${target}`] ?? 0;
}

/** Select national facts under recorded access, keeping a known visible identity with empty values. */
export function projectNewspaperPlayer(row: Selectable<PlayerSummary>, context: NewspaperProjectionContext): NewspaperSnapshot | undefined {
  const reference = source('PlayerSummaries', row);
  const level = visibility(row, context.receiverPlayerID);
  if (level !== 1 && level !== 2) return undefined;
  const own = row.Key === context.receiverPlayerID;
  const info = context.players.find(player => player.Key === row.Key);
  const points = diplomatPoints(row.Key, context);
  const selected = pickFields(row, own ? ownPlayerFields : foreignPlayerFields);
  const values: Record<string, unknown> = projectPlayerReportFields(selected, level, points, info?.IsMajor === 1);
  if (own && level === 2) Object.assign(values, pickFields(row, ['Votes', 'Resources', 'MilitaryUnits', 'MilitarySupply', 'DiplomaticDeals']));
  if ((own || level === 2) && 'MilitaryStrength' in row) values.MilitaryStrength = row.MilitaryStrength;
  if (!info && !Object.keys(values).length) return undefined;
  return { source: reference, subjectID: row.Key, values };
}

/** Find every recorded identity matching a summary label before applying dated contact. */
function resolveRelationshipIdentity(label: string, context: NewspaperProjectionContext): Selectable<PlayerInformation>[] {
  return context.players.filter(player =>
    player.Civilization === label || (player.IsMajor !== 1 && `City-State ${player.Civilization}` === label));
}

/** Project public relationship facts independently of raw national values and private summary strings. */
export function projectNewspaperDiplomacy(
  row: Selectable<PlayerSummary>, context: NewspaperProjectionContext, gaps: NewspaperDiplomacyGap[]
): NewspaperDiplomacySnapshot | undefined {
  const level = visibility(row, context.receiverPlayerID);
  if (level !== 1 && level !== 2) return undefined;
  const reference = source('PlayerSummaries', row);
  /** Record a gap without exposing the unresolved raw label or its private data. */
  function gap(kind: NewspaperDiplomacyGap['kind']): void {
    if (!gaps.some(entry => entry.source.id === row.ID && entry.kind === kind)) gaps.push({ source: reference, subjectID: row.Key, kind });
  }
  const info = context.players.find(player => player.Key === row.Key);
  if (!info) {
    gap('unresolvedIdentity');
    return undefined;
  }
  const result: NewspaperDiplomacySnapshot = {
    source: reference, subjectID: row.Key, teamID: info.TeamID, isMajor: info.IsMajor === 1, relationships: []
  };
  /** Require a unique, dated visible identity before including an entry. */
  function resolve(label: string): Selectable<PlayerInformation> | undefined {
    const candidates = resolveRelationshipIdentity(label, context);
    if (candidates.length !== 1) {
      gap(candidates.length ? 'ambiguousIdentity' : 'unresolvedIdentity');
      return undefined;
    }
    if (!knowsPlayer(candidates[0].Key, context)) {
      gap('unresolvedIdentity');
      return undefined;
    }
    return candidates[0];
  }
  const entries = row.Relationships;
  if (!entries || typeof entries !== 'object' || (Array.isArray(entries) && entries.length > 0)) gap('missingRelationships');
  else for (const [label, value] of Object.entries(entries)) {
    const target = resolve(label);
    if (!target || target.Key === row.Key) continue;
    const facts = parseRelationship(value);
    if (facts.state === 'unknown') gap('unknownRelationship');
    result.relationships.push({ targetPlayerID: target.Key, targetTeamID: target.TeamID, ...facts });
  }
  if (info.IsMajor !== 1) {
    if (row.MajorAlly === null) result.majorAllyPlayerID = null;
    else if (typeof row.MajorAlly === 'string') {
      const ally = resolve(row.MajorAlly);
      if (ally?.IsMajor === 1) result.majorAllyPlayerID = ally.Key;
    }
  }
  return result;
}

/** Select raw city facts under recorded basic or full access, preserving sentinel and boolean values. */
export function projectNewspaperCity(row: Selectable<CityInformation>, context: NewspaperCityProjectionContext): NewspaperSnapshot | undefined {
  const reference = source('CityInformations', row);
  const level = visibility(row, context.receiverPlayerID);
  if (level !== 1 && level !== 2) return undefined;
  const { Key: _key, ...fields } = projectCityReportFields(row, level);
  const values: Record<string, unknown> = { ...fields, ...pickFields(row, ['IsCapital']) };
  const owner = cityOwner(row, context);
  if (owner) values.OwnerID = owner.id;
  return { source: reference, subjectID: row.Key, values,
    ...(owner?.event ? { relatedSources: [source('GameEvents', owner.event)] } : {}) };
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
  /** Payload fields copied into evidence. Name fields publish under their name key; unlisted payload fields never enter editorial input. */
  fields: string[];
  /** Player and team ID fields naming the event's subjects, which the receiver must have met. */
  subjects: EventSubjects;
  /** Subject fields whose -1 sentinel means no player took this role. */
  optionalPlayers?: string[];
  /** Report the event when the receiver or its team is a subject, even if another subject is unmet. */
  reportWhenInvolved?: boolean;
  /** Extra gate: full receiver access to this subject player, or at least this many diplomat points with them. */
  insight?: { playerField: string; diplomatPoints: number };
  /** Nested city labels, keyed by payload object, with the payload field naming that city's owner. */
  cities?: Record<string, string>;
  /** City ID fields paired with their owner fields. */
  cityIDs?: Record<string, string>;
  /** Which city supplies the main plot when there is more than one. */
  mainCityID?: string;
  /** Private terms, copied only when the deal policy allows. */
  dealTerms?: DealTermsConfig;
  /** Report only the named owners and recorded names when the receiver did not witness this event. */
  worldNews?: {
    nameFields: readonly (keyof typeof eventNameFields)[];
    allows?: (payload: Record<string, unknown>) => boolean;
  };
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
  SetAlly: {
    fields: ['MinorPlayerID', 'OldAllyPlayerID', 'NewAllyPlayerID'], subjects: diplomaticEventSubjects.SetAlly,
    reportWhenInvolved: true
  },
  MinorAlliesChanged: {
    fields: ['MinorPlayerID', 'MajorPlayerID', 'IsNowAlly'], subjects: diplomaticEventSubjects.MinorAlliesChanged
  },
  MinorFriendsChanged: {
    fields: ['MinorPlayerID', 'MajorPlayerID', 'IsNowFriend', 'OldFriendship', 'NewFriendship'],
    subjects: diplomaticEventSubjects.MinorFriendsChanged
  },
  CityCaptureComplete: {
    fields: ['OldOwnerID', 'NewOwnerID', 'CityID', 'CityX', 'CityY', 'Population', 'IsConquest', 'IsCapital'],
    subjects: diplomaticEventSubjects.CityCaptureComplete,
    cities: { City: 'NewOwnerID' }
  },
  CityFlipped: {
    fields: ['OldOwnerID', 'NewOwnerID', 'CityID'],
    subjects: diplomaticEventSubjects.CityFlipped,
    cities: { City: 'NewOwnerID' },
    cityIDs: { CityID: 'OldOwnerID' }
  },
  CityTrained: {
    fields: ['PlayerID', 'CityID', 'UnitID', 'WithGold', 'WithFaith'], subjects: playerSubject,
    cityIDs: { CityID: 'PlayerID' }
  },
  CityConstructed: {
    fields: ['OwnerID', 'CityID', 'BuildingType', 'IsGoldPurchase', 'IsFaithPurchase'],
    subjects: { playerIdFields: ['OwnerID'] }, cityIDs: { CityID: 'OwnerID' }
  },
  PlayerCityFounded: { fields: ['PlayerID', 'PlotX', 'PlotY'], subjects: playerSubject },
  UnitCityFounded: { fields: ['PlayerID', 'UnitID', 'UnitType', 'PlotX', 'PlotY'], subjects: playerSubject },
  CityPuppeted: { fields: ['PlayerID', 'CityID'], subjects: playerSubject, cityIDs: { CityID: 'PlayerID' } },
  CityRazed: { fields: ['PlayerID', 'CityX', 'CityY'], subjects: playerSubject },
  SetPopulation: { fields: ['CityX', 'CityY', 'OldPopulation', 'NewPopulation'], subjects: { playerIdFields: [] } },
  CapitalChanged: {
    fields: ['PlayerID', 'NewCapitalCityID', 'OldCapitalCityID'], subjects: playerSubject,
    cityIDs: { NewCapitalCityID: 'PlayerID', OldCapitalCityID: 'PlayerID' }, mainCityID: 'NewCapitalCityID'
  },
  CombatResult: {
    fields: ['AttackingPlayerID', 'AttackingUnitID', 'AttackerRemainingHP', 'AttackerDamage', 'AttackerMaxHp',
      'DefendingPlayerID', 'DefendingUnitID', 'DefenderRemainingHP', 'DefenderDamage', 'DefenderMaxHp',
      'InterceptingPlayerID', 'InterceptingUnitID', 'InterceptorDamage', 'PlotX', 'PlotY'],
    subjects: { playerIdFields: ['AttackingPlayerID', 'DefendingPlayerID', 'InterceptingPlayerID'] },
    optionalPlayers: ['AttackingPlayerID', 'DefendingPlayerID', 'InterceptingPlayerID']
  },
  UnitKilledInCombat: {
    fields: ['KillerPlayerID', 'KilledPlayerID', 'KilledUnitType', 'KillingUnitID'],
    subjects: { playerIdFields: ['KillerPlayerID', 'KilledPlayerID'] }
  },
  UnitCreated: { fields: ['PlayerID', 'UnitID', 'UnitType', 'PlotX', 'PlotY'], subjects: playerSubject },
  GreatPersonExpended: {
    fields: ['PlayerID', 'UnitID', 'GreatPersonType', 'CityX', 'CityY'], subjects: playerSubject
  },
  PlayerGoldenAge: { fields: ['PlayerID', 'TurnChange'], subjects: playerSubject },
  // The liberated city's recorded owner at event time is unknown, so its label is not kept.
  PlayerLiberated: {
    fields: ['LiberatingPlayerID', 'LiberatedPlayerID', 'CityID'],
    subjects: diplomaticEventSubjects.PlayerLiberated
  },
  PlayerTradeRouteCompleted: {
    fields: ['OriginPlayerID', 'DestinationPlayerID', 'OriginCityID', 'DestinationCityID', 'Domain', 'ConnectionType'],
    subjects: diplomaticEventSubjects.PlayerTradeRouteCompleted,
    cities: { OriginCity: 'OriginPlayerID', DestinationCity: 'DestinationPlayerID' },
    cityIDs: { OriginCityID: 'OriginPlayerID', DestinationCityID: 'DestinationPlayerID' }
  },
  PlayerPlunderedTradeRoute: {
    fields: ['PlunderingPlayerID', 'OriginOwnerID', 'DestinationOwnerID', 'PlunderGoldValue'],
    subjects: diplomaticEventSubjects.PlayerPlunderedTradeRoute,
    cities: { OriginCity: 'OriginOwnerID', DestinationCity: 'DestinationOwnerID' }
  },
  TeamSetEra: { fields: ['TeamID', 'NewEra'], subjects: teamSubject },
  TeamTechResearched: {
    fields: ['TeamID', 'TechID', 'ChangeAmount'], subjects: teamSubject,
    worldNews: {
      nameFields: ['TechID'],
      /** The same hook also runs when a team loses a technology. */
      allows: ({ ChangeAmount }) => typeof ChangeAmount === 'number' && ChangeAmount > 0,
    }
  },
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
    cities: { City: 'PlayerID' },
    cityIDs: { CityID: 'PlayerID' }
  },
  ReligionFounded: {
    fields: ['PlayerID', 'HolyCityID', 'ReligionID'],
    subjects: playerSubject,
    cities: { HolyCity: 'PlayerID' },
    cityIDs: { HolyCityID: 'PlayerID' }
  },
  ReligionEnhanced: { fields: ['PlayerID', 'ReligionID', 'FirstEnhancerBelief', 'SecondEnhancerBelief'], subjects: playerSubject },
  ReligionReformed: { fields: ['PlayerID', 'ReligionID', 'ReformationBelief'], subjects: playerSubject },
  CityConvertsReligion: {
    fields: ['OwnerID', 'ReligionID', 'CityX', 'CityY'],
    subjects: { playerIdFields: ['OwnerID'] },
    cities: { City: 'OwnerID' }
  }
};

/** Recorded name fields and the evidence key each becomes. Unlisted values stay private. */
const eventNameFields = {
  TechID: 'Tech', PolicyID: 'Policy', BranchType: 'Branch', OldBranchType: 'OldBranch', NewBranchType: 'NewBranch',
  ReligionID: 'Religion', UnitType: 'Unit', KilledUnitType: 'Unit', GreatPersonType: 'Unit', BuildingType: 'Building'
} as const;

/** World-news types, read without receiver visibility and published only when every subject is known. */
export const newspaperWorldNewsTypes = Object.keys(newspaperEventConfigs).filter(type => newspaperEventConfigs[type].worldNews);

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
function knowsSubjects(subjects: EventSubjects, payload: Record<string, unknown>, context: NewspaperProjectionContext,
  optionalPlayers: string[] = []): boolean {
  return subjects.playerIdFields.every(field => !(field in payload) ||
    ((field === 'OldAllyPlayerID' || field === 'NewAllyPlayerID' || optionalPlayers.includes(field)) && payload[field] === -1) ||
    knowsPlayer(payload[field], context)) &&
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

/** Keep names already resolved by the recorder. Numeric IDs have no recorded name. */
function recordedName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Disambiguate historic false statuses using the hook's positive award or zero-turn ending. */
function goldenAgeStarting(payload: Record<string, unknown>): boolean | undefined {
  const { Starting, TurnChange } = payload;
  const explicitStart = Starting === true || Starting === 1;
  if (!explicitStart && Starting !== false && Starting !== 0) return undefined;
  if (typeof TurnChange !== 'number') return explicitStart ? true : undefined;
  if (!Number.isInteger(TurnChange) || TurnChange < 0) return undefined;
  if (TurnChange > 0) return true;
  return explicitStart ? undefined : false;
}

/** Join a training event to one visible creation of the same owner's unit during the same turn. */
function trainedUnit(row: Selectable<GameEvent>, context: NewspaperProjectionContext): Selectable<GameEvent> | undefined {
  const { PlayerID, UnitID } = row.Payload;
  if (!knowsPlayer(PlayerID, context) || typeof UnitID !== 'number' || !Number.isInteger(UnitID) || UnitID < 0) return undefined;
  const matches = context.turnEvents?.filter(event => event.Type === 'UnitCreated' && event.Turn === row.Turn &&
    event.Payload.PlayerID === PlayerID && event.Payload.UnitID === UnitID && (visibility(event, context.receiverPlayerID) ?? 0) > 0);
  return matches?.length === 1 ? matches[0] : undefined;
}

/** Add only positions backed by a unique dated city row and record what each join used. */
function copyCityPositions(config: NewspaperEventConfig, row: Selectable<GameEvent>,
  values: Record<string, unknown>, context: NewspaperProjectionContext, related: NewspaperSourceReference[]): void {
  const fields = Object.entries(config.cityIDs ?? {});
  for (const [idField, ownerField] of fields) {
    const position = cityAtEvent(row, row.Payload[idField], row.Payload[ownerField], context);
    if (!position) continue;
    if (fields.length === 1 || idField === config.mainCityID) {
      values.CityX = position.row.X;
      values.CityY = position.row.Y;
    }
    if (fields.length > 1) {
      const prefix = idField.slice(0, -2);
      values[`${prefix}X`] = position.row.X;
      values[`${prefix}Y`] = position.row.Y;
    }
    related.push(source('CityInformations', position.row));
    if (position.ownerEvent) related.push(source('GameEvents', position.ownerEvent));
  }
}

/** Publish only the owner and recorded names of an unwitnessed world-news event. */
function projectWorldNewsEvent(row: Selectable<GameEvent>, config: NewspaperEventConfig,
  context: NewspaperProjectionContext): NewspaperEvent | undefined {
  const payload = row.Payload;
  const { worldNews, subjects } = config;
  if (!worldNews || worldNews.allows?.(payload) === false) return undefined;
  const teamFields = subjects.teamIdFields ?? [];
  const values: Record<string, unknown> = {};
  for (const field of [...subjects.playerIdFields, ...teamFields]) {
    const id = payload[field];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return undefined;
    values[field] = id;
  }
  // The barbarian slot is a known label for witnessed events, but does not establish contact.
  const barbarian = context.players.find(player => player.Key === 63);
  if (subjects.playerIdFields.some(field => values[field] === 63) ||
    (barbarian && teamFields.some(field => values[field] === barbarian.TeamID)) ||
    !knowsSubjects(subjects, payload, context)) return undefined;
  for (const field of worldNews.nameFields) {
    const text = recordedName(payload[field]);
    if (!text) return undefined;
    values[eventNameFields[field]] = text;
  }
  return { source: source('GameEvents', row), type: row.Type, values };
}

/** Project a supported event under its configured policy, using dated contact and recorded access. */
export function projectNewspaperEvent(row: Selectable<GameEvent>, context: NewspaperProjectionContext): NewspaperEvent | undefined {
  const config = newspaperEventConfigs[row.Type];
  if (!config) return undefined;
  if ((visibility(row, context.receiverPlayerID) ?? 0) < 1) return projectWorldNewsEvent(row, config, context);
  const payload = row.Payload;
  const receiverTeam = context.players.find(player => player.Key === context.receiverPlayerID)?.TeamID;
  const involved = config.reportWhenInvolved === true && matchesSubjects(config.subjects, payload, context.receiverPlayerID, receiverTeam);
  if (!involved && !knowsSubjects(config.subjects, payload, context, config.optionalPlayers)) return undefined;
  if (config.insight && !hasInsight(config.insight, payload, context)) return undefined;

  const values: Record<string, unknown> = {};
  for (const field of config.fields) {
    if (Object.hasOwn(eventNameFields, field)) {
      const text = recordedName(payload[field]);
      if (text) values[eventNameFields[field as keyof typeof eventNameFields]] = text;
    } else if (Object.hasOwn(payload, field)) values[field] = payload[field];
  }
  if (row.Type === 'MinorAlliesChanged' && (typeof values.IsNowAlly === 'boolean' || typeof values.IsNowAlly === 'number')) {
    values.IsNowAlly = values.IsNowAlly !== false && values.IsNowAlly !== 0;
  }
  const related: NewspaperSourceReference[] = [];
  if (config.cityIDs) copyCityPositions(config, row, values, context, related);
  if (row.Type === 'CityTrained') {
    const created = trainedUnit(row, context);
    const unit = recordedName(created?.Payload.UnitType);
    if (created && unit) {
      values.Unit = unit;
      related.push(source('GameEvents', created));
    }
  }
  if (row.Type === 'PlayerGoldenAge') {
    const starting = goldenAgeStarting(payload);
    if (starting !== undefined) values.Starting = starting;
  }
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
  return { source: source('GameEvents', row), type: row.Type, values,
    ...(related.length ? { relatedSources: [...new Map(related.map(ref => [`${ref.table}/${ref.id}`, ref])).values()] } : {}) };
}
