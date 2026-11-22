import { describe, expect, it } from 'vitest';
import type { DeskText, DeskVariable } from '../../../../src/types/api.js';
import type {
  DeskCatalogue,
  DeskTriggerDefinition,
  DeskTemplate,
  DeskVariant,
} from '../../../../src/newspaper/desk/catalogue.js';
import {
  candidateWarnings,
  templateVariables,
  variantWarnings,
} from '../../../../src/newspaper/desk/variables.js';

/** Read the variable names in table order. */
function names(variables: readonly DeskVariable[]): string[] {
  return variables.map((variable) => variable.name);
}

/** Find one variable by its exact placeholder name. */
function variable(variables: readonly DeskVariable[], name: string): DeskVariable | undefined {
  return variables.find((entry) => entry.name === name);
}

/** Build one trigger definition around its values and group. */
function trigger(
  id: string,
  subject: DeskTriggerDefinition['subject'],
  values?: DeskTriggerDefinition['values'],
  group?: DeskTriggerDefinition['group'],
): DeskTriggerDefinition {
  return { id, subject, when: 'true', values, group };
}

/** Build one variant with a short editable text. */
function variant(id: string, text: DeskText, extra: Partial<DeskVariant> = {}): DeskVariant {
  return { id, text, settled: false, revision: id, links: [], ...extra };
}

/** Build one template around its trigger IDs and variants. */
function template(id: string, triggerIds: string[], variants: DeskVariant[]): DeskTemplate {
  return {
    id,
    file: `${id}.json`,
    tags: [],
    triggerSummary: '',
    triggers: triggerIds,
    formats: {},
    variants,
  };
}

/** Build the catalogue seam used by the variable table. */
function catalogue(
  triggers: DeskTriggerDefinition[],
  extra: Partial<DeskCatalogue> = {},
): DeskCatalogue {
  return {
    available: true,
    directory: '.',
    writingPath: 'writing.md',
    templates: [],
    triggers,
    ...extra,
  };
}

const paragraph = 'A short report.';

