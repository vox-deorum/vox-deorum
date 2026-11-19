/** Probe overlay stories and the People's Daily design, loaded from the on-disk folder. */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, type PublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { evidence as buildEvidence, relationship, snapshot } from '../../../helpers/newspaper-diplomacy.js';

const probeDirectory = fileURLToPath(new URL('../../../../newspaper/probes/', import.meta.url));
const probeTriggerId = 'probe-treasury';
const probeTemplateId = 'probe-treasury-account';
const probeDesignId = 'probe-communist-press';

type Inline = PublicationState['issues'][number]['items'][number]['headline'];

let defaultConfig: EditorialConfig;
let probeConfig: EditorialConfig;
let probeOnlyConfig: EditorialConfig;
let capitalConfig: EditorialConfig;
let vassalConfig: EditorialConfig;
let opinionConfig: EditorialConfig;
let opinionOnlyConfig: EditorialConfig;
let peaceConfig: EditorialConfig;
let milestoneConfig: EditorialConfig;
let quietConfig: EditorialConfig;

/** Supply dated contact and cover the stock rules' lookback windows. */
function probeEvidence({
  gold = 0, branch = 'Tradition', events = [], riderX = 10, turn = 10, previous = 5,
  ownCities = [], relationships = [],
}: {
  gold?: number; branch?: string; events?: NewspaperEvent[]; riderX?: number;
  turn?: number; previous?: number;
  ownCities?: { name: string; capital?: boolean; unhappiness?: unknown }[];
  relationships?: ReturnType<typeof relationship>[];
} = {}): NewspaperEvidence {
  const history = [0, 1, 2].map((id) =>
    snapshot(id, relationships.length ? turn : previous, id === 0 ? relationships : []));
  const projected = buildEvidence(events, history, turn, previous);
  for (const row of projected.players) row.source = history.find((entry) => entry.subjectID === row.subjectID)!.source;
  projected.players[0].values = { Gold: gold, PolicyBranches: { [branch]: [] } };
  projected.cities = [
    ...ownCities.map((city, index) => ({
      subjectID: 100 + index,
      source: { table: 'CityInformations' as const, id: 300 + turn * 10 + index, turn, createdAt: turn * 1000 },
      values: {
        OwnerID: 0, Name: city.name, IsCapital: city.capital ? 1 : 0, X: 0, Y: 0,
        ...(city.unhappiness === undefined ? {} : { UnhappinessSources: city.unhappiness }),
      },
    })),
    { subjectID: 11, source: { table: 'CityInformations', id: 201, turn, createdAt: turn * 1000 },
      values: { OwnerID: 1, Name: 'Persepolis', X: riderX, Y: 0 } },
    { subjectID: 12, source: { table: 'CityInformations', id: 202, turn, createdAt: turn * 1000 },
      values: { OwnerID: 2, Name: 'Attila’s Court', X: 3, Y: 0 } },
  ];
  projected.request.historyFromTurn = -1;
  projected.history = {
    fromTurn: -1,
    baseline: { players: [], cities: [] },
    snapshots: { players: projected.players, cities: projected.cities },
    events,
    gaps: [],
  };
  return projected;
}

/** Run the editor on projected evidence with the chosen catalogue. */
function check(
  projected: NewspaperEvidence,
  catalogue = probeConfig,
  state = createInitialPublicationState(),
  campaignId = 'campaign',
) {
  const facts = buildNewspaperFacts(projected, {
    playerIdentities: {
      0: { name: 'France', major: true, teamId: 100 },
      1: { name: 'Persia', major: true, teamId: 101 },
      2: { name: 'The Huns', major: true, teamId: 102 },
    },
  }, { ideologies: catalogue.constants.types.ideologies });
  return runEditorialCheck({
    campaignId,
    timelineId: 'probe',
    receiver: { playerId: 0, label: 'France' },
    evidence: projected,
    facts,
    speedMultiplier: 1,
    state,
    config: catalogue,
  });
}

