import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';

let config: Awaited<ReturnType<typeof loadEditorialConfig>>;

/** Give snapshots their own row references in the relevant table. */
function snapshot(subjectID: number, turn: number, values: NewspaperSnapshot['values'],
  table: NewspaperSnapshot['source']['table'] = 'PlayerSummaries'): NewspaperSnapshot {
  return { subjectID, values, source: { table, id: turn * 100 + subjectID, turn, createdAt: turn } };
}

/** Build dated and visible evidence for controlled domestic and foreign comparisons. */
function fixture({
  populations = [10, 6, 5], strengths = [20, 20], oldStrengths = [20, 20],
  technologies = [13, 12], oldTechnologies = [13, 12], happiness, goldenAge, atWar = true,
}: {
  populations?: number[]; strengths?: (number | null | undefined)[]; oldStrengths?: (number | undefined)[];
  technologies?: (number | undefined)[]; oldTechnologies?: number[];
  happiness?: number | null; goldenAge?: boolean; atWar?: boolean;
} = {}): NewspaperEvidence {
  const players = [0, 1].map(id => snapshot(id, 30, {
    ...(strengths[id] === undefined ? {} : { MilitaryStrength: strengths[id] }),
    ...(technologies[id] === undefined ? {} : { Technologies: technologies[id] }),
    ...(id === 0 && happiness !== undefined ? { HappinessPercentage: happiness } : {}),
  }));
  const earlier = [0, 1].map(id => snapshot(id, 10, {
    ...(oldStrengths[id] === undefined ? {} : { MilitaryStrength: oldStrengths[id] }),
    Technologies: oldTechnologies[id],
  }));
  const cities = ['Paris', 'Tours', 'Lyon', 'Memphis'].map((Name, id) =>
    snapshot(id + 10, 10, { Name, X: 10 + 2 * id, Y: 10, OwnerID: id === 3 ? 1 : 0,
      IsCapital: id === 0 || id === 3, Population: populations[id] ?? 3 }, 'CityInformations'));
  const events: NewspaperEvidence['events'] = goldenAge === undefined ? [] : [{
    type: 'PlayerGoldenAge', values: { PlayerID: 0, Starting: goldenAge },
    source: { table: 'GameEvents', id: 1, turn: 28, createdAt: 28 },
  }];
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 25, cutoffTurn: 30, historyFromTurn: 9 },
    players, cities, events, comparisons: { players: [], cities: [] },
    history: { fromTurn: 9, baseline: { players: [], cities: [] },
      snapshots: { players: [...earlier, ...players], cities }, events, gaps: [] },
    diplomacy: { fromTurn: 9, baseline: [], gaps: [],
      history: [...earlier, ...players].map(row => ({
        source: row.source, subjectID: row.subjectID, teamID: row.subjectID, isMajor: true,
        relationships: row.subjectID === 0 && row.source.turn === 30 ?
          [{ targetPlayerID: 1, targetTeamID: 1, state: atWar ? 'war' : 'peace' }] : [],
      })) },
  };
}

/** Exercise the real editor with the shipped national rules and authored copy. */
function check(evidence: NewspaperEvidence, state = createInitialPublicationState(), catalogue = config) {
  const facts = buildNewspaperFacts(evidence, { playerIdentities: {
    0: { name: 'France', major: true }, 1: { name: 'Egypt', major: true },
  } });
  return runEditorialCheck({ campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'France' },
    evidence, facts, speedMultiplier: 1, state, config: catalogue });
}

