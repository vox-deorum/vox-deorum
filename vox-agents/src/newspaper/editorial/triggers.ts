/** Derive bounded developments only from permitted, dated observations. */
import type { NewspaperEvidence, NewspaperSnapshot, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialConfig } from './config.js';
import { evaluateCondition, type ConditionContext } from './conditions.js';
import { detectDevelopments } from './developments.js';

/** Identity metadata is separate from projected observations and never supplies unobserved metrics. */
export interface EditorialContext {
  receiverTeamId?: number;
  receiverOwnerName?: string;
  playerNames?: Record<string, string>;
  playerTeamIds?: Record<string, number>;
  technologies?: string[];
  technologyHistoryComplete?: boolean;
  civilization?: string;
  technologyIdentities?: Record<string, { type: string; name: string }>;
  majorPlayerIds?: number[];
  standardTurnsPerGameTurn?: number;
}
/** One measured development, with placeholders and traceable source rows. */
export interface DetectedTrigger {
  id: string;
  definitionId: string;
  subject: string;
  seriesKeys: string[];
  period: { from: number; to: number };
  importance: number;
  urgent: boolean;
  tags: string[];
  values: Record<string, string | number>;
  sources: NewspaperSourceReference[];
  summary: string;
  fingerprint: string;
}

/** Read finite numeric facts, retaining missing and negative sentinel values as unavailable. */
function measured(values: Record<string, unknown>, field: string): number | undefined {
  const value = values[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Select the latest usable earlier observation, preferring the previous completed period boundary. */
function baseline(rows: NewspaperSnapshot[], current: NewspaperSnapshot, previousTurn: number): NewspaperSnapshot | undefined {
  const prior = rows.filter(row => row.subjectID === current.subjectID && row.source.turn < current.source.turn)
    .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
  return prior.filter(row => row.source.turn <= previousTurn).at(-1) ?? prior[0];
}

/** Build known condition facts without inferring technology absence from a partial log. */
export function evidenceConditionContext(evidence: NewspaperEvidence, context: EditorialContext): ConditionContext {
  const own = evidence.players.find(player => player.subjectID === evidence.request.receiverPlayerID);
  return { values: { ...own?.values, civilization: context.civilization, receiverPlayerId: evidence.request.receiverPlayerID,
    cutoffTurn: evidence.request.cutoffTurn }, technologies: context.technologies,
    technologyHistoryComplete: context.technologyHistoryComplete };
}

/** Match the initial supported detectors with measured magnitudes and original references. */
export function detectTriggers(evidence: NewspaperEvidence, config: EditorialConfig, context: EditorialContext = {}): DetectedTrigger[] {
  const result: DetectedTrigger[] = [];
  const { cutoffTurn, previousCheckTurn, receiverPlayerID } = evidence.request;
  const conditions = evidenceConditionContext(evidence, context);
  for (const definition of config.triggers) {
    if (definition.enabled === false) continue;
    if (evaluateCondition(definition.condition, conditions) !== true) continue;
    /** Capture one observed development and its bounded editorial magnitude. */
    const add = (subject: string, keys: string[], magnitude: number, values: Record<string, string | number>,
      sources: NewspaperSourceReference[], summary: string, urgent = false, tags = definition.tags, fingerprint?: string): void => {
      if (magnitude < definition.threshold || !sources.length || sources.some(source => source.turn > cutoffTurn)) return;
      const id = `${definition.id}/${subject}/${sources.map(source => `${source.table}:${source.id}`).join(',')}`;
      result.push({ id, definitionId: definition.id, subject, seriesKeys: keys,
        period: { from: Math.min(...sources.map(source => source.turn)), to: Math.max(...sources.map(source => source.turn)) },
        importance: Math.min(config.defaults.importanceMax, config.defaults.importanceMax * magnitude / definition.scale),
        urgent, tags, values, sources, summary, fingerprint: fingerprint ?? id });
    };
    if (!['incomingWar', 'peace', 'cityContrast'].includes(definition.detector)) {
      for (const draft of detectDevelopments(evidence, definition, context)) {
        add(draft.subject, draft.keys, draft.magnitude, draft.values, draft.sources, draft.summary, false, draft.tags, draft.fingerprint);
      }
      continue;
    }
    if (definition.detector === 'cityContrast') {
      if (!context.receiverOwnerName || evidence.limitations?.length) continue;
      const changes = evidence.cities.filter(city => city.values.Owner === context.receiverOwnerName && city.source.turn > previousCheckTurn)
        .flatMap(city => {
          const before = baseline(evidence.comparisons.cities, city, previousCheckTurn);
          if (!before || before.values.Owner !== city.values.Owner) return [];
          const lifecycleChanged = evidence.events.some(event => ['CityCaptureComplete', 'CityFlipped', 'PlayerLiberated', 'CityRazed'].includes(event.type) &&
            event.source.turn >= before.source.turn && event.source.turn <= city.source.turn &&
            (event.values.CityID === city.subjectID || (event.values.CityX === city.values.X && event.values.CityY === city.values.Y && city.values.X !== undefined)));
          if (lifecycleChanged) return [];
          const afterPopulation = measured(city.values, 'Population');
          const beforePopulation = measured(before.values, 'Population');
          if (afterPopulation === undefined || beforePopulation === undefined) return [];
          return [{ city, before, delta: afterPopulation - beforePopulation, afterPopulation, beforePopulation }];
        });
      const groups = new Map<string, typeof changes>();
      for (const change of changes) {
        const period = `${change.before.source.turn}/${change.city.source.turn}`;
        groups.set(period, [...(groups.get(period) ?? []), change]);
      }
      for (const group of groups.values()) {
        const ordered = group.sort((a, b) => b.delta - a.delta || a.city.subjectID - b.city.subjectID);
        const strongest = ordered[0];
        const weakest = ordered.at(-1);
        if (!strongest || !weakest || strongest === weakest || strongest.delta <= weakest.delta) continue;
        add(`city/${strongest.city.subjectID}`, [`city/${strongest.city.subjectID}/growth`, `city/${weakest.city.subjectID}/growth`],
          strongest.delta - weakest.delta, { cityId: strongest.city.subjectID, city: String(strongest.city.values.Name ?? `City ${strongest.city.subjectID}`),
            otherCityId: weakest.city.subjectID, otherCity: String(weakest.city.values.Name ?? `City ${weakest.city.subjectID}`),
            growth: strongest.delta, contrastGrowth: strongest.delta, otherGrowth: weakest.delta, population: strongest.afterPopulation,
            fromTurn: strongest.before.source.turn, toTurn: strongest.city.source.turn,
            contrastFromTurn: strongest.before.source.turn, contrastToTurn: strongest.city.source.turn },
          [strongest.before.source, strongest.city.source, weakest.before.source, weakest.city.source],
          `Recorded population changes: city ${strongest.city.subjectID} ${strongest.delta}, city ${weakest.city.subjectID} ${weakest.delta}.`);
      }
    } else {
      for (const event of evidence.events) {
        if (event.source.turn <= previousCheckTurn || event.source.turn > cutoffTurn) continue;
        const values = event.values;
        const origin = values.OriginatingPlayerID;
        if (definition.detector === 'incomingWar' && event.type === 'DeclareWar' && context.receiverTeamId !== undefined && values.TargetTeamID === context.receiverTeamId && typeof origin === 'number') {
          add(`civilization/${origin}`, [`diplomacy/${receiverPlayerID}/${origin}/war`], definition.scale,
            { partnerId: origin, partner: context.playerNames?.[String(origin)] ?? `Civilization ${origin}`, eventTurn: event.source.turn },
            [event.source], `DeclareWar event targets receiving team ${context.receiverTeamId} at turn ${event.source.turn}.`, true);
        } else if (definition.detector === 'peace' && event.type === 'MakePeace' && typeof origin === 'number') {
          let partner: number | undefined;
          if (context.receiverTeamId !== undefined && typeof values.TargetTeamID === 'number' && values.TargetTeamID === context.receiverTeamId) partner = origin;
          else if (origin === receiverPlayerID && typeof values.TargetTeamID === 'number') {
            const members = Object.entries(context.playerTeamIds ?? {}).filter(([, team]) => team === values.TargetTeamID);
            if (members.length === 1) partner = Number(members[0][0]);
          }
          if (partner === undefined) continue;
          add(`civilization/${partner}`, [`diplomacy/${receiverPlayerID}/${partner}/war`], definition.scale,
            { partnerId: partner, partner: context.playerNames?.[String(partner)] ?? `Civilization ${partner}`, eventTurn: event.source.turn },
            [event.source], `A MakePeace event involving the receiving team was recorded at turn ${event.source.turn}.`);
        }
      }
    }
  }
  return result;
}
