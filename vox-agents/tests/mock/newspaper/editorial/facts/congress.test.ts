import { describe, expect, it } from 'vitest';
import type {
  NewspaperCongressObservation, NewspaperEvent, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference, type FactObject } from '../../../../../src/newspaper/editorial/facts/model.js';

/** Record one public Congress observation at its source turn. */
function observation(
  turn: number,
  sourceID: number,
  fields: Partial<NewspaperCongressObservation> = {},
): NewspaperCongressObservation {
  return {
    source: { table: 'VictoryProgress', id: sourceID, turn, createdAt: turn * 10 + sourceID },
    available: true,
    votingNow: false,
    expectedSessionTurn: turn + 3,
    diplomaticVictoryVotesNeeded: 10,
    proposals: [],
    activeResolutions: [],
    ...fields,
  };
}

/** Record a visible player observation at a contact date. */
function player(id: number, turn = 0): NewspaperSnapshot {
  return {
    subjectID: id,
    source: { table: 'PlayerSummaries', id: id + 100, turn, createdAt: turn * 10 + 1 },
    values: {},
  };
}

/** Record one public resolution outcome after the reporting period. */
function resolution(id: number, values: NewspaperEvent['values']): NewspaperEvent {
  return { source: { table: 'GameEvents', id, turn: 19, createdAt: 191 }, type: 'ResolutionResult', values };
}

/** Build an evidence window with no history, cities or events. */
function evidence(congress?: NewspaperEvidence['congress']): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 17, cutoffTurn: 20 },
    players: [],
    cities: [],
    comparisons: { players: [], cities: [] },
    events: [],
    ...(congress ? { congress } : {}),
  };
}

/** Make known players visible at their event dates as well as the cutoff. */
function eventEvidence(events: NewspaperEvent[], players: NewspaperSnapshot[]): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 18, cutoffTurn: 20, historyFromTurn: 0 },
    players,
    cities: [],
    comparisons: { players: [], cities: [] },
    events,
    history: {
      fromTurn: 0,
      baseline: { players: [], cities: [] },
      snapshots: { players, cities: [] },
      gaps: [],
      events,
    },
  };
}

/** Read the built game.congress object, if the evidence produced one. */
function congressFields(input: NewspaperEvidence): FactObject | undefined {
  return buildNewspaperFacts(input).game.congress?.value as FactObject | undefined;
}

/** Read the proposal facts in newProposals. */
function newProposals(fields: FactObject): FactObject[] {
  return fields.newProposals!.value as FactObject[];
}