/** Supply a projected event on a date when the actors were already known. */
function probeEvent(type: string, values: NewspaperEvent['values'], id = 101): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn: 8, createdAt: 8000 } };
}

/** Build a validated catalogue variant with only the named probe rules and templates. */
function probeCatalogue(
  triggerIds: string[],
  templateIds: string[],
  defaults: Partial<EditorialConfig['defaults']> = {},
): EditorialConfig {
  return editorialConfigSchema.parse({
    ...probeConfig,
    triggers: probeConfig.triggers.filter((trigger) => triggerIds.includes(trigger.id)),
    templates: probeConfig.templates.filter((template) => templateIds.includes(template.id)),
    defaults: { ...probeConfig.defaults, ...defaults },
  });
}

/** Record prior issues without articles, for press counts and the last issue turn. */
function pastIssues(count: number, turn = 1): PublicationState {
  return {
    ...createInitialPublicationState(),
    issues: Array.from({ length: count }, (_, index) => ({
      issueId: `issue/${index + 1}`, turn, items: [],
    })),
  };
}

/** Record one prior issue so press.lastIssueTurn and the check cursor agree. */
function lastIssueState(turn: number): PublicationState {
  return { ...pastIssues(1, turn), lastCheckTurn: turn };
}

/** Find the audit entry for one rule and subject. */
function auditSubject(
  result: Awaited<ReturnType<typeof check>>,
  ruleId: string,
  subject: string,
) {
  return result.decision.triggerAudit
    .find((audit) => audit.rule === ruleId)
    ?.subjects.find((entry) => entry.subject === subject);
}

/** Find the immutable issue item for a published record. */
function issueItem(
  result: Awaited<ReturnType<typeof check>>,
  itemId: string,
) {
  return result.status === 'published' ? result.issue.items.find((item) => item.id === itemId) : undefined;
}

/** Read which templates actually made it into print. */
function publishedTemplates(state: PublicationState) {
  return state.issues.flatMap((issue) => issue.items.flatMap((item) => item.templateIds));
}

/** Find the published record for one template. */
function publishedItem(state: PublicationState, templateId: string) {
  return state.issues.flatMap((issue) => issue.items).find((item) => item.templateIds.includes(templateId));
}

/** Read inline text as plain text, including absent optional fields. */
function headlineText(text: Inline | undefined) {
  return (text ?? []).map((node) => 'text' in node ? node.text : '').join('');
}

