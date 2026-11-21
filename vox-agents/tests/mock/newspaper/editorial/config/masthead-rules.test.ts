/** Check masthead rule schema compatibility, overlay merging and choice compilation. */
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChoiceExpressionError } from '../../../../../src/newspaper/contracts/publication.js';
import {
  getEditorialExpressions,
  loadEditorialConfig,
  parseEditorialConfig,
} from '../../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema } from '../../../../../src/newspaper/editorial/config/schema.js';
import { evaluateChoices } from '../../../../../src/newspaper/editorial/shared/eligibility.js';

describe('masthead rule catalogue', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'vd-mastheads-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  /** Write one overlay document at its catalogue path. */
  async function writeDocument(filename: string, value: unknown): Promise<void> {
    const target = path.join(directory, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  }

  it('should load stock rules that reference effective pages and designs', async () => {
    const base = await loadEditorialConfig();
    expect(base.mastheadRules?.length).toBeGreaterThan(0);
    const pageIds = new Set(base.pages.map(page => page.id));
    const designIds = new Set(base.designs.map(design => design.id));
    const ruleIds = new Set<string>();
    for (const rule of base.mastheadRules ?? []) {
      expect(rule.title.trim()).toBe(rule.title);
      expect(ruleIds.has(rule.id)).toBe(false);
      ruleIds.add(rule.id);
      for (const id of Object.keys(rule.pageLabels)) expect(pageIds.has(id)).toBe(true);
      for (const id of rule.designs ?? []) expect(designIds.has(id)).toBe(true);
    }
  });

  it('should keep older saved catalogues valid without a masthead rules field', async () => {
    const base = await loadEditorialConfig();
    const saved: Record<string, unknown> = JSON.parse(JSON.stringify(base));
    delete saved.mastheadRules;
    const parsed = editorialConfigSchema.parse(saved);
    expect(parsed).not.toHaveProperty('mastheadRules');
    await expect(parseEditorialConfig(saved)).resolves.toBeDefined();
  });

  it('should merge an overlay by ID and append a local rule', async () => {
    const base = await loadEditorialConfig();
    const existing = base.mastheadRules![0];
    const added = {
      id: 'local-review', title: 'The {{terms.civilization}} Review',
      pageLabels: { front: 'Local Front' }, when: 'true', weight: { base: 1 },
    };
    await writeDocument('masthead-rules.json', [{ id: existing.id, title: 'Local masthead title' }, added]);
    const loaded = await loadEditorialConfig(directory);
    expect(loaded.mastheadRules?.find(rule => rule.id === existing.id)).toMatchObject({
      title: 'Local masthead title',
      when: existing.when,
      weight: existing.weight,
    });
    expect(loaded.mastheadRules?.find(rule => rule.id === added.id)).toMatchObject(added);
  });

  it('should reject duplicate IDs, unknown references and blank authored copy', async () => {
    const base = await loadEditorialConfig();
    const rule = { id: 'trial', title: 'Trial', when: 'true', weight: { base: 1 } };
    const stockId = base.mastheadRules![0].id;
    await writeDocument('masthead-rules.json', [{ id: stockId, title: 'A local title' }, { id: stockId, when: 'false' }]);
    await expect(loadEditorialConfig(directory)).rejects.toThrow(`Duplicate masthead rule id "${stockId}"`);
    await expect(parseEditorialConfig({ ...base, mastheadRules: [rule, rule] })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['mastheadRules', 1, 'id'] })]),
    });
    await expect(parseEditorialConfig({
      ...base, mastheadRules: [{ ...rule, pageLabels: { absent: 'Absent' } }],
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['mastheadRules', 0, 'pageLabels', 'absent'] })]),
    });
    await expect(parseEditorialConfig({
      ...base, mastheadRules: [{ ...rule, designs: ['absent-design'] }],
    })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ['mastheadRules', 0, 'designs', 0] })]),
    });
    for (const [change, field] of [
      [{ title: '   ' }, 'title'],
      [{ motto: '   ' }, 'motto'],
      [{ pageLabels: { front: '   ' } }, 'pageLabels'],
    ] as const) {
      const result = editorialConfigSchema.safeParse({
        ...base, mastheadRules: [{ ...rule, ...change }],
      });
      if (result.success) throw new Error(`Expected ${field} to be rejected.`);
      expect(result.error.issues.some(issue => issue.path[0] === 'mastheadRules' &&
        issue.path[1] === 0 && issue.path[2] === field)).toBe(true);
    }
  });

  it('should compile rule conditions and adjustments with named diagnostics', async () => {
    const base = await loadEditorialConfig();
    const config = await parseEditorialConfig({
      ...base,
      mastheadRules: [{
        id: 'trial', title: 'Trial', when: 'true',
        weight: { base: 2, adjustments: [{ when: 'true', add: 3 }] },
      }],
    });
    const prepared = await getEditorialExpressions(config);
    const [result] = await evaluateChoices(
      prepared.runner, {}, [{ choice: prepared.mastheadRules.get('trial')! }],
    );
    expect(result.weight).toBe(5);

    const failing = await parseEditorialConfig({
      ...base,
      mastheadRules: [{
        id: 'broken-rule', title: 'Trial', when: '(() => { throw new Error("masthead failure"); })()',
        weight: { base: 1 },
      }],
    });
    const failingPrepared = await getEditorialExpressions(failing);
    const choiceErrors = new Map<number, ChoiceExpressionError>();
    const budget = { interruptedSlots: new Set<number>(), choiceErrors };
    await evaluateChoices(
      failingPrepared.runner, {}, [{ choice: failingPrepared.mastheadRules.get('broken-rule')! }], budget,
    );
    expect([...choiceErrors.values()]).toEqual([
      { choice: 'masthead rule broken-rule', field: 'when', message: 'masthead failure' },
    ]);
  });
});
