import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { RuleDevelopment } from '../../../../../src/newspaper/contracts/triggers.js';
import { inlineTextSchema } from '../../../../../src/newspaper/contracts/issue.js';
import { scaleEditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { renderAuthoredText } from '../../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluateTriggerRules } from '../../../../../src/newspaper/editorial/rules/evaluate.js';
import { matchTemplates, substitute } from '../../../../../src/newspaper/editorial/selection/templates.js';

const standard = {
  id: 'report', tags: [], weight: { base: 1 },
  variants: [{ id: 'account', headline: 'News from {{city}}', body: ['Published on {{period.to}}.'], weight: { base: 1 } }],
};

/** Exercise authored eligibility against the same visible facts and compiled catalogue as a check. */
async function candidates(totalCities: number, triggers: unknown[], template: unknown,
  { adjust, receiverName = 'France', receiverLeader }: {
    adjust?: (developments: RuleDevelopment[]) => RuleDevelopment[];
    receiverName?: string;
    receiverLeader?: string;
  } = {}) {
  const base = await loadEditorialConfig();
  const config = await parseEditorialConfig({ ...base, triggers, templates: [template] });
  const cities: NewspaperEvidence['cities'] = Array.from({ length: totalCities }, (_, id) => ({
    subjectID: id,
    source: { table: 'CityInformations', id, turn: 10, createdAt: 10 },
    values: { Name: `City ${id}`, OwnerID: 0, Population: id + 1, MajorityReligion: 'Buddhism' },
  }));
  const owner = {
    subjectID: 0, source: { table: 'PlayerSummaries' as const, id: 2, turn: 10, createdAt: 10 }, values: {},
  };
  const facts = buildNewspaperFacts({
    request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 8, historyFromTurn: 5 },
    players: [owner], cities, events: [], comparisons: { players: [], cities: [] },
    history: { fromTurn: 5, baseline: { players: [], cities: [] },
      snapshots: { players: [owner], cities }, events: [], gaps: [] },
  }, { playerIdentities: { 0: { name: receiverName, major: true, leader: receiverLeader } } });
  const compiled = await getEditorialExpressions(config);
  const rules = await evaluateTriggerRules({
    rules: config.triggers, compiled, facts, constants: config.constants, speedMultiplier: 1,
  });
  const batch = { facts, constants: scaleEditorialConstants(config.constants, 1) };
  return matchTemplates(adjust?.(rules.developments) ?? rules.developments, config, compiled, batch);
}

