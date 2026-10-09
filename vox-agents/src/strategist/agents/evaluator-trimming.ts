/**
 * @module strategist/agents/evaluator-trimming
 *
 * Walks the evaluator strategist's trim ladder (`evaluator-trim-config.ts`) over the trimmable
 * reports until a size check accepts them. Pure: every step works on copies, so the cached
 * `GameState` is never changed. Each action kind has one small applier, which returns undefined
 * when the step would change nothing, so such steps are skipped and not reported.
 */

import type { CitiesReport } from "../../../../mcp-server/dist/tools/knowledge/get-cities.js";
import type { PlayersReport } from "../../../../mcp-server/dist/tools/knowledge/get-players.js";
import type { MilitaryReport } from "../../../../mcp-server/dist/tools/knowledge/get-military-report.js";
import { dropEventTiers, type EventTierName } from "../../utils/prompts/event-importance.js";
import type { TrimStep } from "./evaluator-trim-config.js";

/** The reports the ladder can shorten. Every other part of the state is never trimmed. */
export interface TrimmableReports {
  events?: object;
  players?: PlayersReport;
  cities?: CitiesReport;
  military?: MilitaryReport;
}

/** The outcome of a ladder walk. */
export interface TrimResult {
  /** The shortened reports, or the input itself when nothing was applied. */
  reports: TrimmableReports;
  /** The ladder steps that were applied, in order. */
  steps: TrimStep[];
  /** How many events the applied event steps removed. */
  droppedEvents: number;
  /** Whether the size check accepted the result; false when even the whole ladder was not enough. */
  fits: boolean;
}

/** What an applier needs beyond the reports. */
export interface TrimContext {
  /** Our civilization's name, whose city-state relationships are always kept. */
  civilization?: string;
}

/** One applied step's reports and the events it removed. */
type Applied = { reports: TrimmableReports; droppedEvents?: number } | undefined;

/** A weight at the end of an opinion line, such as `(-30)`, `(+12)`, or `(-51).`. */
const opinionWeight = /\(([+-]?\d+)\)\.?$/;

/** Check for a plain object, as opposed to an array, null, or a scalar. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map the object values of a record through `change`, which returns undefined to leave a value
 * as it is. Returns undefined when no value changed, so callers can skip the step.
 */
function mapChanged<T>(record: T, change: (value: Record<string, unknown>) => Record<string, unknown> | undefined): T | undefined {
  let changed = false;
  const mapped = Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([key, value]) => {
    const next = isRecord(value) ? change(value) : undefined;
    if (next === undefined) return [key, value];
    changed = true;
    return [key, next];
  }));
  return changed ? mapped as T : undefined;
}

