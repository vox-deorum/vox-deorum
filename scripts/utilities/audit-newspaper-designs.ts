/** Report the stock newspaper designs that can compete for each civilization and era. */
import { parseArgs } from 'node:util';
import { capitalCase } from 'change-case';
import { createInitialPublicationState } from '../../vox-agents/src/newspaper/contracts/publication.js';
import { evaluateEditorialTerms } from '../../vox-agents/src/newspaper/editorial/check.js';
import { scaleEditorialConstants } from '../../vox-agents/src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../vox-agents/src/newspaper/editorial/config/load.js';
import type { NewspaperFactModel } from '../../vox-agents/src/newspaper/editorial/facts/index.js';
import { fact } from '../../vox-agents/src/newspaper/editorial/facts/model.js';
import { evaluatePresentation, fittingFrontLayouts, prepareFrontLayouts } from '../../vox-agents/src/newspaper/editorial/presentation/eligibility.js';
import { choosePressRunDesign } from '../../vox-agents/src/newspaper/editorial/presentation/issue.js';
import { buildPress } from '../../vox-agents/src/newspaper/editorial/rules/press.js';

const { values } = parseArgs({
  options: { json: { type: 'boolean' }, breaking: { type: 'boolean' } },
});
const config = await loadEditorialConfig();
const compiled = await getEditorialExpressions(config);
const constants = scaleEditorialConstants(config.constants, 1);
const state = createInitialPublicationState();
const press = buildPress(state);
const groups = Object.fromEntries(Object.entries(config.constants.types)
  .filter(([key]) => key.endsWith('Civilizations'))
  .map(([key, civs]) => [capitalCase(key.replace(/Civilizations$/, '')).replaceAll(' And ', ' and '), civs]));
const civs = [...new Set(Object.values(groups).flat())].sort();
const eras = config.constants.types.eras;
if (!civs.length || !eras?.length) throw new Error('The catalogue needs civilization groups and eras to audit.');
const baselineName = 'Unlisted Civilization';

/** Build a receiver with a known name and optional era, without any game events or earlier issues. */
function auditFacts(name: string, era: string | null): NewspaperFactModel {
  return {
    turn: 1, previous: 0, earliestWindowTurn: 1, earliestSnapshotTurn: 1,
    longTurns: constants.long,
    receiverId: 0,
    game: {},
    press,
    subjects: { city: [], player: [0], event: [], pair: [], incident: [] },
    cities: {}, events: [], pairs: {}, incidents: [],
    players: { 0: {
      current: {
        name: fact(name), self: fact(true), major: fact(true), ideology: fact(null),
        ...(era === null ? {} : { era: fact(era) }),
      },
      history: [],
    } },
  };
}

/** Evaluate a synthetic opening issue with the live weight, layout and press run rules. */
async function openingPool(name: string, era: string | null) {
  const batch = { constants, facts: auditFacts(name, era) };
  const weights = await evaluatePresentation(config, compiled, batch);
  const terms = await evaluateEditorialTerms(compiled, batch);
  const layouts = fittingFrontLayouts(prepareFrontLayouts(config, weights, terms), values.breaking ?? false);
  return choosePressRunDesign([...layouts.keys()], weights, state, () => 0).audit.candidates;
}

/** Compare the same era with and without a name that matches stock civilization rules. */
async function auditEra(era: string | null) {
  const baseline = await openingPool(baselineName, era);
  const baselineWeights = new Map(baseline.map(({ id, rawWeight }) => [id, rawWeight]));
  const civilizations = [];
  for (const name of civs) {
    const candidates = await openingPool(name, era);
    civilizations.push({ name, candidates: candidates.map(candidate => ({
      ...candidate,
      targeted: candidate.rawWeight > (baselineWeights.get(candidate.id) ?? 0),
    })) });
  }
  return { era, baseline, civilizations };
}

type EraResult = Awaited<ReturnType<typeof auditEra>>;
type CivResult = EraResult['civilizations'][number];

/** Count the choices and check whether any competitive design favors this receiver. */
function summarizeCiv(civ: CivResult) {
  const competitive = civ.candidates.filter(candidate => candidate.drawWeight > 0);
  return { name: civ.name, count: competitive.length, targeted: competitive.some(candidate => candidate.targeted) };
}

/** List the designs that are eligible but excluded, with the number of civs affected. */
function belowCutoff(era: EraResult): string {
  const counts = new Map<string, number>();
  for (const { candidates } of era.civilizations)
    for (const { id, drawWeight } of candidates)
      if (drawWeight === 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `${id} (${count})`).join(', ') || 'None';
}

/** Print a compact report with the thin eras and the targeted coverage for each group. */
function markdown(results: EraResult[], edition: string): string {
  const coverage = results.map(result => result.civilizations.map(summarizeCiv));
  const neverTargeted = coverage[0]
    .filter(({ name }) => !coverage.some(row => row.some(civ => civ.name === name && civ.targeted)))
    .map(({ name }) => name);
  return [
    '# Stock newspaper design audit',
    '',
    `${config.designs.length} designs, ${civs.length} civilizations, ${edition} front. Opening draw with no prior issues.`,
    'The baseline uses an unlisted civilization. A targeted choice enters the draw and has a higher weight than it does for the baseline (including designs unavailable to the baseline).',
    '',
    '| Era | Baseline choices | Civs with 0 choices | Civs with 1 choice | Civs with a targeted choice | Designs below cutoff (number of civs) |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...results.map((result, index) => {
      const row = coverage[index];
      return `| ${result.era ?? 'Era unknown'} | ${result.baseline.filter(candidate => candidate.drawWeight > 0).length} | ${row.filter(civ => civ.count === 0).length} | ${row.filter(civ => civ.count === 1).length} | ${row.filter(civ => civ.targeted).length}/${civs.length} | ${belowCutoff(result)} |`;
    }),
    '',
    'Civs with a targeted choice by group and era. Groups can overlap.',
    '',
    `| Group | ${eras.join(' | ')} |`,
    `| --- | ${eras.map(() => '---:').join(' | ')} |`,
    ...Object.entries(groups).map(([group, members]) => {
      const cells = coverage.slice(0, eras.length)
        .map(row => `${row.filter(civ => members.includes(civ.name) && civ.targeted).length}/${members.length}`);
      return `| ${group} | ${cells.join(' | ')} |`;
    }),
    '',
    `Civs with no targeted choice in any era: ${neverTargeted.join(', ') || 'None'}.`,
  ].join('\n');
}

const results = [];
for (const era of [...eras, null]) results.push(await auditEra(era));
const edition = values.breaking ? 'breaking' : 'regular';
const report = values.json
  ? JSON.stringify({ edition, designCount: config.designs.length, baselineName, groups, results }, null, 2)
  : markdown(results, edition);
process.stdout.write(`${report}\n`);
