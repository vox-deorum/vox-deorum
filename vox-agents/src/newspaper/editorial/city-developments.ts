/** Population, food, administration and city collection developments. */
import type { DevelopmentEnvironment } from './development-facts.js';
import { number, names, history, prior, continuous, transition, material } from './development-facts.js';

/** Collect comparable city developments under continuous ownership. */
export function detectCityDevelopments(env: DevelopmentEnvironment): void {
  const { evidence, definition, context, cutoff, previous, window, tuning, pace, maxGap, add } = env;
  for (const city of evidence.cities) {
    if (city.source.turn <= previous || city.source.turn > cutoff) continue;
    const domestic = city.values.Owner === context.receiverOwnerName && context.receiverOwnerName !== undefined;
    if (!domestic && definition.detector !== 'wonder') continue;
    const rows = history(evidence.comparisons.cities, city, window);
    const before = prior(rows, previous);
    const comparable = before ? rows.filter(row => row.source.turn >= before.source.turn) : [];
    if (!before || !continuous(evidence, comparable, city)) continue;
    const values = { cityId: city.subjectID, city: String(city.values.Name ?? `City ${city.subjectID}`) };
    /** Add a city draft whose history is known to retain its owner and identity. */
    const cityAdd = (topic: string, magnitude: number, extra: Record<string, string | number>, summary: string, sources = [before!, city]): void => {
      add(`city/${city.subjectID}`, `city/${city.subjectID}/${topic}`, magnitude,
        { ...values, scope: domestic ? 'domestic' : 'international', ...extra }, sources, summary);
    };
    const population = number(city, 'Population');
    const oldPopulation = number(before, 'Population');
    if (definition.detector === 'cityPopulation' && population !== undefined && oldPopulation !== undefined) {
      const delta = population - oldPopulation;
      if (definition.stage === 'milestone') {
        const crossed = (tuning.milestones ?? [5, 10, 20]).filter(value => oldPopulation < value && population >= value);
        if (crossed.length) cityAdd('growth', crossed.at(-1)!, { population, previousPopulation: oldPopulation, milestone: crossed.at(-1)!, growth: delta }, `Population crossed ${crossed.join(', ')} and reached ${population}.`);
      } else if (definition.stage === 'decline' && delta < 0) {
        cityAdd('growth', -delta, { population, previousPopulation: oldPopulation, growth: delta }, `Population declined from ${oldPopulation} to ${population}.`);
      } else if (definition.stage === 'boom' && delta > 0 && material(oldPopulation, population, tuning.absolute ?? 2, tuning.relative ?? 0.2)) {
        cityAdd('growth', delta, { population, previousPopulation: oldPopulation, growth: delta }, `Population rose from ${oldPopulation} to ${population}.`);
      }
    } else if (definition.detector === 'cityRecovery' && population !== undefined && oldPopulation !== undefined && population > oldPopulation) {
      const earlier = rows.filter(row => row.source.turn < before.source.turn).at(-1);
      if (earlier && continuous(evidence, [...rows.filter(row => row.source.turn >= earlier.source.turn)], city) &&
        (number(earlier, 'Population') ?? -1) > oldPopulation) cityAdd('growth', population - oldPopulation,
        { population, growth: population - oldPopulation, recoveryGrowth: population - oldPopulation, recoveryFromTurn: before.source.turn, recoveryToTurn: city.source.turn },
        `Population rose after an observed decline.`, [earlier, before, city]);
    } else if (definition.detector === 'cityFood') {
      if (!continuous(evidence, rows, city)) continue;
      const persisted = transition(rows, city, 'FoodPerTurn', true, (tuning.persistence ?? 2) * pace, maxGap, previous);
      const food = number(city, 'FoodPerTurn');
      const stored = number(city, 'FoodStored');
      const oldFood = number(before, 'FoodPerTurn');
      const oldStored = number(before, 'FoodStored');
      const reserve = tuning.reserve ?? 3;
      const low = food !== undefined && food < 0 && stored !== undefined && stored / -food < reserve;
      const crossedLow = low && oldFood !== undefined && oldFood < 0 && oldStored !== undefined && oldStored / -oldFood >= reserve;
      let lastBreak = -1;
      for (let index = 0; index < rows.length; index++) {
        if ((number(rows[index], 'FoodPerTurn') ?? 0) >= 0 ||
          index < rows.length - 1 && rows[index + 1].source.turn - rows[index].source.turn > maxGap) lastBreak = index;
      }
      const sustained = rows.slice(lastBreak + 1);
      const stillPersistent = sustained.length > 0 && city.source.turn - sustained[0].source.turn >= (tuning.persistence ?? 2) * pace &&
        [...sustained, city].every((row, index, all) => (number(row, 'FoodPerTurn') ?? 0) < 0 && (index === 0 || row.source.turn - all[index - 1].source.turn <= maxGap));
      if ((persisted || (crossedLow && stillPersistent)) && food !== undefined && stored !== undefined) cityAdd('food', Math.abs(food),
        { food, stored, stage: low ? 'low reserves' : 'sustained shortage', reserveTurns: Math.round(stored / -food * 10) / 10 },
        `Repeated negative food balance, latest ${food}; food stored ${stored}.`, persisted ?? [sustained[0], before, city]);
    } else if (definition.detector === 'cityStatus') {
      const field = definition.stage === 'resistance' ? 'ResistanceTurns' : definition.stage === 'razing' ? 'RazingTurns' : undefined;
      if (field) {
        const old = number(before, field);
        const current = number(city, field);
        if (old !== undefined && current !== undefined && (definition.stage === 'resistance' ? old > 0 && current === 0 : old === 0 && current > 0))
          cityAdd('administration', 1, { status: definition.stage === 'resistance' ? 'resistance has ended' : 'razing is active', remaining: current }, `Recorded ${field} changed from ${old} to ${current}.`);
      } else {
        const fields = ['IsPuppet', 'IsOccupied'];
        const changed = fields.filter(field => [true, false, 0, 1].includes(before.values[field] as boolean) &&
          [true, false, 0, 1].includes(city.values[field] as boolean) && Boolean(before.values[field]) !== Boolean(city.values[field]));
        if (changed.length) cityAdd('administration', changed.length, { status: changed.map(field => `${field === 'IsPuppet' ? 'puppet' : 'occupied'} status ${city.values[field] ? 'active' : 'ended'}`).join('; ') }, `Recorded administration changed: ${changed.join(', ')}.`);
      }
    } else if (definition.detector === 'wonder') {
      const old = names(before.values.Wonders);
      const current = names(city.values.Wonders);
      if (old && current) {
        const added = current.filter(name => !old.includes(name));
        if (added.length) cityAdd('wonders', added.length, { wonders: added.join(', ') }, `New wonders in comparable city observations: ${added.join(', ')}.`);
      }
    } else if (definition.detector === 'greatWorks') {
      const old = number(before, 'GreatWorkCount');
      const current = number(city, 'GreatWorkCount');
      if (old !== undefined && current !== undefined && current > old) cityAdd('great-works', current - old,
        { works: current, previousWorks: old, addedWorks: current - old }, `Great-work collection increased from ${old} to ${current}.`);
    }
  }
}
