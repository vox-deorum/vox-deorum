/**
 * @module envoy/utils/deal-ledger
 *
 * The shared, first-person "Deal On The Table" ledger renderer used by BOTH the diplomat
 * (`diplomat-utils.ts`) and the negotiator (`negotiator-utils.ts`). It folds a deal's terms,
 * the advisory per-item value estimates (from a fresh `inspect-deal`), and, for terms that
 * reference a third civilization, that third party's public relationship to each side plus our
 * own leader's `set-relationship` directive, into one readable markdown block.
 *
 * It is a pure formatter: it imports only types and other pure formatters (never the terminal-tool
 * machinery in `negotiator-utils.ts`), so both consumers can share it without dragging in the
 * durable-store writers. The primitive label/duration helpers (`endpoints`, `civNameFor`,
 * `detailClause`, `renderPromiseDuration`, `namedItemLabel`, …) live here as the single source the
 * menu renderer and the ledger both reuse.
 */

import type { EnvoyThread } from "../../types/index.js";
import { identityOf } from "../../utils/diplomacy/transcript-utils.js";
import type { InspectDealResult } from "../../utils/diplomacy/deal.js";
import {
  formatEstimate,
  formatPromiseLabel,
  itemTypeLabel,
} from "../../../../mcp-server/dist/utils/deal-format.js";
import {
  durationForItemType,
  PROMISE_METADATA,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  DealDurations,
  DealPayload,
  PromiseTerm,
  TradeItem,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import type { OptionsReport } from "../../../../mcp-server/dist/tools/knowledge/get-options.js";

/** The viewer's own `set-relationship` directives, keyed by target civ name (from `get-options`). */
export type RelationshipDirectives = OptionsReport["Relationships"];

/** A seat → civ-name resolver from the thread's stored identities ("Player <id>" fallback). */
export function civNameFor(thread: EnvoyThread): (playerID: number) => string {
  return (id: number) => identityOf(thread, id)?.name ?? `Player ${id}`;
}

/** The negotiator's own seat and its counterpart (the other endpoint of the thread). */
export function endpoints(thread: EnvoyThread): { agentID: number; counterpartID: number } {
  const agentID = thread.agent;
  const counterpartID = thread.player1ID === agentID ? thread.player2ID : thread.player1ID;
  return { agentID, counterpartID };
}

/** Parenthesize comma-separated row details, omitting absent/empty details. */
export function detailClause(...details: Array<string | undefined>): string {
  const present = details.filter((detail): detail is string => !!detail);
  return present.length ? ` (${present.join(", ")})` : "";
}

/** A bare "lasts N turn(s)" phrase for a turn count (singular-aware). */
export function lastsTurns(turns: number): string {
  return `lasts ${turns} ${turns === 1 ? "turn" : "turns"}`;
}

/** A bare "lasts N turns" phrase for a duration-bearing item type, or "" when the type carries none. */
export function durationPhrase(itemType: TradeItem["itemType"], durations: DealDurations): string {
  const turns = durationForItemType(itemType, durations);
  return turns !== undefined ? lastsTurns(turns) : "";
}

/**
 * A bare term-length phrase for a promise. Every offered promise is one the tactical AI honors, so
 * there is no enforcement caveat.
 */
export function renderPromiseDuration(promiseType: PromiseTerm["promiseType"], turns: number | undefined): string {
  if (promiseType === "COOP_WAR") {
    return turns !== undefined ? `war begins in ${turns} turns` : "war begins after a short preparation";
  }
  return turns !== undefined ? lastsTurns(turns) : "lasts until broken";
}

/**
 * Friendly label for an on-the-table item, resolving resource/city/tech/team/vote IDs to NAMES via
 * the inspection range. Duration-bearing terms append their stamped, fixed term length ("lasts N
 * turns") off the item's own `duration` (set server-side by `applyDealDurations`).
 */
export function namedItemLabel(item: TradeItem, inspection?: InspectDealResult): string {
  const giverRange = inspection?.tradableRange[String(item.fromPlayerID)];
  const dur = item.duration ? ` (lasts ${item.duration} turns)` : "";
  switch (item.itemType) {
    case "GOLD":
      return `Gold: ${item.amount ?? 0}`;
    case "GOLD_PER_TURN":
      return `Gold Per Turn: ${item.amount ?? 0}${dur}`;
    case "RESOURCES": {
      const r = giverRange?.resources.find((x) => x.resourceID === item.resourceID);
      return `Resource: ${r?.name ?? `#${item.resourceID}`} x${item.quantity ?? 1}${dur}`;
    }
    case "CITIES": {
      const c = giverRange?.cities.find((x) => x.cityID === item.cityID);
      return `City: ${c?.name ?? `#${item.cityID}`}`;
    }
    case "TECHS": {
      const t = giverRange?.techs.find((x) => x.techID === item.techID);
      return `Technology: ${t?.name ?? `#${item.techID}`}`;
    }
    case "THIRD_PARTY_PEACE": {
      const t = giverRange?.thirdPartyPeace.find((x) => x.teamID === item.thirdPartyTeamID);
      return `Third-Party Peace with ${t?.name ?? `team ${item.thirdPartyTeamID}`}${dur}`;
    }
    case "THIRD_PARTY_WAR": {
      const t = giverRange?.thirdPartyWar.find((x) => x.teamID === item.thirdPartyTeamID);
      return `Third-Party War on ${t?.name ?? `team ${item.thirdPartyTeamID}`}`;
    }
    case "VOTE_COMMITMENT": {
      const v = giverRange?.voteCommitments.find(
        (x) => x.resolutionID === item.resolutionID && x.voteChoice === item.voteChoice && !!x.repeal === !!item.repeal
      );
      return `Vote Commitment: ${v?.name ?? `resolution ${item.resolutionID}`}`;
    }
    default:
      return `${itemTypeLabel(item.itemType)}${dur}`;
  }
}

/** The resolved seats + name resolver a ledger render is framed around (viewer = the voiced seat). */
export interface DealLedgerContext {
  viewerID: number;
  counterpartID: number;
  civName: (playerID: number) => string;
}

/** Derive the ledger context from a thread: {@link endpoints} + {@link civNameFor}. */
export function ledgerContextFor(thread: EnvoyThread): DealLedgerContext {
  const { agentID, counterpartID } = endpoints(thread);
  return { viewerID: agentID, counterpartID, civName: civNameFor(thread) };
}

/** Optional grounding folded into the ledger. All absent → a plain terms-only skeleton. */
export interface DealLedgerOptions {
  /** Fresh inspection of THIS deal (items index-aligned with `deal.items`); absent → no value bullets. */
  inspection?: InspectDealResult;
  /** Viewer-perspective get-players report for third-party public-relationship bullets. */
  players?: PlayersReport;
  /** The viewer's own set-relationship directives (get-options), for the "our leader's intention" lines. */
  relationships?: RelationshipDirectives;
  /** Pre-rendered message block inserted right under the heading (speaker-aware; caller supplies). */
  messageBlock?: string;
}

/** Possessive form: trailing "s" takes a bare apostrophe ("The Zulus'"), else "'s" ("Mongolia's"). */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** "(us)"/"(them)" tag for a seat relative to the viewer. */
function sideTag(id: number, ctx: DealLedgerContext): string {
  return id === ctx.viewerID ? "us" : "them";
}

/** One seat's public relationship status toward a third party (from get-players), or undefined. */
function relationshipStatus(
  players: PlayersReport | undefined,
  endpointID: number,
  targetName: string
): string | undefined {
  const row = players?.[String(endpointID)];
  if (!row || typeof row !== "object") return undefined;
  const rels = (row as { Relationships?: Record<string, string | string[]> }).Relationships;
  const value = rels?.[targetName];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join("; ") : value;
}

/** Render our leader's set-relationship directive toward a civ as a one-line clause, or "" when none. */
function directiveClause(relationships: RelationshipDirectives | undefined, targetName: string): string {
  const dir = relationships?.[targetName];
  if (!dir) return "";
  const rationale = dir.Rationale ? ` (${dir.Rationale})` : "";
  return `Public ${dir.Public}/Private ${dir.Private}${rationale}`;
}

/**
 * The relationship bullets for a term that references a third party `targetName`: each side's public
 * relationship to it, with our own leader's directive toward the target inlined under our side. Menu
 * callers pass `indent: "  "` and omit `relationships` (the directive is a deal-ledger-only detail).
 */
export function thirdPartyRelationshipBullets(
  targetName: string,
  ctx: DealLedgerContext,
  players: PlayersReport | undefined,
  options: { relationships?: RelationshipDirectives; indent?: string } = {}
): string[] {
  const { relationships, indent = "" } = options;
  const lines: string[] = [];

  const ourStatus = relationshipStatus(players, ctx.viewerID, targetName);
  if (ourStatus !== undefined) {
    lines.push(`${indent}- ${possessive(ctx.civName(ctx.viewerID))} (our) relationship to ${targetName} (third-party): ${ourStatus}`);
  }
  const directive = directiveClause(relationships, targetName);
  if (directive) {
    lines.push(`${indent}> Our leader's intention for ${targetName}: ${directive}`);
  }
  const theirStatus = relationshipStatus(players, ctx.counterpartID, targetName);
  if (theirStatus !== undefined) {
    lines.push(`${indent}- ${possessive(ctx.civName(ctx.counterpartID))} (their) relationship to ${targetName} (third-party): ${theirStatus}`);
  }
  return lines;
}

/** The "## Our Leader's Intention Toward <Counterpart>" top section, or undefined when no directive is set. */
function counterpartIntentionSection(ctx: DealLedgerContext, relationships: RelationshipDirectives | undefined): string | undefined {
  const name = ctx.civName(ctx.counterpartID);
  const dir = relationships?.[name];
  if (!dir) return undefined;
  const lines = [`## Our Leader's Intention Toward ${name}`, `Public ${dir.Public}, Private ${dir.Private}`];
  if (dir.Rationale) lines.push(`> Rationale: ${dir.Rationale}`);
  return lines.join("\n");
}

/** Build the target-name map for {@link formatPromiseLabel} from the inspection + players report. */
function promiseTargetNames(options: DealLedgerOptions): Record<number, string> {
  const names: Record<number, string> = {};
  for (const t of options.inspection?.promiseTargets ?? []) {
    if (t.name) names[t.playerID] = t.name;
  }
  return names;
}

/** The third-party target NAME a term references (for relationship lookup), or undefined. */
function itemTargetName(item: TradeItem, options: DealLedgerOptions): string | undefined {
  const giverRange = options.inspection?.tradableRange[String(item.fromPlayerID)];
  if (item.itemType === "THIRD_PARTY_WAR") {
    return giverRange?.thirdPartyWar.find((x) => x.teamID === item.thirdPartyTeamID)?.name;
  }
  if (item.itemType === "THIRD_PARTY_PEACE") {
    return giverRange?.thirdPartyPeace.find((x) => x.teamID === item.thirdPartyTeamID)?.name;
  }
  return undefined;
}

/** The `### term` subsection (header + value/relationship bullets) for one trade item. */
function itemSubsection(
  item: TradeItem,
  index: number,
  ctx: DealLedgerContext,
  options: DealLedgerOptions
): string {
  const lines = [`### ${namedItemLabel(item, options.inspection)}`];
  const inspected = options.inspection?.items[index];
  if (inspected) {
    // valueIfIGive is the giver's advisory value, valueIfIReceive the receiver's; giver first.
    lines.push(`- Estimated value to ${ctx.civName(item.fromPlayerID)} (${sideTag(item.fromPlayerID, ctx)}): ${formatEstimate(inspected.valueIfIGive)}`);
    lines.push(`- Estimated value to ${ctx.civName(item.toPlayerID)} (${sideTag(item.toPlayerID, ctx)}): ${formatEstimate(inspected.valueIfIReceive)}`);
    if (!inspected.legality) {
      lines.push(`- ILLEGAL right now: ${inspected.reasons.join("; ") || "no reason given"}`);
    }
  }
  const targetName = itemTargetName(item, options);
  if (targetName) {
    lines.push(...thirdPartyRelationshipBullets(targetName, ctx, options.players, { relationships: options.relationships }));
  }
  return lines.join("\n");
}

/** The `### term` subsection for one promise (duration in the header, third-party bullets when targeted). */
function promiseSubsection(
  promise: PromiseTerm,
  ctx: DealLedgerContext,
  options: DealLedgerOptions,
  targetNames: Record<number, string>
): string {
  const label = formatPromiseLabel(promise, targetNames);
  const lines = [`### ${label}${detailClause(renderPromiseDuration(promise.promiseType, promise.duration))}`];
  if (PROMISE_METADATA[promise.promiseType].targeted && promise.targetPlayerID !== undefined) {
    const targetName = targetNames[promise.targetPlayerID];
    if (targetName) {
      lines.push(...thirdPartyRelationshipBullets(targetName, ctx, options.players, { relationships: options.relationships }));
    }
  }
  return lines.join("\n");
}

/** One directional section (`## <Giver> Offers To Give <Receiver>` + its term subsections), or undefined. */
function directionSection(
  deal: DealPayload,
  giverID: number,
  receiverID: number,
  ctx: DealLedgerContext,
  options: DealLedgerOptions,
  targetNames: Record<number, string>
): string | undefined {
  const subsections: string[] = [];
  deal.items.forEach((item, index) => {
    if (item.fromPlayerID === giverID && item.toPlayerID === receiverID) {
      subsections.push(itemSubsection(item, index, ctx, options));
    }
  });
  for (const promise of deal.promises) {
    if (promise.promiserID === giverID && promise.recipientID === receiverID) {
      subsections.push(promiseSubsection(promise, ctx, options, targetNames));
    }
  }
  if (subsections.length === 0) return undefined;
  return `## ${ctx.civName(giverID)} Offers To Give ${ctx.civName(receiverID)}\n${subsections.join("\n\n")}`;
}

/**
 * Render the unified proposal ledger under a caller-supplied `heading` line: the advisory note, the
 * optional message block, our leader's intention toward the counterpart, then each direction's terms
 * with per-item value estimates and third-party relationship context. `options` is a true option:
 * with none supplied, the result is a plain `##`/`###` skeleton (no bullets, no note).
 */
export function formatDealLedger(
  deal: DealPayload,
  heading: string,
  ctx: DealLedgerContext,
  options: DealLedgerOptions = {}
): string {
  const targetNames = promiseTargetNames(options);
  const blocks: string[] = [];

  // Heading (+ the once-per-ledger advisory note, only when values will actually render).
  blocks.push(
    options.inspection && deal.items.length > 0
      ? `${heading}\nNote that estimated value is an advisory value from in-game AI.`
      : heading
  );

  if (options.messageBlock) blocks.push(options.messageBlock);
  const intention = counterpartIntentionSection(ctx, options.relationships);
  if (intention) blocks.push(intention);

  // Viewer's giving side first, then the counterpart's.
  for (const [giverID, receiverID] of [
    [ctx.viewerID, ctx.counterpartID],
    [ctx.counterpartID, ctx.viewerID],
  ] as const) {
    const section = directionSection(deal, giverID, receiverID, ctx, options, targetNames);
    if (section) blocks.push(section);
  }

  return blocks.join("\n\n");
}
