import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeskRef } from '../../../../src/types/api.js';
import type { AuthoredVariant } from '../../../../src/newspaper/editorial/config/schema.js';
import { builtInCatalogueDirectory } from '../../../../src/newspaper/editorial/config/load.js';
import { printable } from '../../../../src/newspaper/editorial/selection/templates.js';
import type { DeskCatalogue, DeskVariant } from '../../../../src/newspaper/desk/catalogue.js';
import { DeskError, readDeskCatalogue } from '../../../../src/newspaper/desk/catalogue.js';
import type { DeskSettleOptions } from '../../../../src/newspaper/desk/settle.js';
import { settleVariant, unsettleVariant } from '../../../../src/newspaper/desk/settle.js';
import { templateVariables } from '../../../../src/newspaper/desk/variables.js';

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
  ref: DeskRef;
  secondRef: DeskRef;
}

interface ParsedTemplate {
  id: string;
  variants: Record<string, unknown>[];
}

const directories: string[] = [];

/** Build an isolated stock catalogue with two variants in one template. */
async function createFixture(): Promise<Fixture> {
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
  await writeFile(path.join(templates, 'fixture.json'), templateSource, 'utf8');
  await writeFile(path.join(triggers, 'fixture.json'), triggerSource, 'utf8');
  const writingPath = path.join(directory, 'writing.md');
  await writeFile(writingPath, writingRules, 'utf8');
  return {
    directory,
    writingPath,
    templatePath: path.join(templates, 'fixture.json'),
    ref: { templateId: 'fixture-news', variantId: 'draft' },
    secondRef: { templateId: 'fixture-news', variantId: 'second' },
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
    const values = Object.fromEntries(variables.map(variable => [variable.name, 'x']));
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
