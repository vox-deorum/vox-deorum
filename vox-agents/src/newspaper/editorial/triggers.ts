/** Derive bounded developments only from permitted, dated observations. */
import type { NewspaperEvidence, NewspaperSnapshot, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialConfig } from './config.js';
import { evaluateCondition, type ConditionContext } from './conditions.js';

/** Identity metadata is separate from projected observations and never supplies unobserved metrics. */
export interface EditorialContext {
  receiverTeamId?: number;
  receiverOwnerName?: string;
  playerNames?: Record<string, string>;
  playerTeamIds?: Record<string, number>;
  technologies?: string[];
  technologyHistoryComplete?: boolean;
  civilization?: string;
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

/** Read explicitly foreign route gold, excluding the -1 yield sentinel and domestic routes. */
function tradeShares(snapshot: NewspaperSnapshot, context: EditorialContext, receiver: number): Map<number, { gold: number; share: number }> | undefined {
  const totals = new Map<number, number>();
  const routes = snapshot.values.OutgoingTradeRoutes;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return undefined;
  for (const [label, route] of Object.entries(routes)) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) continue;
    const name = /\(([^()]*)\)\s*$/.exec(label)?.[1];
    if (!name) return undefined;
    const matching = Object.entries(context.playerNames ?? {}).filter(([, playerName]) => playerName === name);
    if (matching.length !== 1) return undefined;
    const partner = Number(matching[0][0]);
    if (partner === receiver) continue;
    const rawGold = (route as Record<string, unknown>).FromGold;
    if (typeof rawGold !== 'number' || !Number.isFinite(rawGold)) return undefined;
    const gold = measured(route as Record<string, unknown>, 'FromGold');
    if (!gold || gold <= 0) continue;
    totals.set(partner, (totals.get(partner) ?? 0) + gold);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return new Map([...totals].map(([partner, gold]) => [partner, { gold, share: gold / total }]));
}

