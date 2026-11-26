import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeskRef } from '../../../../src/types/api.js';
import type { AuthoredVariant } from '../../../../src/newspaper/editorial/config/schema.js';
import { scaleEditorialConstants } from '../../../../src/newspaper/editorial/config/constants.js';
import { builtInCatalogueDirectory, getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { evaluateTriggerRules } from '../../../../src/newspaper/editorial/rules/evaluate.js';
import { matchTemplates, printable } from '../../../../src/newspaper/editorial/selection/templates.js';
import { briefView } from '../../../../src/newspaper/desk/brief.js';
import type { DeskCatalogue, DeskVariant } from '../../../../src/newspaper/desk/catalogue.js';
import { DeskError, readDeskCatalogue } from '../../../../src/newspaper/desk/catalogue.js';
import type { DeskSettleOptions } from '../../../../src/newspaper/desk/settle.js';
import { settleManyVariants, settleVariant, unsettleVariant, updateVariantStyle } from '../../../../src/newspaper/desk/settle.js';
import { templateVariables } from '../../../../src/newspaper/desk/variables.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, link: vi.fn(fs.link) };
});

const templateSource = `[
  {
    "id": "fixture-news",
    "triggers": ["fixture-era"],
    "tags": ["science"],
    "names": ["civilization", "era"],
    "weight": { "base": 1 },
    "variants": [
      {
        "id": "draft",
        "headline": "A friend enters the {{era}}",
        "byline": "Staff",
        "body": [
          "Letters say {{civilization}} has entered the {{era}}."
        ],
        "links": [
          { "placeholder": "civilization", "label": "{{civilization}}", "target": { "type": "civilization", "civilizationId": "{{playerId}}" } }
        ],
        "weight": { "base": 1 }
      },
      {
        "id": "second",
        "headline": "Second draft",
        "body": ["Second body."],
        "weight": { "base": 1 }
      }
    ]
  }
]
`;

const secondVariantSource = `      {
        "id": "second",
        "headline": "Second draft",
        "body": ["Second body."],
        "weight": { "base": 1 }
      }`;

const multiTemplateSource = `[
  {
    "id": "fixture-multi",
    "triggers": ["fixture-era"],
    "tags": ["science"],
    "names": ["civilization", "era"],
    "weight": { "base": 1 },
    "merge": {
      "match": "true",
      "min": 1,
      "variants": [
        {
          "id": "draft-1",
          "headline": "Merged draft",
          "body": ["Merged body."],
          "weight": { "base": 1 }
        }
      ]
    },
    "variants": [
      {
        "id": "draft",
        "when": "true",
        "voice": "gazette",
        "stance": "neutral",
        "genre": "report",
        "headline": "A friend enters the {{era}}",
        "subheadline": "Source deck",
        "byline": "Staff",
        "body": [
          "Letters say {{civilization}} has entered the {{era}}."
        ],
        "links": [
          { "placeholder": "civilization", "label": "{{civilization}}", "target": { "type": "civilization", "civilizationId": "{{playerId}}" } }
        ],
        "weight": { "base": 1, "adjustments": [{ "when": "true", "add": 2 }] }
      },
      {
        "id": "draft-2",
        "headline": "Occupied suffix",
        "body": ["Occupied body."],
        "weight": { "base": 1 }
      }
    ]
  }
]
`;

const triggerSource = `[
  {
    "id": "fixture-era",
    "subject": "player",
    "when": "true",
    "tier": "routine",
    "values": {
      "civilization": "player.name",
      "era": "player.era",
      "distance": "player.knows('distance') ? player.distance : null"
    }
  }
]
`;

const writingRules = '# Writing rules\n\nWrite plainly.\n';

interface Fixture {
  directory: string;
  writingPath: string;
  templatePath: string;
  companionPath: string;
  ref: DeskRef;
  secondRef: DeskRef;
}

interface ParsedTemplate {
  id: string;
  merge?: unknown;
  variants: Record<string, unknown>[];
}

const directories: string[] = [];

