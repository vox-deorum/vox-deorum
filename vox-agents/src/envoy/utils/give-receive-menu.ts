/**
 * @module envoy/utils/give-receive-menu
 *
 * Renders the shared first-person GIVE/RECEIVE tradable menu (context 2): for each side, every legal
 * term grouped by category with advisory value, counts, and durations. Negotiators also receive a
 * copyable example on each heading, while diplomats receive the same live rows for awareness only.
 * The labels and names mirror what `ledger-resolver.ts` parses back. {@link formatGiveReceiveLedger}
 * is the public entry; negotiators and diplomats compose it with their role-specific presentation.
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

/** Role-specific framing for the same legal Give/Receive rows. */
export type GiveReceivePresentation = "negotiator" | "diplomat";

/** Options controlling how the shared legal deal-item menu is presented. */
export interface GiveReceiveLedgerOptions {
  presentation?: GiveReceivePresentation;
}

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
  presentation: GiveReceivePresentation,
  relBullets?: (targetName: string) => string[]
): string {
  const head = `## What ${giverName} Can Give`;
  const out: string[] = [head, `- ${subline}`];
  // Diplomats need the live legal rows, but not the copyable authoring examples supplied to negotiators.
  const pushCategory = (title: string, rows: string[], example?: string): void => {
    pushMenuCategory(out, title, rows, presentation === "negotiator" ? example : undefined);
  };

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
  pushCategory("Gold", goldRows, goldExample);

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
  pushCategory("Luxury Resources", luxury.map(resourceRow), resourceExample(luxury));
  pushCategory("Strategic Resources", strategic.map(resourceRow), resourceExample(strategic));

  // World Congress vote commitments (votes + advisory value). The example is the first resolution name.
  const legalVotes = range.voteCommitments.filter((v) => v.legal);
  const voteRows = legalVotes.map(
    (v) =>
      `- ${v.name ?? `Resolution #${v.resolutionID}`}${detailClause(
        `${v.numVotes} ${v.numVotes === 1 ? "vote" : "votes"}`,
        bareValue(v.valueToReceiver, receiverName)
      )}`
  );
  pushCategory("World Congress", voteRows, legalVotes[0]?.name);

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
  pushCategory("Agreements", agreementRows, legalAgreements[0]?.label);

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
  pushCategory("Cities", cityRows, legalCities[0]?.name);

  // Technologies. The example is the first technology name.
  const legalTechs = range.techs.filter((t) => t.legal);
  const techRows = legalTechs.map(
    (t) => `- ${t.name ?? `Tech #${t.techID}`}${valueClause(t.valueToReceiver, receiverName)}`
  );
  pushCategory("Technologies", techRows, legalTechs[0]?.name);

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
  pushCategory("Third-Party Peace & War", tpRows, tpExample);

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
  pushCategory("Promises", promiseRows, promiseExample);

  return out.join("\n").trim();
}

/**
 * Format the full first-person Give/Receive ledger menu (context 2): what the agent's civ can GIVE
 * (its own tradable range) and what it can RECEIVE (the counterpart's range). Negotiator presentation
 * adds quoted examples so the menu doubles as a tool-authoring template. Diplomat presentation keeps
 * the same legal rows without those authoring cues.
 */
export function formatGiveReceiveLedger(
  inspection: InspectDealResult,
  thread: EnvoyThread,
  players?: PlayersReport,
  options: GiveReceiveLedgerOptions = {}
): string {
  const presentation = options.presentation ?? "negotiator";
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
    presentation,
    relBullets
  );
  const receive = formatSideMenu(
    inspection.tradableRange[String(counterpartID)],
    counterpartName,
    agentName,
    `Potential terms ${counterpartName} can give ${agentName} (YOUR civ)`,
    inspection.promiseTargets,
    inspection,
    presentation,
    relBullets
  );
  return [
    presentation === "negotiator"
      ? "Each Give/Receive entry is ONE plain string. Follow the quoted example on each heading below. " +
        "Add a number only for Gold, Gold Per Turn, or a resource quantity; durations and vote counts are fixed by the game."
      : "These are the currently possible deal items for conversational awareness only. " +
        "Do not construct or approve terms yourself; the negotiator remains responsible for deal decisions.",
    give,
    receive,
  ].join("\n\n").trim();
}
