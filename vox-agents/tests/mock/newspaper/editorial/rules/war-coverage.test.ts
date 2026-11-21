import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { IssueItem } from '../../../../../src/newspaper/contracts/issue.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, evidence, event, relationship, snapshot } from '../../../../helpers/newspaper-diplomacy.js';
import { editionBriefTemplate, withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

interface Attack { player: number; ally?: number; turn?: number }
interface WarFixture { active?: number[]; ongoing?: number[]; defensiveAlly?: number; vassal?: number; hiddenNames?: number[] }

let stock: EditorialConfig;
beforeAll(async () => { stock = await loadEditorialConfig(); });

/** Reproduce the visible summaries and native calls for declarations and their joining city-states. */
function declarations(attacks: Attack[], options: WarFixture): NewspaperEvidence {
  const { active, ongoing = [], defensiveAlly, vassal } = options;
  const calls: NewspaperEvidence['events'] = [];
  const history = [snapshot(0, 8, [
    ...attacks.map(({ player }) => relationship(player)),
    ...ongoing.map(player => relationship(player, 'war')),
  ])];
  for (const { player, ally, turn = 10 } of attacks) {
    calls.push(event('DeclareWar', calls.length + 1, turn, player, 0, { IsAggressor: true }));
    if (ally !== undefined) {
      history.push(snapshot(ally, turn - 1, [relationship(0)], { majorAllyPlayerID: player }));
      calls.push(event('DeclareWar', calls.length + 1, turn, ally, 0, { IsAggressor: false }));
    }
    if (player === attacks[0].player && defensiveAlly !== undefined) {
      history.push(snapshot(defensiveAlly, turn - 1, [relationship(player)], { majorAllyPlayerID: 0 }));
      calls.push(event('DeclareWar', calls.length + 1, turn, defensiveAlly, player, { IsAggressor: false }));
    }
    if (player === attacks[0].player && vassal !== undefined) {
      history.push(snapshot(player, turn - 1, [relationship(vassal, 'peace', { vassal: 'voluntary' })]));
      calls.push(event('DeclareWar', calls.length + 1, turn, vassal, 0, { IsAggressor: false }));
    }
  }
  if (active) history.push(snapshot(0, 10, active.map(player => relationship(player, 'war'))));
  const input = evidence(calls, history, 10, 8);
  const visible = input.players.map(row => ({ ...row, source: { ...row.source, turn: 0, createdAt: 0 } }));
  const summaries = history.map(({ subjectID, source }) => ({ subjectID, source, values: {} }));
  input.players = input.players.map(row => summaries.find(item =>
    item.subjectID === row.subjectID && item.source.turn === 10) ?? row);
  input.history = { fromTurn: -1, baseline: { cities: [], players: [] },
    snapshots: { cities: [], players: [...visible, ...summaries] }, events: calls, gaps: [] };
  return input;
}

/** Run the stock war catalogue through the same editorial check as replay. */
function check(attacks: Attack[], options: WarFixture = {}, catalogue = stock, briefs = 4) {
  const { evidence, config } = withEditionBriefs(declarations(attacks, options), catalogue, briefs);
  const facts = buildNewspaperFacts(evidence, {
    playerIdentities: Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [id, {
      name: options.hiddenNames?.includes(Number(id)) ? undefined : name,
      major: Number(id) < 10, teamId: Number(id) + 100,
    }])),
  });
  return runEditorialCheck({
    campaignId: 'fixture', timelineId: 'war-coverage', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config, context, speedMultiplier: 1, state: createInitialPublicationState(),
  });
}

/** Read the text on the page rather than pinning a variant's phrasing. */
function articleText(item: IssueItem): string {
  return [item.headline, item.subheadline ?? [], ...item.body].flat().map(node => node.text).join(' ');
}