/** Build an isolated stock catalogue with two source variants in one template. */
async function createFixture(
  source = templateSource,
  templateId = 'fixture-news',
  variantId = 'draft',
  secondVariantId = 'second',
): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vd-desk-settle-'));
  directories.push(directory);
  const templates = path.join(directory, 'templates');
  const triggers = path.join(directory, 'triggers');
  await mkdir(templates, { recursive: true });
  await mkdir(triggers, { recursive: true });
  await mkdir(path.join(directory, 'styles'));
  const stock = builtInCatalogueDirectory();
  for (const file of ['constants.json', 'civic-terms.json', 'styles/voice.json', 'styles/stance.json', 'styles/genre.json'])
    await copyFile(path.join(stock, file), path.join(directory, file));
  await writeFile(path.join(templates, 'fixture.json'), source, 'utf8');
  await writeFile(path.join(triggers, 'fixture.json'), triggerSource, 'utf8');
  const writingPath = path.join(directory, 'writing.md');
  await writeFile(writingPath, writingRules, 'utf8');
  return {
    directory,
    writingPath,
    templatePath: path.join(templates, 'fixture.json'),
    companionPath: path.join(templates, 'fixture-variants.json'),
    ref: { templateId, variantId },
    secondRef: { templateId, variantId: secondVariantId },
  };
}

/** Point the desk at one fixture catalogue. */
function options(fixture: Fixture): DeskSettleOptions {
  return { directory: fixture.directory, writingPath: fixture.writingPath };
}

/** Read the fixture catalogue and assert that it is editable. */
async function readCatalogue(fixture: Fixture): Promise<DeskCatalogue> {
  const catalogue = await readDeskCatalogue(options(fixture));
  expect(catalogue.available).toBe(true);
  return catalogue;
}

/** Find one variant in a fixture catalogue. */
function findVariant(catalogue: DeskCatalogue, ref: DeskRef): DeskVariant {
  const variant = catalogue.templates
    .find((template) => template.id === ref.templateId)
    ?.variants.find((entry) => entry.id === ref.variantId);
  if (!variant) throw new Error(`Missing fixture variant ${ref.templateId}/${ref.variantId}.`);
  return variant;
}

/** Read the saved fixture template. */
async function readParsed(file: string): Promise<ParsedTemplate[]> {
  return JSON.parse(await readFile(file, 'utf8')) as ParsedTemplate[];
}

/** Capture the desk error a save should reject with. */
async function rejection(promise: Promise<unknown>): Promise<DeskError> {
  try {
    await promise;
  } catch (error) {
    return error as DeskError;
  }
  throw new Error('Expected the desk save to fail.');
}

