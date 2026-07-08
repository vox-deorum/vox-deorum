/**
 * @module envoy/utils/give-receive-menu
 *
 * Renders the negotiator's first-person GIVE/RECEIVE tradable menu (context 2): for each side, every legal
 * term grouped by category with advisory value, counts, and durations, and — on each heading — a
 * copyable `(example format "...")` example of the exact `propose-deal` string to author for that category. The
 * menu doubles as the authoring template, so the labels/names here mirror what `ledger-resolver.ts`
 * parses back. {@link formatGiveReceiveLedger} is the public entry; {@link Negotiator} composes it.
 */

import { isSentinel } from "../../../../mcp-server/dist/utils/deal-format.js";
import {
  durationForPromiseType,
  AGREEMENT_METADATA,
  PROMISE_METADATA,
  PROMISE_TYPES,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type { DealDurations } from "../../../../mcp-server/dist/utils/deal-schema.js";
import type { NormalizedSideRange } from "../../../../mcp-server/dist/tools/knowledge/inspect-deal.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import type { InspectDealResult } from "../../utils/diplomacy/deal.js";
import type { EnvoyThread } from "../../types/index.js";
import {
  civNameFor,
  detailClause,
  durationPhrase,
  endpoints,
  ledgerContextFor,
  renderPromiseDuration,
  thirdPartyRelationshipBullets,
} from "./deal-ledger.js";

/** A bare advisory-value phrase ("worth ~N to <civ>" / "no usable estimate"), or "" when absent. */
function bareValue(value: number | undefined, receiverName: string): string {
  if (value === undefined) return "";
  return isSentinel(value) ? "no usable estimate" : `worth ~${Math.round(value)} to ${receiverName}`;
}

/** A parenthesized advisory-value clause for a menu row, or "" when no estimate is available. */
function valueClause(value: number | undefined, receiverName: string): string {
  return detailClause(bareValue(value, receiverName));
}

/** Append a "### <title>" block when it has rows, tagging the heading with a copyable `(example format "...")`
 * example so the model sees the exact propose-deal string form for that category. The leading newline
 * (the menu is join("\n")-ed) puts one blank line BEFORE each header and none after; the final .trim()
 * drops any leading blank. */
function pushMenuCategory(into: string[], title: string, rows: string[], example?: string): void {
  if (rows.length === 0) return;
  into.push(example ? `\n### ${title} (example format "${example}")` : `\n### ${title}`, ...rows);
}

/**
 * Render one side's tradable range as a first-person "What <Giver> Can Give" menu (only legal terms),
 * with the friendly term labels and entity NAMES the `propose-deal` tool expects, plus advisory value
 * (to the receiver), available counts, net income, and city population/HP. `receiverName` frames the
 * advisory values; `promiseTargets` drives the targeted-promise rows.
 */
function formatSideMenu(
  range: NormalizedSideRange,
  giverName: string,
  receiverName: string,
  subline: string,
  promiseTargets: InspectDealResult["promiseTargets"],
  durations: DealDurations,
  relBullets?: (targetName: string) => string[]
): string {
  const head = `## What ${giverName} Can Give`;
  const out: string[] = [head, `- ${subline}`];

  // Gold + gold per turn (net income shows how much GPT the side can sustain; GPT runs for a term).
  // The example shows the amount-appended form the propose-deal string grammar expects.
  const goldRows: string[] = [];
  if (range.gold.available) goldRows.push(`- Gold (up to ${range.gold.max})`);
  if (range.goldPerTurn.available) {
    goldRows.push(`- Gold Per Turn${detailClause(
      range.netGoldPerTurn !== undefined ? `${giverName}'s net income: ${range.netGoldPerTurn}/turn` : undefined,
      durationPhrase("GOLD_PER_TURN", durations)
    )}`);
  }
  // Prefer the lump-sum Gold example (clamped to what the side has); otherwise ground a GPT example in
  // the side's sustainable net income rather than a magic constant.
  const goldExample = range.gold.available
    ? `Gold ${Math.min(100, Math.max(1, range.gold.max))}`
    : `Gold Per Turn ${Math.max(1, Math.min(20, range.netGoldPerTurn ?? 10))}`;
  pushMenuCategory(out, "Gold", goldRows, goldExample);

  // Resources, bucketed luxury then strategic (count + duration + advisory value). The example appends
  // a quantity to the first legal resource in the bucket.
  const legalResources = (category: "luxury" | "strategic") =>
    range.resources.filter((r) => r.legal && r.category === category);
  const resourceRow = (r: NormalizedSideRange["resources"][number]): string =>
    `- ${r.name ?? `Resource #${r.resourceID}`}${detailClause(
      `${r.quantityAvailable} available`,
      durationPhrase("RESOURCES", durations),
      bareValue(r.valueToReceiver, receiverName)
    )}`;
  const resourceExample = (list: NormalizedSideRange["resources"]): string | undefined =>
    list[0]?.name ? `${list[0].name} 1` : undefined;
  const luxury = legalResources("luxury");
  const strategic = legalResources("strategic");
  pushMenuCategory(out, "Luxury Resources", luxury.map(resourceRow), resourceExample(luxury));
  pushMenuCategory(out, "Strategic Resources", strategic.map(resourceRow), resourceExample(strategic));

  // World Congress vote commitments (votes + advisory value). The example is the first resolution name.
  const legalVotes = range.voteCommitments.filter((v) => v.legal);
  const voteRows = legalVotes.map(
    (v) =>
      `- ${v.name ?? `Resolution #${v.resolutionID}`}${detailClause(
        `${v.numVotes} ${v.numVotes === 1 ? "vote" : "votes"}`,
        bareValue(v.valueToReceiver, receiverName)
      )}`
  );
  pushMenuCategory(out, "World Congress", voteRows, legalVotes[0]?.name);

  // Agreements: single-shot toggles + the four mutual pacts (tagged). Each shows its fixed term
  // length where it carries one; mutual pacts are tagged and omit the (symmetric) advisory value.
  const legalAgreements = AGREEMENT_METADATA.filter(({ rangeKey }) => {
    const cand = range[rangeKey as keyof NormalizedSideRange] as NormalizedSideRange["maps"] | undefined;
    return cand?.legal;
  });
  const agreementRows = legalAgreements.map(({ rangeKey, label, itemType, mutual }) => {
    const cand = range[rangeKey as keyof NormalizedSideRange] as NormalizedSideRange["maps"] | undefined;
    return `- ${label}${detailClause(
      mutual ? "Mutual" : undefined,
      durationPhrase(itemType, durations),
      mutual ? undefined : bareValue(cand!.valueToReceiver, receiverName)
    )}`;
  });
  pushMenuCategory(out, "Agreements", agreementRows, legalAgreements[0]?.label);

  // Cities (population + HP + advisory value). The example is the first city name.
  const legalCities = range.cities.filter((c) => c.legal);
  const cityRows = legalCities.map(
    (c) =>
      `- ${c.name}${detailClause(
        c.population !== undefined ? `Population ${c.population}` : undefined,
        c.hitPoints !== undefined && c.maxHitPoints !== undefined ? `HP ${c.hitPoints}/${c.maxHitPoints}` : undefined,
        bareValue(c.valueToReceiver, receiverName)
      )}`
  );
  pushMenuCategory(out, "Cities", cityRows, legalCities[0]?.name);

  // Technologies. The example is the first technology name.
  const legalTechs = range.techs.filter((t) => t.legal);
  const techRows = legalTechs.map(
    (t) => `- ${t.name ?? `Tech #${t.techID}`}${valueClause(t.valueToReceiver, receiverName)}`
  );
  pushMenuCategory(out, "Technologies", techRows, legalTechs[0]?.name);

  // Third-party peace & war (target civ names + advisory value; peace runs for the peace-deal term).
  // Each legal target trails the two sides' public relationship to it (relBullets), indented. The
  // example is the first legal target in its copyable "Third-Party Peace with <civ>" form.
  const peaceDur = durationPhrase("THIRD_PARTY_PEACE", durations);
  const tpBullets = (name: string | undefined): string[] => (name ? relBullets?.(name) ?? [] : []);
  const legalPeace = range.thirdPartyPeace.filter((t) => t.legal);
  const legalWar = range.thirdPartyWar.filter((t) => t.legal);
  const tpRows = [
    ...legalPeace.flatMap((t) => [
      `- Third-Party Peace with ${t.name ?? `team ${t.teamID}`}${detailClause(
        peaceDur,
        bareValue(t.valueToReceiver, receiverName)
      )}`,
      ...tpBullets(t.name),
    ]),
    ...legalWar.flatMap((t) => [
      `- Third-Party War on ${t.name ?? `team ${t.teamID}`}${valueClause(t.valueToReceiver, receiverName)}`,
      ...tpBullets(t.name),
    ]),
  ];
  const tpExample = legalPeace[0]?.name
    ? `Third-Party Peace with ${legalPeace[0].name}`
    : legalWar[0]?.name
      ? `Third-Party War on ${legalWar[0].name}`
      : undefined;
  pushMenuCategory(out, "Third-Party Peace & War", tpRows, tpExample);

  // Promises: the untargeted ones (with their term length), then one Coop War row per eligible major
  // target (each row is copyable verbatim as its own propose-deal string). Only AI-honored promises
  // are offered. The example is the first untargeted promise label.
  const untargetedPromises = PROMISE_TYPES.filter((t) => !PROMISE_METADATA[t].targeted);
  const promiseRows = untargetedPromises.map(
    (promiseType) =>
      `- ${PROMISE_METADATA[promiseType].label}${detailClause(renderPromiseDuration(promiseType, durationForPromiseType(promiseType, durations)))}`
  );
  const coopTargets = (promiseTargets ?? []).filter((t) => t.kind === "major" && t.coopWarEligible !== false);
  const coopDur = renderPromiseDuration("COOP_WAR", durationForPromiseType("COOP_WAR", durations));
  for (const t of coopTargets) {
    promiseRows.push(`- ${PROMISE_METADATA.COOP_WAR.label} on ${t.name ?? `player ${t.playerID}`}${detailClause(coopDur)}`);
    promiseRows.push(...tpBullets(t.name));
  }
  const promiseExample = untargetedPromises[0] ? PROMISE_METADATA[untargetedPromises[0]].label : undefined;
  pushMenuCategory(out, "Promises", promiseRows, promiseExample);

  return out.join("\n").trim();
}

/**
 * Format the full first-person Give/Receive ledger menu (context 2): what the negotiator's civ can GIVE
 * (its own tradable range) and what it can RECEIVE (the counterpart's range). Every heading carries a
 * quoted `(example format "...")` example of the exact propose-deal string the model should copy for that
 * category, so the menu doubles as the tool's authoring template.
 */
export function formatGiveReceiveLedger(
  inspection: InspectDealResult,
  thread: EnvoyThread,
  players?: PlayersReport
): string {
  const { agentID, counterpartID } = endpoints(thread);
  const name = civNameFor(thread);
  const ctx = ledgerContextFor(thread);
  // Menu sub-bullets carry only the public relationship status (no set-relationship directive;
  // that stays a deal-ledger detail), indented two spaces under the third-party candidate row.
  const relBullets = (targetName: string) =>
    thirdPartyRelationshipBullets(targetName, ctx, players, { indent: "  " });
  const agentName = name(agentID);
  const counterpartName = name(counterpartID);
  const give = formatSideMenu(
    inspection.tradableRange[String(agentID)],
    agentName,
    counterpartName,
    `Potential terms ${agentName} (YOUR civ) can give ${counterpartName}`,
    inspection.promiseTargets,
    inspection,
    relBullets
  );
  const receive = formatSideMenu(
    inspection.tradableRange[String(counterpartID)],
    counterpartName,
    agentName,
    `Potential terms ${counterpartName} can give ${agentName} (YOUR civ)`,
    inspection.promiseTargets,
    inspection,
    relBullets
  );
  return [
    "Each Give/Receive entry is ONE plain string. Follow the quoted example on each heading below. " +
      "Add a number only for Gold, Gold Per Turn, or a resource quantity; durations and vote counts are fixed by the game.",
    give,
    receive,
  ].join("\n\n").trim();
}
