import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { DiplomacyIncidentFact, DiplomacyPairObservation } from '../../../../../src/newspaper/contracts/diplomacy.js';
import { addDiplomacyFacts, buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference } from '../../../../../src/newspaper/editorial/facts/model.js';
import { compileEditorialExpressions } from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Make a public player row at the date that established contact. */
function player(subjectID: number, turn: number): NewspaperSnapshot {
  return {
    subjectID,
    source: { table: 'PlayerSummaries', id: turn * 10 + subjectID, turn, createdAt: turn },
    values: {},
  };
}

const self = player(2, 10);
const rival = player(1, 10);
const vassal = player(3, 17);
const cityState = player(4, 18);
const knownLater = player(5, 20);
const diplomaticCall = { table: 'GameEvents', id: 91, turn: 18, createdAt: 18 } as const;
const playerIdentities = {
  1: { name: 'Rome', major: true }, 2: { name: 'Carthage', major: true },
  3: { name: 'Greece', major: true }, 4: { name: 'Geneva', major: false }, 5: { name: 'Late Contact', major: true },
};

/** Only include nations available at their dated observation. */
function baseEvidence(): NewspaperEvidence {
  return {
    request: { cutoffTurn: 20, previousCheckTurn: 17, receiverPlayerID: 2 },
    players: [self, rival, vassal, cityState, knownLater],
    cities: [], events: [], comparisons: { players: [], cities: [] },
    history: {
      fromTurn: 10, baseline: { players: [self, rival], cities: [] },
      snapshots: { players: [vassal, cityState, knownLater], cities: [] },
      events: [], gaps: [],
    },
  };
}

/** Use distinctly dated directional score rows to test transport and citation behavior. */
function war(turn: number, warScore?: number): DiplomacyPairObservation {
  return { turn, state: 'war', since: 10, peaceAnchored: false, warScore, sources: [player(2, turn).source] };
}

/** Build an existing inferred pair with optional incidents for public expression evaluation. */
function facts(observations: DiplomacyPairObservation[], incidents: DiplomacyIncidentFact[] = []) {
  const latest = observations.at(-1)!;
  return addDiplomacyFacts(buildNewspaperFacts(baseEvidence(), { playerIdentities }), {
    audit: [],
    memory: { pairs: { '1/2': {
      players: [1, 2], perspective: 2, state: latest.state, since: latest.since,
      lastObserved: latest.turn, peaceAnchored: latest.peaceAnchored, observations, foughtBefore: true,
    } } },
    incidents,
  });
}

/** Exercise the real sandbox so dates, shortcuts, hidden reads and citations cross the wire. */
async function check(
  model: ReturnType<typeof facts>,
  expressions: string[],
  subject: 'pair' | 'incident' = 'pair',
  id = '1/2',
) {
  const runner = await compileEditorialExpressions(expressions.map(source => ({
    rule: 'diplomacy', field: 'when', source,
  })), {
    shortcuts: {
      pair: { active: 'pair.atWar && pair.majors' },
      player: { rival: '!player.self && player.major' },
    },
  });
  const [[results]] = await runner.evaluate({
    facts: model,
    groups: [{
      windowFromTurn: 14, expressions: expressions.map((_, index) => index),
      subjects: [{ [subject]: reference(subject, id) }],
    }],
  });
  return results;
}