describe('newspaper desk settle', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('should change only the edited variant fields and preserve the rest of the file', async () => {
    const fixture = await createFixture();
    const before = await readCatalogue(fixture);
    const draft = findVariant(before, fixture.ref);
    const original = await readParsed(fixture.templatePath);
    await settleVariant(fixture.ref, {
      headline: 'A new {{era}} for {{civilization}}',
      subheadline: 'Deck copy',
      body: ['', 'Fresh body for {{civilization}}.', '  '],
    }, draft.revision, options(fixture));
    const edited = await readFile(fixture.templatePath, 'utf8');
    const after = await readParsed(fixture.templatePath);
    expect(edited.slice(edited.indexOf(secondVariantSource))).toBe(templateSource.slice(templateSource.indexOf(secondVariantSource)));
    expect(after[0].variants[1]).toEqual(original[0].variants[1]);
    expect(after[0].variants[0]).toMatchObject({
      headline: 'A new {{era}} for {{civilization}}',
      subheadline: 'Deck copy',
      body: ['Fresh body for {{civilization}}.'],
      settled: true,
    });
    expect(after[0].variants[0]).not.toHaveProperty('byline');
    expect(after[0].variants[0].links).toEqual(original[0].variants[0].links);
    expect(after[0].variants[0].weight).toEqual(original[0].variants[0].weight);
  });

  it('should save all three tags when correcting the style of a variant with implicit defaults', async () => {
    const fixture = await createFixture();
    const before = await readParsed(fixture.templatePath);
    const variant = findVariant(await readCatalogue(fixture), fixture.ref);
    const style = { voice: 'general', stance: 'government-critical', genre: 'report' };
    await updateVariantStyle(fixture.ref, { revision: variant.revision, style }, options(fixture));

    const after = await readParsed(fixture.templatePath);
    expect(after[0].variants).toEqual([{ ...before[0].variants[0], ...style }, before[0].variants[1]]);
    const saved = findVariant(await readCatalogue(fixture), fixture.ref);
    expect(saved).toMatchObject({ text: variant.text, settled: false, style });
    expect(saved.revision).not.toBe(variant.revision);
    await expect(updateVariantStyle(fixture.ref, { revision: variant.revision, style }, options(fixture)))
      .rejects.toMatchObject({ status: 409 });
  });

  it('should keep companion copy and review status when changing the style', async () => {
    const fixture = await createFixture(multiTemplateSource, 'fixture-multi');
    const base = await readFile(fixture.templatePath, 'utf8');
    const siblingRef = { templateId: fixture.ref.templateId, variantId: 'companion-draft' };
    const sibling = { ...JSON.parse(base)[0].variants[0], id: siblingRef.variantId, settled: true };
    await writeFile(fixture.companionPath, JSON.stringify([{ id: siblingRef.templateId, variants: [sibling] }]));
    const variant = findVariant(await readCatalogue(fixture), siblingRef);
    const style = { voice: 'press', stance: 'populist', genre: 'analysis' };
    await updateVariantStyle(siblingRef, { revision: variant.revision, style }, options(fixture));

    expect((await readParsed(fixture.companionPath))[0].variants).toEqual([{ ...sibling, ...style }]);
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(base);
  });

  it('should reject a stale revision without touching the file', async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const error = await rejection(settleVariant(
      fixture.ref,
      { headline: 'New copy', body: ['New body.'] },
      'stale-revision',
      options(fixture),
    ));
    expect(error).toBeInstanceOf(DeskError);
    expect(error.status).toBe(409);
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should reject a runtime alias that the writer table does not list', async () => {
    const fixture = await createFixture();
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const error = await rejection(settleVariant(
      fixture.ref,
      { headline: 'A friend enters the {{subject.name}} era', body: ['News from {{civilization}}.'] },
      draft.revision,
      options(fixture),
    ));
    expect(error.status).toBe(400);
    expect(error.message).toContain('subject.name');
  });

  it('should reject an unknown placeholder and leave the original bytes in place', async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const error = await rejection(settleVariant(
      fixture.ref,
      { headline: 'A mystery in {{mystery}}', body: ['New body.'] },
      draft.revision,
      options(fixture),
    ));
    expect(error.status).toBe(400);
    expect(error.message).toContain('mystery');
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should reject a candidate that drops a kept link', async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const error = await rejection(settleVariant(
      fixture.ref,
      { headline: 'No link here', body: ['Plain body.'] },
      draft.revision,
      options(fixture),
    ));
    expect(error.status).toBe(400);
    expect(error.message).toContain('civilization');
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should restore the original bytes if full catalogue validation fails', async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const variant = findVariant(await readCatalogue(fixture), fixture.ref);
    const onChange = vi.fn();
    const validate = vi.fn(async () => {
      expect((await readParsed(fixture.templatePath))[0].variants[0].settled).toBe(true);
      throw new Error('Catalogue validation rejected the save.');
    });
    await expect(settleVariant(fixture.ref, variant.text, variant.revision, {
      ...options(fixture), validate, onChange,
    })).rejects.toMatchObject({ status: 400 });
    expect(validate).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should remove the settled mark when a variant is reopened', async () => {
    const fixture = await createFixture();
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    await settleVariant(
      fixture.ref,
      { headline: 'A new {{era}}', body: ['Body from {{civilization}}.'] },
      draft.revision,
      options(fixture),
    );
    const settled = findVariant(await readCatalogue(fixture), fixture.ref);
    expect(settled.settled).toBe(true);
    await unsettleVariant(fixture.ref, settled.revision, options(fixture));
    const parsed = await readParsed(fixture.templatePath);
    expect(parsed[0].variants[0]).not.toHaveProperty('settled');
    expect(findVariant(await readCatalogue(fixture), fixture.ref).settled).toBe(false);
  });

  it('should stay printable with a value for every listed variable and a typed link', async () => {
    const fixture = await createFixture();
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    await settleVariant(
      fixture.ref,
      {
        headline: '{{civilization}} reaches the {{era}}',
        body: ['The road is {{distance}} from our gate.'],
      },
      draft.revision,
      options(fixture),
    );
    const settled = findVariant(await readCatalogue(fixture), fixture.ref);
    const parsed = await readParsed(fixture.templatePath);
    const raw = parsed[0].variants[0] as unknown as AuthoredVariant;
    const catalogue = await readCatalogue(fixture);
    const variables = templateVariables(catalogue.templates[0], catalogue, settled);
    // Links target IDs, which the writer table omits, so supply the alias the link needs.
    const values = { playerId: 1, ...Object.fromEntries(variables.map(variable => [variable.name, 'x'])) };
    expect(variables).not.toHaveLength(0);
    expect(printable(raw, values)).toBe(true);
  });

  it('should serialize concurrent writes to two variants in one file', async () => {
    const fixture = await createFixture();
    const before = await readCatalogue(fixture);
    const draft = findVariant(before, fixture.ref);
    const second = findVariant(before, fixture.secondRef);
    await Promise.all([
      settleVariant(
        fixture.ref,
        { headline: 'First {{era}}', body: ['First {{civilization}}.'] },
        draft.revision,
        options(fixture),
      ),
      settleVariant(
        fixture.secondRef,
        { headline: 'Second {{era}}', body: ['Second {{civilization}}.'] },
        second.revision,
        options(fixture),
      ),
    ]);
    const parsed = await readParsed(fixture.templatePath);
    expect(parsed[0].variants[0]).toMatchObject({ headline: 'First {{era}}', settled: true });
    expect(parsed[0].variants[1]).toMatchObject({ headline: 'Second {{era}}', settled: true });
  });

  it('should notify the caller after a successful save and reopen', async () => {
    const fixture = await createFixture();
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const onChange = vi.fn();
    await settleVariant(
      fixture.ref,
      { headline: 'A new {{era}}', body: ['Body from {{civilization}}.'] },
      draft.revision,
      { ...options(fixture), onChange },
    );
    expect(onChange).toHaveBeenCalledWith(fixture.ref);
    const settled = findVariant(await readCatalogue(fixture), fixture.ref);
    onChange.mockClear();
    await unsettleVariant(fixture.ref, settled.revision, { ...options(fixture), onChange });
    expect(onChange).toHaveBeenCalledWith(fixture.ref);
  });

  it('should reject the old revision after a successful save', async () => {
    const fixture = await createFixture();
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    await settleVariant(
      fixture.ref,
      { headline: 'A new {{era}}', body: ['Body from {{civilization}}.'] },
      draft.revision,
      options(fixture),
    );
    const error = await rejection(settleVariant(
      fixture.ref,
      { headline: 'Another {{era}}', body: ['Another {{civilization}}.'] },
      draft.revision,
      options(fixture),
    ));
    expect(error.status).toBe(409);
  });

  it('should report an unavailable catalogue when a target template file is read-only', async () => {
    const fixture = await createFixture();
    await chmod(fixture.templatePath, 0o444);
    try {
      const catalogue = await readDeskCatalogue(options(fixture));
      expect(catalogue.available).toBe(false);
      expect(catalogue.reason).toMatch(/read-only|not writable/i);
    } finally {
      await chmod(fixture.templatePath, 0o666);
    }
  });

  it('should refuse to save while the catalogue is unavailable', async () => {
    const fixture = await createFixture();
    await chmod(fixture.templatePath, 0o444);
    try {
      const error = await rejection(settleVariant(
        fixture.ref,
        { headline: 'A new {{era}}', body: ['Body from {{civilization}}.'] },
        'any-revision',
        options(fixture),
      ));
      expect(error.status).toBe(503);
    } finally {
      await chmod(fixture.templatePath, 0o666);
    }
  });
});

