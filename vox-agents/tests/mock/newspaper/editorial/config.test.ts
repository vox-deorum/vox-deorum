/** Exercise file discovery, overrides, and validation through the real catalogue loader. */
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config.js';

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

  it('should retain flat overrides and merge entries and variants by identity while replacing primitive arrays', async () => {
    const base = await loadEditorialConfig();
    const trigger = base.triggers[0];
    const template = base.templates.find(entry => entry.variants.length > 1)!;
    const variant = template.variants[0];
    const triggerIds = [base.triggers[1].id];
    await writeDocument('defaults.json', { feedback: { tag: 0.25 } });
    await writeDocument('triggers.json', [{ id: trigger.id, tags: [] }]);
    await writeDocument('templates.json', [{
      id: template.id, triggerIds, tags: ['replacement'],
      variants: [{ id: variant.id, body: ['Replacement {{name}}'] }],
    }]);
    await writeDocument('pages.json', [{ id: 'additional', label: 'Extra', tags: ['extra'], minimum: 1, order: 20 }]);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.defaults.feedback).toEqual({ ...base.defaults.feedback, tag: 0.25 });
    expect(loaded.triggers).toEqual([{ ...trigger, tags: [] }, ...base.triggers.slice(1)]);
    const edited = loaded.templates.find(entry => entry.id === template.id)!;
    expect(edited).toMatchObject({ triggerIds, tags: ['replacement'], weight: template.weight });
    expect(edited.variants).toEqual([
      { ...variant, body: ['Replacement {{name}}'] }, ...template.variants.slice(1),
    ]);
    expect(loaded.pages.map(page => page.id)).toEqual([...base.pages.map(page => page.id), 'additional']);
    expect(loaded.designs).toEqual(base.designs);
  });

  it('should discover section files in filename order and apply them after flat overrides', async () => {
    const base = await loadEditorialConfig();
    const template = base.templates[0];
    const design = base.designs[0];
    await writeDocument('templates.json', [{ id: template.id, weight: { base: 3 } }]);
    await writeDocument('templates/z-last.json', [{
      id: 'last', triggerIds: ['custom-trigger'], tags: ['trade'], weight: { base: 2 }, variants: [],
    }]);
    await writeDocument('templates/a-first.json', [
      { id: template.id, weight: { base: 7 } },
      { id: 'first', triggerIds: ['custom-trigger'], tags: ['trade'], weight: { base: 1 }, variants: [] },
    ]);
    await writeDocument('triggers/trade.json', [{
      id: 'custom-trigger', detector: 'tradeConcentration', threshold: 2, scale: 10, tags: ['trade'],
    }]);
    await writeDocument('designs/custom.json', [{ id: design.id, title: 'Custom title' }]);
    await writeDocument('templates/notes.txt', 'Ignored non-JSON document');
    await writeDocument('templates/ignored.json/nested.json', []);

    const loaded = await loadEditorialConfig(directory);
    expect(loaded.templates.find(entry => entry.id === template.id)).toEqual({ ...template, weight: { base: 7, adjustments: [] } });
    expect(loaded.templates.slice(-2).map(entry => entry.id)).toEqual(['first', 'last']);
    expect(loaded.triggers.at(-1)).toMatchObject({ id: 'custom-trigger', threshold: 2 });
    expect(loaded.designs.find(entry => entry.id === design.id)).toEqual({ ...design, title: 'Custom title' });
  });

  it('should reject invalid references and malformed section documents', async () => {
    const base = await loadEditorialConfig();
    await writeDocument('templates/trade.json', [{ id: base.templates[0].id, triggerIds: ['absent-trigger'] }]);
    await expect(loadEditorialConfig(directory)).rejects.toThrow('Unknown trigger');
    await writeDocument('templates/trade.json', { id: 'an-array-is-required' });
    await expect(loadEditorialConfig(directory)).rejects.toThrow();
    await writeFile(path.join(directory, 'templates/trade.json'), '{');
    await expect(loadEditorialConfig(directory)).rejects.toBeInstanceOf(SyntaxError);
  });
});
