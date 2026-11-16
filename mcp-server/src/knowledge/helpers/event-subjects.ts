/** Subject fields used by diplomatic relevance and historical reporting. */
export interface EventSubjects {
  playerIdFields: string[];
  playerIdListFields?: string[];
  teamIdFields?: string[];
}

/** Diplomatic subject metadata, independent of presentation formatters. */
const subjectsByType = {
  DeclareWar: {
    playerIdFields: ["OriginatingPlayerID"],
    teamIdFields: ["TargetTeamID"],
  },
  MakePeace: {
    playerIdFields: ["OriginatingPlayerID"],
    teamIdFields: ["TargetTeamID"],
  },
  DealMade: {
    playerIdFields: ["FromPlayerID", "ToPlayerID"],
  },
  TeamMeet: {
    playerIdFields: [],
    teamIdFields: ["CurrentTeamID", "OtherTeamID"],
  },
  CityCaptureComplete: {
    playerIdFields: ["OldOwnerID", "NewOwnerID"],
  },
  CityFlipped: {
    playerIdFields: ["OldOwnerID", "NewOwnerID"],
  },
  PlayerLiberated: {
    playerIdFields: ["LiberatingPlayerID", "LiberatedPlayerID"],
  },
  MinorAlliesChanged: {
    playerIdFields: ["MinorPlayerID", "MajorPlayerID"],
  },
  MinorFriendsChanged: {
    playerIdFields: ["MinorPlayerID", "MajorPlayerID"],
  },
  SetAlly: {
    playerIdFields: ["MinorPlayerID", "OldAllyPlayerID", "NewAllyPlayerID"],
  },
  MinorGiftUnit: {
    playerIdFields: ["MinorPlayerID", "MajorPlayerID"],
  },
  PlayerGifted: {
    playerIdFields: ["GivingPlayerID", "ReceivingPlayerID"],
  },
  PlayerBullied: {
    playerIdFields: ["BullyingPlayerID", "MinorPlayerID"],
  },
  PlayerBoughtOut: {
    playerIdFields: ["BuyingPlayerID", "MinorPlayerID"],
  },
  PlayerProtected: {
    playerIdFields: ["MajorPlayerID", "MinorPlayerID"],
  },
  PlayerRevoked: {
    playerIdFields: ["MajorPlayerID", "MinorPlayerID"],
  },
  EspionageNotificationData: {
    playerIdFields: ["SourcePlayerID", "TargetPlayerID"],
  },
  ElectionResultSuccess: {
    playerIdFields: ["PlayerID"],
  },
  ElectionResultFailure: {
    playerIdFields: ["PlayerID"],
  },
  PlayerPlunderedTradeRoute: {
    playerIdFields: ["PlunderingPlayerID", "OriginOwnerID", "DestinationOwnerID"],
  },
  StealPlot: {
    playerIdFields: ["FromPlayerID", "ToPlayerID"],
  },
  ResolutionResult: {
    playerIdFields: ["ProposerPlayerID"],
  },
  UnitConverted: {
    playerIdFields: ["OldOwnerID", "NewOwnerID"],
  },
  PlayerTradeRouteCompleted: {
    playerIdFields: ["OriginPlayerID", "DestinationPlayerID"],
  },
  NuclearDetonation: {
    playerIdFields: ["PlayerID"],
  },
  RelayedMessage: {
    playerIdFields: ["ToPlayerID", "FromPlayerID"],
    playerIdListFields: ["AboutPlayerIDs"],
  },
} satisfies Record<string, EventSubjects>;

/** Literal event names keep formatting configuration aligned with subject metadata. */
export type DiplomaticEventType = keyof typeof subjectsByType;
export const diplomaticEventSubjects: Record<string, EventSubjects> = subjectsByType;

/** Match the existing diplomatic tool's flat player, list, and team subjects. */
export function matchesEventSubject(type: string, payload: Record<string, any>, playerID: number, teamID?: number): boolean {
  const subjects = diplomaticEventSubjects[type];
  return subjects ? matchesSubjects(subjects, payload, playerID, teamID) : false;
}

/** Check whether a player, directly, through a subject list, or through its team, is one of the given subjects. */
export function matchesSubjects(subjects: EventSubjects, payload: Record<string, any>, playerID: number, teamID?: number): boolean {
  return subjects.playerIdFields.some(field => payload[field] === playerID)
    || (subjects.playerIdListFields?.some(field => Array.isArray(payload[field]) && payload[field].includes(playerID)) ?? false)
    || (subjects.teamIdFields?.some(field => teamID !== undefined && payload[field] === teamID) ?? false);
}