describe('newspaper desk settle many', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it('should keep inherited links when settling a draft and copying it to the companion', async () => {
    const [template] = JSON.parse(templateSource) as ParsedTemplate[];
    const { links, ...source } = template.variants[0];
    const fixture = await createFixture(JSON.stringify([{
      ...template, extends: 'fixture-civilization', variants: [source, { ...template.variants[1], links: [] }],
    }]));
    await writeFile(path.join(fixture.directory, 'root-templates.json'), JSON.stringify([
      { id: 'fixture-civilization', links },
    ]));
    const initial = await readCatalogue(fixture);
    const draft = findVariant(initial, fixture.ref);
    expect(draft.links).toEqual(links);
    expect(findVariant(initial, fixture.secondRef).links).toEqual([]);
    const original = await readFile(fixture.templatePath, 'utf8');
    const copy = { headline: 'News from {{civilization}}', body: ['The {{era}} begins.'] };
    const invalid = { headline: 'News from abroad', body: copy.body };

    await expect(settleManyVariants(fixture.ref, {
      revision: draft.revision, primary: copy, siblings: [invalid],
    }, options(fixture))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('civilization') });
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
    await expect(readFile(fixture.companionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await settleManyVariants(fixture.ref, {
      revision: draft.revision, primary: copy, siblings: [draft.text],
    }, options(fixture));
    const [base] = await readParsed(fixture.templatePath);
    const [companion] = await readParsed(fixture.companionPath);
    expect(base).toHaveProperty('extends', 'fixture-civilization');
    expect(base.variants[0]).not.toHaveProperty('links');
    expect(companion.variants[0]).not.toHaveProperty('links');

    const sibling = { ...fixture.ref, variantId: String(companion.variants[0].id) };
    expect(findVariant(await readCatalogue(fixture), sibling).links).toEqual(links);
    const config = await loadEditorialConfig(fixture.directory);
    expect(config.templates.find(entry => entry.id === sibling.templateId)?.variants
      .find(variant => variant.id === sibling.variantId)?.links).toEqual(links);
  });

  it('should keep the primary in place and publish companion copies as separate choices', async () => {
    const fixture = await createFixture(multiTemplateSource, 'fixture-multi', 'draft', 'draft-2');
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const original = await readParsed(fixture.templatePath);
    const sourceRow = original[0].variants[0];
    await writeFile(fixture.companionPath, JSON.stringify([{ id: fixture.ref.templateId, variants: [{
      id: 'draft-3', headline: 'Earlier sibling', body: ['Earlier story.'], weight: { base: 1 },
    }] }]), 'utf8');
    const onChange = vi.fn();
    await settleManyVariants(fixture.ref, {
      revision: draft.revision,
      primary: {
        headline: 'Primary {{era}}',
        subheadline: 'Fresh deck',
        body: ['Primary body for {{civilization}}.'],
      },
      siblings: [
        { headline: 'First sibling {{era}}', body: ['First sibling body for {{civilization}}.'] },
        { headline: 'Second sibling {{era}}', byline: 'Staff', body: ['Second sibling body for {{civilization}}.'] },
      ],
    }, { ...options(fixture), onChange });
    expect(onChange).toHaveBeenCalledWith(fixture.ref);

    const after = await readParsed(fixture.templatePath);
    const rows = after[0].variants;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'draft',
      settled: true,
      headline: 'Primary {{era}}',
      subheadline: 'Fresh deck',
      body: ['Primary body for {{civilization}}.'],
    });
    expect(rows[0]).not.toHaveProperty('byline');
    expect(rows[0]).toMatchObject({
      when: sourceRow.when,
      voice: sourceRow.voice,
      stance: sourceRow.stance,
      genre: sourceRow.genre,
      weight: sourceRow.weight,
      links: sourceRow.links,
    });
    expect(rows[1]).toEqual(original[0].variants[1]);
    expect(after[0].merge).toEqual(original[0].merge);

    const [extra] = await readParsed(fixture.companionPath);
    expect(extra.id).toBe(fixture.ref.templateId);
    expect(extra.variants.map(row => row.id)).toEqual(['draft-3', 'draft-4', 'draft-5']);
    for (const row of extra.variants.slice(1)) {
      expect(row).toMatchObject({
        settled: true,
        when: sourceRow.when,
        voice: sourceRow.voice,
        stance: sourceRow.stance,
        genre: sourceRow.genre,
        weight: sourceRow.weight,
        links: sourceRow.links,
      });
    }
    expect(extra.variants[1]).toMatchObject({
      headline: 'First sibling {{era}}',
      body: ['First sibling body for {{civilization}}.'],
    });
    expect(extra.variants[1]).not.toHaveProperty('subheadline');
    expect(extra.variants[1]).not.toHaveProperty('byline');
    expect(extra.variants[2]).toMatchObject({ headline: 'Second sibling {{era}}', byline: 'Staff' });
    expect(extra.variants[2]).not.toHaveProperty('subheadline');

    const catalogue = await readCatalogue(fixture);
    const firstSibling = findVariant(catalogue, { templateId: 'fixture-multi', variantId: 'draft-4' });
    expect(firstSibling.settled).toBe(true);
    expect(firstSibling.text).toMatchObject({
      headline: 'First sibling {{era}}',
      body: ['First sibling body for {{civilization}}.'],
    });
    expect(firstSibling.links).toEqual(sourceRow.links);
    const brief = briefView([fixture.secondRef], catalogue, 1);
    expect(brief.examples.map(example => example.variantId)).toEqual(['draft', 'draft-4', 'draft-5']);

    const config = await loadEditorialConfig(fixture.directory);
    const compiled = await getEditorialExpressions(config);
    const facts = buildNewspaperFacts({
      request: { receiverPlayerID: 0, previousCheckTurn: 1, cutoffTurn: 5 },
      players: [{ subjectID: 0, values: { Era: 'Renaissance Era' },
        source: { table: 'PlayerSummaries', id: 1, turn: 5, createdAt: 1 } }],
      cities: [], comparisons: { players: [], cities: [] }, events: [],
    }, { playerIdentities: { 0: { name: 'Rome', major: true } } });
    const rules = await evaluateTriggerRules({
      rules: config.triggers.filter(rule => rule.id === 'fixture-era'), compiled, facts, constants: config.constants, speedMultiplier: 1,
    });
    const matches = await matchTemplates(rules.developments, config, compiled, { facts, constants: scaleEditorialConstants(config.constants, 1) });
    expect(matches.find(match => match.templateIds.includes(fixture.ref.templateId))?.variantWeights)
      .toMatchObject({ draft: 3, 'draft-4': 3, 'draft-5': 3 });
  });

  it('should create numbered siblings and let the desk edit them in the companion', async () => {
    const fixture = await createFixture();
    const { revision } = findVariant(await readCatalogue(fixture), fixture.ref);
    const copy = { headline: 'Latest news', body: ['News from {{civilization}}.'] };
    vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error('No hard links'), { code: 'ENOTSUP' }));
    await settleManyVariants(fixture.ref, { revision, primary: copy, siblings: [copy, { ...copy, headline: 'Other news' }] }, options(fixture));
    const [extra] = await readParsed(fixture.companionPath);
    expect(extra.variants.map(variant => variant.id)).toEqual(['draft-1', 'draft-2']);

    const ref = { ...fixture.ref, variantId: 'draft-1' };
    const sibling = findVariant(await readCatalogue(fixture), ref);
    const base = await readFile(fixture.templatePath, 'utf8');
    await unsettleVariant(ref, sibling.revision, options(fixture));
    const reopened = findVariant(await readCatalogue(fixture), ref);
    expect(reopened.settled).toBe(false);
    await settleManyVariants(ref, {
      revision: reopened.revision, primary: { ...copy, headline: 'Revised companion' }, siblings: [copy],
    }, options(fixture));
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(base);
    expect((await readParsed(fixture.companionPath))[0].variants.map(variant => [variant.id, variant.headline])).toEqual([
      ['draft-1', 'Revised companion'], ['draft-2', 'Other news'], ['draft-1-1', 'Latest news'],
    ]);
  });

  it('should keep a companion another editor creates during the save', async () => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const { revision } = findVariant(await readCatalogue(fixture), fixture.ref);
    const copy = { headline: 'Latest news', body: ['News from {{civilization}}.'] };
    const companion = '[\n]\n';
    vi.mocked(link).mockImplementationOnce(async (_temporary, file) => {
      await writeFile(file, companion);
      throw Object.assign(new Error('Companion already exists'), { code: 'EEXIST' });
    });
    await expect(settleManyVariants(fixture.ref, { revision, primary: copy, siblings: [copy] }, options(fixture)))
      .rejects.toMatchObject({ status: 409 });
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
    expect(await readFile(fixture.companionPath, 'utf8')).toBe(companion);
  });

  it.each([false, true])('should restore the base and companion after validation fails (existing companion: %s)', async (existing) => {
    const fixture = await createFixture();
    const original = await readFile(fixture.templatePath, 'utf8');
    const companion = '[\n]\n';
    if (existing) await writeFile(fixture.companionPath, companion, 'utf8');
    const { revision } = findVariant(await readCatalogue(fixture), fixture.ref);
    const copy = { headline: 'Latest news', body: ['News from {{civilization}}.'] };
    const onChange = vi.fn();
    await expect(settleManyVariants(fixture.ref, { revision, primary: copy, siblings: [copy] }, {
      ...options(fixture), onChange,
      validate: async () => { throw new Error('Invalid catalogue'); },
    })).rejects.toMatchObject({ status: 400 });
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
    if (existing) expect(await readFile(fixture.companionPath, 'utf8')).toBe(companion);
    else await expect(readFile(fixture.companionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should reject an invalid sibling without touching the file or clearing drafts', async () => {
    const fixture = await createFixture(multiTemplateSource, 'fixture-multi', 'draft', 'draft-2');
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    const original = await readFile(fixture.templatePath, 'utf8');
    const onChange = vi.fn();
    const error = await rejection(settleManyVariants(fixture.ref, {
      revision: draft.revision,
      primary: { headline: 'Primary {{era}}', body: ['Primary body for {{civilization}}.'] },
      siblings: [
        { headline: 'Valid sibling {{era}}', body: ['Valid body for {{civilization}}.'] },
        { headline: 'A mystery in {{mystery}}', body: ['Invalid body.'] },
      ],
    }, { ...options(fixture), onChange }));
    expect(error.status).toBe(400);
    expect(error.message).toContain('mystery');
    expect(onChange).not.toHaveBeenCalled();
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should reject a stale revision without touching the file or clearing drafts', async () => {
    const fixture = await createFixture(multiTemplateSource, 'fixture-multi', 'draft', 'draft-2');
    const original = await readFile(fixture.templatePath, 'utf8');
    const onChange = vi.fn();
    const error = await rejection(settleManyVariants(fixture.ref, {
      revision: 'stale-revision',
      primary: { headline: 'Primary {{era}}', body: ['Primary body for {{civilization}}.'] },
      siblings: [{ headline: 'Sibling {{era}}', body: ['Sibling body for {{civilization}}.'] }],
    }, { ...options(fixture), onChange }));
    expect(error.status).toBe(409);
    expect(onChange).not.toHaveBeenCalled();
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });

  it('should refuse a multiple save after the source variant is settled', async () => {
    const fixture = await createFixture(multiTemplateSource, 'fixture-multi', 'draft', 'draft-2');
    const draft = findVariant(await readCatalogue(fixture), fixture.ref);
    await settleVariant(
      fixture.ref,
      { headline: 'Primary {{era}}', body: ['Primary body for {{civilization}}.'] },
      draft.revision,
      options(fixture),
    );
    const settled = findVariant(await readCatalogue(fixture), fixture.ref);
    const original = await readFile(fixture.templatePath, 'utf8');
    const error = await rejection(settleManyVariants(fixture.ref, {
      revision: settled.revision,
      primary: { headline: 'Another {{era}}', body: ['Another body for {{civilization}}.'] },
      siblings: [{ headline: 'Sibling {{era}}', body: ['Sibling body for {{civilization}}.'] }],
    }, options(fixture)));
    expect(error.status).toBe(409);
    expect(await readFile(fixture.templatePath, 'utf8')).toBe(original);
  });
});
