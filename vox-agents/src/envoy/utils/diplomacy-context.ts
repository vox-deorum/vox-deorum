/**
 * @module envoy/utils/diplomacy-context
 *
 * The game-state background the diplomat and negotiator see by default alongside a conversation:
 * the two civilizations' cities, the deals currently in force between them (from the game, with
 * turns remaining), and the deals recently concluded between them. This is grounding pulled fresh
 * from the game, distinct from the diplomat's on-the-table deal context (which reflects the agent
 * transcript's in-flight proposal, see {@link ../diplomat.ts}).
 *
 * All three sub-fetches are perspective-aware (`PlayerID = the voiced seat`) so cities and standing
 * deals carry the right visibility. We do NOT reuse the strategist's cached `GameState` (fetched with
 * no perspective, so it strips `DiplomaticDeals` and over-shares cities), nor do we adjust
 * `refreshGameState` (that would ripple into the strategist and its briefers).
 */

import type { VoxContext } from "../../infra/vox-context.js";
import type { StrategistParameters } from "../../strategist/strategy-parameters.js";
import type { EnvoyThread } from "../../types/index.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import { createLogger } from "../../utils/logger.js";
import { endpoints } from "./negotiator-utils.js";
import {
  formatStringDeal,
  getDealExpirySuffix,
} from "../../../../mcp-server/dist/utils/deal-format.js";
import type { CitiesReport } from "../../../../mcp-server/dist/tools/knowledge/get-cities.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import type { DiplomaticDealDetails } from "../../../../mcp-server/dist/knowledge/schema/timed.js";
// The sentinel lives in the dependency-free base schema, so importing it here does not pull the
// server's module graph (config load, managers, MCP SDK) into the vox-agents process.
import { MINOR_CIV_LEADER } from "../../../../mcp-server/dist/knowledge/schema/base.js";

const logger = createLogger("diplomacy-context");

/** How many turns back to scan for recently-concluded deals, and the cap on how many to show. */
const DEFAULT_RECENT_TURN_WINDOW = 15;
const MAX_CONCLUDED_DEALS = 10;

// One active in-game deal between the pair (from `get-players` -> DiplomaticDeals), viewer-perspective.
// Reuses the server's own contract (DiplomaticDealDetails) so the shape cannot drift from the schema.
type StandingDeal = DiplomaticDealDetails;

/** A raw `DealMade` event payload as returned by `get-diplomatic-events` in unformatted mode. */
interface DealMadeEvent {
  Type?: string;
  FromPlayerID?: number;
  ToPlayerID?: number;
  FromGives?: string[];
  ToGives?: string[];
  TurnsRemaining?: number;
  StartTurn?: number;
}

/** The trailing "(N turns remaining)" clause for a standing deal (no StartTurn to derive expiry from). */
function standingDealFraming(turnsRemaining: number): string {
  return turnsRemaining > 0
    ? ` (${turnsRemaining} ${turnsRemaining === 1 ? "turn" : "turns"} remaining)`
    : " (ongoing)";
}

/** Render the two civilizations' city groups (full for own, basic for the counterpart, per get-cities). */
function citiesSection(
  cities: CitiesReport,
  selfCiv: string,
  counterpartCiv: string
): string | undefined {
  const blocks: string[] = [];
  const own = cities[selfCiv];
  const theirs = cities[counterpartCiv];
  if (own && Object.keys(own).length > 0) {
    blocks.push(`## Your cities (${selfCiv})\n\n${jsonToMarkdown(own)}`);
  }
  if (theirs && Object.keys(theirs).length > 0) {
    blocks.push(`## ${counterpartCiv}'s cities (visible)\n\n${jsonToMarkdown(theirs)}`);
  }
  return blocks.length ? blocks.join("\n\n") : undefined;
}

/** Render the deals currently in force between the pair (viewer-first), or undefined when none. */
function standingDealsSection(
  deals: StandingDeal[] | undefined,
  selfCiv: string,
  counterpartCiv: string
): string | undefined {
  if (!Array.isArray(deals) || deals.length === 0) return undefined;
  const rows = deals.map((d) =>
    formatStringDeal({
      leftLabel: selfCiv,
      rightLabel: counterpartCiv,
      leftGive: d.WeGive,
      rightGive: d.TheyGive,
      framing: standingDealFraming(d.TurnsRemaining),
    })
  );
  return `## Standing agreements currently in force with ${counterpartCiv}\n${rows.join("\n")}`;
}

/** Render the pair's recently-concluded deals (viewer-first), most recent last, or undefined when none. */
function concludedDealsSection(
  events: Record<string, unknown[]> | undefined,
  viewerID: number,
  counterpartID: number,
  selfCiv: string,
  counterpartCiv: string,
  currentTurn: number,
  window: number
): string | undefined {
  if (!events || typeof events !== "object") return undefined;

  // Flatten the turn-keyed groups, keeping only DealMade events strictly between the pair. The
  // server already filtered by visibility + OtherPlayerID, but that also admits the counterpart's
  // deals with THIRD parties, so re-confirm both endpoints are the viewer and the counterpart.
  const pair = new Set([viewerID, counterpartID]);
  const concluded: Array<{ turn: number; payload: DealMadeEvent }> = [];
  for (const [turnKey, entries] of Object.entries(events)) {
    const turn = Number(turnKey);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as DealMadeEvent[]) {
      if (!entry || entry.Type !== "DealMade") continue;
      if (entry.FromPlayerID === undefined || entry.ToPlayerID === undefined) continue;
      if (!pair.has(entry.FromPlayerID) || !pair.has(entry.ToPlayerID)) continue;
      if (entry.FromPlayerID === entry.ToPlayerID) continue;
      concluded.push({ turn, payload: entry });
    }
  }
  if (concluded.length === 0) return undefined;

  concluded.sort((a, b) => a.turn - b.turn);
  const shown = concluded.slice(-MAX_CONCLUDED_DEALS);
  const rows = shown.map(({ turn, payload }) => {
    const viewerIsFrom = payload.FromPlayerID === viewerID;
    return `- turn ${turn}: ${formatStringDeal({
      leftLabel: selfCiv,
      rightLabel: counterpartCiv,
      leftGive: viewerIsFrom ? payload.FromGives ?? [] : payload.ToGives ?? [],
      rightGive: viewerIsFrom ? payload.ToGives ?? [] : payload.FromGives ?? [],
      framing: getDealExpirySuffix(payload, currentTurn),
    })}`;
  });
  return `## Recently concluded deals with ${counterpartCiv} (last ${window} turns)\n${rows.join("\n")}`;
}

