/** Build readable cultural influence changes for one foreign major. */
import type {
  NewspaperCulturalInfluenceObservation,
  NewspaperEvidence,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { fact, reference, type FactField, type FactObject } from './model.js';

type Observation = NewspaperCulturalInfluenceObservation;
type Reading = Observation['readings'][number];
type DatedReading = { reading: Reading; source: NewspaperSourceReference };
type Direction = Reading['direction'];

const levelRank: Record<Reading['level'], number> = {
  Exotic: 0, Familiar: 1, Popular: 2, Influential: 3, Dominant: 4,
};

/** Index one rival's readings by direction; an omitted direction stays missing. */
function readingsFor(observation: Observation, otherPlayerID: number): Map<Direction, DatedReading> {
  const readings = new Map<Direction, DatedReading>();
  for (const reading of observation.readings)
    if (reading.otherPlayerID === otherPlayerID)
      readings.set(reading.direction, { reading, source: observation.source });
  return readings;
}

/** Build one change between consecutive readings, or undefined when nothing readable changed. */
function changeFields(
  otherPlayerID: number,
  direction: Direction,
  before: DatedReading,
  current: DatedReading
): FactObject | undefined {
  const previous = before.reading;
  const reading = current.reading;
  const levelChanged = reading.level !== previous.level;
  // A trend needs both readable endpoints. A percentage move alone is not a trend change.
  const trendChanged = reading.trend !== undefined && previous.trend !== undefined &&
    reading.trend !== previous.trend;
  if (!levelChanged && !trendChanged) return undefined;

  const sources = [before.source, current.source];
  const fields: Record<string, FactField> = {
    rival: fact(reference('player', otherPlayerID), sources),
    direction: fact(direction, sources),
    level: fact(reading.level, sources),
    previousLevel: fact(previous.level, sources),
    percentage: fact(reading.percentage, sources),
    previousPercentage: fact(previous.percentage, sources),
    observedTurn: fact(current.source.turn, sources),
    previousTurn: fact(before.source.turn, sources),
    levelChanged: fact(levelChanged, sources),
    trendChanged: fact(trendChanged, sources),
    // Only an upward crossing counts; falling back from Dominant did not reach Influential.
    reachedInfluential: fact(
      levelRank[previous.level] < levelRank.Influential && reading.level === 'Influential', sources
    ),
  };
  if (reading.trend !== undefined) fields.trend = fact(reading.trend, sources);
  if (previous.trend !== undefined) fields.previousTrend = fact(previous.trend, sources);
  if (reading.tourismCultureRatio !== undefined)
    fields.tourismCultureRatio = fact(reading.tourismCultureRatio, sources);
  if (reading.turnsToInfluential !== undefined)
    fields.turnsToInfluential = fact(reading.turnsToInfluential, sources);
  return fields;
}

/**
 * List the readable influence changes for one rival.
 * Each change compares the observation with the immediately preceding row in the same
 * direction, so a missing row breaks the series instead of inferring across the gap.
 */
export function buildCulturalInfluenceChanges(
  evidence: NewspaperEvidence,
  otherPlayerID: number
): FactField | undefined {
  const cultural = evidence.culturalInfluence;
  const { previousCheckTurn, cutoffTurn } = evidence.request;
  const baseline = cultural?.baseline;
  // Without an earlier observation every window reading would be a first observation.
  if (!cultural || !baseline || baseline.source.turn > previousCheckTurn) return undefined;

  const observations = [...cultural.observations]
    .filter(observation => observation.source.turn > previousCheckTurn &&
      observation.source.turn <= cutoffTurn)
    .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);

  const changes: FactObject[] = [];
  let prior = readingsFor(baseline, otherPlayerID);
  for (const observation of observations) {
    const current = readingsFor(observation, otherPlayerID);
    for (const [direction, dated] of current) {
      const before = prior.get(direction);
      if (!before) continue;
      const change = changeFields(otherPlayerID, direction, before, dated);
      if (change) changes.push(change);
    }
    // Replace the whole index so an absent direction cannot be bridged by a later row.
    prior = current;
  }
  return changes.length ? fact(changes) : undefined;
}
