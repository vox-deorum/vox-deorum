import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeskRef, DeskStyle, DeskText, DeskVariable } from '../../../../src/types/api.js';
import { deskWritingRulesPath, type DeskCatalogue, type DeskTemplate, type DeskVariant } from '../../../../src/newspaper/desk/catalogue.js';
import {
  briefView,
  chunkByStyle,
  pickExamples,
  renderBrief,
} from '../../../../src/newspaper/desk/brief.js';

const mocks = vi.hoisted(() => ({
  variables: [] as DeskVariable[],
}));

vi.mock('../../../../src/newspaper/desk/variables.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/newspaper/desk/variables.js')>();
  return {
    ...actual,
    templateVariables: () => mocks.variables,
    candidateWarnings: () => [],
  };
});

const press: DeskStyle = { voice: 'press', stance: 'hawkish', genre: 'analysis' };

/** Build one fake variant around a short editable text. */
function variant(
  id: string,
  style: DeskStyle | undefined,
  settled = false,
  extra: Partial<DeskVariant> = {},
): DeskVariant {
  const text: DeskText = {
    headline: `Headline for ${id}`,
    body: [`Body for ${id} on turn {{period.to}}.`],
  };
  return {
    id,
    ...(style ? { style } : {}),
    text,
    settled,
    revision: `revision-${id}`,
    links: [],
    ...extra,
  };
}

/** Build one fake template with the trigger context a brief reads. */
function template(
  id: string,
  tags: string[],
  variants: DeskVariant[],
  extra: Partial<DeskTemplate> = {},
): DeskTemplate {
  return {
    id,
    file: `${id}.json`,
    tags,
    triggerSummary: `Summary for ${id}`,
    triggers: ['trigger-a'],
    when: 'period.from > 0',
    formats: { population: 'million|millions' },
    names: ['era'],
    variants,
    ...extra,
  };
}

/** Build the catalogue seam consumed by the brief. */
function catalogue(templates: DeskTemplate[]): DeskCatalogue {
  return {
    available: true,
    directory: '.',
    writingPath: deskWritingRulesPath,
    templates,
    triggers: [{
      id: 'trigger-a',
      subject: 'player',
      when: ['first', 'second'],
      values: { era: 'self.era' },
      group: { by: 'kind' },
    }],
    styles: {
      voice: [{ id: 'press', guidance: 'Write with pace.' }],
      stance: [{ id: 'hawkish', guidance: 'Look for the opening.' }],
      genre: [{ id: 'analysis', guidance: 'Ask one question.' }],
    },
  };
}

const target = template('science-news', ['science', 'international'], [
  variant('draft', press, false, {
    links: [{ placeholder: 'civilization', label: '{{civilization}}', target: { type: 'civilization', civilizationId: '{{playerId}}' } }],
  }),
  variant('sibling', press, false),
  variant('target-settled', press, true),
]);

const settled = template('settled-news', ['science', 'international'], [
  variant('same-style', press, true),
  variant('untouched', undefined, false),
]);

describe('newspaper desk brief', () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('should group variants by style and treat untagged variants as general/neutral/report', () => {
    const refs: DeskRef[] = [
      { templateId: target.id, variantId: 'draft' },
      { templateId: target.id, variantId: 'sibling' },
      { templateId: settled.id, variantId: 'untouched' },
    ];
    const chunks = chunkByStyle(refs, catalogue([target, settled]), 3);
    expect(chunks).toEqual([
      refs.slice(0, 2),
      [refs[2]],
    ]);
  });

  it('should prefer settled examples with the same voice and template and ignore unsettled variants', () => {
    const results = pickExamples({ templateId: target.id, variantId: 'draft' }, catalogue([target, settled]));
    expect(results.map(example => example.variantId)).toEqual(['target-settled', 'same-style']);
    expect(results.every(example => example.score > 0)).toBe(true);
    expect(results.some(example => example.variantId === 'untouched')).toBe(false);
  });

  it('should deduplicate examples shared by variants in one chunk', () => {
    const view = briefView([
      { templateId: target.id, variantId: 'draft' },
      { templateId: target.id, variantId: 'sibling' },
    ], catalogue([target, settled]), 2);
    const keys = view.examples.map(example => JSON.stringify([example.templateId, example.variantId]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should render the live writing rules and the current starting text', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'vd-desk-brief-'));
    const writingPath = path.join(directory, 'writing.md');
    await writeFile(writingPath, 'Write plainly.\n\nBRIEF-MARKER-42\n');
    const view = briefView([{ templateId: target.id, variantId: 'draft' }], catalogue([target, settled]), 2, writingPath);
    const rendered = renderBrief(view);
    expect(rendered).toContain('BRIEF-MARKER-42');
    expect(rendered).toContain('Headline for draft');
    expect(rendered).toContain('Body for draft');
    expect(rendered).toContain('Write with pace.');
  });
});