describe('newspaper template matching', () => {
  it.each([
    ['The Aztecs', ['generic', 'mesoamerican']],
    ['The Maya', ['generic', 'mesoamerican']],
    ['Indonesia', ['generic', 'southeastAsianAndPacific']],
    ['Polynesia', ['generic', 'southeastAsianAndPacific']],
    ['France', ['generic']],
  ] as const)('should offer the eligible regional variants to %s', async (receiverName, expected) => {
    const variant = { ...standard.variants[0], headline: 'News' };
    const selected = await candidates(0, [{ id: 'report', subject: 'world', tier: 'filler', when: 'true' }], {
      ...standard, triggers: ['report'],
      variants: [
        { ...variant, id: 'generic' },
        { ...variant, id: 'mesoamerican', when: 'self.is.mesoamerican' },
        { ...variant, id: 'southeastAsianAndPacific', when: 'self.is.southeastAsianAndPacific' },
      ],
    }, { receiverName });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map(({ id }) => id)).toEqual(expected);
  });

  it('should find a shared subject even after more than one hundred other rule matches', async () => {
    const selected = await candidates(130, [
      { id: 'all', subject: 'city', tier: 'filler', when: 'true', values: { population: 'city.population' } },
      { id: 'last', subject: 'city', tier: 'filler', when: 'city.id === 129' },
    ], {
      ...standard, triggers: ['all', 'last'],
      when: 'period.from === 8 && values.population === city.population && subject.id === 129',
      weight: { base: 0, adjustments: [{ when: 'triggerValues.all.population === 130', add: 2 }] },
      variants: [{ ...standard.variants[0], headline: 'News from {{city}} in {{owner}}' }],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      subject: 'city/129', weight: 2,
      values: { city: 'City 129', cityId: 129, owner: 'France', ownerId: 0, 'period.to': 10 },
    });
    expect(selected[0].triggerIds).toHaveLength(2);
    expect(selected[0].variantSources.account).toEqual([
      expect.objectContaining({ table: 'CityInformations', id: 129 }),
      expect.objectContaining({ table: 'PlayerSummaries', id: 2 }),
    ]);
  });

  it('should print and source a visible leader name in the body while preserving named links', async () => {
    const triggers = [{ id: 'report', subject: 'city', tier: 'filler', when: 'true' }];
    const template = {
      ...standard, triggers: ['report'], names: ['city', 'city.owner.leader'],
      variants: [
        {
          ...standard.variants[0], id: 'named',
          body: ['{{city.owner.leader}} visits {{city}} on {{period.to}}.'],
          links: [{ placeholder: 'city', label: '{{city}}', target: { type: 'city', cityId: '{{cityId}}' } }],
        },
        standard.variants[0],
      ],
    };
    const [candidate] = await candidates(1, triggers, template, { receiverLeader: 'Napoleon' });
    const [variant] = candidate.variants;
    const body = inlineTextSchema.parse(renderAuthoredText(variant.body[0], candidate.values, variant, candidate.names));
    expect(body.filter(node => node.type === 'text' || node.type === 'link').filter(node => node.isName))
      .toEqual([
        { type: 'text', text: 'Napoleon', isName: true },
        { type: 'link', text: 'City 0', isName: true, target: { type: 'city', cityId: '0' } },
      ]);
    expect(candidate.variantSources.named).toContainEqual(expect.objectContaining({ table: 'PlayerSummaries', id: 2 }));

    const [withoutLeader] = await candidates(1, triggers, template);
    expect(withoutLeader.variants.map(choice => choice.id)).toEqual(['account']);
  });

  it('should expose group totals and each member’s values without treating a member as the group', async () => {
    const selected = await candidates(3, [
      { id: 'conversions', subject: 'city', tier: 'filler', when: 'true', values: { population: 'city.population' },
        group: { by: 'city.majorityReligion', min: 3 } },
    ], {
      ...standard, triggers: ['conversions'],
      when: 'group.count === 3 && group.matches[1].city.name === "City 1" && typeof city === "undefined"',
      variants: [
        { id: 'valid', headline: '{{group.key}} spreads to {{count}} cities', body: ['{{period.to}}.'],
          when: 'group.matches[2].values.population === 3 && !Object.hasOwn(values, "population")',
          weight: { base: 0, adjustments: [{ when: 'group.matches.every(m => m.city.id >= 0)', add: 1 }] } },
        { id: 'false', headline: '{{key}} spreads', body: ['Observed this turn.'],
          when: 'group.matches[0].values.population > 10', weight: { base: 100 } },
        { id: 'missing', headline: 'Missing {{city}}', body: ['Observed this turn.'], weight: { base: 100 } },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['valid']);
    expect(selected[0].values).toMatchObject({ key: 'Buddhism', count: 3 });
    expect(selected[0].values).not.toHaveProperty('population');
  });

  it('should skip variants with invalid link destinations or direct reads of an unavailable subject name', async () => {
    const selected = await candidates(0, [
      { id: 'generic', subject: 'world', tier: 'filler', when: 'true', values: { empty: '""' } },
    ], {
      ...standard, triggers: ['generic'],
      variants: [
        { id: 'valid', headline: 'News', body: ['{{period.to}}.'],
          when: '!subject.knows("name") && subject.kind === "world"', weight: { base: 1 } },
        { id: 'missing-name', headline: 'News', body: ['No city named.'],
          when: '!subject.name', weight: { base: 100 } },
        { id: 'missing-id', headline: 'News from city {{cityId}}', body: ['No city named.'],
          weight: { base: 100 } },
        { id: 'invalid-link', headline: 'News', body: ['See {{location}}.'], weight: { base: 100 },
          links: [{ placeholder: 'location', label: 'our city', target: { type: 'city', cityId: '{{empty}}' } }] },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['valid']);
  });

  it('should give each grouped rule its own membership and suppress ambiguous group placeholders', async () => {
    const selected = await candidates(3, [
      { id: 'conversions', subject: 'city', tier: 'filler', when: 'true', group: { by: 'city.majorityReligion', min: 2 } },
      { id: 'growth', subject: 'city', tier: 'filler', when: 'city.population > 1', group: { by: 'city.majorityReligion', min: 2 } },
    ], {
      ...standard, triggers: ['conversions', 'growth'],
      when: 'typeof group === "undefined" && typeof count === "undefined" && triggerValues.growth.matches[0].city.id === 1',
      variants: [
        { ...standard.variants[0], id: 'ambiguous', headline: '{{count}} cities' },
        { ...standard.variants[0], id: 'ambiguous-key', headline: '{{group.key}} spreads' },
        { ...standard.variants[0], id: 'qualified',
          headline: '{{triggerValues.conversions.key}} reaches {{triggerValues.conversions.count}} cities',
          body: ['Of these, {{triggerValues.growth.count}} are growing.'],
          when: 'triggerValues.conversions.matches.length === 3 && triggerValues.growth.count === 2' },
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ subject: 'group/city/"Buddhism"',
      values: { 'triggerValues.conversions.count': 3, 'triggerValues.growth.count': 2 } });
    expect(selected[0].variants.map((variant) => variant.id)).toEqual(['qualified']);
  });

  it('should use qualified scalar names and match only intersecting rule windows', async () => {
    const rules = [
      { id: 'ledger', subject: 'city', tier: 'filler', window: 5, when: 'true', values: { amount: '2' } },
      { id: 'growth', subject: 'city', tier: 'filler', when: 'true', values: { amount: '3' } },
    ];
    const template = {
      ...standard, triggers: ['ledger', 'growth'],
      when: 'typeof amount === "undefined" && !Object.hasOwn(values, "amount") && triggerValues.ledger.amount === 2',
      variants: [
        { ...standard.variants[0], id: 'ambiguous', headline: '{{amount}}' },
        { ...standard.variants[0], id: 'qualified', headline: '{{triggerValues.ledger.amount}} and {{triggerValues.growth.amount}}' },
      ],
    };
    const overlapping = await candidates(1, rules, template);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0]).toMatchObject({ period: { from: 8, to: 10 },
      values: { 'triggerValues.ledger.amount': 2, 'triggerValues.growth.amount': 3 } });
    expect(overlapping[0].variants.map((variant) => variant.id)).toEqual(['qualified']);

    const adjacent = await candidates(1, rules, template, {
      adjust: (developments) => developments.map((development) =>
        development.definitionId === 'ledger' ? { ...development, period: { from: 5, to: 8 } } : development
      ),
    });
    expect(adjacent).toEqual([]);
  });
});

describe('newspaper placeholder printing', () => {
  it('should capitalize terms according to where they print in the sentence', () => {
    const body = '“{{terms.civic.people}} greet their {{office}}.” {{office}} makes an announcement.';
    const variant = {
      ...standard.variants[0],
      links: [{
        placeholder: 'office', label: '{{player.civic.government}}',
        target: { type: 'city' as const, cityId: '{{terms.capitalId}}' },
      }],
    };
    const nodes = renderAuthoredText(body, {
      'terms.civic.people': 'citizens', 'player.civic.government': 'war council', 'terms.capitalId': 'city-a',
    }, variant);

    expect(nodes.map(node => node.text).join(''))
      .toBe('“Citizens greet their war council.” War council makes an announcement.');
    expect(nodes.filter(node => node.type === 'link').map(node => node.target))
      .toEqual([{ type: 'city', cityId: 'city-a' }, { type: 'city', cityId: 'city-a' }]);
  });

  it('should choose a singular or plural label from the value', () => {
    expect(substitute('{{count|branch|branches}}', { count: 1 })).toBe('1 branch');
    expect(substitute('{{count|branch|branches}}', { count: 3 })).toBe('3 branches');
    expect(substitute('{{count|branch|branches}}', {})).toBe('{{count|branch|branches}}');
  });

  it('should infer units from placeholder names', () => {
    expect(substitute('{{turnsLeft}} at {{routeDistance}}', { turnsLeft: 1, routeDistance: 3 }))
      .toBe('1 turn at 3 tiles');
    expect(substitute('{{largestPopulation}} at {{happinessPercentage}}',
      { largestPopulation: 12, happinessPercentage: 62 })).toBe('12 million at 62 percent');
    expect(substitute('{{wearinessPercent}}', { wearinessPercent: 60 })).toBe('60 percent');
    expect(substitute('{{dropPoints}}', { dropPoints: 5 })).toBe('5 points');
    expect(substitute('{{unrestPoints}}', { unrestPoints: -1 })).toBe('-1 point');
    expect(substitute('{{nearestDistance}}', { nearestDistance: 3 })).toBe('3 tiles');
    expect(substitute('{{faminePopulation}}', { faminePopulation: 3 })).toBe('3 million');
    expect(substitute('{{faminePopulation}} {{terms.civic.people}}',
      { faminePopulation: 3, 'terms.civic.people': 'citizens' })).toBe('3 million citizens');
    expect(substitute('{{wallStrength}} of {{maxWallStrength}}',
      { wallStrength: 100, maxWallStrength: 300 })).toBe('100 of 300');
  });

  it('should let a template declare a raw unit', async () => {
    const template = {
      ...standard, triggers: ['report'], formats: { turns: 'cycle|cycles' },
      variants: [{
        ...standard.variants[0],
        headline: 'After {{turns}}',
        body: ['{{period.to}}.'],
      }],
    };
    const selected = await candidates(0, [{
      id: 'report', subject: 'world', tier: 'filler', when: 'true', values: { turns: '2' },
    }], template);
    const [variant] = selected[0].variants;
    const nodes = inlineTextSchema.parse(
      renderAuthoredText(variant.headline, selected[0].values, variant, selected[0].names)
    );
    expect(nodes.map((node) => node.text).join('')).toBe('After 2 cycles');
  });

  it('should apply built-in units in authored prose', async () => {
    const template = {
      ...standard, triggers: ['report'],
      variants: [{
        ...standard.variants[0],
        headline: '{{population}} people at {{happinessPercentage}}, famine at {{faminePopulation}}, war in {{turns}}, city {{distance}}',
        body: ['After {{period.from}} and by {{period.to}}.'],
      }],
    };
    const selected = await candidates(0, [{
      id: 'report', subject: 'world', tier: 'filler', when: 'true',
      values: { population: '12', happinessPercentage: '62', faminePopulation: '1', turns: '3', distance: '2' },
    }], template);
    const [variant] = selected[0].variants;
    const nodes = inlineTextSchema.parse(
      renderAuthoredText(variant.headline, selected[0].values, variant, selected[0].names)
    );
    expect(nodes.map((node) => node.text).join(''))
      .toBe('12 million people at 62 percent, famine at 1 million, war in 3 turns, city 2 tiles');
    const body = renderAuthoredText(variant.body[0], selected[0].values, variant);
    expect(body.map((node) => node.text).join('')).toBe('After Turn 8 and by Turn 10.');
  });
});