describe('newspaper desk variables', () => {
  it('should list bare values for an ungrouped trigger and mark null-capable ones', () => {
    const era = trigger('era', 'player', {
      civilization: 'player.name',
      era: 'player.era',
      distance: "player.knows('distance') ? player.distance : null",
    });
    const variables = templateVariables(
      template('news', ['era'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([era]),
    );
    const listed = names(variables);
    expect(listed).toEqual(expect.arrayContaining([
      'civilization', 'era', 'distance',
      'triggerValues.era.civilization', 'triggerValues.era.era',
    ]));
    expect(variable(variables, 'distance')).toMatchObject({ group: 'trigger', mayBeEmpty: true });
    expect(variable(variables, 'civilization')).toMatchObject({ source: 'player.name', mayBeEmpty: false });
    expect(listed).not.toContain('key');
    expect(listed).not.toContain('count');
  });

  it('should drop a bare trigger key shared by two triggers but keep both qualified names', () => {
    const first = trigger('first', 'player', { civilization: 'player.name' });
    const second = trigger('second', 'player', { civilization: 'player.name' });
    const listed = names(templateVariables(
      template('news', ['first', 'second'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([first, second]),
    ));
    expect(listed).not.toContain('civilization');
    expect(listed).toEqual(expect.arrayContaining([
      'triggerValues.first.civilization',
      'triggerValues.second.civilization',
    ]));
  });

  it('should offer key and count for one grouped trigger without exposing its members', () => {
    const grouped = trigger('grouped', 'player', { unit: 'unit.type', amount: 'amount' }, { by: 'kind' });
    const listed = names(templateVariables(
      template('news', ['grouped'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([grouped]),
    ));
    expect(listed).toEqual(expect.arrayContaining([
      'triggerValues.grouped.key',
      'triggerValues.grouped.count',
      'key',
      'count',
      'group.key',
      'group.count',
    ]));
    expect(listed).not.toContain('unit');
    expect(listed).not.toContain('amount');
    expect(listed).not.toContain('triggerValues.grouped.unit');
  });

  it('should leave bare key and count out when two triggers are grouped', () => {
    const first = trigger('first', 'player', { unit: 'unit.type' }, { by: 'kind' });
    const second = trigger('second', 'player', { unit: 'unit.type' }, { by: 'kind' });
    const listed = names(templateVariables(
      template('news', ['first', 'second'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([first, second]),
    ));
    expect(listed).toEqual(expect.arrayContaining([
      'triggerValues.first.key', 'triggerValues.first.count',
      'triggerValues.second.key', 'triggerValues.second.count',
    ]));
    expect(listed).not.toContain('key');
    expect(listed).not.toContain('count');
  });

  it('should advertise only the visible keys for a world subject', () => {
    const variables = templateVariables(
      template('news', ['world-news'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([trigger('world-news', 'world', { era: 'world.era' })]),
    );
    const subjectNames = names(variables.filter((entry) => entry.group === 'subject'));
    expect(subjectNames).toEqual(['subject.key', 'subject.kind']);
    const listed = names(variables);
    for (const absent of ['world', 'worldId', 'world.name', 'world.id', 'subject.name', 'subject.id'])
      expect(listed).not.toContain(absent);
  });

  it('should not advertise member identity fields for a grouped subject', () => {
    // Grouped rules anchor on a generated key such as group/player/<JSON key>, which has no member identity.
    const grouped = trigger('grouped', 'player', { unit: 'unit.type', amount: 'amount' }, { by: 'kind' });
    const variables = templateVariables(
      template('news', ['grouped'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([grouped]),
    );
    const subjectNames = names(variables.filter((entry) => entry.group === 'subject'));
    expect(subjectNames).toEqual(['subject.key', 'subject.kind']);
    const listed = names(variables);
    for (const absent of [
      'subject.name', 'subject.id', 'subject.leader',
      'player', 'playerId', 'player.name', 'player.id', 'player.leader',
      'capital', 'capitalId', 'player.capital.name',
      'majorAlly', 'majorAllyId', 'player.majorAlly.name', 'player.majorAlly.leader',
    ]) expect(listed).not.toContain(absent);
  });

  it('should advertise only the event identity fields an event provides', () => {
    const event = trigger('event-report', 'event', { type: 'event.type' });
    const variables = templateVariables(
      template('news', ['event-report'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([event]),
    );
    const listed = names(variables);
    expect(listed).toEqual(expect.arrayContaining([
      'subject.key', 'subject.kind', 'subject.id', 'eventId', 'event.id',
    ]));
    for (const absent of ['subject.name', 'name', 'event', 'event.name'])
      expect(listed).not.toContain(absent);
  });

  it('should advertise ids but no names for pair and incident subjects', () => {
    for (const kind of ['pair', 'incident'] as const) {
      const variables = templateVariables(
        template('news', [kind], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
        catalogue([trigger(kind, kind, { detail: `${kind}.detail` })]),
      );
      const listed = names(variables);
      expect(listed).toEqual(expect.arrayContaining([
        'subject.key', 'subject.kind', 'subject.id', `${kind}Id`, `${kind}.id`,
      ]));
      for (const absent of ['subject.name', 'name', kind, `${kind}.name`])
        expect(listed).not.toContain(absent);
    }
  });

  it('should offer player leader and bare civic slots for a player subject', () => {
    const variables = templateVariables(
      template('news', ['era'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([trigger('era', 'player', { era: 'player.era' })], {
        civicTerms: { defaults: { government: 'government', people: 'people' } },
      }),
    );
    expect(names(variables)).toEqual(expect.arrayContaining([
      'subject.leader', 'player.leader',
      'civic.government', 'subject.civic.government', 'player.civic.government',
    ]));
    expect(variable(variables, 'subject.leader')).toMatchObject({ mayBeEmpty: true });
  });

  it('should list a city owner as an empty-capable reference', () => {
    const city = trigger('city-event', 'city', { cityName: 'city.name' });
    const variables = templateVariables(
      template('news', ['city-event'], [variant('draft', { headline: 'Hello', body: [paragraph] })]),
      catalogue([city]),
    );
    const listed = names(variables);
    expect(listed).toEqual(expect.arrayContaining([
      'city', 'cityId', 'city.name', 'city.id',
      'owner', 'ownerId', 'city.owner.name', 'city.owner.id',
    ]));
    expect(variable(variables, 'owner')).toMatchObject({ group: 'reference', mayBeEmpty: true });
  });

  it('should mark only the link placeholders the current text uses as keep', () => {
    const draft = variant('draft', {
      headline: 'A word from {{civilization}}',
      body: [paragraph],
    }, {
      links: [
        {
          placeholder: 'civilization',
          label: '{{civilization}}',
          target: { type: 'civilization', civilizationId: '{{playerId}}' },
        },
        {
          placeholder: 'era',
          label: '{{era}}',
          target: { type: 'civilization', civilizationId: '{{playerId}}' },
        },
      ],
    });
    const variables = templateVariables(
      template('news', ['empty'], [draft]),
      catalogue([trigger('empty', 'player')]),
      draft,
    );
    expect(variable(variables, 'civilization')).toMatchObject({ group: 'link', keep: true });
    expect(variable(variables, 'era')).toMatchObject({ group: 'link', keep: false });
  });

  it('should flag an unknown placeholder and expose the warning as a candidate message', () => {
    const draft = variant('draft', { headline: 'Known {{era}}', body: [paragraph] });
    const table = templateVariables(
      template('news', ['era'], [draft]),
      catalogue([trigger('era', 'player', { era: 'player.era' })]),
      draft,
    );
    const warnings = variantWarnings(
      { headline: 'Unknown {{mystery}}', body: ['A {{era}} line.'] },
      draft,
      table,
    );
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unknown-variable' }));
    expect(candidateWarnings({ headline: 'Unknown {{mystery}}', body: [paragraph] }, draft, table))
      .toContainEqual(expect.stringContaining('mystery'));
  });

  it('should flag a kept link that the candidate drops', () => {
    const draft = variant('draft', {
      headline: 'A word from {{civilization}}',
      body: [paragraph],
    }, {
      links: [{
        placeholder: 'civilization',
        label: '{{civilization}}',
        target: { type: 'civilization', civilizationId: '{{playerId}}' },
      }],
    });
    const table = templateVariables(
      template('news', ['empty'], [draft]),
      catalogue([trigger('empty', 'player')]),
      draft,
    );
    const warnings = variantWarnings({ headline: 'No link here', body: [paragraph] }, draft, table);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'dropped-link' }));
  });

  it('should warn about a newly introduced empty-capable variable only once', () => {
    const draft = variant('draft', { headline: 'No distance', body: [paragraph] });
    const table = templateVariables(
      template('news', ['era'], [draft]),
      catalogue([trigger('era', 'player', {
        distance: "player.knows('distance') ? player.distance : null",
      })]),
      draft,
    );
    const first = variantWarnings({ headline: 'It is {{distance}} away', body: [paragraph] }, draft, table);
    const second = variantWarnings({ headline: 'It is {{distance}} away', body: [paragraph] }, draft, table);
    expect(first).toContainEqual(expect.objectContaining({ code: 'may-be-empty' }));
    expect(second).toEqual(first);
  });

  it('should list reader terms and placeholders seen only in a sibling', () => {
    const draft = variant('draft', { headline: 'Draft', body: [paragraph] });
    const sibling = variant('sibling', { headline: 'Sibling {{heirloom}}', body: [paragraph] });
    const table = templateVariables(
      template('news', ['era'], [draft, sibling]),
      catalogue([
        trigger('era', 'player', { era: 'player.era' }),
      ], {
        constants: { terms: { civilization: 'self.name' } },
        civicTerms: { defaults: { government: 'government', people: 'people' } },
      }),
      draft,
    );
    const listed = names(table);
    expect(listed).toEqual(expect.arrayContaining([
      'terms.civilization',
      'terms.civic.government',
      'terms.civic.people',
      'heirloom',
    ]));
    expect(variable(table, 'heirloom')).toMatchObject({ group: 'sibling', source: 'sibling:sibling' });
  });
});