describe('newspaper diplomacy facts', () => {
  it('should keep the pair perspective and cite distinct dated observations', async () => {
    const observations = [war(14, 11), war(17, 24), war(18, 27), war(19, 29), war(20, 30)];
    const [sides, dates, history, held, duration] = await check(facts(observations), [
      'pair.a.name === "Rome" && pair.b.self && pair.other === pair.a && pair.involvesSelf && pair.is.active',
      '[pair.before.warScore, pair.previous.warScore, pair.at(1).warScore, pair.warScore].join(",")',
      'pair.history.map(s => s.warScore).join(",")',
      'held(pair, s => s.warScore >= 25, 2)',
      'pair.at(5).warTurns',
    ]);
    expect(sides).toHaveProperty('value', true);
    expect(dates).toEqual({
      value: '11,24,29,30', sources: [14, 17, 19, 20].map(turn => player(2, turn).source),
    });
    expect(history).toHaveProperty('value', '24,27,29,30');
    expect(held).toEqual({ value: true, sources: [18, 19, 20].map(turn => player(2, turn).source) });
    expect(duration).toHaveProperty('value', 5);
  });

  it('should reject implicit and explicit gaps and keep a missing score hidden', async () => {
    const noReport = [war(18, 26), war(20, 29)];
    const ambiguous = { ...war(19), state: 'unknown' as const };
    const [absent] = await check(facts(noReport), ['held(pair, s => s.warScore >= 25, 2)']);
    const [gap, historical] = await check(facts([noReport[0], ambiguous, noReport[1]]), [
      'held(pair, s => s.atWar, 2)', 'pair.at(1).warScore',
    ]);
    const [known, hidden] = await check(facts([war(20)]), ['pair.knows("warScore")', 'pair.warScore']);
    expect(absent).toHaveProperty('value', false);
    expect(gap).toEqual({ value: false, sources: [...ambiguous.sources, ...noReport[1].sources] });
    expect(historical).toHaveProperty('error.hidden', 'pair.at');
    expect(known).toEqual({ value: false });
    expect(hidden).toHaveProperty('error.hidden', 'pair.warScore');
  });

  it('should carry a cited final wartime score into peace and reset the trend', async () => {
    const finalWar = war(17, 29);
    const peace: DiplomacyPairObservation = {
      turn: 18, state: 'peace', since: 18, peaceAnchored: true, sources: [diplomaticCall],
      lastWarScore: { turn: finalWar.turn, score: 29, source: finalWar.sources[0] },
    };
    const [state, final, old, previous] = await check(facts([finalWar, peace]), [
      '!pair.atWar && pair.warTurns === 0 && pair.peaceTurns === 2 && !pair.knows("warScore")',
      'pair.lastWarScore', 'pair.history.some(s => s.knows("warScore"))',
      'pair.previous.atWar && pair.previous.warTurns === 7 && !pair.previous.knows("warScore")',
    ]);
    expect(state).toHaveProperty('value', true);
    expect(final).toEqual({ value: 29, sources: [finalWar.sources[0], diplomaticCall] });
    expect(old).toHaveProperty('value', false);
    expect(previous).toHaveProperty('value', true);
    const briefPeace = { ...diplomaticCall, turn: 19, createdAt: 19 };
    const [interrupted] = await check(facts([war(18, 29), {
      ...peace, turn: 19, since: 19, sources: [briefPeace],
    }, { ...war(20, 35), since: 20 }]), [
      'held(pair, s => s.atWar, 2)',
    ]);
    expect(interrupted).toEqual({ value: false, sources: [briefPeace, player(2, 20).source] });
    const [initial] = await check(facts([{ ...peace, peaceAnchored: false, lastWarScore: undefined }]), [
      '!pair.knows("peaceTurns") && !pair.knows("lastWarScore")',
    ]);
    expect(initial).toHaveProperty('value', true);
  });

  it('should expose incident links and causes only for dated visible actors in the reporting period', async () => {
    const incident: DiplomacyIncidentFact = {
      id: 'call/91', kind: 'war', turn: 18, root: [1, 2], role: 'target', reason: 'root',
      participants: [
        { id: 3, side: 'target', reason: 'vassal' },
        { id: 5, side: 'initiator', reason: 'pact' },
      ],
      cityStates: [4],
      resumed: true, observed: false, partial: false, capitulation: false, concessions: [],
      sources: [diplomaticCall], pair: war(18, -35),
    };
    const model = facts([war(18, -35), war(20, 15)], [{ ...incident, id: 'old', turn: 17 }, incident]);
    expect(model.subjects.incident).toEqual([incident.id]);
    const [actors, names, score, internals, shortcut] = await check(model, [
      'incident.initiator.is.rival && incident.target.self && incident.resumed && incident.reason === "root"',
      '[...incident.participants.map(p => p.player.name + ":" + p.side + ":" + p.reason), ...incident.cityStates.map(p => p.name)].join(",")',
      'incident.pair.warScore',
      'incident.knows("sources") || incident.knows("root") || incident.pair.knows("perspective")',
      'incident.pair.is.active && !incident.pair.knows("history")',
    ], 'incident', incident.id);
    expect(actors).toMatchObject({ value: true, sources: expect.arrayContaining([diplomaticCall, rival.source, self.source]) });
    expect(names).toMatchObject({ value: 'Greece:target:vassal,Geneva', sources: expect.arrayContaining([diplomaticCall]) });
    expect(score).toEqual({ value: -35, sources: [diplomaticCall, player(2, 18).source] });
    expect(internals).toHaveProperty('value', false);
    expect(shortcut).toHaveProperty('value', true);

    const observed = {
      ...incident, id: 'observed/1/2/18', rootRolesUnknown: true as const, observed: true,
      role: undefined, reason: undefined,
    };
    const [unseenOpening] = await check(facts([war(18, -35)], [observed]), [
      'incident.observed && !incident.knows("initiator") && !incident.knows("target") && !incident.knows("role") && incident.pair.involvesSelf',
    ], 'incident', observed.id);
    expect(unseenOpening).toHaveProperty('value', true);

    const neutral: DiplomacyIncidentFact = { ...observed, id: 'observed/1/3/18', root: [1, 3], role: 'none' };
    const [foreignOpening] = await check(facts([war(18, -35)], [neutral]), [
      'incident.observed && incident.role === "none" && !incident.pair.involvesSelf',
    ], 'incident', neutral.id);
    expect(foreignOpening).toHaveProperty('value', true);
  });
});