/**
 * Build the diplomat/negotiator background message: the two civs' cities, the standing in-game deals
 * between them, and their recently-concluded deals. Returns a single markdown string (the caller wraps
 * it as a `user` message), or `undefined` when there is nothing to show (no counterpart, a minor-civ
 * counterpart, or all three sections empty).
 */
export async function buildDiplomacyBackgroundMessage(
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
  thread: EnvoyThread,
  opts?: { recentTurnWindow?: number }
): Promise<string | undefined> {
  const { agentID: viewerID, counterpartID } = endpoints(thread);

  const selfIdentity = identityOf(thread, viewerID);
  const counterpartIdentity = identityOf(thread, counterpartID);

  // Intended skip: a minor-civ (city-state) counterpart carries the sentinel leader and records no
  // deals, so there is deliberately no civ-to-civ background to show. Silent by design.
  if (counterpartIdentity?.leader === MINOR_CIV_LEADER) {
    return undefined;
  }
  // Data gap (distinct from the minor-civ skip above): a civ-to-civ thread should carry a leader
  // identity on both seats. Absence is production-plausible (unmet / not-yet-visible players, a
  // missing gameState, a non-strategist parameter set), and rendering half the pair by name and the
  // other as a bare "Player N" would be misleading, so skip and surface it rather than fail silently.
  if (!counterpartIdentity?.leader || !selfIdentity?.leader) {
    logger.warn("Diplomacy background skipped: missing civ identity for the pair", {
      viewerID,
      counterpartID,
      hasSelfIdentity: Boolean(selfIdentity?.leader),
      hasCounterpartIdentity: Boolean(counterpartIdentity?.leader),
    });
    return undefined;
  }

  if (parameters.playerID !== undefined && parameters.playerID !== viewerID) {
    logger.warn("Envoy seat differs from parameters.playerID; using the voiced seat", {
      viewerID,
      playerID: parameters.playerID,
    });
  }

  const selfCiv = selfIdentity?.name ?? `Player ${viewerID}`;
  const counterpartCiv = counterpartIdentity.name ?? `Player ${counterpartID}`;
  const window = opts?.recentTurnWindow ?? DEFAULT_RECENT_TURN_WINDOW;

  // Three perspective-aware fetches in parallel; callTool swallows errors (→ undefined), so each
  // section degrades independently.
  const [cities, players, events] = await Promise.all([
    context.callTool<CitiesReport>("get-cities", { PlayerID: viewerID }, parameters),
    context.callTool<PlayersReport>("get-players", { PlayerID: viewerID }, parameters),
    context.callTool<Record<string, unknown[]>>(
      "get-diplomatic-events",
      {
        PlayerID: viewerID,
        OtherPlayerID: counterpartID,
        FromTurn: Math.max(0, parameters.turn - window),
        ToTurn: parameters.turn,
        Formatted: false,
      },
      parameters
    ),
  ]);

  // The voiced seat's own city group and player row should always be present after a successful
  // fetch; a miss means a name-key mismatch (identity name vs. get-cities keying, localization drift,
  // a data-source change) that would silently drop the self side. Log it so the gap is an operational
  // signal rather than invisible context loss.
  if (cities && !cities[selfCiv]) {
    logger.warn("get-cities returned no row for the voiced seat; its cities will be omitted", {
      viewerID,
      selfCiv,
    });
  }

  // Standing deals live on the viewer's own row (visibility 2 -> DiplomaticDeals survives), keyed by
  // counterpart civ name. The row can be a plain string ("Defeated…"/"Unmet…"); guard for an object.
  let standingDeals: StandingDeal[] | undefined;
  const selfRow = players?.[String(viewerID)];
  if (selfRow && typeof selfRow === "object") {
    standingDeals = selfRow.DiplomaticDeals?.[counterpartCiv] as StandingDeal[] | undefined;
  } else if (players) {
    logger.warn("get-players returned no usable row for the voiced seat; standing deals will be omitted", {
      viewerID,
    });
  }

  const sections = [
    cities ? citiesSection(cities, selfCiv, counterpartCiv) : undefined,
    standingDealsSection(standingDeals, selfCiv, counterpartCiv),
    concludedDealsSection(events, viewerID, counterpartID, selfCiv, counterpartCiv, parameters.turn, window),
  ].filter((s): s is string => s !== undefined);

  if (sections.length === 0) return undefined;
  return [`# Cities & Diplomatic Standing (with ${counterpartCiv})`, ...sections].join("\n\n");
}