/** Copy an object without the given keys, or return undefined when it has none of them. */
function omitKeys(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!keys.some(key => key in value)) return undefined;
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Compress an opinion list to its `keep` most telling items plus one merged line.
 *
 * - Lines ending in a weight such as `(-30)` keep the `keep` largest by absolute weight, in their
 *   original order, and the rest merge into one line with their summed weight.
 * - Lines without a weight are summaries (such as the leader's real approach) and always stay.
 * - A list without any weights (game settings can hide them) cannot be ranked, so it is left alone.
 *
 * @returns The compressed list, or undefined when the list is already short enough or has no weights
 */
export function compressOpinions(lines: readonly string[], keep: number): string[] | undefined {
  const weights = lines.map(line => {
    const match = opinionWeight.exec(line);
    return match ? Number(match[1]) : undefined;
  });
  const ranked = lines.map((_, index) => index)
    .filter(index => weights[index] !== undefined)
    .sort((a, b) => Math.abs(weights[b]!) - Math.abs(weights[a]!) || a - b);
  if (ranked.length <= keep + 1) return undefined;
  const merged = new Set(ranked.slice(keep));
  const total = [...merged].reduce((sum, index) => sum + weights[index]!, 0);
  return [
    ...lines.filter((_, index) => !merged.has(index)),
    `${merged.size} smaller factors combined (${total})`,
  ];
}

/** Drop one event tier, or skip when the tier has no events left. */
function applyEvents(reports: TrimmableReports, tier: EventTierName): Applied {
  if (!reports.events) return undefined;
  const trimmed = dropEventTiers(reports.events, [tier]);
  if (trimmed.droppedEvents === 0) return undefined;
  return { reports: { ...reports, events: trimmed.events }, droppedEvents: trimmed.droppedEvents };
}

/** Delete the listed fields from every city of every owner. */
function applyCityFields(reports: TrimmableReports, fields: readonly string[]): Applied {
  if (!reports.cities) return undefined;
  const cities = mapChanged(reports.cities, owner => mapChanged(owner, city => omitKeys(city, fields)));
  return cities && { reports: { ...reports, cities } };
}

/** Delete the listed top-level sections from the military report. */
function applyMilitaryKeys(reports: TrimmableReports, keys: readonly string[]): Applied {
  if (!reports.military) return undefined;
  const military = omitKeys(reports.military, keys);
  return military && { reports: { ...reports, military } };
}

/** Delete the listed fields from every tactical zone; other military sections have none of them. */
function applyMilitaryZoneFields(reports: TrimmableReports, fields: readonly string[]): Applied {
  if (!reports.military) return undefined;
  const military = mapChanged(reports.military, zone => omitKeys(zone, fields));
  return military && { reports: { ...reports, military } };
}

/** Keep only our own entry in each city-state's relationships. */
function applyCityStateRelationships(reports: TrimmableReports, context: TrimContext): Applied {
  if (!reports.players) return undefined;
  const players = mapChanged(reports.players, player => {
    const relationships = player.Relationships;
    if (player.IsMajor === true || !isRecord(relationships)) return undefined;
    const others = Object.keys(relationships).filter(name => name !== context.civilization);
    if (others.length === 0) return undefined;
    const ours = context.civilization === undefined ? undefined : relationships[context.civilization];
    const { Relationships: _dropped, ...rest } = player;
    return ours === undefined ? rest : { ...rest, Relationships: { [context.civilization!]: ours } };
  });
  return players && { reports: { ...reports, players } };
}

/** Compress both opinion lists of every major civilization. */
function applyOpinions(reports: TrimmableReports, keep: number): Applied {
  if (!reports.players) return undefined;
  const players = mapChanged(reports.players, player => {
    if (player.IsMajor !== true) return undefined;
    const ours = Array.isArray(player.OurOpinionOfThem) ? compressOpinions(player.OurOpinionOfThem, keep) : undefined;
    const theirs = Array.isArray(player.TheirOpinionOfUs) ? compressOpinions(player.TheirOpinionOfUs, keep) : undefined;
    if (!ours && !theirs) return undefined;
    return { ...player, ...(ours && { OurOpinionOfThem: ours }), ...(theirs && { TheirOpinionOfUs: theirs }) };
  });
  return players && { reports: { ...reports, players } };
}

/** Apply one ladder step by its action kind. */
function applyStep(reports: TrimmableReports, step: TrimStep, context: TrimContext): Applied {
  if ("events" in step) return applyEvents(reports, step.events);
  if ("cityFields" in step) return applyCityFields(reports, step.cityFields);
  if ("militaryKeys" in step) return applyMilitaryKeys(reports, step.militaryKeys);
  if ("militaryZoneFields" in step) return applyMilitaryZoneFields(reports, step.militaryZoneFields);
  if ("cityStateRelationships" in step) return applyCityStateRelationships(reports, context);
  return applyOpinions(reports, step.opinions.keep);
}

/**
 * Walk the ladder until `fits` accepts the reports. Steps are cumulative; a step that changes
 * nothing is skipped without a size check. Returns the first result that fits, or the most
 * trimmed one with `fits: false`.
 *
 * @param reports - The trimmable reports (never mutated)
 * @param ladder - The ordered trim steps
 * @param fits - Whether a candidate is small enough
 * @param context - What the appliers need, such as our civilization's name
 */
export function trimToFit(
  reports: TrimmableReports,
  ladder: readonly TrimStep[],
  fits: (candidate: TrimmableReports) => boolean,
  context: TrimContext = {},
): TrimResult {
  const result: TrimResult = { reports, steps: [], droppedEvents: 0, fits: fits(reports) };
  for (const step of ladder) {
    if (result.fits) break;
    const applied = applyStep(result.reports, step, context);
    if (!applied) continue;
    result.reports = applied.reports;
    result.steps.push(step);
    result.droppedEvents += applied.droppedEvents ?? 0;
    result.fits = fits(result.reports);
  }
  return result;
}
