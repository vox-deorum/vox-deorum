/** Curated non-war developments from permitted dated observations. */
import type { NewspaperEvidence, NewspaperSnapshot, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialConfig } from './config.js';
import type { EditorialContext } from './triggers.js';

export type Definition = EditorialConfig['triggers'][number];
export interface Draft { subject: string; keys: string[]; magnitude: number; values: Record<string, string | number>; sources: NewspaperSourceReference[]; summary: string; tags: string[]; fingerprint?: string }

/** Read a finite measurement, allowing negative balances only where the field permits them. */
export function number(row: NewspaperSnapshot, field: string): number | undefined {
  const value = row.values[field];
  const signed = ['Gold', 'GoldPerTurn', 'FoodPerTurn', 'HappinessPercentage', 'HappinessDelta'].includes(field);
  return typeof value === 'number' && Number.isFinite(value) && (signed || value >= 0) ? value : undefined;
}
/** Read a recorded identity without inventing a localized database name. */
export function identity(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/** Read an explicit list, preserving unavailable values. */
export function names(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}
/** Select ordered dated history, with one final row for each subject and turn. */
export function history(rows: NewspaperSnapshot[], current: NewspaperSnapshot, window: number): NewspaperSnapshot[] {
  const dated = rows.filter(row => row.subjectID === current.subjectID && row.source.turn < current.source.turn &&
    row.source.turn >= current.source.turn - window).sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
  return [...new Map(dated.map(row => [row.source.turn, row])).values()];
}
/** Require a previous completed boundary so an initial observation is only a baseline. */
export function prior(rows: NewspaperSnapshot[], previous: number): NewspaperSnapshot | undefined {
  return rows.filter(row => row.source.turn <= previous).at(-1);
}
/** Verify same-owner city continuity throughout a comparison, including the available lifecycle log. */
export function continuous(evidence: NewspaperEvidence, rows: NewspaperSnapshot[], current: NewspaperSnapshot): boolean {
  const owner = current.values.Owner;
  if (typeof owner !== 'string' || !rows.length || evidence.limitations?.length) return false;
  if (rows.some(row => row.values.Owner !== owner ||
    (row.values.X !== undefined && current.values.X !== undefined && (row.values.X !== current.values.X || row.values.Y !== current.values.Y)))) return false;
  return !evidence.events.some(event => ['CityCaptureComplete', 'CityFlipped', 'PlayerLiberated', 'CityRazed'].includes(event.type) &&
    event.source.turn >= rows[0].source.turn && event.source.turn <= current.source.turn &&
    (event.values.CityID === current.subjectID || (current.values.X !== undefined && event.values.CityX === current.values.X && event.values.CityY === current.values.Y)));
}
/** Establish persistence from at least two observations with bounded gaps and an observed earlier opposite state. */
export function transition(rows: NewspaperSnapshot[], current: NewspaperSnapshot, field: string, negative: boolean,
  duration: number, maxGap: number, previous: number): NewspaperSnapshot[] | undefined {
  const all = [...rows, current];
  let start = all.length - 1;
  while (start >= 0) {
    const value = number(all[start], field);
    if (value === undefined || (value < 0) !== negative) break;
    start--;
  }
  if (start < 0 || start === all.length - 1) return undefined;
  const boundary = all[start];
  const tail = all.slice(start + 1);
  if (number(boundary, field) === undefined || tail.length < 2 || current.source.turn - tail[0].source.turn < duration) return undefined;
  if (all.slice(start + 1).some((row, index) => row.source.turn - all[start + index].source.turn > maxGap)) return undefined;
  const qualified = tail.find(row => row.source.turn - tail[0].source.turn >= duration);
  return qualified && qualified.source.turn > previous ? [boundary, ...tail] : undefined;
}
/** Parse a complete outgoing-route observation, separating known partners from positive gold shares. */
export function routes(row: NewspaperSnapshot, context: EditorialContext, receiver: number): { count: number; gold: number; partners: Map<number, number> } | undefined {
  const value = row.values.OutgoingTradeRoutes;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let count = 0;
  let gold = 0;
  const partners = new Map<number, number>();
  for (const [label, raw] of Object.entries(value)) {
    if (label === 'Not assigned' && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) continue;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const name = /\(([^()]*)\)\s*$/.exec(label)?.[1];
    const matching = Object.entries(context.playerNames ?? {}).filter(([, candidate]) => candidate === name);
    if (matching.length !== 1) return undefined;
    const partner = Number(matching[0][0]);
    if (partner === receiver) continue;
    const amount = (raw as Record<string, unknown>).FromGold;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < -1) return undefined;
    count++;
    // -1 explicitly means no gold yield, while the route and partner remain observed.
    const income = Math.max(0, amount);
    gold += income;
    partners.set(partner, (partners.get(partner) ?? 0) + income);
  }
  return { count, gold, partners };
}
/** Compare absolute and proportional changes together, including a measured zero baseline. */
export function material(before: number, after: number, absolute: number, relative: number): boolean {
  return Math.abs(after - before) >= absolute && Math.abs(after - before) >= Math.abs(before) * relative && before !== after;
}
/** Read an explicit golden-age state from the recorded status text. */
export function golden(value: unknown): boolean | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (/^\d+ turns? remaining$/i.test(value.trim())) return true;
  if (/^(Estimated in \d+ turns?|Need More Happiness|Not in Golden Age)/i.test(value)) return false;
  return undefined;
}
/** Shared observation scope and draft builders used by the independent topic detectors. */
export interface DevelopmentEnvironment {
  evidence: NewspaperEvidence; definition: Definition; context: EditorialContext; result: Draft[];
  cutoff: number; previous: number; receiver: number; tuning: NonNullable<Definition['tuning']>;
  pace: number; window: number; maxGap: number; own?: NewspaperSnapshot; metric?: string;
  playerName: (id: number) => string;
  add: (subject: string, topic: string, magnitude: number, values: Record<string, string | number>,
    rows: { source: NewspaperSourceReference }[], summary: string) => void;
  national: (row: NewspaperSnapshot, before: NewspaperSnapshot, topic: string, magnitude: number,
    values: Record<string, string | number>, summary: string) => void;
}
