/** Exercise file discovery, overrides, and validation through the real catalogue loader. */
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChoiceExpressionError } from '../../../../../src/newspaper/contracts/publication.js';
import { getEditorialExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference } from '../../../../../src/newspaper/editorial/facts/model.js';
import { evaluateChoices } from '../../../../../src/newspaper/editorial/shared/eligibility.js';

describe('editorial catalogue files', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'vd-catalogue-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  /** Write an override document, creating its section folder when needed. */
  async function writeDocument(filename: string, value: unknown): Promise<void> {
    const target = path.join(directory, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  }

  it('should load the stock rules and their story templates while retaining styling', async () => {
    const base = await loadEditorialConfig();
    const ids = base.triggers.map(rule => rule.id);
    expect(ids).toEqual(expect.arrayContaining([
      'neighbor-puppet-annexed', 'settler-departure', 'capital-outgrown',
      'neighbor-army-overtakes', 'technology-leader-changes', 'golden-age-in-wartime',
    ]));
    expect(ids).toHaveLength(14);
    expect(base.templates.length).toBeGreaterThan(0);
    expect(new Set(base.templates.flatMap(template => template.triggers))).toEqual(new Set(ids));
    expect(base.designs[0].layouts.map(layout => layout.variant)).toEqual(expect.arrayContaining(['ordinary', 'breaking']));
  });

  it('should merge style additions by ID and reject unregistered or partial variant tags', async () => {
    const base = await loadEditorialConfig();
    const template = base.templates[0];
    const variant = template.variants[0];
    const match = { voice: 'resident', stance: 'supportive', genre: 'reader-mail' };
    const rule = { id: 'letters', match, when: 'true', multiplier: 2 };
    const variantPath = ['templates', 0, 'variants', 0];
    /** Apply a style change without repeating the stock prose. */
    async function writeTags(tags: Record<string, string>) {
      await writeDocument('templates.json', [{ id: template.id, variants: [{ id: variant.id, ...tags }] }]);
    }
    await writeDocument('styles/voice.json', [{ id: 'resident' }]);
    await writeDocument('styles/stance.json', [{ id: 'supportive' }]);
    await writeDocument('styles/genre.json', [{ id: match.genre }]);
    await writeDocument('styles/mixed-rules.json', [rule]);
    await writeTags(match);
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.styles?.genre).toEqual([...base.styles!.genre, { id: match.genre }]);
    expect(loaded.styles?.rules).toEqual([...base.styles!.rules, rule]);
    expect(loaded.templates[0].variants[0]).toMatchObject(match);
    await writeTags({ voice: 'general' });
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: variantPath })]),
    });
    await writeTags({ ...match, stance: match.genre });
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: [...variantPath, 'stance'] })]),
    });
    await writeTags(match);
    await writeDocument('styles/mixed-rules.json', [{ ...rule, multiplier: 0 }]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({
        path: ['styles', 'mixed-rules.json', 0, 'multiplier'],
      })]),
    });
  });

  it('should load a style rule that matches a list of tags', async () => {
    const rule = { id: 'listed', match: { stance: ['neutral', 'pro-government'] }, when: 'true', multiplier: 2 };
    await writeDocument('styles/stance-rules.json', [rule]);
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.styles?.rules).toContainEqual(rule);
  });

  it('should reject an unknown or empty style tag list', async () => {
    const rule = { id: 'listed', match: { stance: ['neutral', 'absent-stance'] }, when: 'true', multiplier: 2 };
    const matchPath = ['styles', 'stance-rules.json', 0, 'match', 'stance'];
    await writeDocument('styles/stance-rules.json', [rule]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: matchPath })]),
    });
    await writeDocument('styles/stance-rules.json', [{ ...rule, match: { stance: [] } }]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: matchPath })]),
    });
  });

  it('should load voice, stance, genre and mixed rules in that order after stock rules', async () => {
    const base = await loadEditorialConfig();
    const fields = { when: 'true', multiplier: 2 };
    const voice = [
      { ...fields, id: 'voice-z', match: { voice: 'general' } },
      { ...fields, id: 'voice-a', match: { voice: 'general' } },
    ];
    const stance = { ...fields, id: 'stance-pref', match: { stance: 'neutral' } };
    const genre = { ...fields, id: 'genre-pref', match: { genre: 'report' } };
    const mixed = { ...fields, id: 'mixed-pref', match: { voice: 'general', genre: 'report' } };
    await writeDocument('styles/mixed-rules.json', [mixed]);
    await writeDocument('styles/genre-rules.json', [genre]);
    await writeDocument('styles/stance-rules.json', [stance]);
    await writeDocument('styles/voice-rules.json', voice);
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.styles?.rules).toEqual([...base.styles!.rules, ...voice, stance, genre, mixed]);
  });

  it.each([
    { file: 'voice-rules.json', match: { stance: 'neutral' } },
    { file: 'voice-rules.json', match: { voice: 'general', stance: 'neutral' } },
    { file: 'mixed-rules.json', match: { stance: ['neutral', 'pro-government'] } },
    { file: 'mixed-rules.json', match: {} },
  ])('should reject misplaced style rule matches in $file: $match', async ({ file, match }) => {
    await writeDocument(`styles/${file}`, [{ id: 'misplaced', match, when: 'true', multiplier: 2 }]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['styles', file, 0, 'match'] })]),
    });
  });

  it('should reject duplicate style rule IDs across files', async () => {
    const rule = { id: 'duplicate', when: 'true', multiplier: 2 };
    await writeDocument('styles/voice-rules.json', [{ ...rule, match: { voice: 'general' } }]);
    await writeDocument('styles/genre-rules.json', [{ ...rule, match: { genre: 'report' } }]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['styles', 'genre-rules.json', 0, 'id'] })]),
    });
  });

  it('should ignore a leftover combined rule file among overlay style files', async () => {
    const base = await loadEditorialConfig();
    await mkdir(path.join(directory, 'styles'));
    await writeFile(path.join(directory, 'styles/rules.json'), '{');
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.styles).toEqual(base.styles);
  });

  it('should supply repeat factors when a catalogue omits styleRepeat', async () => {
    const base = await loadEditorialConfig();
    const defaults: Record<string, unknown> = { ...base.defaults };
    delete defaults.styleRepeat;
    const loaded = await parseEditorialConfig({ ...base, defaults });
    expect(loaded.defaults.styleRepeat).toEqual({ voice: 1, stance: 1, genre: 0.8 });
  });

  it('should apply split style overrides after legacy flat overrides', async () => {
    const rule = { id: 'letters', match: { genre: 'reader-mail' }, when: 'true', multiplier: 2 };
    await writeDocument('styles.json', { genre: [{ id: rule.match.genre }], rules: [rule] });
    await writeDocument('styles/genre-rules.json', [{ id: rule.id, multiplier: 3 }]);
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.styles?.genre.map(genre => genre.id)).toContain(rule.match.genre);
    expect(loaded.styles?.rules).toContainEqual({ ...rule, multiplier: 3 });
  });

  it('should merge trigger overrides by identity and replace primitive arrays', async () => {
    const base = await loadEditorialConfig();
    const [trigger, ...others] = base.triggers;
    await writeDocument('defaults.json', { feedback: { tag: 0.25 }, styleRepeat: { genre: 0.5 } });
    await writeDocument('triggers.json', [{ id: trigger.id, tags: ['cities'], enabled: false }]);
    await writeDocument('triggers/local.json', [{ id: trigger.id, when: ['city.own', 'true'] }]);
    await writeDocument('pages.json', [{ id: 'additional', label: 'Extra', tags: ['extra'], minimum: 1, order: 20 }]);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.defaults.feedback).toEqual({ ...base.defaults.feedback, tag: 0.25 });
    expect(loaded.defaults.styleRepeat).toEqual({ ...base.defaults.styleRepeat, genre: 0.5 });
    expect(loaded.triggers[0]).toEqual({ ...trigger, tags: ['cities'], enabled: false, when: ['city.own', 'true'] });
    expect(loaded.triggers.slice(1)).toEqual(others);
    expect(loaded.pages.map(page => page.id)).toEqual([...base.pages.map(page => page.id), 'additional']);
    expect(loaded.designs).toEqual(base.designs);
  });

  it('should discover section files in filename order and apply them after flat overrides', async () => {
    const base = await loadEditorialConfig();
    const design = base.designs[0];
    const template = { id: 'local', triggers: ['custom-trigger'], tags: ['trade'], weight: { base: 3 }, variants: [
      { id: 'primary', headline: 'Original', body: ['Original'], weight: { base: 1 } },
    ] };
    await writeDocument('templates.json', [template]);
    await writeDocument('templates/z-last.json', [{
      id: 'last', triggers: ['custom-trigger'], tags: ['trade'], weight: { base: 2 }, variants: [],
    }]);
    await writeDocument('templates/a-first.json', [
      { id: template.id, weight: { base: 7 }, variants: [{ id: 'primary', body: ['Replacement'] }] },
      { id: 'first', triggers: ['custom-trigger'], tags: ['trade'], weight: { base: 1 }, variants: [] },
    ]);
    await writeDocument('triggers/trade.json', [{
      id: 'custom-trigger', subject: 'world', importance: 2, when: 'true',
    }]);
    await writeDocument('designs/custom.json', [{ id: design.id, title: 'Custom title' }]);
    await writeDocument('templates/notes.txt', 'Ignored non-JSON document');
    await writeDocument('templates/ignored.json/nested.json', []);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.templates.find(entry => entry.id === 'local')).toMatchObject({
      weight: { base: 7 },
      variants: [{ id: 'primary', headline: 'Original', body: ['Replacement'] }],
    });
    expect(loaded.templates.slice(base.templates.length).map(entry => entry.id)).toEqual(['local', 'first', 'last']);
    expect(loaded.triggers.at(-1)).toMatchObject({ id: 'custom-trigger', importance: 2 });
    expect(loaded.designs.find(entry => entry.id === design.id)).toEqual({ ...design, title: 'Custom title' });
  });

  it('should reject invalid references and malformed section documents', async () => {
    await writeDocument('templates/trade.json', [{
      id: 'missing', triggers: ['absent-trigger'], tags: [], weight: { base: 1 }, variants: [],
    }]);
    await expect(loadEditorialConfig(directory)).rejects.toThrow('Unknown trigger');
    await writeDocument('templates/trade.json', { id: 'an-array-is-required' });
    await expect(loadEditorialConfig(directory)).rejects.toThrow();
    await writeFile(path.join(directory, 'templates/trade.json'), '{');
    await expect(loadEditorialConfig(directory)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('should reject malformed trigger rules and unknown span names', async () => {
    const base = await loadEditorialConfig();
    const [rule] = base.triggers;
    for (const change of [
      { detector: 'warTransition' }, { subject: 'event' }, { event: 'DealMade' },
      { subject: 'event', event: [] }, { window: 'unknown' }, { repeat: 'unknown' },
      { repeat: 0 }, { when: [] }, { group: { by: 'city.owner.id', min: 0 } },
      { values: { city: 'true' } }, { values: { neighboring: 'true' } },
      ...['values', 'triggerValues', 'group', 'subject', 'period', '$kind', 'story'].map(name => ({ values: { [name]: '1' } })),
      ...['Math', 'undefined', 'NaN', 'JSON'].map(name => ({ values: { [name]: '1' } })),
    ])
      expect(editorialConfigSchema.safeParse({ ...base, triggers: [{ ...rule, ...change }], templates: [] }).success).toBe(false);
  });

  it('should reject listing the same required trigger twice in one template', async () => {
    const config = await loadEditorialConfig();
    const id = config.triggers[0].id;
    const index = config.templates.length;
    await writeDocument('templates/local.json', [{
      id: 'trial', triggers: [id, id], tags: [], weight: { base: 1 }, variants: [],
    }]);
    await expect(loadEditorialConfig(directory)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['templates', index, 'triggers'] })]),
    });
  });

  it('should require template triggers that can match the same subject', async () => {
    const base = await loadEditorialConfig();
    const primary = { id: 'primary', subject: 'city', when: 'true', group: { by: 'city.owner.id' } };
    const report = { id: 'report', triggers: ['primary', 'secondary'], tags: [], weight: { base: 1 }, variants: [] };
    const scope = (secondary: { subject: string; group?: { by: string } }) => ({
      ...base, templates: [report], triggers: [primary, { id: 'secondary', when: 'true', ...secondary }],
    });
    await expect(parseEditorialConfig(scope({ subject: 'city', group: { by: 'city.owner.id' } }))).resolves.toBeDefined();
    for (const secondary of [{ subject: 'city' }, { subject: 'player', group: { by: 'player.id' } }]) {
      await expect(parseEditorialConfig(scope(secondary))).rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ path: ['templates', 0, 'triggers'] })]),
      });
    }
  });

  it('should preserve canonical subject IDs and accept custom ID names', async () => {
    const config = await loadEditorialConfig();
    const [rule] = config.triggers;
    for (const name of ['cityId', 'playerId', 'pairId', 'eventId', 'incidentId', 'ownerId']) {
      const constants = { ...config.constants, sizes: { ...config.constants.sizes, [name]: 4 } };
      expect(editorialConfigSchema.safeParse({ ...config, constants }).success).toBe(false);
      const triggers = [{ ...rule, values: { [name]: 'city.id' } }];
      expect(editorialConfigSchema.safeParse({ ...config, triggers, templates: [] }).success).toBe(false);
    }
    const triggers = [{ ...rule, values: { largestCityId: 'city.id' } }];
    await expect(parseEditorialConfig({ ...config, triggers, templates: [] })).resolves.toMatchObject({ triggers });
  });

  it('should allow documented local values named distance and count', async () => {
    const base = await loadEditorialConfig();
    const rule = { id: 'rated', subject: 'world', when: 'true', values: { distance: '2', count: 'distance + 1' } };
    await expect(parseEditorialConfig({ ...base, triggers: [rule], templates: [] })).resolves.toMatchObject({ triggers: [rule] });
  });

  it('should prepare expression slots per catalogue and recompile when restoring authored JSON', async () => {
    const config = await loadEditorialConfig();
    const saved = JSON.parse(JSON.stringify(config));
    const restored = await parseEditorialConfig(saved);
    const prepared = await getEditorialExpressions(config);

    expect(await getEditorialExpressions(config)).toBe(prepared);
    expect(await getEditorialExpressions(restored)).not.toBe(prepared);
    expect(saved).toEqual(config);
    expect(prepared.slots.get('neighbor-puppet-annexed')?.when).toHaveLength(4);
  });

  it('should reject invalid trigger expressions in overlays and saved snapshots during loading', async () => {
    const config = await loadEditorialConfig();
    const [trigger] = config.triggers;
    const invalid = { ...trigger, urgent: 'city.own &&' };
    await writeDocument('triggers.json', [{ id: trigger.id, urgent: invalid.urgent }]);
    await expect(loadEditorialConfig(directory)).rejects.toThrow(trigger.id);
    await expect(parseEditorialConfig({ ...config, triggers: [invalid], templates: [] })).rejects.toThrow('urgent');
  });

  it('should reject legacy choice fields even when the replacement fields are supplied', async () => {
    const base = await loadEditorialConfig();
    const legacy = { op: 'always' };
    const template = {
      id: 'trial', triggers: [base.triggers[0].id], tags: [], weight: { base: 1 }, variants: [],
    };
    expect(editorialConfigSchema.safeParse({ ...base, templates: [template] }).success).toBe(true);
    for (const change of [
      { triggerIds: template.triggers }, { compositeOf: [] }, { condition: legacy },
      { when: legacy }, { weight: { base: 1, adjustments: [{ condition: legacy, add: 2 }] } },
      { variants: [{ id: 'extra', headline: 'News', body: ['Report'], weight: { base: 1 }, condition: legacy }] },
    ]) {
      expect(editorialConfigSchema.safeParse({ ...base, templates: [{ ...template, ...change }] }).success).toBe(false);
    }
    const [design] = base.designs;
    expect(editorialConfigSchema.safeParse({ ...base, designs: [{ ...design, condition: legacy }] }).success).toBe(false);
    const layouts = design.layouts.map(layout => ({ ...layout, condition: legacy }));
    expect(editorialConfigSchema.safeParse({ ...base, designs: [{ ...design, layouts }] }).success).toBe(false);
    const pages = base.pages.map(page => ({ ...page, condition: legacy }));
    expect(editorialConfigSchema.safeParse({ ...base, pages }).success).toBe(false);
  });

  it('should require front and fallback layouts that need no fact evaluation', async () => {
    const base = await loadEditorialConfig();
    const pages = base.pages.map(page => page.front ? { ...page, when: 'self.era === "Ancient"' } : page);
    expect(editorialConfigSchema.safeParse({ ...base, pages }).success).toBe(false);
    const [design] = base.designs;
    for (const change of [
      { when: 'turn > 10' },
      { weight: { base: 1, adjustments: [{ when: 'true', add: -1 }] } },
      { weight: { base: 0 } },
    ]) {
      const layouts = design.layouts.map(layout => layout.variant === 'breaking' ? { ...layout, ...change } : layout);
      expect(editorialConfigSchema.safeParse({ ...base, designs: [{ ...design, layouts }] }).success).toBe(false);
    }
  });

  it('should report malformed choice expressions at their authored location', async () => {
    const base = await loadEditorialConfig();
    const trial = {
      id: 'trial-design', when: 'true', weight: { base: 1 },
      layouts: [...base.designs[0].layouts, {
        id: 'trial-layout', variant: 'ordinary', weight: { base: 1, adjustments: [{ add: 3, when: 'turn >' }] },
      }],
    };
    const invalid = { ...base, designs: [{ ...base.designs[0], ...trial }] };
    await expect(parseEditorialConfig(invalid)).rejects.toThrow(/trial-layout.*adjustments\[0\].when/);
  });

  it('should evaluate prepared choices with separate subjects and only apply known adjustments', async () => {
    const base = await loadEditorialConfig();
    const config = await parseEditorialConfig({
      ...base,
      templates: [{
        id: 'update', triggers: [base.triggers[0].id], tags: [], when: 'city.population >= needed',
        weight: { base: 3, adjustments: [
          { when: 'invisible.cities > 0', add: 20 },
          { when: 'city.population >= 8', add: 2 },
          { when: 'false', add: 100 },
        ] },
        variants: [{
          id: 'trial', when: 'false', weight: { base: 50 }, headline: 'News', body: ['Report'],
        }],
      }],
    });
    const prepared = await getEditorialExpressions(config);
    const template = prepared.templates.get('update')!;
    const choice = (population: number) => ({ choice: template, bindings: { city: { population } } });
    const results = await evaluateChoices(prepared.runner, { constants: { needed: 4 } }, [
      choice(8), choice(4), choice(2), { choice: template }, { choice: template.variants.get('trial')! },
    ]);
    expect(results.map(result => result.weight)).toEqual([5, 3, 0, 0, 0]);
  });

  it('should report authored runtime failures once per choice expression and omit hidden or false checks', async () => {
    const base = await loadEditorialConfig();
    const makeTemplate = (id: string, when: string) => ({
      id, when, triggers: [base.triggers[0].id], tags: [], weight: { base: 1 }, variants: [],
    });
    const config = await parseEditorialConfig({
      ...base,
      templates: [
        makeTemplate('error', 'city.name()'),
        makeTemplate('hidden', 'city.missing'),
        makeTemplate('false', 'false'),
        makeTemplate('overrun', '(() => { while (true) {} })()'),
      ],
    });
    const facts = buildNewspaperFacts({
      request: { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 12 },
      cities: ['Boston', 'Philadelphia'].map((name, index) => ({
        subjectID: index,
        source: { table: 'CityInformations', id: index + 100, turn: 12, createdAt: 1 },
        values: { OwnerID: 0, Name: name },
      })),
      players: [], comparisons: { cities: [], players: [] }, events: [],
    });
    const prepared = await getEditorialExpressions(config);
    const choices = [...prepared.templates.values()].flatMap(choice =>
      [0, 1].map(id => ({ choice, bindings: { city: reference('city', id) } }))
    );
    const choiceErrors = new Map<number, ChoiceExpressionError>();
    const budget = { interruptedSlots: new Set<number>(), choiceErrors };
    for (let i = 0; i < 2; i++) {
      const results = await evaluateChoices(prepared.runner, { facts }, choices, budget);
      expect(results.every(result => result.weight === 0)).toBe(true);
    }
    expect([...choiceErrors.values()]).toEqual([
      { choice: 'template error', field: 'when', message: expect.any(String) },
      { choice: 'template overrun', field: 'when', message: expect.any(String) },
    ]);
  });

  it('should exclude choices with interrupted or skipped adjustments and retain constant choices', async () => {
    const base = await loadEditorialConfig();
    const template = { triggers: [base.triggers[0].id], tags: [], variants: [] };
    const config = await parseEditorialConfig({
      ...base,
      templates: [
        { ...template, id: 'constant', weight: { base: 1 } },
        { ...template, id: 'conditional', weight: { base: 3, adjustments: [{ when: 'isLate', add: -3 }] } },
        { ...template, id: 'overrun', weight: { base: 5, adjustments: [{ when: '(() => { while (true) {} })()', add: -5 }] } },
      ],
    });
    const prepared = await getEditorialExpressions(config);
    const choices = [...prepared.templates.values()].map(choice => ({ choice }));
    const budget = { interruptedSlots: new Set<number>() };
    const known = { globals: { isLate: false } };
    for (let i = 0; i < 2; i++) {
      const results = await evaluateChoices(prepared.runner, known, choices, budget);
      expect(results.map(result => result.weight)).toEqual([1, 3, 0]);
    }
    const exhausted = { interruptedSlots: new Set(Array.from({ length: 100 }, (_, i) => i + 100)) };
    const results = await evaluateChoices(prepared.runner, known, choices, exhausted);
    expect(results.map(result => result.weight)).toEqual([1, 0, 0]);
  });
});
