/**
 * @module utils/prompts/event-importance
 *
 * Importance-based trimming for turn-keyed event reports. Event types are grouped into named
 * tiers, from most to least important. Unlisted types count as noise. Callers either drop the
 * bottom tiers one level at a time (the player loop's event window fallback) or drop tiers by
 * name in any order (the evaluator strategist's trim ladder).
 */

/** One importance tier: a name for configs and telemetry, and the event types it holds. */
export interface EventTier {
  name: string;
  types: readonly string[];
}

/**
 * Event types grouped by importance, most important first. Unlisted types belong to the noise
 * tier. Events blocked by the DLL's forwarding blacklist are omitted.
 */
export const eventImportanceTiers = [
  // Turning points: war and peace, conquest, deals, messages, and ideology.
  { name: "turning-points", types: [
    "DeclareWar", "MakePeace", "NuclearDetonation", "CityCaptureComplete", "CityRazed", "CityPuppeted",
    "CityFlipped", "PlayerLiberated", "CapitalChanged", "RelayedMessage", "DiplomaticMessage", "DealMade",
    "IdeologyAdopted", "IdeologySwitched", "ResolutionResult", "ReligionFounded", "PlayerAnarchy",
  ] },
  // Diplomatic and strategic shifts.
  { name: "diplomacy", types: [
    "TeamMeet", "SetAlly", "MinorAlliesChanged", "UiDiploEvent", "ElectionResultSuccess", "ElectionResultFailure",
    "PlayerBullied", "PlayerGifted", "PlayerProtected", "PlayerRevoked", "PlayerBoughtOut",
    "PlayerPlunderedTradeRoute", "StealPlot", "PlayerAdoptsGovernment", "PlayerSecularizes", "StateReligionAdopted",
    "StateReligionChanged", "UnitCityFounded", "PlayerGoldenAge", "LoyaltyStateChanged", "CircumnavigatedGlobe",
  ] },
  // Units: training, creation, upgrades, and losses, which change the balance of forces.
  { name: "units", types: [
    "CityTrained", "UnitCreated", "EventUnitCreated", "CityInvestedUnit", "UnitUpgraded", "UnitConverted",
    "UnitKilledInCombat", "UnitCaptured",
  ] },
  // Progress: policies, technologies, wonders, great people, religion, and city-state relations.
  { name: "progress", types: [
    "PlayerAdoptPolicy", "TeamTechResearched", "PlayerBuilt", "CityConstructed",
    "CityProjectComplete", "GreatPersonExpended", "GreatWorkCreated", "PantheonFounded", "ReligionEnhanced",
    "ReligionReformed", "CityConvertsReligion", "CityConvertsPantheon", "PlayerAdoptsCurrency", "ProvinceLevelChanged",
    "ContractStarted", "ContractEnded", "ContractsRefreshed", "MinorFriendsChanged", "EspionageState",
    "EspionageNotificationData", "MinorGift", "MinorGiftUnit", "NaturalWonderDiscovered", "PlayerTradeRouteCompleted",
    "GovernmentCooldownChanges", "GovernmentCooldownRateChanges", "ReformCooldownChanges", "ReformCooldownRateChanges",
    "PlayerEndOfMayaLongCount", "GoodyHutTechResearched",
  ] },
  // Combat detail: individual battles, promotions, and barbarian camps.
  { name: "combat", types: [
    "CombatResult", "UnitPromoted", "BarbariansCampCleared", "BarbariansCampFounded",
  ] },
  // Economy detail: city growth, purchases, and city events.
  { name: "economy", types: [
    "SetPopulation", "CityCreated", "CityBoughtPlot", "CityInvestedBuilding", "CitySoldBuilding", "BuildFinished",
    "CityBeginsWLTKD", "CityEndsWLTKD", "CityExtendsWLTKD", "CityEventActivated", "CityEventChoiceActivated",
    "CityEventChoiceEnded", "EventActivated", "EventChoiceActivated", "EventChoiceEnded",
    "ChangeGoldenAgeProgressMeter", "PietyChanged", "PietyRateChanged", "GoodyHutReceivedBonus", "PlaceResource",
    "PlayerBuilding", "TileOwnershipChanged",
  ] },
  // Noise: tiles, unit movement, remaining system events, and all unlisted types.
  { name: "noise", types: [
    "TileFeatureChanged", "TileImprovementChanged", "TileRouteChanged", "TileRevealed", "TerraformingMap",
    "UnitSetXY", "RebaseTo", "PushingMissionTo", "ParadropAt", "PlayerDoTurn", "PlayerDoneTurn", "TeamSetEra", "TurnComplete",
  ] },
] as const satisfies readonly EventTier[];

/** The name of one event importance tier. */
export type EventTierName = typeof eventImportanceTiers[number]["name"];

/**
 * The deepest trim level for {@link dropLeastImportantEvents}: every tier except the top one.
 * Level 1 drops noise, including unlisted types, and each further level drops one more tier,
 * starting from the least important.
 */
export const maxEventTrimLevel = eventImportanceTiers.length - 1;

/** The noise tier, which also holds every unlisted type. */
const noiseTier: EventTierName = "noise";

/** Tier name by event type. */
const tierByType = new Map<string, EventTierName>(
  eventImportanceTiers.flatMap(tier => tier.types.map(type => [type, tier.name] as const)),
);

/** Name the tier of one event, treating unlisted or missing types as noise. */
function eventTier(event: unknown): EventTierName {
  const type = (event as { Type?: unknown } | null)?.Type;
  return typeof type === "string" ? tierByType.get(type) ?? noiseTier : noiseTier;
}

/** A trimmed copy of an events report and how many events it lost. */
export interface TrimmedEvents<T> {
  /** The events report with the dropped events removed. */
  events: T;
  /** How many trim levels were applied (0 when nothing was dropped). */
  droppedTiers: number;
  /** How many events were removed. */
  droppedEvents: number;
}

/**
 * Copy a turn-keyed events report without the named tiers, in any combination. Non-array entries
 * such as `_markdownConfig` are kept, and turns left without events are removed.
 *
 * @param events - The turn-keyed events report
 * @param names - The tiers to drop; `noise` also drops unlisted types
 * @returns The trimmed copy and the number of events removed
 */
export function dropEventTiers<T extends object>(
  events: T,
  names: Iterable<EventTierName>,
): { events: T; droppedEvents: number } {
  const dropped = new Set(names);
  const trimmed: Record<string, unknown> = {};
  let droppedEvents = 0;
  for (const [key, value] of Object.entries(events)) {
    if (!Array.isArray(value)) {
      trimmed[key] = value;
      continue;
    }
    const kept = value.filter(event => !dropped.has(eventTier(event)));
    droppedEvents += value.length - kept.length;
    if (kept.length > 0) trimmed[key] = kept;
  }
  return { events: trimmed as T, droppedEvents };
}

/**
 * Copy a turn-keyed events report without its `level` least important tiers (see
 * {@link maxEventTrimLevel}). Level 0 returns an unchanged copy.
 *
 * @param events - The turn-keyed events report
 * @param level - How many tiers to drop, from 0 to {@link maxEventTrimLevel}
 * @returns The trimmed copy and the number of events removed
 */
export function dropLeastImportantEvents<T extends object>(events: T, level: number): TrimmedEvents<T> {
  const count = Math.min(Math.max(level, 0), maxEventTrimLevel);
  const names = eventImportanceTiers.slice(eventImportanceTiers.length - count).map(tier => tier.name);
  const trimmed = dropEventTiers(events, names);
  return { ...trimmed, droppedTiers: trimmed.droppedEvents > 0 ? level : 0 };
}
