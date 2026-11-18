/** Exercise file discovery, overrides, and validation through the real catalogue loader. */
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEditorialTriggerExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema } from '../../../../src/newspaper/editorial/config/schema.js';

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

  it('should load the owner rules and empty built-in templates while retaining styling', async () => {
    const base = await loadEditorialConfig();
    expect(base.triggers.map(rule => rule.id)).toEqual(['neighbor-puppet-annexed', 'settler-departure']);
    expect(base.templates).toEqual([]);
    expect(base.designs[0].layouts.map(layout => layout.variant)).toEqual(expect.arrayContaining(['ordinary', 'breaking']));
  });

  it('should merge trigger overrides by identity and replace primitive arrays', async () => {
    const base = await loadEditorialConfig();
    const [trigger, other] = base.triggers;
    await writeDocument('defaults.json', { feedback: { tag: 0.25 } });
    await writeDocument('triggers.json', [{ id: trigger.id, tags: ['cities'], enabled: false }]);
    await writeDocument('triggers/local.json', [{ id: trigger.id, when: ['city.own', 'true'] }]);
    await writeDocument('pages.json', [{ id: 'additional', label: 'Extra', tags: ['extra'], minimum: 1, order: 20 }]);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.defaults.feedback).toEqual({ ...base.defaults.feedback, tag: 0.25 });
    expect(loaded.triggers).toEqual([{ ...trigger, tags: ['cities'], enabled: false, when: ['city.own', 'true'] }, other]);
    expect(loaded.pages.map(page => page.id)).toEqual([...base.pages.map(page => page.id), 'additional']);
    expect(loaded.designs).toEqual(base.designs);
  });

  it('should discover section files in filename order and apply them after flat overrides', async () => {
    const base = await loadEditorialConfig();
    const design = base.designs[0];
    const template = { id: 'local', triggerIds: ['custom-trigger'], tags: ['trade'], weight: { base: 3 }, variants: [
      { id: 'primary', headline: 'Original', body: ['Original'], weight: { base: 1 } },
    ] };
    await writeDocument('templates.json', [template]);
    await writeDocument('templates/z-last.json', [{
      id: 'last', triggerIds: ['custom-trigger'], tags: ['trade'], weight: { base: 2 }, variants: [],
    }]);
    await writeDocument('templates/a-first.json', [
      { id: template.id, weight: { base: 7 }, variants: [{ id: 'primary', body: ['Replacement'] }] },
      { id: 'first', triggerIds: ['custom-trigger'], tags: ['trade'], weight: { base: 1 }, variants: [] },
    ]);
    await writeDocument('triggers/trade.json', [{
      id: 'custom-trigger', subject: 'world', importance: 2, when: 'true',
    }]);
    await writeDocument('designs/custom.json', [{ id: design.id, title: 'Custom title' }]);
    await writeDocument('templates/notes.txt', 'Ignored non-JSON document');
    await writeDocument('templates/ignored.json/nested.json', []);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.templates[0]).toMatchObject({
      id: 'local', weight: { base: 7 },
      variants: [{ id: 'primary', headline: 'Original', body: ['Replacement'] }],
    });
    expect(loaded.templates.slice(1).map(entry => entry.id)).toEqual(['first', 'last']);
    expect(loaded.triggers.at(-1)).toMatchObject({ id: 'custom-trigger', importance: 2 });
    expect(loaded.designs.find(entry => entry.id === design.id)).toEqual({ ...design, title: 'Custom title' });
  });

  it('should reject invalid references and malformed section documents', async () => {
    await writeDocument('templates/trade.json', [{
      id: 'missing', triggerIds: ['absent-trigger'], tags: [], weight: { base: 1 }, variants: [],
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
      ...['Math', 'undefined', 'NaN', 'JSON'].map(name => ({ values: { [name]: '1' } })),
    ])
      expect(editorialConfigSchema.safeParse({ ...base, triggers: [{ ...rule, ...change }] }).success).toBe(false);
  });

  it('should allow documented local values named distance and count', async () => {
    const base = await loadEditorialConfig();
    const rule = { id: 'rated', subject: 'world', when: 'true', values: { distance: '2', count: 'distance + 1' } };
    await expect(parseEditorialConfig({ ...base, triggers: [rule] })).resolves.toMatchObject({ triggers: [rule] });
  });

  it('should prepare expression slots per catalogue and recompile when restoring authored JSON', async () => {
    const config = await loadEditorialConfig();
    const saved = JSON.parse(JSON.stringify(config));
    const restored = await parseEditorialConfig(saved);
    const prepared = await getEditorialTriggerExpressions(config);

    expect(await getEditorialTriggerExpressions(config)).toBe(prepared);
    expect(await getEditorialTriggerExpressions(restored)).not.toBe(prepared);
    expect(saved).toEqual(config);
    expect(prepared.slots.get('neighbor-puppet-annexed')?.when).toHaveLength(4);
  });

  it('should reject invalid trigger expressions in overlays and saved snapshots during loading', async () => {
    const config = await loadEditorialConfig();
    const [trigger] = config.triggers;
    const invalid = { ...trigger, urgent: 'city.own &&' };
    await writeDocument('triggers.json', [{ id: trigger.id, urgent: invalid.urgent }]);
    await expect(loadEditorialConfig(directory)).rejects.toThrow(trigger.id);
    await expect(parseEditorialConfig({ ...config, triggers: [invalid] })).rejects.toThrow('urgent');
  });
});
