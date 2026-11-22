/** Probe overlay stories and the People's Daily design, loaded from the on-disk folder. */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperEvent, NewspaperEvidence, NewspaperSnapshot, NewspaperTacticalZone,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, type PublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { scaleEditorialConstants } from '../../../../src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import type { FactObject, FactWindow } from '../../../../src/newspaper/editorial/facts/model.js';
import { renderAuthoredText } from '../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluateTriggerRules } from '../../../../src/newspaper/editorial/rules/evaluate.js';
import { computeFeedback } from '../../../../src/newspaper/editorial/selection/feedback.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/selection/templates.js';
import { uniqueSources } from '../../../../src/newspaper/editorial/shared/sources.js';
import { withEditionBriefs } from '../../../helpers/newspaper-briefs.js';
import { evidence as buildEvidence, relationship, snapshot } from '../../../helpers/newspaper-diplomacy.js';

const probeDirectory = fileURLToPath(new URL('../../../../newspaper/probes/', import.meta.url));
const probeTriggerId = 'probe-treasury';
const probeTemplateId = 'probe-treasury-account';
const probeDesignId = 'probe-communist-press';

type Inline = PublicationState['issues'][number]['items'][number]['headline'];

let defaultConfig: EditorialConfig;
let probeConfig: EditorialConfig;
let storyConfig: EditorialConfig;
let probeOnlyConfig: EditorialConfig;
let capitalConfig: EditorialConfig;
let vassalConfig: EditorialConfig;
let opinionConfig: EditorialConfig;
let opinionOnlyConfig: EditorialConfig;
let peaceConfig: EditorialConfig;
let milestoneConfig: EditorialConfig;
let quietConfig: EditorialConfig;
let spyConfig: EditorialConfig;
let diplomatConfig: EditorialConfig;
let foreignPolicyConfig: EditorialConfig;
let espionageConfig: EditorialConfig;
let frontConfig: EditorialConfig;
let shipConfig: EditorialConfig;

/** Supply dated contact and cover the stock rules' lookback windows. */
function probeEvidence({
  gold = 0, branch = 'Tradition', events = [], riderX = 10, turn = 10, previous = 5,
  ownCities = [], relationships = [], foreignCityValues = {}, playerValues = {}, tacticalZones,
}: {
  gold?: number; branch?: string; events?: NewspaperEvent[]; riderX?: number;
  turn?: number; previous?: number;
  ownCities?: { name: string; capital?: boolean; unhappiness?: unknown }[];
  relationships?: ReturnType<typeof relationship>[];
  foreignCityValues?: NewspaperSnapshot['values'];
  playerValues?: Record<number, NewspaperSnapshot['values']>;
  tacticalZones?: NewspaperTacticalZone[];
} = {}): NewspaperEvidence {
  const history = [0, 1, 2].map((id) =>
    snapshot(id, relationships.length ? turn : previous, id === 0 ? relationships : []));
  const projected = buildEvidence(events, history, turn, previous);
  for (const row of projected.players) row.source = history.find((entry) => entry.subjectID === row.subjectID)!.source;
  projected.players[0].values = { Gold: gold, PolicyBranches: { [branch]: [] } };
  for (const [id, values] of Object.entries(playerValues))
    Object.assign(projected.players.find((row) => row.subjectID === Number(id))!.values, values);
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
      values: { OwnerID: 1, Name: 'Persepolis', X: riderX, Y: 0, ...foreignCityValues } },
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
  if (tacticalZones !== undefined) projected.tacticalZones = tacticalZones;
  return projected;
}

/** Build the fact model for projected evidence with the chosen catalogue. */
function buildFacts(projected: NewspaperEvidence, catalogue = probeConfig) {
  return buildNewspaperFacts(projected, {
    playerIdentities: {
      0: { name: 'France', major: true, teamId: 100 },
      1: { name: 'Persia', major: true, teamId: 101 },
      2: { name: 'The Huns', major: true, teamId: 102 },
    },
  }, { ideologies: catalogue.constants.types.ideologies });
}

