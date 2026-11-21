import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, evidence, event, relationship, snapshot, scores } from '../../../../helpers/newspaper-diplomacy.js';
import { editionBriefTemplate, withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

/** Supply visible identities at each date, as in a replay's projected baseline. */
function withDatedVisibility(input: NewspaperEvidence, olderEvents: NewspaperEvidence['events']): NewspaperEvidence {
  const visible = input.players.map(row => ({ ...row, source: { ...row.source, turn: 0, createdAt: 0 } }));
  return { ...input, history: { fromTurn: -1, baseline: { cities: [], players: [] },
    snapshots: { cities: [], players: visible }, events: [...olderEvents, ...input.events], gaps: [] } };
}

/** Evaluate the catalogue through the same check used by replay. */
function check(config: EditorialConfig, input: NewspaperEvidence, olderEvents: NewspaperEvidence['events'] = [], briefs = 0) {
  const prepared = withEditionBriefs(withDatedVisibility(input, olderEvents), config, briefs);
  const { evidence } = prepared;
  const facts = buildNewspaperFacts(evidence, {
    playerIdentities: Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [
      id, { name, major: Number(id) < 10, teamId: Number(id) + 100 },
    ])),
  });
  return runEditorialCheck({
    campaignId: 'fixture', timelineId: 'diplomacy', receiver: { playerId: 0, label: 'France' },
    ...prepared, facts, context, speedMultiplier: 1,
    state: createInitialPublicationState(),
  });
}

describe('newspaper diplomacy trigger rules', () => {
  it('should fire a vassal story, keep the independent declaration and publish one account per incident', async () => {
    const base = await loadEditorialConfig();
    const summary = {
      id: 'war-opening', subject: 'incident', window: 'long', when: "incident.kind == 'war'",
      values: { initiator: 'incident.initiator.name' }, importance: 55,
    };
    const config = await parseEditorialConfig({
      ...base,
      triggers: [...base.triggers.filter(rule => rule.id === 'vassals-join-war'), summary],
      templates: [
        ...base.templates.filter(template => template.id === 'vassals-join-war-account'),
        {
          id: summary.id, triggers: [summary.id], tags: ['military'], weight: { base: 1 },
          variants: [{ id: 'account', headline: '{{initiator}} opens a war',
            body: ['The declaration starts a new war.'], weight: { base: 1 } }],
        },
      ],
    });
    const current = [
      event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
      event('DeclareWar', 2, 10, 0, 0, { IsAggressor: true }),
      event('DeclareWar', 3, 10, 0, 1, { IsAggressor: true }),
      event('DeclareWar', 4, 10, 0, 4, { IsAggressor: false }),
      event('DeclareWar', 5, 10, 5, 10, { IsAggressor: true }),
    ];
    const observations = [
      snapshot(0, 9, [relationship(1), relationship(3, 'peace', { vassal: 'voluntary' })]),
      snapshot(1, 9, [relationship(2, 'peace', { defensivePact: true }), relationship(4, 'peace', { vassal: 'capitulated' })]),
      snapshot(2, 9, [relationship(1, 'peace', { defensivePact: true })]),
      snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]),
      snapshot(4, 9, [relationship(1, 'peace', { master: 'capitulated' })]),
      snapshot(5, 9, [relationship(10)]),
      snapshot(2, 10, [relationship(0, 'war', { warScore: 0 })]), snapshot(3, 10, [relationship(1, 'war', { warScore: 0 })]),
    ];
    const input = evidence(current, observations, 10, 9);
    const result = await check(config, input, [event('DeclareWar', 99, 7, 5, 4, { IsAggressor: true })], 3);
    const [vassals, openings] = result.decision.triggerAudit;
    expect(vassals.subjects.map(result => result.outcome)).toEqual(['fired', 'false']);
    expect(vassals.subjects[0].expressions).toContainEqual(expect.objectContaining({
      field: 'values.vassals', value: expect.stringContaining('Iroquois'),
    }));
    expect(vassals.subjects[0].sources.filter(row => row.table === 'GameEvents').map(row => row.id))
      .toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(openings).toMatchObject({ windowFromTurn: -1, subjectCount: 2 });
    expect(openings.subjects.every(result => result.outcome === 'fired')).toBe(true);
    const selected = result.decision.candidateScores.filter(score => score.selected && !score.id.startsWith(`${editionBriefTemplate.id}/`)).map(score => score.id);
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining([
      expect.stringMatching(/^vassals-join-war-account\//),
      expect.stringMatching(/^war-opening\//),
    ]));
    expect(result.state.issues[0]?.items.flatMap(item => item.seriesKeys))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('["vassals-join-war","incident/war/10/1"]'),
        expect.stringContaining('["war-opening","incident/war/10/5"]'),
      ]));
  });

  it.each(['gap', 'hidden'] as const)('should stop the stalled-war rule when the history has a %s', async kind => {
    const config = await loadEditorialConfig();
    const input = scores(Array.from({ length: 38 }, (_, index): [number, number] => [
      index + 13, index === 0 ? 27 : 20,
    ]).filter(([turn]) => kind !== 'gap' || turn !== 45), 49);
    if (kind === 'hidden') delete input.diplomacy!.history.at(-1)!.relationships[0].warScore;
    const result = await check(config, input);
    expect(result.decision.triggerAudit.find(rule => rule.rule === 'war-advantage-stalls')?.subjects).toMatchObject([{
      subject: 'pair/0/1',
      outcome: kind === 'gap' ? 'false' : 'hidden',
    }]);
  });
});