describe('national desk', () => {
  beforeAll(async () => {
    const stock = await loadEditorialConfig();
    const ids = ['capital-outgrown', 'neighbor-army-overtakes', 'technology-leader-changes', 'golden-age-in-wartime'];
    config = { ...stock, triggers: stock.triggers.filter(rule => ids.includes(rule.id)),
      templates: stock.templates.filter(template => template.triggers.some(id => ids.includes(id))) };
  });

  describe('population and military strength', () => {
    it.each([
      [[10, 11, 9], 'capital-outgrown-single'],
      [[10, 11, 11], 'capital-outgrown-tied'],
    ])('should publish the population comparison for %j', async (populations, variant) => {
      const evidence = fixture({ populations });
      const result = await check(evidence);
      expect(result.status).toBe('published');
      expect(Object.values(result.decision.selectedVariants)).toEqual([variant]);
      expect(result.decision.evidence).toEqual(expect.arrayContaining(evidence.cities.slice(0, 3).map(city => city.source)));
      const next = { ...evidence, request: { ...evidence.request, previousCheckTurn: 30, cutoffTurn: 31 } };
      const repeated = await check(next, result.state);
      expect(repeated.status).toBe('skipped');
    });

    it('should leave a capital tied for the largest population out of the news', async () => {
      expect((await check(fixture({ populations: [10, 10, 9] }))).status).toBe('skipped');
    });

    it('should publish a measured crossing even when our measured strength is zero', async () => {
      const result = await check(fixture({ strengths: [0, 25] }));
      expect(result.status).toBe('published');
      expect(Object.values(result.decision.selectedVariants)).toEqual(['neighbor-army-overtakes-report']);
    });

    it('should require a known baseline and present comparison for an overtake', async () => {
      expect((await check(fixture({ strengths: [20, 25], oldStrengths: [20, 25] }))).status).toBe('skipped');
      expect((await check(fixture({ strengths: [20, 25], oldStrengths: [20, undefined] }))).status).toBe('skipped');
      expect((await check(fixture({ strengths: [null, 25] }))).status).toBe('skipped');
    });
  });

  describe('research standings', () => {
    it.each([
      [14, 'technology-leader-changes-single'],
      [13, 'technology-leader-changes-tied'],
    ])('should distinguish a sole lead from a tie with %i technologies', async (count, variant) => {
      const result = await check(fixture({ technologies: [13, count] }));
      expect(result.status).toBe('published');
      expect(Object.values(result.decision.selectedVariants)).toEqual([variant]);
      expect(result.state.issues[0].items[0].tags).toContain('international');
    });

    it.each([
      [14, 'technology-leader-changes-home-single'],
      [13, 'technology-leader-changes-home-tied'],
    ])('should cover our own rise to the lead at home with %i technologies', async (count, variant) => {
      // Three domestic stories and two front-page slots give the home section extra coverage.
      const result = await check(fixture({
        populations: [10, 11, 9], technologies: [count, 13], oldTechnologies: [12, 13], goldenAge: true,
      }), createInitialPublicationState(), { ...config, defaults: { ...config.defaults, frontPageItems: 2 } });
      if (result.status !== 'published') throw new Error('Expected the home research story to publish.');
      const story = result.state.issues[0].items.find(item => result.decision.selectedVariants[item.id] === variant);
      if (!story) throw new Error('Expected the domestic variant in the published issue.');
      expect(story.tags).toContain('domestic');
      expect(story.tags).not.toContain('international');
      expect(result.issue.pages.find(page => page.id === 'home')?.itemIds).toContain(story.id);
    });

    it('should not claim a new leader with no readable contender', async () => {
      expect((await check(fixture({ technologies: [undefined, 14] }))).status).toBe('skipped');
    });
  });

  describe('wartime Golden Age', () => {
    it.each([
      [34, 'critical'], [35, 'neutral'], [50, 'neutral'], [51, 'supportive'],
      [null, 'neutral'], [undefined, 'neutral'],
    ])('should choose the edition voice at happiness %s', async (happiness, tone) => {
      const evidence = fixture({ happiness, goldenAge: true });
      const result = await check(evidence);
      expect(result.status).toBe('published');
      expect(Object.values(result.decision.selectedVariants)).toEqual([`golden-age-in-wartime-${tone}`]);
      expect(result.decision.evidence).toContainEqual(evidence.events[0].source);
    });

    it('should leave a Golden Age ending or a peacetime award out of the wartime report', async () => {
      expect((await check(fixture({ goldenAge: false }))).status).toBe('skipped');
      expect((await check(fixture({ goldenAge: true, atWar: false }))).status).toBe('skipped');
    });
  });
});