/** Run the editor on projected evidence with the chosen catalogue. */
function check(
  projected: NewspaperEvidence,
  catalogue = probeConfig,
  state = createInitialPublicationState(),
  campaignId = 'campaign',
) {
  const facts = buildFacts(projected, catalogue);
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

/** Supply four unrelated briefs so the probe has room to lead. */
function checkWithBriefs(
  projected: NewspaperEvidence,
  catalogue: EditorialConfig,
  state?: PublicationState,
  campaignId?: string,
) {
  const { evidence, config } = withEditionBriefs(projected, catalogue);
  return check(evidence, config, state, campaignId);
}

/** Inspect trigger and template behavior before the editor tries to fill a layout. */
async function inspect(projected: NewspaperEvidence, config = storyConfig) {
  const facts = buildFacts(projected, config);
  const compiled = await getEditorialExpressions(config);
  const rules = await evaluateTriggerRules({
    rules: config.triggers, compiled, facts, constants: config.constants, speedMultiplier: 1,
  });
  const candidates = await matchTemplates(rules.developments, config, compiled, {
    facts, constants: scaleEditorialConstants(config.constants, 1),
  });
  return { decision: { triggerAudit: rules.audit }, candidates };
}

/** Find and render one eligible prose variant of a named probe candidate. */
function candidateArticle(result: Awaited<ReturnType<typeof inspect>>, templateId: string) {
  const candidate = result.candidates.find((story) => story.templateIds.includes(templateId));
  if (!candidate) return undefined;
  const [variant] = candidate.variants;
  /** Render one authored passage against the evidence supplied to the template. */
  const render = (passage: string | undefined) =>
    passage ? renderAuthoredText(passage, candidate.values, variant, candidate.names) : undefined;
  return {
    ...candidate,
    variant: variant.id,
    sources: uniqueSources([...candidate.sources, ...candidate.variantSources[variant.id]]),
    headline: render(variant.headline),
    subheadline: render(variant.subheadline),
    byline: render(variant.byline),
    body: variant.body.map(render),
  };
}

/** Supply a projected event on a date when the actors were already known. */
function probeEvent(
  type: string,
  values: NewspaperEvent['values'],
  id = 101,
  turn = 8,
  reportTurn?: number,
): NewspaperEvent {
  return {
    type,
    values,
    source: { table: 'GameEvents', id, turn, createdAt: 8000 },
    ...(reportTurn === undefined ? {} : { reportTurn }),
  };
}

/** Build one private front observation with a stable source identity. */
function tacticalZone(overrides: Partial<NewspaperTacticalZone> = {}): NewspaperTacticalZone {
  return {
    source: { table: 'TacticalZones', id: 901, turn: 10, createdAt: 10000 },
    zoneID: 4,
    city: 'Rotterdam',
    domain: 'Sea',
    posture: 'Withdraw',
    units: { Netherlands: { Frigate: 2, Trireme: 1 } },
    ...overrides,
  };
}

/** Build one training row joined to a recorded creation and dated city observation. */
function shipEvidence({
  unit = 'Frigate', port = 'Rotterdam', withGold = false, withFaith = false,
  omitGold = false, omitFaith = false, playerId = 0, cityId = 100, x = 0, turn = 8,
}: {
  unit?: string; port?: string | null; withGold?: boolean; withFaith?: boolean;
  omitGold?: boolean; omitFaith?: boolean; playerId?: number; cityId?: number; x?: number; turn?: number;
} = {}) {
  const projected = probeEvidence({ ownCities: [{ name: 'Rotterdam', capital: true }] });
  const city = projected.cities.find((row) => row.subjectID === cityId)!;
  const created = probeEvent('UnitCreated', { PlayerID: playerId, UnitID: 42, UnitType: unit }, 200, turn);
  const training: NewspaperEvent = {
    type: 'CityTrained',
    values: {
      PlayerID: playerId, CityID: cityId, UnitID: 42, Unit: unit, CityX: x, CityY: 0,
      ...(omitGold ? {} : { WithGold: withGold }),
      ...(omitFaith ? {} : { WithFaith: withFaith }),
      ...(port === null ? {} : { Port: port }),
    },
    source: { table: 'GameEvents', id: 201, turn, createdAt: turn * 1000 },
    relatedSources: [created.source, city.source],
  };
  projected.events = [training];
  projected.history!.events = [training];
  return { projected, training, created, city };
}

/** Build a validated catalogue variant with only the named probe rules and templates. */
function probeCatalogue(
  triggerIds: string[],
  templateIds: string[],
): EditorialConfig {
  return editorialConfigSchema.parse({
    ...probeConfig,
    triggers: probeConfig.triggers.filter((trigger) => triggerIds.includes(trigger.id)),
    templates: probeConfig.templates.filter((template) => templateIds.includes(template.id)),
  });
}

/** Isolate the design being tested, using Wire for cases that do not depend on the design. */
function publicationCatalogue(config: EditorialConfig, designId = 'wire'): EditorialConfig {
  const design = config.designs.find(entry => entry.id === designId)!;
  return editorialConfigSchema.parse({
    ...config,
    designs: [{ ...design, ...(designId === 'wire' ? { when: undefined } : {}) }],
    mastheadRules: [],
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
  result: { decision: Pick<Awaited<ReturnType<typeof check>>['decision'], 'triggerAudit'> },
  ruleId: string,
  subject: string,
) {
  return result.decision.triggerAudit
    .find((audit) => audit.rule === ruleId)
    ?.subjects.find((entry) => entry.subject === subject);
}

/** Find one audited expression value for a rule and subject. */
function auditValue(
  result: Parameters<typeof auditSubject>[0],
  ruleId: string,
  subject: string,
  field: string,
) {
  return auditSubject(result, ruleId, subject)?.expressions.find((entry) => entry.field === field);
}

/** Find the immutable issue item for a published record. */
function issueItem(
  result: Awaited<ReturnType<typeof check>>,
  itemId: string,
) {
  return result.status === 'published' ? result.issue.items.find((item) => item.id === itemId) : undefined;
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
    storyConfig = probeCatalogue(
      probeConfig.triggers.filter(rule => rule.id.startsWith('probe-')).map(rule => rule.id),
      probeConfig.templates.filter(template => template.id.startsWith('probe-')).map(template => template.id),
    );
    const treasuryConfig = probeCatalogue([probeTriggerId], [probeTemplateId]);
    treasuryConfig.triggers[0].repeat = 1;
    probeOnlyConfig = publicationCatalogue(treasuryConfig, probeDesignId);
    capitalConfig = publicationCatalogue(treasuryConfig, 'probe-capital-masthead');
    vassalConfig = publicationCatalogue(treasuryConfig, 'probe-vassal-strapline');
    opinionConfig = probeCatalogue(
      ['probe-treasury', 'probe-huns-riding', 'probe-ideology-adopted', 'probe-obituary', 'probe-culture-opinion'],
      ['probe-treasury-account', 'probe-huns-riding-account', 'probe-ideology-adopted-account',
        'probe-obituary-account', 'probe-culture-opinion-account'],
    );
    opinionConfig.designs = opinionConfig.designs.filter(design => design.id === 'probe-capital-masthead');
    opinionConfig.mastheadRules = [];
    opinionConfig = editorialConfigSchema.parse({
      ...opinionConfig,
      triggers: [...opinionConfig.triggers, {
        id: 'fixture-opinion', subject: 'world', tier: 'filler', adjust: '-10', when: 'true',
      }],
      templates: [...opinionConfig.templates, {
        id: 'fixture-opinion', triggers: ['fixture-opinion'], tags: ['opinion'], weight: { base: 1 },
        variants: [{ id: 'comment', headline: 'Letters to the editor', body: ['Readers wrote to the paper.'], weight: { base: 1 } }],
      }],
    });
    opinionOnlyConfig = probeCatalogue(
      ['probe-culture-opinion'], ['probe-culture-opinion-account'],
    );
    peaceConfig = publicationCatalogue(probeCatalogue(
      ['probe-peace', 'probe-retraction'], ['probe-peace-account', 'probe-retraction-account'],
    ));
    milestoneConfig = publicationCatalogue(probeCatalogue(
      ['probe-hundredth-issue'], ['probe-hundredth-issue-account'],
    ));
    quietConfig = publicationCatalogue(probeCatalogue(
      ['probe-quiet-spell'], ['probe-quiet-spell-account'],
    ));
    spyConfig = probeCatalogue(
      ['probe-spy-city-profile'], ['probe-spy-city-profile-account'],
    );
    diplomatConfig = probeCatalogue(
      ['probe-inbound-diplomat'], ['probe-inbound-diplomat-account'],
    );
    foreignPolicyConfig = probeCatalogue(
      ['probe-foreign-policies'], ['probe-foreign-policies-account'],
    );
    espionageConfig = probeCatalogue(
      ['probe-espionage-tech', 'probe-spy-loss', 'probe-defender-report', 'probe-election-influence'],
      ['probe-espionage-tech-account', 'probe-spy-loss-account', 'probe-defender-report-account',
        'probe-election-influence-account'],
    );
    frontConfig = probeCatalogue(
      ['probe-front-zone'], ['probe-front-zone-account'],
    );
    shipConfig = probeCatalogue(
      ['probe-ship-launch'], ['probe-ship-launch-account'],
    );
  });

  describe('treasury probe', () => {
    it('should match the treasury template at the constant threshold', async () => {
      const result = await inspect(probeEvidence({ gold: 100 }));
      expect(result.candidates.flatMap(story => story.templateIds)).toContain(probeTemplateId);
    });

    it('should not match the treasury template below the threshold', async () => {
      const result = await inspect(probeEvidence({ gold: 99 }));
      expect(result.candidates.flatMap(story => story.templateIds)).not.toContain(probeTemplateId);
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
      const result = await inspect(probeEvidence({ events, riderX }));
      expect(result.candidates.flatMap(story => story.templateIds).includes('probe-huns-riding-account')).toBe(published);
    });

    it.each([
      { branch: 'Freedom', published: true },
      { branch: 'Tradition', published: false },
    ])('should report $branch as an ideology only if it qualifies', async ({ branch, published }) => {
      const events = [probeEvent('PlayerAdoptPolicyBranch', { PlayerID: 1, Branch: branch })];
      const result = await inspect(probeEvidence({ events }));
      expect(result.candidates.flatMap(story => story.templateIds).includes('probe-ideology-adopted-account')).toBe(published);
    });
  });

  describe('great people probes', () => {
    it('should print a named birth abroad from only a player and a name', async () => {
      const birth = probeEvent('UnitCreated', { PlayerID: 1, Person: 'Ptolemy' });
      const projected = probeEvidence({ events: [birth] });
      const config = publicationCatalogue(probeCatalogue(['probe-foreign-birth'], ['probe-foreign-birth-account']));
      const result = await checkWithBriefs(projected, config);
      const item = publishedItem(result.state, 'probe-foreign-birth-account');

      expect(result.status).toBe('published');
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
      const result = await inspect(probeEvidence({ events: [probeEvent('UnitCreated', values)] }));
      expect(candidateArticle(result, 'probe-foreign-birth-account')).toBeUndefined();
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
      const result = await inspect(projected);
      const item = candidateArticle(result, 'probe-obituary-account');

      expect(item).toBeDefined();
      expect(item!.ruleIds).toContain('probe-obituary');
      expect(item!.subject).toMatch(/^event\//);
      expect(headlineText(item!.headline)).toContain('Hypatia');
      expect(headlineText(item!.subheadline)).toContain('Hypatia');
      expect(headlineText(item!.subheadline)).toContain(civilization);
      expect(headlineText(item!.byline)).toContain(civilization);
      expect(item!.variant).toBe(variant);
      expect(item!.sources).toEqual(expect.arrayContaining([
        obituary.source, projected.players.find((player) => player.subjectID === owner)!.source,
      ]));
    });

    it.each([
      { type: 'GreatPersonExpended', values: { PlayerID: 1 } },
      { type: 'UnitPrekill', values: { OwnerID: 1, AttackingPlayerID: -1 } },
    ])('should not report an unnamed $type', async ({ type, values }) => {
      const result = await inspect(probeEvidence({ events: [probeEvent(type, values)] }));
      expect(candidateArticle(result, 'probe-obituary-account')).toBeUndefined();
    });
  });

  describe('unhappiness probes', () => {
    it.each([
      { label: 'no cause detail', unhappiness: undefined },
      { label: 'a non-numeric cause', unhappiness: { Culture: 'much' } },
    ])('should hide the culture opinion with $label', async ({ unhappiness }) => {
      const result = await inspect(probeEvidence({
        ownCities: [{ name: 'Paris', capital: true, unhappiness }],
      }), opinionOnlyConfig);

      expect(auditSubject(result, 'probe-culture-opinion', 'city/100')?.outcome).toBe('hidden');
    });

    it('should not report culture when another cause is larger', async () => {
      const result = await inspect(probeEvidence({
        ownCities: [{ name: 'Paris', capital: true, unhappiness: { Culture: 2, Distress: 5 } }],
      }), opinionOnlyConfig);

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
      const peace = await checkWithBriefs(probeEvidence({ relationships: [relationship(1)] }), peaceConfig);
      expect(peace.status).toBe('published');
      const peaceRecord = publishedItem(peace.state, 'probe-peace-account');
      expect(peaceRecord).toBeDefined();
      expect(peaceRecord!.ruleIds).toContain('probe-peace');
      expect(peaceRecord!.subject).toBe('pair/0/1');

      const result = await checkWithBriefs(probeEvidence({
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
      const result = await checkWithBriefs(probeEvidence({
        relationships: [relationship(1, 'war')],
      }), peaceConfig);

      expect(publishedItem(result.state, 'probe-retraction-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-retraction', 'pair/0/1')?.outcome).toBe('false');
    });

    it('should not retract a war after the printed peace story is too old', async () => {
      const peace = await checkWithBriefs(probeEvidence({ relationships: [relationship(1)] }), peaceConfig);
      expect(peace.status).toBe('published');

      const result = await checkWithBriefs(probeEvidence({
        turn: 30, previous: 10, relationships: [relationship(1, 'war')],
      }), peaceConfig, peace.state);

      expect(publishedItem(result.state, 'probe-retraction-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-retraction', 'pair/0/1')?.outcome).toBe('false');
    });
  });

  describe('milestone and chance probes', () => {
    it('should publish the hundredth issue only after ninety-nine issues', async () => {
      const result = await checkWithBriefs(probeEvidence(), milestoneConfig, pastIssues(99));

      expect(result.status).toBe('published');
      const record = publishedItem(result.state, 'probe-hundredth-issue-account');
      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-hundredth-issue');
      const printed = issueItem(result, record!.id);
      expect(printed).toBeDefined();
      expect(headlineText(printed!.body[0])).toContain('100');

      const early = await checkWithBriefs(probeEvidence(), milestoneConfig, pastIssues(98));
      expect(publishedItem(early.state, 'probe-hundredth-issue-account')).toBeUndefined();
      expect(auditSubject(early, 'probe-hundredth-issue', 'world')?.outcome).toBe('false');
    });

    it('should leave the quiet-spell story out when there is no issue or the gap is short', async () => {
      const never = await checkWithBriefs(probeEvidence({ turn: 30, previous: 5 }), quietConfig);
      expect(publishedItem(never.state, 'probe-quiet-spell-account')).toBeUndefined();
      expect(auditSubject(never, 'probe-quiet-spell', 'world')?.outcome).toBe('false');

      const early = await checkWithBriefs(probeEvidence(), quietConfig, lastIssueState(5));
      expect(publishedItem(early.state, 'probe-quiet-spell-account')).toBeUndefined();
      expect(auditSubject(early, 'probe-quiet-spell', 'world')?.outcome).toBe('false');
    });

    it('should let the seeded draw both publish and suppress the quiet-spell story', async () => {
      const campaigns = Array.from({ length: 40 }, (_, index) => `quiet-${index}`);
      const results: Awaited<ReturnType<typeof check>>[] = [];
      for (const campaignId of campaigns)
        results.push(await checkWithBriefs(probeEvidence({ turn: 30, previous: 5 }), quietConfig,
          lastIssueState(5), campaignId));
      const passed = results.find((result) => publishedItem(result.state, 'probe-quiet-spell-account'));
      const failed = results.find((result) =>
        auditSubject(result, 'probe-quiet-spell', 'world')?.outcome === 'chance');
      const repeatKey = JSON.stringify(['probe-quiet-spell', 'world']);

      expect(passed).toBeDefined();
      expect(failed).toBeDefined();
      expect(publishedItem(failed!.state, 'probe-quiet-spell-account')).toBeUndefined();
      expect(failed!.state.triggerRepeats[repeatKey]).toBeUndefined();
      expect(passed!.state.triggerRepeats[repeatKey]?.lastTurn).toBe(30);
      const record = publishedItem(passed!.state, 'probe-quiet-spell-account');
      expect(record).toBeDefined();
      const printed = issueItem(passed!, record!.id);
      expect(printed).toBeDefined();
      expect(headlineText(printed!.body[0])).toContain('25');
    });
  });

  describe('covert presence probes', () => {
    it('should print a foreign city profile when our spy reports boredom there', async () => {
      const projected = probeEvidence({
        foreignCityValues: { OurSpyPresent: true, UnhappinessSources: { Culture: 3, Distress: 1 } },
      });
      const result = await checkWithBriefs(projected, publicationCatalogue(spyConfig));
      const record = publishedItem(result.state, 'probe-spy-city-profile-account');

      expect(result.status).toBe('published');
      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-spy-city-profile');
      expect(record!.subject).toBe('city/11');
      expect(record!.sources).toContainEqual(
        projected.cities.find((city) => city.subjectID === 11)!.source);
      expect(headlineText(record!.headline)).toContain('Persepolis');
    });

    it.each([
      { label: 'an observed absence', values: { OurSpyPresent: false, UnhappinessSources: { Culture: 3 } }, outcome: 'false' },
      { label: 'no presence observation', values: { UnhappinessSources: { Culture: 3 } }, outcome: 'hidden' },
      { label: 'detail without boredom', values: { OurSpyPresent: true, UnhappinessSources: { Distress: 3 } }, outcome: 'false' },
    ])('should withhold the spy profile with $label', async ({ values, outcome }) => {
      const result = await inspect(probeEvidence({ foreignCityValues: values }), spyConfig);

      expect(candidateArticle(result, 'probe-spy-city-profile-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-spy-city-profile', 'city/11')?.outcome).toBe(outcome);
    });

    it('should report an inbound diplomat only with an explicit empty post of ours', async () => {
      const projected = probeEvidence({
        playerValues: { 1: { TheirDiplomatHere: true, OurDiplomatThere: false } },
      });
      const result = await inspect(projected, diplomatConfig);
      const record = candidateArticle(result, 'probe-inbound-diplomat-account');

      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-inbound-diplomat');
      expect(record!.subject).toBe('player/1');
      expect(record!.sources).toContainEqual(
        projected.players.find((player) => player.subjectID === 1)!.source);
    });

    it.each([
      { label: 'our own post there', values: { TheirDiplomatHere: true, OurDiplomatThere: true }, outcome: 'false' },
      { label: 'their post absent', values: { TheirDiplomatHere: false, OurDiplomatThere: false }, outcome: 'false' },
      { label: 'no inbound observation', values: { OurDiplomatThere: false }, outcome: 'hidden' },
      { label: 'no outgoing observation', values: { TheirDiplomatHere: true }, outcome: 'hidden' },
    ])('should withhold the inbound story with $label', async ({ values, outcome }) => {
      const result = await inspect(probeEvidence({ playerValues: { 1: values } }), diplomatConfig);

      expect(candidateArticle(result, 'probe-inbound-diplomat-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-inbound-diplomat', 'player/1')?.outcome).toBe(outcome);
    });

    it('should brief one readable branch from the latest tier, including an ideology', async () => {
      const projected = probeEvidence({
        playerValues: { 1: {
          OurDiplomatThere: true,
          PolicyBranches: { Tradition: ['Aristocracy'], Industry: ['Free Trade'], Order: ['Workers’ Faculties'], Freedom: [] },
        } },
      });
      const result = await inspect(projected, foreignPolicyConfig);
      const record = candidateArticle(result, 'probe-foreign-policies-account');

      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-foreign-policies');
      expect(record!.subject).toBe('player/1');
      expect(headlineText(record!.body[0])).toContain('Workers’ Faculties');
      expect(headlineText(record!.body[0])).not.toMatch(/Aristocracy|Free Trade/);
    });

    it('should vary among readable branches in the latest tier without joining their lists', async () => {
      const playerValues = { 1: {
        OurDiplomatThere: true,
        PolicyBranches: { Tradition: ['Aristocracy'], Industry: ['Free Trade'], Rationalism: ['Scientific Revolution'] },
      } };
      const stories = [];
      for (const turn of [10, 11]) {
        const result = await inspect(probeEvidence({ turn, playerValues }), foreignPolicyConfig);
        const record = candidateArticle(result, 'probe-foreign-policies-account');
        const body = headlineText(record?.body[0]);
        const named = body.match(/Free Trade|Scientific Revolution/g);
        expect(named).toHaveLength(1);
        expect(body).not.toContain('Aristocracy');
        stories.push(named?.[0]);
      }
      expect(new Set(stories).size).toBe(2);
    });

    it.each([
      { label: 'policy branch counts', values: { OurDiplomatThere: true, PolicyBranches: { Tradition: 3, Liberty: 2 } }, outcome: 'false' },
      { label: 'empty policy lists', values: { OurDiplomatThere: true, PolicyBranches: { Tradition: [] } }, outcome: 'false' },
      { label: 'an inbound visit without our diplomat', values: { TheirDiplomatHere: true, OurDiplomatThere: false, PolicyBranches: { Tradition: ['Liberty'] } }, outcome: 'false' },
      { label: 'no outgoing observation', values: { PolicyBranches: { Tradition: ['Liberty'] } }, outcome: 'hidden' },
    ])('should withhold the policy briefing with $label', async ({ values, outcome }) => {
      const result = await inspect(probeEvidence({ playerValues: { 1: values } }), foreignPolicyConfig);

      expect(candidateArticle(result, 'probe-foreign-policies-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-foreign-policies', 'player/1')?.outcome).toBe(outcome);
    });
  });

  describe('espionage and election probes', () => {
    describe('technology theft', () => {
      it('should write a likely source-side gain with its original evidence', async () => {
        const theft = probeEvent('EspionageResult', {
          Perspective: 'source', SpyResult: 'Detected', SourcePlayerID: 0, TargetPlayerID: 1,
          CityX: 10, CityY: 0, CityName: 'Persepolis', Tech: 'Steam Power',
        });
        theft.relatedSources = [{ table: 'GameEvents', id: 102, turn: 8, createdAt: 8000 }];
        const projected = probeEvidence({ events: [theft] });
        const result = await inspect(projected, espionageConfig);
        const record = candidateArticle(result, 'probe-espionage-tech-account');

        expect(record).toBeDefined();
        expect(record!.ruleIds).toContain('probe-espionage-tech');
        expect(record!.subject).toBe('event/101');
        expect(auditValue(result, 'probe-espionage-tech', 'event/101', 'values.technology')?.value)
          .toBe('Steam Power');
        expect(record!.sources).toEqual(expect.arrayContaining([theft.source, ...theft.relatedSources]));
        expect(headlineText(record!.body[0])).toContain('Steam Power');
        expect(headlineText(record!.body[0])).toContain('Persepolis');
      });

      it('should fall back to a generic city when the operation has no recorded name', async () => {
        const theft = probeEvent('EspionageResult', {
          Perspective: 'source', SpyResult: 'Undetected', SourcePlayerID: 0, TargetPlayerID: 1,
          CityX: 10, CityY: 0, Tech: 'Steam Power',
        });
        const result = await inspect(probeEvidence({ events: [theft] }), espionageConfig);
        const record = candidateArticle(result, 'probe-espionage-tech-account');

        expect(record).toBeDefined();
        expect(headlineText(record!.body[0])).toContain('Steam Power');
        expect(headlineText(record!.body[0])).not.toMatch(/\{\{|\bundefined\b/);
      });

      it('should leave an unnamed technology out of the theft story', async () => {
        const attempt = probeEvent('EspionageResult', {
          Perspective: 'source', SpyResult: 'Detected', SourcePlayerID: 0, TargetPlayerID: 1,
        });
        const result = await inspect(probeEvidence({ events: [attempt] }), espionageConfig);

        expect(candidateArticle(result, 'probe-espionage-tech-account')).toBeUndefined();
        expect(auditSubject(result, 'probe-espionage-tech', 'event/101')?.outcome).toBe('false');
      });
    });

    describe('spy loss', () => {
      it.each(['Killed', 'KilledNotIdentified'])('should report %s without a city name', async (outcome) => {
        const loss = probeEvent('EspionageResult', {
          Perspective: 'source', SpyResult: outcome, SourcePlayerID: 0, TargetPlayerID: 1,
        });
        const result = await inspect(probeEvidence({ events: [loss] }), espionageConfig);
        const record = candidateArticle(result, 'probe-spy-loss-account');

        expect(record).toBeDefined();
        expect(record!.ruleIds).toContain('probe-spy-loss');
        expect(auditSubject(result, 'probe-spy-loss', 'event/101')?.outcome).toBe('fired');
        expect(record!.sources).toContainEqual(loss.source);
        expect(headlineText(record!.body[0])).not.toMatch(/\{\{|\bundefined\b/);
      });

      it('should keep the loss story ahead of a technology gain from the same operation', async () => {
        const loss = probeEvent('EspionageResult', {
          Perspective: 'source', SpyResult: 'Killed', SourcePlayerID: 0, TargetPlayerID: 1,
          CityName: 'Persepolis', Tech: 'Steam Power',
        });
        const result = await inspect(probeEvidence({ events: [loss] }), espionageConfig);
        const state = createInitialPublicationState();
        const { selected } = selectHeuristic(result.candidates, state, espionageConfig, computeFeedback(state, espionageConfig));
        const taking = selected.flatMap(candidate => candidate.templateIds);

        expect(taking.slice(0, 2)).toEqual(['probe-spy-loss-account', 'probe-espionage-tech-account']);
        expect(auditSubject(result, 'probe-espionage-tech', 'event/101')?.outcome).toBe('fired');
      });
    });

    describe('defender reports', () => {
      it('should name a resolved source and cite its player row', async () => {
        const report = probeEvent('EspionageResult', {
          Perspective: 'target', SpyResult: 'Identified', SourcePlayerID: 1, TargetPlayerID: 0,
          CityName: 'Paris', CityX: 0, CityY: 0,
        });
        const projected = probeEvidence({ events: [report] });
        const result = await inspect(projected, espionageConfig);
        const record = candidateArticle(result, 'probe-defender-report-account');

        expect(record).toBeDefined();
        expect(record!.ruleIds).toContain('probe-defender-report');
        const playerSource = projected.players.find((player) => player.subjectID === 1)!.source;
        expect(record!.sources).toEqual(expect.arrayContaining([report.source, playerSource]));
        expect(headlineText(record!.body[0])).toContain('Persia');
        expect(headlineText(record!.body[0])).toContain('Paris');
      });

      it('should keep an anonymous source generic without a player citation', async () => {
        const report = probeEvent('EspionageResult', {
          Perspective: 'target', SpyResult: 'KilledNotIdentified', TargetPlayerID: 0,
        });
        const projected = probeEvidence({ events: [report] });
        const result = await inspect(projected, espionageConfig);
        const record = candidateArticle(result, 'probe-defender-report-account');

        expect(record).toBeDefined();
        const playerSource = projected.players.find((player) => player.subjectID === 1)!.source;
        expect(record!.sources).not.toContainEqual(playerSource);
        expect(headlineText(record!.body[0])).not.toContain('Persia');
        expect(headlineText(record!.body[0])).not.toMatch(/\{\{|\bundefined\b/);
      });
    });

    describe('election influence', () => {
      it.each([
        { type: 'ElectionResultSuccess', change: 12, cityState: 'Geneva' },
        { type: 'ElectionResultFailure', change: -8, cityState: undefined },
      ])('should report a $type change of $change', async ({ type, change, cityState }) => {
        const election = probeEvent(type, {
          PlayerID: 0, InfluenceChange: change, ...(cityState === undefined ? {} : { CityState: cityState }),
        });
        const result = await inspect(probeEvidence({ events: [election] }), espionageConfig);
        const record = candidateArticle(result, 'probe-election-influence-account');

        expect(record).toBeDefined();
        expect(record!.ruleIds).toContain('probe-election-influence');
        expect(auditValue(result, 'probe-election-influence', 'event/101', 'values.change')?.value).toBe(change);
        expect(record!.sources).toContainEqual(election.source);
        expect(headlineText(record!.body[0])).toContain(String(change));
        expect(headlineText(record!.body[0])).not.toMatch(/\{\{|\bundefined\b/);
        if (cityState) expect(headlineText(record!.body[0])).toContain(cityState);
      });

      it('should not report a zero influence change', async () => {
        const election = probeEvent('ElectionResultSuccess', {
          PlayerID: 0, InfluenceChange: 0, CityState: 'Geneva',
        });
        const result = await inspect(probeEvidence({ events: [election] }), espionageConfig);

        expect(candidateArticle(result, 'probe-election-influence-account')).toBeUndefined();
        expect(auditSubject(result, 'probe-election-influence', 'event/101')?.outcome).toBe('false');
      });
    });

    describe('delayed reports', () => {
      /** Build a defender report recorded at its operation and dated again when reported. */
      const delayed = () => probeEvent('EspionageResult', {
        Perspective: 'target', SpyResult: 'Identified', SourcePlayerID: 1, TargetPlayerID: 0,
        CityName: 'Paris', CityX: 10, CityY: 0,
      }, 101, 8, 9);

      it('should expose the report turn while citing the original row date', () => {
        const report = delayed();
        const model = buildFacts(probeEvidence({ turn: 9, previous: 5, events: [report] }), espionageConfig);
        const row = model.events.find((event) => event.id === 101);

        expect(row?.turn).toBe(9);
        expect(row?.fields.turn).toEqual({ value: 9, sources: [report.source] });
        expect(row?.sources).toContainEqual(report.source);
      });

      it('should keep the report out of facts and timelines before its report turn', async () => {
        const report = delayed();
        const projected = probeEvidence({ turn: 8, previous: 5, events: [report] });
        const model = buildFacts(projected, espionageConfig);
        const playerEvents = model.players[0].current!.events.value as FactWindow;

        expect(model.events.some((event) => event.id === 101)).toBe(false);
        expect(model.subjects.event).not.toContain(101);
        expect(playerEvents.entries.some((entry) => entry.turn === 9)).toBe(false);
        const result = await inspect(projected, espionageConfig);
        expect(auditSubject(result, 'probe-defender-report', 'event/101')).toBeUndefined();
      });

      it('should treat a delayed report as new even when its operation is outside the reporting window', async () => {
        const report = probeEvent('EspionageResult', {
          Perspective: 'target', SpyResult: 'KilledNotIdentified', TargetPlayerID: 0,
        }, 101, 8, 9);
        const result = await inspect(probeEvidence({ turn: 9, previous: 8, events: [report] }), espionageConfig);

                expect(candidateArticle(result, 'probe-defender-report-account')).toBeDefined();
        expect(auditSubject(result, 'probe-defender-report', 'event/101')?.outcome).toBe('fired');
      });

      it('should use the report turn in city and player event timelines', () => {
        const report = delayed();
        const projected = probeEvidence({ turn: 9, previous: 5, events: [report] });
        const city = projected.cities.find((row) => row.subjectID === 11)!;
        projected.history!.snapshots.cities = [
          { ...city, source: { table: 'CityInformations', id: 301, turn: 8, createdAt: 8000 } },
          ...projected.history!.snapshots.cities,
        ];
        const model = buildFacts(projected, espionageConfig);
        const playerEvents = model.players[0].current!.events.value as FactWindow;
        const cityEvents = model.cities[11].current!.events.value as FactWindow;

        expect(playerEvents.entries).toEqual(expect.arrayContaining([expect.objectContaining({ turn: 9 })]));
        expect(cityEvents.entries).toEqual(expect.arrayContaining([expect.objectContaining({ turn: 9 })]));
      });
    });
  });

  describe('front zone probes', () => {
    it('should write a named city front with recorded posture and observed counts', async () => {
      const zone = tacticalZone();
      const result = await inspect(probeEvidence({ tacticalZones: [zone] }), frontConfig);
      const record = candidateArticle(result, 'probe-front-zone-account');

      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-front-zone');
      expect(record!.subject).toBe('player/0');
      expect(record!.sources).toContainEqual(zone.source);
      expect(auditValue(result, 'probe-front-zone', 'player/0', 'values.frontCity')?.value).toBe('Rotterdam');
      expect(auditValue(result, 'probe-front-zone', 'player/0', 'values.posture')?.value).toBe('Withdraw');
      expect(String(auditValue(result, 'probe-front-zone', 'player/0', 'values.counts')?.value))
        .toContain('Frigate');
    });

    it('should cite only the selected zone row', async () => {
      const selected = tacticalZone({
        city: 'Stuttgart',
        source: { table: 'TacticalZones', id: 902, turn: 10, createdAt: 10000 },
      });
      const other = tacticalZone({
        city: 'Utrecht', posture: 'Advance',
        source: { table: 'TacticalZones', id: 903, turn: 10, createdAt: 10000 },
      });
      const result = await inspect(probeEvidence({ tacticalZones: [selected, other] }), frontConfig);
      const record = candidateArticle(result, 'probe-front-zone-account');

      expect(record).toBeDefined();
      expect(record!.sources).toContainEqual(selected.source);
      expect(record!.sources).not.toContainEqual(other.source);
    });

    it.each([
      { label: 'no zone rows', zones: undefined },
      { label: 'an older observation', zones: [tacticalZone({
        source: { table: 'TacticalZones', id: 904, turn: 9, createdAt: 9000 },
      })] },
      { label: 'a zone without a city', zones: [tacticalZone({ city: undefined })] },
      { label: 'a named zone without visible counts', zones: [tacticalZone({ units: {} })] },
    ])('should leave the front unknown with $label', async ({ zones }) => {
      const result = await inspect(probeEvidence({ tacticalZones: zones }), frontConfig);

      expect(candidateArticle(result, 'probe-front-zone-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-front-zone', 'player/0')?.outcome).toBe('false');
    });
  });

  describe('ship launch probes', () => {
    it.each(['Frigate', 'Trireme'])('should write a non-purchased %s with its joined citations', async (unit) => {
      const { projected, training, created, city } = shipEvidence({ unit });
      const result = await inspect(projected, shipConfig);
      const record = candidateArticle(result, 'probe-ship-launch-account');

      expect(record).toBeDefined();
      expect(record!.ruleIds).toContain('probe-ship-launch');
      expect(record!.subject).toBe('city/100');
      expect(record!.sources).toEqual(expect.arrayContaining([
        training.source, created.source, city.source,
      ]));
      expect(auditValue(result, 'probe-ship-launch', 'city/100', 'values.ship')?.value).toBe(unit);
      expect(auditValue(result, 'probe-ship-launch', 'city/100', 'values.port')?.value).toBe('Rotterdam');
    });

    it('should use the recorded port instead of a renamed current city', async () => {
      const { projected } = shipEvidence();
      projected.cities.find((row) => row.subjectID === 100)!.values.Name = 'Rotterdam Reborn';
      const result = await inspect(projected, shipConfig);

      expect(auditValue(result, 'probe-ship-launch', 'city/100', 'values.port')?.value).toBe('Rotterdam');
    });

    it.each([
      { label: 'a non-naval unit', options: { unit: 'Warrior' } },
      { label: 'a gold purchase', options: { withGold: true } },
      { label: 'a faith purchase', options: { withFaith: true } },
      { label: 'a missing gold flag', options: { omitGold: true } },
      { label: 'a missing faith flag', options: { omitFaith: true } },
      { label: 'no recorded port', options: { port: null } },
    ])('should withhold the launch report with $label', async ({ options }) => {
      const { projected } = shipEvidence(options);
      const result = await inspect(projected, shipConfig);

      expect(candidateArticle(result, 'probe-ship-launch-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-ship-launch', 'city/100')?.outcome).toBe('false');
    });

    it('should keep the port private to the training player', async () => {
      const { projected } = shipEvidence({ playerId: 1, cityId: 11, x: 10 });
      const model = buildFacts(projected, shipConfig);
      const trained = model.cities[11].current!.trained.value as FactWindow;

      expect(trained.entries).toHaveLength(1);
      const fields = trained.entries[0].field.value as FactObject;
      expect(fields).not.toHaveProperty('port');
      const result = await inspect(projected, shipConfig);
      expect(candidateArticle(result, 'probe-ship-launch-account')).toBeUndefined();
      expect(auditSubject(result, 'probe-ship-launch', 'city/11')?.outcome).toBe('false');
    });
  });

  describe("People's Daily design", () => {
    it('should choose the probe design when the receiver follows Order', async () => {
      const result = await checkWithBriefs(probeEvidence({
        gold: 100, branch: 'Order', ownCities: [{ name: 'Paris', capital: true }],
      }), probeOnlyConfig);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.publication.designId).toBe(probeDesignId);
      expect(result.issue.publication.title).toBe('The Paris Worker');
      expect(result.issue.publication.motto).toBe('All power to the Party');
    });

    it('should not publish with this design when the receiver follows Freedom', async () => {
      const result = await checkWithBriefs(probeEvidence({
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
      const first = await checkWithBriefs(firstEvidence, capitalConfig);
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      expect(first.issue.publication.title).toBe('The Paris Herald');
      const capitalSource = firstEvidence.cities.find((city) => city.values.Name === 'Paris')!.source;
      expect(first.decision.evidence).toContainEqual(capitalSource);
      expect(publishedItem(first.state, probeTemplateId)!.sources).not.toContainEqual(capitalSource);

      const second = await checkWithBriefs(probeEvidence({
        gold: 100, turn: 15, previous: 10,
        ownCities: [{ name: 'Paris', capital: false }, { name: 'Orleans', capital: true }],
      }), capitalConfig, first.state);
      expect(second.status).toBe('published');
      if (second.status !== 'published') return;
      expect(second.issue.publication.title).toBe('The Orleans Herald');
    });

    it('should drop a selected design when its motto loses our master', async () => {
      const first = await checkWithBriefs(probeEvidence({
        gold: 100, relationships: [relationship(2, 'peace', { master: 'voluntary' })],
      }), vassalConfig);
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      expect(first.issue.publication.designId).toBe('probe-vassal-strapline');
      expect(first.issue.publication.motto).toBe("A journal of The Huns's dominion");

      const second = await checkWithBriefs(probeEvidence({
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
