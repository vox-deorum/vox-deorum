/** Probe overlay stories and the People's Daily design, loaded from the on-disk folder. */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, type PublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { evidence as buildEvidence, snapshot } from '../../../helpers/newspaper-diplomacy.js';

const probeDirectory = fileURLToPath(new URL('../../../../newspaper/probes/', import.meta.url));
const probeTemplateId = 'probe-treasury-account';
const probeDesignId = 'probe-communist-press';

let defaultConfig: EditorialConfig;
let probeConfig: EditorialConfig;
let probeOnlyConfig: EditorialConfig;

/** Supply dated contact and cover the stock rules' lookback windows. */
function probeEvidence({ gold = 0, branch = 'Tradition', events = [], riderX = 10 }: {
  gold?: number; branch?: string; events?: NewspaperEvent[]; riderX?: number;
} = {}): NewspaperEvidence {
  const projected = buildEvidence(events, [snapshot(0, 5, []), snapshot(1, 5, []), snapshot(2, 5, [])]);
  for (const row of projected.players) row.source = snapshot(row.subjectID, 5, []).source;
  projected.players[0].values = { Gold: gold, PolicyBranches: { [branch]: [] } };
  projected.cities = [
    { subjectID: 11, source: { table: 'CityInformations', id: 201, turn: 10, createdAt: 10_000 },
      values: { OwnerID: 1, Name: 'Persepolis', X: riderX, Y: 0 } },
    { subjectID: 12, source: { table: 'CityInformations', id: 202, turn: 10, createdAt: 10_000 },
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
function check(projected: NewspaperEvidence, catalogue = probeConfig) {
  const facts = buildNewspaperFacts(projected, {
    playerIdentities: {
      0: { name: 'France', major: true, teamId: 100 },
      1: { name: 'Persia', major: true, teamId: 101 },
      2: { name: 'The Huns', major: true, teamId: 102 },
    },
  }, { ideologies: catalogue.constants.types.ideologies });
  return runEditorialCheck({
    campaignId: 'campaign',
    timelineId: 'probe',
    receiver: { playerId: 0, label: 'France' },
    evidence: projected,
    facts,
    speedMultiplier: 1,
    state: createInitialPublicationState(),
    config: catalogue,
  });
}

/** Supply a projected event on a date when the actors were already known. */
function probeEvent(type: string, values: NewspaperEvent['values']): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id: 101, turn: 8, createdAt: 8000 } };
}

/** Read which templates actually made it into print. */
function publishedTemplates(state: PublicationState) {
  return state.issues.flatMap((issue) => issue.items.flatMap((item) => item.templateIds));
}

/** Find the published record for one template. */
function publishedItem(state: PublicationState, templateId: string) {
  return state.issues.flatMap((issue) => issue.items).find((item) => item.templateIds.includes(templateId));
}

/** Read one headline as plain text. */
function headlineText(headline: PublicationState['issues'][number]['items'][number]['headline']) {
  return headline.map((node) => 'text' in node ? node.text : '').join('');
}

describe('probe overlay', () => {
  beforeAll(async () => {
    defaultConfig = await loadEditorialConfig();
    probeConfig = await loadEditorialConfig(probeDirectory);
    probeOnlyConfig = {
      ...probeConfig,
      designs: probeConfig.designs.filter((design) => design.id === probeDesignId),
    };
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
      const result = await check(probeEvidence({ events: [birth] }));
      const item = publishedItem(result.state, 'probe-foreign-birth-account');

      expect(item).toBeDefined();
      expect(headlineText(item!.headline)).toContain('Ptolemy');
      expect(item!.sources).toEqual(expect.arrayContaining([birth.source, snapshot(1, 5, []).source]));
    });

    it.each([
      { label: 'an unnamed creation abroad', values: { PlayerID: 1, Unit: 'Warrior' } },
      { label: 'a named birth at home', values: { PlayerID: 0, Person: 'Ptolemy' } },
    ])('should not report $label as a foreign birth', async ({ values }) => {
      const result = await check(probeEvidence({ events: [probeEvent('UnitCreated', values)] }));
      expect(publishedItem(result.state, 'probe-foreign-birth-account')).toBeUndefined();
    });

    it.each([
      { kind: 'expenditure abroad', type: 'GreatPersonExpended', owner: 1,
        values: { PlayerID: 1, Person: 'Hypatia' }, variant: 'probe-obituary-expended' },
      { kind: 'expenditure at home', type: 'GreatPersonExpended', owner: 0,
        values: { PlayerID: 0, Person: 'Hypatia' }, variant: 'probe-obituary-expended' },
      { kind: 'death abroad', type: 'UnitPrekill', owner: 1,
        values: { OwnerID: 1, AttackingPlayerID: -1, Person: 'Hypatia' }, variant: 'probe-obituary-died' },
      { kind: 'death at home', type: 'UnitPrekill', owner: 0,
        values: { OwnerID: 0, AttackingPlayerID: -1, Person: 'Hypatia' }, variant: 'probe-obituary-died' },
    ])('should report a named $kind as one obituary without coordinates', async ({ type, owner, values, variant }) => {
      const obituary = probeEvent(type, values);
      const result = await check(probeEvidence({ events: [obituary] }));
      const item = publishedItem(result.state, 'probe-obituary-account');

      expect(item).toBeDefined();
      expect(headlineText(item!.headline)).toContain('Hypatia');
      expect(result.decision.selectedVariants[item!.id]).toBe(variant);
      expect(item!.sources).toEqual(expect.arrayContaining([obituary.source, snapshot(owner, 5, []).source]));
    });

    it.each([
      { type: 'GreatPersonExpended', values: { PlayerID: 1 } },
      { type: 'UnitPrekill', values: { OwnerID: 1, AttackingPlayerID: -1 } },
    ])('should not report an unnamed $type', async ({ type, values }) => {
      const result = await check(probeEvidence({ events: [probeEvent(type, values)] }));
      expect(publishedItem(result.state, 'probe-obituary-account')).toBeUndefined();
    });
  });

  describe("People's Daily design", () => {
    it('should choose the probe design when the receiver follows Order', async () => {
      const result = await check(probeEvidence({ gold: 100, branch: 'Order' }), probeOnlyConfig);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.publication.designId).toBe(probeDesignId);
    });

    it('should not publish with this design when the receiver follows Freedom', async () => {
      const result = await check(probeEvidence({ gold: 100, branch: 'Freedom' }), probeOnlyConfig);
      expect(result.status).toBe('skipped');
      expect(
        result.decision.candidateScores.some(
          (candidate) => candidate.selected && candidate.id.startsWith(`${probeTemplateId}/`)
        )
      ).toBe(true);
    });
  });
});
