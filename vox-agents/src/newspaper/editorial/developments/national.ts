/** National output, budget, happiness, trade and comparative science developments. */
import type { DevelopmentEnvironment } from './development-facts.js';
import {
  number,
  identity,
  history,
  prior,
  transition,
  routes,
  material,
  golden,
} from './development-facts.js';

/** Compare material permitted output changes for the configured national metric. */
export function detectOutputDevelopments(env: DevelopmentEnvironment): void {
  const { evidence, definition, cutoff, previous, receiver, window, tuning, metric, national } =
    env;
  if (!metric) return;
  for (const row of evidence.players) {
    if (
      row.source.turn <= previous ||
      row.source.turn > cutoff ||
      (['economyIncome', 'scienceOutput'].includes(definition.detector) &&
        row.subjectID !== receiver) ||
      (definition.detector === 'foreignCulture' && row.subjectID === receiver) ||
      (definition.detector === 'cultureOutput' && row.subjectID !== receiver)
    )
      continue;
    const before = prior(history(evidence.comparisons.players, row, window), previous);
    if (!before) continue;
    const current = number(row, metric);
    const old = number(before, metric);
    if (
      current === undefined ||
      old === undefined ||
      !material(
        old,
        current,
        tuning.absolute ?? (metric === 'GoldPerTurn' || metric === 'SciencePerTurn' ? 10 : 5),
        tuning.relative ?? 0.25
      )
    )
      continue;
    const topic =
      metric === 'GoldPerTurn'
        ? 'income'
        : metric === 'SciencePerTurn'
          ? 'science'
          : metric === 'CulturePerTurn'
            ? 'culture'
            : 'tourism';
    const values: Record<string, string | number> = {
      output: current,
      previousOutput: old,
      change: current - old,
      direction: current > old ? 'rises' : 'falls',
    };
    if (metric === 'CulturePerTurn')
      Object.assign(values, {
        culture: current,
        previousCulture: old,
        cultureChange: current - old,
        cultureFromTurn: before.source.turn,
        cultureToTurn: row.source.turn,
      });
    national(
      row,
      before,
      topic,
      Math.abs(current - old),
      values,
      `${metric} changed from ${old} to ${current}.`
    );
  }
}
/** Detect domestic fiscal, trade, happiness, golden-age and religious transitions. */
export function detectDomesticDevelopments(env: DevelopmentEnvironment): void {
  const {
    evidence,
    definition,
    context,
    cutoff,
    previous,
    receiver,
    window,
    tuning,
    pace,
    maxGap,
    own,
    national,
    add,
    playerName,
  } = env;
  if (own && own.source.turn > previous && own.source.turn <= cutoff) {
    const rows = history(evidence.comparisons.players, own, window);
    const before = prior(rows, previous);
    if (before) {
      if (definition.detector === 'economyBudget') {
        if (definition.stage === 'reserve') {
          const income = number(own, 'GoldPerTurn');
          const gold = number(own, 'Gold');
          const oldIncome = number(before, 'GoldPerTurn');
          const oldGold = number(before, 'Gold');
          const reserve = (tuning.reserve ?? 5) * pace;
          if (
            income !== undefined &&
            income < 0 &&
            gold !== undefined &&
            oldIncome !== undefined &&
            oldGold !== undefined &&
            gold / -income < reserve &&
            (oldIncome >= 0 || oldGold / -oldIncome >= reserve || (gold <= 0 && oldGold > 0))
          )
            national(
              own,
              before,
              'budget',
              1,
              { gold, income, reserveTurns: Math.round((gold / -income) * 10) / 10 },
              `Treasury ${gold} at a recorded deficit of ${-income} gold per turn.`
            );
        } else {
          const negative = definition.stage !== 'recovery';
          const persisted = transition(
            rows,
            own,
            'GoldPerTurn',
            negative,
            (tuning.persistence ?? 2) * pace,
            maxGap,
            previous
          );
          if (persisted)
            add(
              `civilization/${receiver}`,
              `civilization/${receiver}/budget`,
              Math.abs(number(own, 'GoldPerTurn')!) || 1,
              {
                partnerId: receiver,
                partner: playerName(receiver),
                income: number(own, 'GoldPerTurn')!,
                stage: negative ? 'deficit' : 'recovery',
              },
              persisted,
              `Repeated observations establish ${negative ? 'a budget deficit' : 'an end to the budget deficit'}.`
            );
        }
      } else if (definition.detector === 'happiness') {
        const old = number(before, 'HappinessPercentage');
        const current = number(own, 'HappinessPercentage');
        if (old !== undefined && current !== undefined) {
          const crossed = (tuning.milestones ?? [35, 50]).some(
            (value) => old < value !== current < value
          );
          if (crossed || Math.abs(current - old) >= (tuning.absolute ?? 10))
            national(
              own,
              before,
              'happiness',
              Math.abs(current - old),
              {
                happiness: current,
                previousHappiness: old,
                direction: current > old ? 'improves' : 'falls',
                stage: current > old ? 'recovery' : 'decline',
              },
              `Happiness changed from ${old}% to ${current}%.`
            );
        }
      } else if (
        ['tradePartners', 'tradeContraction', 'tradeConcentration'].includes(definition.detector)
      ) {
        const old = routes(before, context, receiver);
        const current = routes(own, context, receiver);
        if (old && current) {
          if (
            definition.detector === 'tradeContraction' &&
            ((old.count - current.count >= (tuning.absolute ?? 2) &&
              old.count - current.count >= old.count * (tuning.relative ?? 0.25)) ||
              (old.gold - current.gold >= (tuning.reserve ?? 10) &&
                old.gold - current.gold >= old.gold * (tuning.relative ?? 0.25)))
          )
            national(
              own,
              before,
              'trade-total',
              Math.max(old.count - current.count, old.gold - current.gold),
              {
                routes: current.count,
                previousRoutes: old.count,
                gold: current.gold,
                previousGold: old.gold,
              },
              `Foreign outgoing routes changed from ${old.count} to ${current.count}, gold from ${old.gold} to ${current.gold}.`
            );
          for (const partner of new Set([...old.partners.keys(), ...current.partners.keys()])) {
            const gold = current.partners.get(partner) ?? 0;
            const share = current.gold > 0 ? gold / current.gold : undefined;
            const previousShare =
              old.gold > 0 ? (old.partners.get(partner) ?? 0) / old.gold : undefined;
            const newPartner =
              definition.detector === 'tradePartners' &&
              !old.partners.has(partner) &&
              current.partners.has(partner);
            const crossed =
              share !== undefined &&
              previousShare !== undefined &&
              share > (tuning.share ?? 0.5) !== previousShare > (tuning.share ?? 0.5);
            if (
              !newPartner &&
              !(
                definition.detector === 'tradeConcentration' &&
                share !== undefined &&
                previousShare !== undefined &&
                (crossed || Math.abs(share - previousShare) >= (tuning.relative ?? 0.2))
              )
            )
              continue;
            add(
              `civilization/${partner}`,
              `trade/${receiver}/${partner}`,
              newPartner ? 1 : Math.abs(share! - previousShare!) * 100,
              {
                partnerId: partner,
                partner: playerName(partner),
                gold,
                share: Math.round((share ?? 0) * 1000) / 10,
                previousShare: Math.round((previousShare ?? 0) * 1000) / 10,
                tradeFromTurn: before.source.turn,
                tradeToTurn: own.source.turn,
              },
              [before, own],
              newPartner
                ? `A newly observed foreign outgoing-route partner: ${playerName(partner)}.`
                : `Positive foreign outgoing-route gold share changed from ${previousShare! * 100}% to ${share! * 100}%.`
            );
          }
        }
      } else if (definition.detector === 'goldenAge') {
        const old = golden(before.values.GoldenAge);
        const current = golden(own.values.GoldenAge);
        if (old !== undefined && current !== undefined && old !== current)
          national(
            own,
            before,
            'golden-age',
            1,
            { stage: current ? 'begins' : 'ends' },
            `Recorded golden-age status ${current ? 'became active' : 'ended'}.`
          );
      } else if (definition.detector === 'nationalReligion') {
        const old = identity(before.values.MajorityReligion);
        const current = identity(own.values.MajorityReligion);
        if (old && current && old !== current)
          national(
            own,
            before,
            'religion',
            1,
            { religion: current, previousReligion: old },
            `National majority religion changed from ${old} to ${current}.`
          );
      }
    }
  }
}
/** Compare technology leaders only within a fresh and comparable known-major cohort. */
export function detectTechnologyLead(env: DevelopmentEnvironment): void {
  const {
    evidence,
    definition,
    context,
    cutoff,
    previous,
    receiver,
    window,
    tuning,
    pace,
    maxGap,
    add,
    playerName,
  } = env;
  if (definition.detector === 'technologyLead' && context.majorPlayerIds?.includes(receiver)) {
    const majors = evidence.players.filter((row) =>
      context.majorPlayerIds!.includes(row.subjectID)
    );
    const comparisons = majors.map((row) => ({
      row,
      before: prior(history(evidence.comparisons.players, row, window), previous),
    }));
    const complete =
      comparisons.length >= 2 &&
      comparisons.every(
        ({ row, before }) =>
          before &&
          row.source.turn > previous &&
          cutoff - row.source.turn <= maxGap &&
          previous - before.source.turn <= maxGap &&
          number(row, 'Technologies') !== undefined &&
          number(before, 'Technologies') !== undefined
      );
    if (complete) {
      const currentTurns = comparisons.map(({ row }) => row.source.turn);
      const oldTurns = comparisons.map(({ before }) => before!.source.turn);
      if (
        Math.max(...currentTurns) - Math.min(...currentTurns) <= (tuning.absolute ?? 1) * pace &&
        Math.max(...oldTurns) - Math.min(...oldTurns) <= (tuning.absolute ?? 1) * pace
      ) {
        const maximum = Math.max(...majors.map((row) => number(row, 'Technologies')!));
        const oldMaximum = Math.max(
          ...comparisons.map(({ before }) => number(before!, 'Technologies')!)
        );
        const leaders = majors
          .filter((row) => number(row, 'Technologies') === maximum)
          .map((row) => row.subjectID)
          .sort();
        const oldLeaders = comparisons
          .filter(({ before }) => number(before!, 'Technologies') === oldMaximum)
          .map(({ row }) => row.subjectID)
          .sort();
        if (leaders.join(',') !== oldLeaders.join(','))
          add(
            `civilization/${receiver}`,
            `science/known-lead`,
            1,
            {
              leaders: leaders.map(playerName).join(', '),
              previousLeaders: oldLeaders.map(playerName).join(', '),
              technologies: maximum,
              knownMajors: majors.length,
            },
            comparisons.flatMap(({ row, before }) => [before!, row]),
            `Technology-count leadership changed among ${majors.length} known major civilizations.`
          );
      }
    }
  }
}