describe('newspaper declaration coverage', () => {
  it('leads a full breaking front with one story that covers five declarations', async () => {
    const result = await check([{ player: 1, ally: 10 }, { player: 2, ally: 11 }, { player: 3 }, { player: 4 }, { player: 5 }]);
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    expect(result.issue.items).toHaveLength(5);
    const front = result.issue.pages[0];
    expect(front.layout).toBe('breaking');
    expect(front.itemIds).toHaveLength(5);
    const article = result.issue.items.find(item => item.id === front.itemIds[0])!;
    for (const name of ['Brazil', 'India', 'Iroquois', 'Byzantium', 'Zulu', 'Geneva', 'Sidon'])
      expect(articleText(article)).toContain(name);
    const covered = result.decision.candidateScores.filter(candidate => candidate.mergedInto);
    expect(covered).toHaveLength(5);
    expect(new Set(covered.map(candidate => candidate.mergedInto)).size).toBe(1);
    const record = result.state.issues[0].items.find(item => item.id === article.id)!;
    expect(record.ruleIds).toContain('incoming-war-wave');
    expect(record.sources.filter(row => row.table === 'GameEvents').map(row => row.id))
      .toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]));
  });

  it('still waits when only three declaration stories are ready', async () => {
    const result = await check([{ player: 1 }, { player: 2 }, { player: 3 }], {}, stock, 0);
    expect(result.status).toBe('skipped');
    expect(result.state.issues).toHaveLength(0);
  });

  it('prints two separate reports with their own allies and excludes defensive and unnamed allies from the copy', async () => {
    const result = await check([{ player: 1, ally: 10 }, { player: 2, ally: 11 }],
      { defensiveAlly: 12, hiddenNames: [11] }, stock, 3);
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    const stories = result.issue.items.filter(item => result.decision.selectedVariants[item.id] !== editionBriefTemplate.variants[0].id).map(articleText);
    expect(stories).toHaveLength(2);
    expect(stories.find(story => story.includes('Brazil'))).toContain('Geneva');
    expect(stories.find(story => story.includes('India'))).not.toContain('Geneva');
    expect(stories.join(' ')).not.toMatch(/Riga|Sidon/);
  });

  it('uses the fronts lead for two new wars and an existing enemy', async () => {
    const result = await check([{ player: 1, ally: 10 }, { player: 2, ally: 11 }],
      { active: [1, 2, 4], ongoing: [4] });
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    const lead = result.issue.pages[0].itemIds[0];
    const record = result.state.issues[0].items.find(item => item.id === lead)!;
    expect(record.ruleIds).toContain('war-on-three-fronts');
    expect(record.ruleIds).toContain('war-involving-us');
    const article = result.issue.items.find(item => item.id === lead)!;
    expect(article.body.some(paragraph => {
      const text = paragraph.map(node => node.text).join('');
      return text.includes('Brazil') && text.includes('India') && !text.includes('Byzantium');
    })).toBe(true);
    expect(articleText(article)).toMatch(/Byzantium/);
    expect(articleText(article)).toContain('Geneva');
    expect(articleText(article)).toContain('Sidon');
    expect(result.issue.pages[0].layout).toBe('breaking');
  });

  it('uses the attack incident when a vassal account wins a story slot', async () => {
    const config = await parseEditorialConfig({ ...stock, templates: stock.templates.map(template =>
      template.id === 'vassals-join-war-account' ? { ...template, weight: { base: 50 } } : template) });
    const result = await check([{ player: 1, ally: 10 }, { player: 2 }, { player: 3 }], { vassal: 5 }, config);
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    const lead = result.issue.items.find(item => item.id === result.issue.pages[0].itemIds[0])!;
    expect(articleText(lead)).toContain('Geneva');
    expect(result.decision.candidateScores.some(candidate =>
      candidate.id.startsWith('vassals-join-war-account/') && candidate.mergedInto)).toBe(true);
  });

  it('keeps declarations on different turns and independent city-state attacks separate', async () => {
    const result = await check([{ player: 1, turn: 9 }, { player: 2 }, { player: 3 }, { player: 10 }], {}, stock, 1);
    expect(result.status).toBe('published');
    if (result.status !== 'published') return;
    expect(result.issue.items.filter(item => result.decision.selectedVariants[item.id] !== editionBriefTemplate.variants[0].id)).toHaveLength(4);
    expect(result.decision.candidateScores.some(candidate => candidate.mergedInto)).toBe(false);
  });
});