describe('probe overlay', () => {
  beforeAll(async () => {
    defaultConfig = await loadEditorialConfig();
    probeConfig = await loadEditorialConfig(probeDirectory);
    probeOnlyConfig = {
      ...probeConfig,
      designs: probeConfig.designs.filter((design) => design.id === probeDesignId),
    };
    const repeatableTriggers = probeConfig.triggers.map((trigger) =>
      trigger.id === probeTriggerId ? { ...trigger, repeat: 1 } : trigger);
    capitalConfig = {
      ...probeConfig,
      triggers: repeatableTriggers,
      designs: probeConfig.designs.filter((design) => design.id === 'probe-capital-masthead'),
    };
    vassalConfig = {
      ...probeConfig,
      triggers: repeatableTriggers,
      designs: probeConfig.designs.filter((design) => design.id === 'probe-vassal-strapline'),
    };
    opinionConfig = probeCatalogue(
      ['probe-treasury', 'probe-huns-riding', 'probe-ideology-adopted', 'probe-obituary', 'probe-culture-opinion'],
      ['probe-treasury-account', 'probe-huns-riding-account', 'probe-ideology-adopted-account',
        'probe-obituary-account', 'probe-culture-opinion-account'],
      { maxItems: 5, frontPageItems: 4 },
    );
    opinionOnlyConfig = probeCatalogue(
      ['probe-culture-opinion'], ['probe-culture-opinion-account'],
    );
    peaceConfig = probeCatalogue(
      ['probe-peace', 'probe-retraction'], ['probe-peace-account', 'probe-retraction-account'],
    );
    milestoneConfig = probeCatalogue(
      ['probe-hundredth-issue'], ['probe-hundredth-issue-account'],
    );
    quietConfig = probeCatalogue(
      ['probe-quiet-spell'], ['probe-quiet-spell-account'],
    );
  });

  describe('treasury probe', () => {
    it('should publish the probe story at the constant threshold', async () => {
      const result = await check(probeEvidence({ gold: 100 }));
      expect(publishedTemplates(result.state)).toContain(probeTemplateId);
    });

    it('should leave the probe story unpublished below the threshold', async () => {
      const result = await check(probeEvidence({ gold: 99 }));
      expect(publishedTemplates(result.state)).not.toContain(probeTemplateId);
    });
  });

  it('should keep the probes out of the default catalogue', () => {
    expect([...defaultConfig.triggers, ...defaultConfig.templates, ...defaultConfig.designs]
      .some((entry) => entry.id.startsWith('probe-'))).toBe(false);
  });

  describe('world news probes', () => {
    it.each([
      { tech: 'Horseback Riding', riderX: 10, published: true },
      { tech: 'Horseback Riding', riderX: 11, published: false },
      { tech: 'Horseback Riding', riderX: 10, changeAmount: -1, published: false },
      { tech: 'Printing Press', riderX: 10, published: false },
    ])('should report $tech at x=$riderX with change $changeAmount only if it qualifies', async ({ tech, riderX, changeAmount, published }) => {
      const events = [probeEvent('TeamTechResearched', {
        TeamID: 101, Tech: tech, ...(changeAmount === undefined ? {} : { ChangeAmount: changeAmount }),
      })];
      const result = await check(probeEvidence({ events, riderX }));
      expect(publishedTemplates(result.state).includes('probe-huns-riding-account')).toBe(published);
    });

    it.each([
      { branch: 'Freedom', published: true },
      { branch: 'Tradition', published: false },
    ])('should report $branch as an ideology only if it qualifies', async ({ branch, published }) => {
      const events = [probeEvent('PlayerAdoptPolicyBranch', { PlayerID: 1, Branch: branch })];
      const result = await check(probeEvidence({ events }));
      expect(publishedTemplates(result.state).includes('probe-ideology-adopted-account')).toBe(published);
    });
  });

  describe('great people probes', () => {
    it('should report a named birth abroad from only a player and a name', async () => {
      const birth = probeEvent('UnitCreated', { PlayerID: 1, Person: 'Ptolemy' });
      const projected = probeEvidence({ events: [birth] });
      const result = await check(projected);
      const item = publishedItem(result.state, 'probe-foreign-birth-account');

      expect(item).toBeDefined();
      expect(headlineText(item!.headline)).toContain('Ptolemy');
      expect(item!.sources).toEqual(expect.arrayContaining([
        birth.source, projected.players.find((player) => player.subjectID === 1)!.source,
      ]));
    });

    it.each([
      { label: 'an unnamed creation abroad', values: { PlayerID: 1, Unit: 'Warrior' } },
      { label: 'a named birth at home', values: { PlayerID: 0, Person: 'Ptolemy' } },
    ])('should not report $label as a foreign birth', async ({ values }) => {
      const result = await check(probeEvidence({ events: [probeEvent('UnitCreated', values)] }));
      expect(publishedItem(result.state, 'probe-foreign-birth-account')).toBeUndefined();
    });

    it.each([
      { kind: 'expenditure abroad', type: 'GreatPersonExpended', owner: 1, civilization: 'Persia',
        values: { PlayerID: 1, Person: 'Hypatia' }, variant: 'probe-obituary-expended' },
      { kind: 'expenditure at home', type: 'GreatPersonExpended', owner: 0, civilization: 'France',
        values: { PlayerID: 0, Person: 'Hypatia' }, variant: 'probe-obituary-expended' },
      { kind: 'death abroad', type: 'UnitPrekill', owner: 1, civilization: 'Persia',
        values: { OwnerID: 1, AttackingPlayerID: -1, Person: 'Hypatia' }, variant: 'probe-obituary-died' },
      { kind: 'death at home', type: 'UnitPrekill', owner: 0, civilization: 'France',
        values: { OwnerID: 0, AttackingPlayerID: -1, Person: 'Hypatia' }, variant: 'probe-obituary-died' },
    ])('should report a named $kind as one obituary without coordinates', async ({ type, owner, civilization, values, variant }) => {
      const obituary = probeEvent(type, values);
      const projected = probeEvidence({ events: [obituary] });
      const result = await check(projected);
      const item = publishedItem(result.state, 'probe-obituary-account');

      expect(item).toBeDefined();
      const printed = issueItem(result, item!.id);
      expect(printed).toBeDefined();
      expect(item!.ruleIds).toContain('probe-obituary');
      expect(item!.subject).toMatch(/^event\//);
      expect(headlineText(item!.headline)).toContain('Hypatia');
      expect(headlineText(printed!.subheadline)).toContain('Hypatia');
      expect(headlineText(printed!.subheadline)).toContain(civilization);
      expect(headlineText(printed!.byline)).toContain(civilization);
      expect(result.decision.selectedVariants[item!.id]).toBe(variant);
      expect(item!.sources).toEqual(expect.arrayContaining([
        obituary.source, projected.players.find((player) => player.subjectID === owner)!.source,
      ]));
    });

    it.each([
      { type: 'GreatPersonExpended', values: { PlayerID: 1 } },
      { type: 'UnitPrekill', values: { OwnerID: 1, AttackingPlayerID: -1 } },
    ])('should not report an unnamed $type', async ({ type, values }) => {
      const result = await check(probeEvidence({ events: [probeEvent(type, values)] }));
      expect(publishedItem(result.state, 'probe-obituary-account')).toBeUndefined();
    });
  });

  describe('unhappiness probes', () => {
    it.each([
      { label: 'no cause detail', unhappiness: undefined },
      { label: 'a non-numeric cause', unhappiness: { Culture: 'much' } },
    ])('should hide the culture opinion with $label', async ({ unhappiness }) => {
      const result = await check(probeEvidence({
        ownCities: [{ name: 'Paris', capital: true, unhappiness }],
      }), opinionOnlyConfig);

      expect(result.status).toBe('skipped');
      expect(auditSubject(result, 'probe-culture-opinion', 'city/100')?.outcome).toBe('hidden');
    });

    it('should not report culture when another cause is larger', async () => {
      const result = await check(probeEvidence({
        ownCities: [{ name: 'Paris', capital: true, unhappiness: { Culture: 2, Distress: 5 } }],
      }), opinionOnlyConfig);

      expect(result.status).toBe('skipped');
      expect(auditSubject(result, 'probe-culture-opinion', 'city/100')?.outcome).toBe('false');
    });
  });

  describe('opinion page probe', () => {
    it('should place the culture opinion beyond the front page with its subheadline and byline', async () => {
      const events = [
        probeEvent('TeamTechResearched', { TeamID: 101, Tech: 'Horseback Riding' }, 101),
        probeEvent('PlayerAdoptPolicyBranch', { PlayerID: 1, Branch: 'Freedom' }, 102),
        probeEvent('GreatPersonExpended', { PlayerID: 1, Person: 'Hypatia' }, 103),
      ];
      const result = await check(probeEvidence({
        gold: 100, events,
        ownCities: [{ name: 'Paris', capital: true, unhappiness: { Culture: 3 } }],
      }), opinionConfig);

      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const record = publishedItem(result.state, 'probe-culture-opinion-account');
      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-culture-opinion');
      expect(record!.subject).toBe('city/100');
      const printed = issueItem(result, record!.id);
      expect(printed).toBeDefined();
      expect(result.issue.pages.find((page) => page.id === 'opinion')?.itemIds).toContain(record!.id);
      expect(result.issue.pages.find((page) => page.id === 'front')?.itemIds).not.toContain(record!.id);
      expect(headlineText(printed!.headline)).toContain('Paris');
      expect(headlineText(printed!.subheadline)).toContain('3');
      expect(headlineText(printed!.subheadline)).toContain('Paris');
      expect(headlineText(printed!.byline)).toContain('Paris');
    });
  });

  describe('peace retraction probes', () => {
    it('should retract a peace story while the printed report is recent', async () => {
      const peace = await check(probeEvidence({ relationships: [relationship(1)] }), peaceConfig);
      expect(peace.status).toBe('published');
      const peaceRecord = publishedItem(peace.state, 'probe-peace-account');
      expect(peaceRecord).toBeDefined();
      expect(peaceRecord!.ruleIds).toContain('probe-peace');
      expect(peaceRecord!.subject).toBe('pair/0/1');

      const result = await check(probeEvidence({
        turn: 15, previous: 10, relationships: [relationship(1, 'war')],
      }), peaceConfig, peace.state);

      expect(result.status).toBe('published');
      const record = publishedItem(result.state, 'probe-retraction-account');
      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-retraction');
      expect(record!.subject).toBe('pair/0/1');
      const printed = issueItem(result, record!.id);
      expect(printed).toBeDefined();
      expect(headlineText(printed!.headline)).toContain('Persia');
      expect(headlineText(printed!.body[0])).toContain('5');
    });

    it('should not retract a war without an earlier peace story in print', async () => {
      const result = await check(probeEvidence({
        relationships: [relationship(1, 'war')],
      }), peaceConfig);

      expect(result.status).toBe('skipped');
      expect(auditSubject(result, 'probe-retraction', 'pair/0/1')?.outcome).toBe('false');
    });

    it('should not retract a war after the printed peace story is too old', async () => {
      const peace = await check(probeEvidence({ relationships: [relationship(1)] }), peaceConfig);
      expect(peace.status).toBe('published');

      const result = await check(probeEvidence({
        turn: 30, previous: 10, relationships: [relationship(1, 'war')],
      }), peaceConfig, peace.state);

      expect(result.status).toBe('skipped');
      expect(auditSubject(result, 'probe-retraction', 'pair/0/1')?.outcome).toBe('false');
    });
  });

  describe('milestone and chance probes', () => {
    it('should publish the hundredth issue only after ninety-nine issues', async () => {
      const result = await check(probeEvidence(), milestoneConfig, pastIssues(99));

      expect(result.status).toBe('published');
      const record = publishedItem(result.state, 'probe-hundredth-issue-account');
      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-hundredth-issue');
      const printed = issueItem(result, record!.id);
      expect(printed).toBeDefined();
      expect(headlineText(printed!.body[0])).toContain('100');

      const early = await check(probeEvidence(), milestoneConfig, pastIssues(98));
      expect(early.status).toBe('skipped');
      expect(auditSubject(early, 'probe-hundredth-issue', 'world')?.outcome).toBe('false');
    });

    it('should leave the quiet-spell story out when there is no issue or the gap is short', async () => {
      const never = await check(probeEvidence({ turn: 30, previous: 5 }), quietConfig);
      expect(never.status).toBe('skipped');
      expect(auditSubject(never, 'probe-quiet-spell', 'world')?.outcome).toBe('false');

      const early = await check(probeEvidence(), quietConfig, lastIssueState(5));
      expect(early.status).toBe('skipped');
      expect(auditSubject(early, 'probe-quiet-spell', 'world')?.outcome).toBe('false');
    });

    it('should let the seeded draw both publish and suppress the quiet-spell story', async () => {
      const campaigns = Array.from({ length: 40 }, (_, index) => `quiet-${index}`);
      const results: Awaited<ReturnType<typeof check>>[] = [];
      for (const campaignId of campaigns)
        results.push(await check(probeEvidence({ turn: 30, previous: 5 }), quietConfig,
          lastIssueState(5), campaignId));
      const passed = results.find((result) => result.status === 'published');
      const failed = results.find((result) =>
        auditSubject(result, 'probe-quiet-spell', 'world')?.outcome === 'chance');
      const repeatKey = JSON.stringify(['probe-quiet-spell', 'world']);

      expect(passed).toBeDefined();
      expect(failed).toBeDefined();
      expect(failed!.status).toBe('skipped');
      expect(failed!.state.triggerRepeats[repeatKey]).toBeUndefined();
      expect(passed!.state.triggerRepeats[repeatKey]?.lastTurn).toBe(30);
      const record = publishedItem(passed!.state, 'probe-quiet-spell-account');
      expect(record).toBeDefined();
      const printed = issueItem(passed!, record!.id);
      expect(printed).toBeDefined();
      expect(headlineText(printed!.body[0])).toContain('25');
    });
  });

  describe("People's Daily design", () => {
    it('should choose the probe design when the receiver follows Order', async () => {
      const result = await check(probeEvidence({
        gold: 100, branch: 'Order', ownCities: [{ name: 'Paris', capital: true }],
      }), probeOnlyConfig);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.publication.designId).toBe(probeDesignId);
      expect(result.issue.publication.title).toBe('The Paris Worker');
      expect(result.issue.publication.motto).toBe('All power to the Party');
    });

    it('should not publish with this design when the receiver follows Freedom', async () => {
      const result = await check(probeEvidence({
        gold: 100, branch: 'Freedom', ownCities: [{ name: 'Paris', capital: true }],
      }), probeOnlyConfig);
      expect(result.status).toBe('skipped');
      expect(
        result.decision.candidateScores.some(
          (candidate) => candidate.selected && candidate.id.startsWith(`${probeTemplateId}/`)
        )
      ).toBe(true);
    });
  });

  describe('masthead probes', () => {
    it('should follow a moved capital and cite the title term separately from articles', async () => {
      const firstEvidence = probeEvidence({
        gold: 100, ownCities: [{ name: 'Paris', capital: true }, { name: 'Orleans', capital: false }],
      });
      const first = await check(firstEvidence, capitalConfig);
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      expect(first.issue.publication.title).toBe('The Paris Herald');
      const capitalSource = firstEvidence.cities.find((city) => city.values.Name === 'Paris')!.source;
      expect(first.decision.evidence).toContainEqual(capitalSource);
      expect(publishedItem(first.state, probeTemplateId)!.sources).not.toContainEqual(capitalSource);

      const second = await check(probeEvidence({
        gold: 100, turn: 15, previous: 10,
        ownCities: [{ name: 'Paris', capital: false }, { name: 'Orleans', capital: true }],
      }), capitalConfig, first.state);
      expect(second.status).toBe('published');
      if (second.status !== 'published') return;
      expect(second.issue.publication.title).toBe('The Orleans Herald');
    });

    it('should drop a selected design when its motto loses our master', async () => {
      const first = await check(probeEvidence({
        gold: 100, relationships: [relationship(2, 'peace', { master: 'voluntary' })],
      }), vassalConfig);
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      expect(first.issue.publication.designId).toBe('probe-vassal-strapline');
      expect(first.issue.publication.motto).toBe("A journal of The Huns's dominion");

      const second = await check(probeEvidence({
        gold: 100, turn: 15, previous: 10, relationships: [relationship(2)],
      }), vassalConfig, first.state);
      expect(second.status).toBe('skipped');
      expect(
        second.decision.candidateScores.some(
          (candidate) => candidate.selected && candidate.id.startsWith(`${probeTemplateId}/`)
        )
      ).toBe(true);
    });
  });
});
