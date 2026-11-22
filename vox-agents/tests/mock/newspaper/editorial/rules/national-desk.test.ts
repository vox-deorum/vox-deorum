import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { editionBriefTemplate, withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

let config: Awaited<ReturnType<typeof loadEditorialConfig>>;

/** Give snapshots their own row references in the relevant table. */
function snapshot(subjectID: number, turn: number, values: NewspaperSnapshot['values'],
  table: NewspaperSnapshot['source']['table'] = 'PlayerSummaries'): NewspaperSnapshot {
  return { subjectID, values, source: { table, id: turn * 100 + subjectID, turn, createdAt: turn } };
}

/** Build dated and visible evidence for controlled domestic and foreign comparisons. */
function fixture({
  populations = [10, 6, 5], strengths = [20, 20], oldStrengths = [20, 20],
  technologies = [13, 12], oldTechnologies = [13, 12], goldenAge, atWar = true,
}: {
  populations?: number[]; strengths?: (number | null | undefined)[]; oldStrengths?: (number | undefined)[];
  technologies?: (number | undefined)[]; oldTechnologies?: number[];
  goldenAge?: boolean; atWar?: boolean;
} = {}): NewspaperEvidence {
  const players = [0, 1].map(id => snapshot(id, 30, {
    ...(strengths[id] === undefined ? {} : { MilitaryStrength: strengths[id] }),
    ...(technologies[id] === undefined ? {} : { Technologies: technologies[id] }),
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
async function check(observations: NewspaperEvidence, state = createInitialPublicationState()) {
  const input = withEditionBriefs(observations, config);
  const { evidence } = input;
  const facts = buildNewspaperFacts(evidence, { playerIdentities: {
    0: { name: 'France', major: true }, 1: { name: 'Egypt', major: true },
  } });
  const result = await runEditorialCheck({ campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'France' },
    ...input, facts, speedMultiplier: 1, state });
  const records = (result.state.issues.at(-1)?.items ?? []).filter(item =>
    item.turn === evidence.request.cutoffTurn && !item.templateIds.includes(editionBriefTemplate.id));
  return { ...result, records, articles: result.issue?.items.filter(item => records.some(record => record.id === item.id)) ?? [] };
}

describe('national desk', () => {
  beforeAll(async () => {
    const stock = await loadEditorialConfig();
    const ids = ['capital-outgrown', 'neighbor-army-overtakes', 'technology-leader-changes', 'golden-age-in-wartime'];
    config = { ...stock,
      triggers: stock.triggers.filter(rule => ids.includes(rule.id)),
      templates: stock.templates.filter(template => template.triggers.some(id => ids.includes(id))) };
  });

  describe('population and military strength', () => {
    it.each([
      [[10, 11, 9], ['Paris', 'Tours']],
      [[10, 11, 11], ['Paris', 'Tours', 'Lyon']],
    ])('should publish the population comparison for %j', async (populations, cities) => {
      const evidence = fixture({ populations });
      const result = await check(evidence);
      expect(result.status).toBe('published');
      const items = result.articles;
      expect(items).toHaveLength(1);
      const copy = JSON.stringify(items[0]);
      for (const city of cities) expect(copy).toContain(city);
      expect(result.decision.evidence).toEqual(expect.arrayContaining(evidence.cities.slice(0, 3).map(city => city.source)));
      const next = { ...evidence, request: { ...evidence.request, previousCheckTurn: 30, cutoffTurn: 31 } };
      const repeated = await check(next, result.state);
      expect(repeated.records).toEqual([]);
    });

    it('should leave a capital tied for the largest population out of the news', async () => {
      expect((await check(fixture({ populations: [10, 10, 9] }))).records).toEqual([]);
    });

    it('should publish a measured crossing even when our measured strength is zero', async () => {
      const result = await check(fixture({ strengths: [0, 25] }));
      expect(result.status).toBe('published');
      expect(result.records).toEqual([
        expect.objectContaining({ ruleIds: ['neighbor-army-overtakes'] }),
      ]);
    });

    it('should require a known baseline and present comparison for an overtake', async () => {
      expect((await check(fixture({ strengths: [20, 25], oldStrengths: [20, 25] }))).records).toEqual([]);
      expect((await check(fixture({ strengths: [20, 25], oldStrengths: [20, undefined] }))).records).toEqual([]);
      expect((await check(fixture({ strengths: [null, 25] }))).records).toEqual([]);
    });
  });

  describe('research standings', () => {
    it.each([
      [14, false], [13, true],
    ])('should distinguish a sole lead from a tie with %i technologies', async (count, tied) => {
      const result = await check(fixture({ technologies: [13, count] }));
      expect(result.status).toBe('published');
      expect(result.records).toEqual([
        expect.objectContaining({ subject: 'player/1', ruleIds: ['technology-leader-changes'] }),
      ]);
      expect(result.decision.triggerAudit.find(rule => rule.rule === 'technology-leader-changes')?.subjects)
        .toContainEqual(expect.objectContaining({
          subject: 'player/1', outcome: 'fired',
          expressions: expect.arrayContaining([expect.objectContaining({ field: 'values.tied', value: tied })]),
        }));
    });

    it.each([14, 13])('should report our own rise to the lead with %i technologies', async count => {
      const evidence = fixture({ technologies: [count, 13], oldTechnologies: [12, 13] });
      const result = await check(evidence);
      expect(result.status).toBe('published');
      expect(result.records).toEqual([
        expect.objectContaining({ subject: 'player/0', ruleIds: ['technology-leader-changes'] }),
      ]);
      expect(result.decision.evidence).toContainEqual(evidence.players[0].source);
    });

    it('should not claim a new leader with no readable contender', async () => {
      expect((await check(fixture({ technologies: [undefined, 14] }))).records).toEqual([]);
    });
  });

  describe('wartime Golden Age', () => {
    it('should report a Golden Age beginning during a war even without a happiness reading', async () => {
      const evidence = fixture({ goldenAge: true });
      const result = await check(evidence);
      expect(result.status).toBe('published');
      expect(result.records).toEqual([
        expect.objectContaining({ ruleIds: ['golden-age-in-wartime'] }),
      ]);
      expect(result.decision.evidence).toContainEqual(evidence.events[0].source);
    });

    it('should leave a Golden Age ending or a peacetime award out of the wartime report', async () => {
      expect((await check(fixture({ goldenAge: false }))).records).toEqual([]);
      expect((await check(fixture({ goldenAge: true, atWar: false }))).records).toEqual([]);
    });
  });
});