/** Match the initial supported detectors with measured magnitudes and original references. */
export function detectTriggers(evidence: NewspaperEvidence, config: EditorialConfig, context: EditorialContext = {}): DetectedTrigger[] {
  const result: DetectedTrigger[] = [];
  const { cutoffTurn, previousCheckTurn, receiverPlayerID } = evidence.request;
  const conditions = evidenceConditionContext(evidence, context);
  const own = evidence.players.find(player => player.subjectID === receiverPlayerID);
  for (const definition of config.triggers) {
    if (evaluateCondition(definition.condition, conditions) !== true) continue;
    /** Capture one observed development and its bounded editorial magnitude. */
    const add = (subject: string, keys: string[], magnitude: number, values: Record<string, string | number>,
      sources: NewspaperSourceReference[], summary: string, urgent = false): void => {
      if (magnitude < definition.threshold || !sources.length || sources.some(source => source.turn > cutoffTurn)) return;
      const id = `${definition.id}/${subject}/${sources.map(source => `${source.table}:${source.id}`).join(',')}`;
      result.push({ id, definitionId: definition.id, subject, seriesKeys: keys,
        period: { from: Math.min(...sources.map(source => source.turn)), to: Math.max(...sources.map(source => source.turn)) },
        importance: Math.min(config.defaults.importanceMax, config.defaults.importanceMax * magnitude / definition.scale),
        urgent, tags: definition.tags, values, sources, summary, fingerprint: id });
    };
    if (definition.detector === 'cityContrast' || definition.detector === 'cityRecovery') {
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
      if (definition.detector === 'cityContrast') {
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
        for (const change of changes) {
          const history = evidence.comparisons.cities.filter(row => row.subjectID === change.city.subjectID && row.values.Owner === context.receiverOwnerName && row.source.turn < change.before.source.turn);
          const earlier = history.find(row => (measured(row.values, 'Population') ?? 0) > change.beforePopulation);
          if (!earlier || change.delta <= 0) continue;
          add(`city/${change.city.subjectID}`, [`city/${change.city.subjectID}/growth`], change.delta,
            { cityId: change.city.subjectID, city: String(change.city.values.Name ?? `City ${change.city.subjectID}`), growth: change.delta, recoveryGrowth: change.delta,
              population: change.afterPopulation, fromTurn: change.before.source.turn, toTurn: change.city.source.turn,
              recoveryFromTurn: change.before.source.turn, recoveryToTurn: change.city.source.turn },
            [earlier.source, change.before.source, change.city.source], `Population rose after an observed earlier decline in city ${change.city.subjectID}.`);
        }
      }
    } else if (definition.detector === 'tradeConcentration') {
      if (!own || own.source.turn <= previousCheckTurn) continue;
      const before = baseline(evidence.comparisons.players, own, previousCheckTurn);
      if (!before) continue;
      const prior = tradeShares(before, context, receiverPlayerID);
      const currentShares = tradeShares(own, context, receiverPlayerID);
      if (!prior || !currentShares) continue;
      for (const [partner, current] of currentShares) {
        const old = prior.get(partner)?.share ?? 0;
        const delta = current.share - old;
        if (delta === 0) continue;
        add(`civilization/${partner}`, [`trade/${receiverPlayerID}/${partner}`], Math.abs(delta) * 100,
          { partnerId: partner, partner: context.playerNames?.[String(partner)] ?? `Civilization ${partner}`,
            share: Math.round(current.share * 1000) / 10, previousShare: Math.round(old * 1000) / 10,
            gold: Math.round(current.gold * 100) / 100, fromTurn: before.source.turn, toTurn: own.source.turn,
            tradeFromTurn: before.source.turn, tradeToTurn: own.source.turn },
          [before.source, own.source], `Partner ${partner} supplies ${Math.round(current.share * 1000) / 10}% of positive foreign outgoing-route gold; prior share ${Math.round(old * 1000) / 10}%.`);
      }
    } else if (definition.detector === 'foreignCulture') {
      for (const current of evidence.players) {
        if (current.subjectID === receiverPlayerID || current.source.turn <= previousCheckTurn) continue;
        const before = baseline(evidence.comparisons.players, current, previousCheckTurn);
        if (!before) continue;
        const culture = measured(current.values, 'CulturePerTurn');
        const previousCulture = measured(before.values, 'CulturePerTurn');
        if (culture === undefined || previousCulture === undefined || culture === previousCulture) continue;
        const delta = culture - previousCulture;
        add(`civilization/${current.subjectID}`, [`civilization/${current.subjectID}/culture`], Math.abs(delta),
          { partnerId: current.subjectID, partner: context.playerNames?.[String(current.subjectID)] ?? `Civilization ${current.subjectID}`,
            culture, previousCulture, cultureChange: delta, fromTurn: before.source.turn, toTurn: current.source.turn,
            cultureFromTurn: before.source.turn, cultureToTurn: current.source.turn },
          [before.source, current.source], `Recorded culture per turn changed from ${previousCulture} to ${culture} between turns ${before.source.turn} and ${current.source.turn}.`);
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
        } else if (definition.detector === 'deal' && event.type === 'DealMade') {
          const from = values.FromPlayerID;
          const to = values.ToPlayerID;
          const partner = from === receiverPlayerID ? to : to === receiverPlayerID ? from : undefined;
          if (typeof partner !== 'number') continue;
          const termCount = ['FromGives', 'ToGives', 'TradedItems'].reduce((count, key) => count + (Array.isArray(values[key]) ? (values[key] as unknown[]).length : 0), 0);
          add(`civilization/${partner}`, [`diplomacy/${receiverPlayerID}/${partner}/exchange`], Math.max(1, termCount),
            { partnerId: partner, partner: context.playerNames?.[String(partner)] ?? `Civilization ${partner}`, eventTurn: event.source.turn },
            [event.source], `A recorded deal between the receiver and player ${partner} began at turn ${event.source.turn}.`);
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
