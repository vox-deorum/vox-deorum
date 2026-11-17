/** Dispatch configurable non-war families through shared dated evidence helpers. */
import type {
  NewspaperEvidence,
  NewspaperSnapshot,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialContext } from '../shared/context.js';
import { uniqueSources } from '../shared/sources.js';
import type { Definition, Draft, DevelopmentEnvironment } from './development-facts.js';
import { detectCityDevelopments } from './cities.js';
import {
  detectOutputDevelopments,
  detectDomesticDevelopments,
  detectTechnologyLead,
} from './national.js';
import { detectEventDevelopments } from './events.js';

/** Match one configured family and return bounded factual drafts for shared editorial scoring. */
export function detectDevelopments(
  evidence: NewspaperEvidence,
  definition: Definition,
  context: EditorialContext
): Draft[] {
  const result: Draft[] = [];
  const {
    cutoffTurn: cutoff,
    previousCheckTurn: previous,
    receiverPlayerID: receiver,
  } = evidence.request;
  const tuning = definition.tuning ?? {};
  const pace =
    context.standardTurnsPerGameTurn && context.standardTurnsPerGameTurn > 0
      ? 1 / context.standardTurnsPerGameTurn
      : 1;
  const window = (tuning.window ?? 15) * pace;
  const maxGap = (tuning.maxGap ?? 5) * pace;
  const own = evidence.players.find((row) => row.subjectID === receiver);
  /** Resolve only recorded identity metadata for a player label. */
  const playerName = (id: number): string =>
    context.playerNames?.[String(id)] ?? `Civilization ${id}`;
  /** Build one fully referenced story with common comparison and identity placeholders. */
  function add(
    subject: string,
    topic: string,
    magnitude: number,
    values: Record<string, string | number>,
    rows: { source: NewspaperSourceReference }[],
    summary: string
  ): void {
    const sources = uniqueSources(rows.map((row) => row.source));
    if (!sources.length || sources.some((source) => source.turn > cutoff)) return;
    result.push({
      subject,
      keys: [topic],
      magnitude,
      values: {
        fromTurn: Math.min(...sources.map((source) => source.turn)),
        toTurn: Math.max(...sources.map((source) => source.turn)),
        ...values,
      },
      sources,
      summary,
      tags: values.scope
        ? [
            ...definition.tags.filter((tag) => tag !== 'domestic' && tag !== 'international'),
            String(values.scope),
          ]
        : definition.tags,
    });
  }
  /** Add a national story with a usable civilization link and shared topic continuity. */
  function national(
    row: NewspaperSnapshot,
    before: NewspaperSnapshot,
    topic: string,
    magnitude: number,
    values: Record<string, string | number>,
    summary: string
  ): void {
    add(
      `civilization/${row.subjectID}`,
      `civilization/${row.subjectID}/${topic}`,
      magnitude,
      {
        partnerId: row.subjectID,
        partner: playerName(row.subjectID),
        scope: row.subjectID === receiver ? 'domestic' : 'international',
        ...values,
      },
      [before, row],
      summary
    );
  }
  const cityDetector = [
    'cityPopulation',
    'cityFood',
    'cityRecovery',
    'cityStatus',
    'wonder',
    'greatWorks',
  ].includes(definition.detector);
  const metric =
    definition.detector === 'economyIncome'
      ? 'GoldPerTurn'
      : definition.detector === 'scienceOutput'
        ? 'SciencePerTurn'
        : ['cultureOutput', 'foreignCulture'].includes(definition.detector)
          ? 'CulturePerTurn'
          : definition.detector === 'tourismOutput'
            ? 'TourismPerTurn'
            : undefined;
  const env: DevelopmentEnvironment = {
    evidence,
    definition,
    context,
    result,
    cutoff,
    previous,
    receiver,
    tuning,
    pace,
    window,
    maxGap,
    own,
    metric,
    playerName,
    add,
    national,
  };
  if (cityDetector) detectCityDevelopments(env);
  else if (metric) detectOutputDevelopments(env);
  else {
    detectDomesticDevelopments(env);
    detectTechnologyLead(env);
    detectEventDevelopments(env);
  }
  return result;
}