describe('newspaper congress facts', () => {
  describe('agenda observations', () => {
    it('should read the newest observation and report proposals first seen in the window', () => {
      const baseline = observation(17, 701, {
        league: 'World Congress',
        proposals: [{ name: 'Arts Funding', isEnact: true }],
      });
      const earlier = observation(19, 702, {
        proposals: [
          { name: 'Arts Funding', isEnact: true },
          { name: 'World Religion', isEnact: true, proposer: 'Hiawatha', description: 'Choose a religion' },
        ],
        activeResolutions: [{ name: 'Open Borders', enactedTurn: 12 }],
      });
      const latest = observation(20, 703, {
        league: 'United Nations',
        votingNow: true,
        expectedSessionTurn: 20,
        diplomaticVictoryVotesNeeded: 12,
        proposals: [
          { name: 'World Religion', isEnact: true, proposer: 'Hiawatha' },
          { name: 'Open Borders', isEnact: false },
        ],
        activeResolutions: [{ name: 'Open Borders', enactedTurn: 12, description: 'Open borders' }],
      });
      const fields = congressFields(evidence({ baseline, observations: [latest, earlier] }))!;

      expect(fields.available).toEqual({ value: true, sources: [latest.source] });
      expect(fields.observedTurn).toEqual({ value: 20, sources: [latest.source] });
      expect(fields.league).toEqual({ value: 'United Nations', sources: [latest.source] });
      expect(fields.votingNow).toEqual({ value: true, sources: [latest.source] });
      expect(fields.expectedSessionTurn).toEqual({ value: 20, sources: [latest.source] });
      expect(fields.diplomaticVictoryVotesNeeded).toEqual({ value: 12, sources: [latest.source] });

      const current = fields.proposals!.value as FactObject[];
      expect(current.map(proposal => proposal.name!.value)).toEqual(['World Religion', 'Open Borders']);
      expect(current.map(proposal => proposal.isEnact!.value)).toEqual([true, false]);
      const resolutions = fields.activeResolutions!.value as FactObject[];
      expect(resolutions.map(item => item.name!.value)).toEqual(['Open Borders']);
      expect(resolutions[0]!.enactedTurn).toEqual({ value: 12, sources: [latest.source] });

      const fresh = newProposals(fields);
      expect(fresh.map(proposal => proposal.name!.value)).toEqual(['World Religion', 'Open Borders']);
      expect(fresh.map(proposal => proposal.observedTurn!.value)).toEqual([19, 20]);
      expect(fresh[0]!.proposer).toEqual({ value: 'Hiawatha', sources: [baseline.source, earlier.source] });
      expect(fresh[0]!.description).toEqual({ value: 'Choose a religion', sources: [baseline.source, earlier.source] });
      expect(fresh[1]!.name.sources).toEqual([earlier.source, latest.source]);
      expect(fields.newProposals!.sources).toEqual([baseline.source, earlier.source, latest.source]);
    });

    it('should not claim voting from an observation before the cutoff', () => {
      const stale = observation(18, 710, { votingNow: true, expectedSessionTurn: 18 });
      const fields = congressFields(evidence({ observations: [stale] }))!;

      expect(fields.votingNow).toEqual({ value: false, sources: [stale.source] });
      expect(fields.observedTurn).toEqual({ value: 18, sources: [stale.source] });
    });

    it('should omit an expected session turn the cutoff has passed', () => {
      const passed = observation(18, 711, { expectedSessionTurn: 18 });
      const upcoming = observation(18, 712, { expectedSessionTurn: 20 });

      expect(congressFields(evidence({ observations: [passed] }))).not.toHaveProperty('expectedSessionTurn');
      expect(congressFields(evidence({ observations: [upcoming] }))!.expectedSessionTurn)
        .toEqual({ value: 20, sources: [upcoming.source] });
    });

    it('should treat the first observed agenda as new when no baseline exists', () => {
      const first = observation(19, 720, { proposals: [{ name: 'World Religion', isEnact: true }] });
      const fields = congressFields(evidence({ observations: [first] }))!;
      const fresh = newProposals(fields);

      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.observedTurn).toEqual({ value: 19, sources: [first.source] });
      expect(fields.newProposals!.sources).toEqual([first.source]);
    });

    it('should compare proposals across gaps and never infer withdrawal', () => {
      const baseline = observation(16, 730, { proposals: [{ name: 'Arts Funding', isEnact: true }] });
      const middle = observation(18, 731, {
        proposals: [
          { name: 'Arts Funding', isEnact: true },
          { name: 'World Religion', isEnact: true },
        ],
      });
      const locked = observation(19, 732, { available: false, expectedSessionTurn: 19 });
      const latest = observation(20, 733, {
        proposals: [{ name: 'Open Borders', isEnact: false }],
        activeResolutions: [{ name: 'Arts Funding' }],
      });
      const input = evidence({ baseline, observations: [latest, locked, middle] });
      const fields = congressFields(input)!;
      const fresh = newProposals(fields);

      expect(fresh.map(proposal => proposal.name!.value)).toEqual(['World Religion', 'Open Borders']);
      expect(fresh[0]!.observedTurn).toEqual({ value: 18, sources: [baseline.source, middle.source] });
      expect(fresh[1]!.observedTurn).toEqual({ value: 20, sources: [locked.source, latest.source] });
      expect((fields.proposals!.value as FactObject[]).map(proposal => proposal.name!.value))
        .toEqual(['Open Borders']);
    });

    it('should read an unavailable observation as a known empty agenda', () => {
      const baseline = observation(17, 740, {
        league: 'World Congress',
        proposals: [{ name: 'Arts Funding', isEnact: true }],
      });
      const locked = observation(19, 741, { available: false, expectedSessionTurn: 19 });
      const fields = congressFields(evidence({ baseline, observations: [locked] }))!;

      expect(fields.available).toEqual({ value: false, sources: [locked.source] });
      expect(fields.observedTurn).toEqual({ value: 19, sources: [locked.source] });
      expect(fields.votingNow).toEqual({ value: false, sources: [locked.source] });
      expect(fields.proposals).toEqual({ value: [], sources: [locked.source] });
      expect(fields.activeResolutions).toEqual({ value: [], sources: [locked.source] });
      expect(fields.newProposals).toEqual({ value: [], sources: [locked.source] });
      expect(fields).not.toHaveProperty('league');
      expect(fields).not.toHaveProperty('expectedSessionTurn');
      expect(fields).not.toHaveProperty('diplomaticVictoryVotesNeeded');
    });

    it('should make a proposal new again after an unavailable agenda', () => {
      const baseline = observation(17, 750, { proposals: [{ name: 'Arts Funding', isEnact: true }] });
      const locked = observation(18, 751, { available: false, expectedSessionTurn: 18 });
      const returned = observation(19, 752, {
        proposals: [
          { name: 'Arts Funding', isEnact: true },
          { name: 'World Religion', isEnact: true },
        ],
      });
      const fresh = newProposals(congressFields(evidence({ baseline, observations: [returned, locked] }))!);

      expect(fresh.map(proposal => proposal.name!.value)).toEqual(['Arts Funding', 'World Religion']);
      expect(fresh.map(proposal => proposal.name.sources)).toEqual([
        [locked.source, returned.source],
        [locked.source, returned.source],
      ]);
    });

    it('should omit congress facts when the evidence has no observations', () => {
      expect(buildNewspaperFacts(evidence()).game).not.toHaveProperty('congress');
      expect(buildNewspaperFacts(evidence({ observations: [] })).game).not.toHaveProperty('congress');
    });
  });

  describe('resolution outcomes', () => {
    it('should keep a failed enactment and link the proposer through ordinary contact', () => {
      const proposer = player(1, 1);
      const outcome = resolution(900, {
        IsEnact: true, Passed: false, ResolutionType: 5, ProposerPlayerID: 1, Decision: 2,
        ProposerName: 'Civ1',
      });
      const fields = buildNewspaperFacts(eventEvidence([outcome], [player(0, 1), proposer])).events[0]!.fields;

      expect(fields.isEnact).toEqual({ value: true, sources: [outcome.source] });
      expect(fields.passed).toEqual({ value: false, sources: [outcome.source] });
      expect(fields.resolutionType).toEqual({ value: 5, sources: [outcome.source] });
      expect(fields.decision).toEqual({ value: 2, sources: [outcome.source] });
      expect(fields.proposerPlayerId).toEqual({ value: 1, sources: [outcome.source] });
      expect(fields.proposerName).toEqual({ value: 'Civ1', sources: [outcome.source] });
      expect(fields.proposerPlayer).toEqual({
        value: reference('player', 1), sources: [outcome.source, proposer.source],
      });
      expect(fields.player).toEqual(fields.proposerPlayer);
    });

    it('should normalize recorded yes-or-no values and leave an unknown proposer unlinked', () => {
      const known = resolution(901, { IsEnact: 0, Passed: 1, ProposerPlayerID: 0 });
      const unknown = resolution(902, { IsEnact: 1, Passed: 0, ProposerPlayerID: 9 });
      const model = buildNewspaperFacts(eventEvidence([known, unknown], [player(0, 1)]));

      expect(model.events[0]!.fields).toMatchObject({
        isEnact: { value: false },
        passed: { value: true },
        player: { value: reference('player', 0) },
      });
      expect(model.events[1]!.fields).toMatchObject({
        isEnact: { value: true },
        passed: { value: false },
        proposerPlayerId: { value: 9 },
      });
      expect(model.events[1]!.fields).not.toHaveProperty('player');
    });
  });
});
