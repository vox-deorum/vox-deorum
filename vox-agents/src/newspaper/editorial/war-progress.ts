/** Detect persistent changes in directional major-war scores without summing allied fronts. */
import type { NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { DiplomacyPair } from '../contracts/diplomacy.js';
import type { EditorialConfig } from './config.js';
import type { DiplomacyFacts } from './diplomacy-facts.js';

export interface WarProgress { stage: string; signature: string; score: number; previousScore: number; sources: NewspaperSourceReference[] }
/** Keep the common history settings effective even when the advantage article itself is disabled. */
export function warHistorySettings(config: EditorialConfig): { window: number; maxGap: number; freshness: number } {
  const tuning = config.triggers.find(entry => entry.detector === 'warProgress' && entry.stage === 'advantage')?.tuning;
  return { window: tuning?.window ?? 30, maxGap: tuning?.maxGap ?? 10, freshness: tuning?.freshness ?? 5 };
}
/** Read a stage's configurable timing and threshold while keeping authored defaults in one place. */
function setting(config: EditorialConfig, stage: string, key: string, fallback: number): number {
  const value = config.triggers.find(entry => entry.detector === 'warProgress' && entry.stage === stage)?.tuning;
  const item = value && key in value ? value[key as keyof typeof value] : undefined;
  return typeof item === 'number' ? item : fallback;
}
/** Find at most one new pair development in the required precedence order. */
export function detectWarProgress(pair: DiplomacyPair, facts: DiplomacyFacts, cutoff: number, config: EditorialConfig,
  eligible: (development: WarProgress) => boolean = () => true): WarProgress | undefined {
  if (pair.state !== 'war' || pair.samples.length < 2) return undefined;
  const { window, maxGap, freshness: fresh } = warHistorySettings(config);
  let rows = pair.samples.filter(sample => facts.standard(cutoff - sample.turn) <= window);
  // A missing observation interval breaks confirmation rather than becoming evidence of a stable front.
  let lastGap = -1;
  for (let index = 1; index < rows.length; index++) if (facts.standard(rows[index].turn - rows[index - 1].turn) > maxGap) lastGap = index;
  if (lastGap > 0) rows = rows.slice(lastGap);
  const latest = rows.at(-1);
  if (!latest || rows.length < 2 || facts.standard(cutoff - latest.turn) > fresh) return undefined;
  const score = latest.score;
  const advantage = setting(config, 'advantage', 'absolute', 25);
  const commanding = setting(config, 'commanding', 'absolute', 60);
  const confirmation = setting(config, 'advantage', 'persistence', 2);
  const currentSign = Math.sign(score);
  /** Respect disabled stages while allowing lower-priority enabled developments to run. */
  const enabled = (stage: string): boolean => config.triggers.some(entry => entry.detector === 'warProgress' && entry.stage === stage && entry.enabled !== false);
  /** Require two distinct observations spanning enough standard turns in the same score band. */
  function confirmed(threshold: number, duration: number): typeof rows {
    let first = rows.length - 1;
    while (first >= 0 && rows[first].score * currentSign >= threshold) first--;
    const tail = rows.slice(first + 1);
    return first >= 0 && tail.length >= 2 && facts.standard(latest!.turn - tail[0].turn) >= duration ? [rows[first], ...tail] : [];
  }
  const advantageRows = confirmed(advantage, confirmation);
  const reversalThreshold = setting(config, 'reversal', 'absolute', 25);
  const reversalRows = confirmed(reversalThreshold, setting(config, 'reversal', 'persistence', 2));
  const commandingRows = confirmed(commanding, setting(config, 'commanding', 'persistence', 2));
  const opposite = rows.filter(row => row.score * currentSign <= -reversalThreshold &&
    facts.standard(latest.turn - row.turn) <= setting(config, 'reversal', 'window', 15)).at(-1);
  /** Skip already published stages before considering the next development in precedence order. */
  function candidate(stage: string, support: typeof rows, signature: string): WarProgress | undefined {
    if (!enabled(stage) || pair.lastKinds[stage] === signature) return undefined;
    if (pair.lastPublication !== null && facts.standard(cutoff - pair.lastPublication) < setting(config, stage, 'cooldown', 10) &&
      !['reversal', 'commanding'].includes(stage)) return undefined;
    const development = { stage, signature, score, previousScore: support[0].score, sources: support.map(row => row.source) };
    return eligible(development) ? development : undefined;
  }
  if (reversalRows.length && opposite) {
    const next = candidate('reversal', [opposite, ...reversalRows], `${opposite.source.table}/${opposite.source.id}/${currentSign}`);
    if (next) return next;
  }
  if (commandingRows.length && pair.commandingArmed) {
    const next = candidate('commanding', commandingRows, `${commandingRows[1].turn}/${currentSign}`);
    if (next) return next;
  }
  if (advantageRows.length && pair.advantageArmed) {
    const next = candidate('advantage', advantageRows, `${advantageRows[1].turn}/${currentSign}`);
    if (next) return next;
  }
  const swing = rows.filter(row => row.turn < latest.turn && facts.standard(latest.turn - row.turn) <= setting(config, 'swing', 'window', 10) &&
    Math.abs(score - row.score) >= setting(config, 'swing', 'absolute', 25)).at(-1);
  if (swing) {
    const next = candidate('swing', [swing, latest], `${swing.source.table}/${swing.source.id}/${Math.sign(score - swing.score)}`);
    if (next) return next;
  }
  let first = rows.length - 1;
  while (first >= 0 && Math.abs(rows[first].score) <= setting(config, 'balance', 'absolute', 10)) first--;
  const balanced = rows.slice(first + 1);
  const priorAdvantage = rows.slice(0, first + 1).filter(row => Math.abs(row.score) >= advantage).at(-1);
  if (priorAdvantage && balanced.length >= 2 && facts.standard(latest.turn - balanced[0].turn) >= setting(config, 'balance', 'persistence', 5)) {
    const next = candidate('balance', [priorAdvantage, ...balanced], `${priorAdvantage.source.table}/${priorAdvantage.source.id}`);
    if (next) return next;
  }
  const duration = setting(config, 'stagnation', 'persistence', 20);
  const range = setting(config, 'stagnation', 'absolute', 10);
  const episodeRows = rows.filter(row => pair.stagnationEpisodeTurn === null || row.turn >= pair.stagnationEpisodeTurn);
  let stableStart = episodeRows.length - 1;
  let low = score;
  let high = score;
  while (stableStart > 0) {
    const next = episodeRows[stableStart - 1].score;
    if (Math.max(high, next) - Math.min(low, next) > range) break;
    stableStart--; low = Math.min(low, next); high = Math.max(high, next);
  }
  const stable = episodeRows.slice(stableStart);
  if (stable.length >= setting(config, 'stagnation', 'minimumSamples', 4) && facts.standard(latest.turn - stable[0].turn) >= duration) {
    // A quiet window sliding forward does not constitute another development.
    return candidate('stagnation', stable, String(pair.stagnationEpisodeTurn));
  }
  return undefined;
}

/** Advance score arms on actual observations, allowing a later renewed band crossing. */
export function rearmWarProgress(pair: DiplomacyPair, score: number, turn: number, config: EditorialConfig): void {
  if (Math.abs(score) < setting(config, 'advantage', 'rearm', 15)) pair.advantageArmed = true;
  if (Math.abs(score) < setting(config, 'commanding', 'rearm', 50)) pair.commandingArmed = true;
  if (Math.abs(score) > setting(config, 'balance', 'absolute', 10)) delete pair.lastKinds.balance;
  if (pair.stagnationScore !== null && Math.abs(score - pair.stagnationScore) > setting(config, 'stagnation', 'absolute', 10)) {
    delete pair.lastKinds.stagnation;
    pair.stagnationScore = null;
    pair.stagnationEpisodeTurn = turn;
  }
}
