import type { Selectable } from 'kysely';
import type { PlayerSummary } from '../knowledge/schema/timed.js';
import type { NewspaperSourceReference } from './evidence.js';
import type { NewspaperCityProjectionContext } from './projection.js';
import {
  citiesAtTurn, cityOwner, cityStillAtPlot, knowsPlayer, sameRecordedCity, source, visibility, type NewspaperCityObservation
} from './recorded-city.js';

export type RecordedRoster = Pick<Selectable<PlayerSummary>, 'ID' | 'Key' | 'Turn' | 'CreatedAt' | 'Spies'>;

interface Presence {
  present: boolean;
  points: number;
  sources: NewspaperSourceReference[];
}

const stationedStates = new Set(['Gathering Intelligence', 'Establishing Surveillance', 'Rigging Election', 'Counter-intelligence']);
const inactiveStates = new Set(['Unassigned', 'Traveling', 'Travelling', 'Making Introductions', 'Killed In Action', 'Terminated']);
const diplomatRoles = new Set(['Diplomat', 'Vassal Diplomat']);
const spyRoles = new Set(['Spy', 'Counterspy']);

/** Read assignments to one host or city, leaving incomplete observations unknown. */
function readPresence(
  roster: RecordedRoster | undefined, host: string,
  { city, unique }: { city?: NewspaperCityObservation; unique: boolean }, kind: 'spy' | 'diplomat'
): Presence | undefined {
  const spies = roster?.Spies;
  if (!roster || !spies || typeof spies !== 'object' || (Array.isArray(spies) && spies.length)) return undefined;
  const sources = [source('PlayerSummaries', roster)];
  if (city && unique) sources.push(source('CityInformations', city));
  const suffix = ` (${host})`;
  const roles = kind === 'spy' ? spyRoles : diplomatRoles;
  const otherRoles = kind === 'spy' ? diplomatRoles : spyRoles;
  let points = -1;
  let uncertain = false;
  for (const agent of Object.values(spies)) {
    if (agent?.Location === 'Unassigned' || inactiveStates.has(agent?.State)) continue;
    const location = agent?.Location;
    const assigned = typeof location === 'string' && /.+ \(.+\)$/.test(location);
    if (assigned && !location.endsWith(suffix)) continue;
    if (otherRoles.has(agent?.Role)) continue;
    if (city && assigned && location !== `${city.Name}${suffix}`) {
      if (kind === 'diplomat' && !unique) uncertain = true;
      continue;
    }
    // Vox Populi's GetNetworkPointsStored returns -1 outside gathering intelligence and schmoozing.
    const network = Number.isFinite(agent?.Network) ? agent.Network : -1;
    const knownStationed = kind === 'spy' ? stationedStates.has(agent?.State) : agent?.State === 'Schmoozing';
    if (!assigned || !city || !unique || !roles.has(agent?.Role) || (!knownStationed && network < 0)) {
      uncertain = true;
      continue;
    }
    points = Math.max(points, network, 0);
  }
  if (points >= 0) return { present: true, points, sources };
  return uncertain ? undefined : { present: false, points: 0, sources };
}

/** Assess the receiver's spy against the readable version of this city at the requested date. */
export function ownSpyAtCity(row: NewspaperCityObservation, context: NewspaperCityProjectionContext): Presence | undefined {
  const dated = context.espionage;
  if (!dated?.receiverRoster) return undefined;
  const cities = citiesAtTurn(dated.turn, context);
  const active = cities.find(city => sameRecordedCity(city, row));
  if (!active || !cityStillAtPlot(row, dated.turn, context)) return undefined;
  const owner = cityOwner(active, context);
  const info = context.players.find(player => player.Key === owner?.id && player.Key !== 63);
  if (!info) return undefined;
  const host = info.IsMajor === 1 ? info.Civilization : `City-State ${info.Civilization}`;
  const matching = cities.filter(city => city.Owner === active.Owner && city.Name === active.Name);
  return readPresence(dated.receiverRoster, host, { city: active, unique: matching.length === 1 }, 'spy');
}

/** Resolve a diplomat only against the receiver's or host's unique readable recorded capital. */
export function diplomatAtCapital(
  visitor: number, host: number, context: NewspaperCityProjectionContext, earlier = false
): Presence | undefined {
  const dated = context.espionage;
  const own = visitor === context.receiverPlayerID;
  if (!dated || visitor === host || (!own && (earlier || host !== context.receiverPlayerID)) ||
      !knowsPlayer(visitor, context) || !knowsPlayer(host, context)) return undefined;
  const info = context.players.find(player => player.Key === host && player.IsMajor === 1);
  if (!info || !context.players.some(player => player.Key === visitor && player.IsMajor === 1) ||
      context.players.filter(player => player.IsMajor === 1 && player.Civilization === info.Civilization).length !== 1) return undefined;
  const roster = earlier ? dated.earlierRoster : own ? dated.receiverRoster : dated.rosters.get(visitor);
  if (!roster?.Spies || (earlier && roster.Turn >= dated.turn)) return undefined;
  const cities = citiesAtTurn(dated.turn - Number(earlier), context).filter(city => city.Owner === info.Civilization);
  const capitals = cities.filter(city => city.IsCapital === 1);
  const capital = capitals.length === 1 ? capitals[0] : undefined;
  const level = visibility(capital, context.receiverPlayerID);
  const unique = (level === 1 || level === 2) && cities.filter(city => city.Name === capital?.Name).length === 1;
  return readPresence(roster, info.Civilization, { city: capital, unique }, 'diplomat');
}
