/**
 * Mock-tier unit tests for the World Congress text formatter.
 *
 * Targets `formatWorldCongress` in src/narrators/utils/world-congress.ts.
 * Assertions check for specific facts (status, votes, delegate ordering,
 * contender, active resolutions/proposals, voting results) rather than
 * snapshotting the whole summary string, to keep tests stable.
 */
import { describe, it, expect } from 'vitest';
import { formatWorldCongress } from '../../../src/narrators/utils/world-congress.js';

describe('world-congress', () => {
  describe('formatWorldCongress', () => {
    it('should return null when there is nothing to report', () => {
      expect(formatWorldCongress(null, [])).toBeNull();
      expect(formatWorldCongress({}, [])).toBeNull();
      expect(formatWorldCongress(undefined, [])).toBeNull();
      // A non-object diplomatic blob plus no events => still null
      expect(formatWorldCongress('not-an-object', [])).toBeNull();
    });

    it('should include status and votes needed in the header', () => {
      const result = formatWorldCongress(
        { Status: 'In Session', VotesNeeded: 12 },
        [],
      );
      expect(result).not.toBeNull();
      expect(result).toContain('In Session');
      expect(result).toContain('12 votes needed');
    });

    it('should include status alone when votes needed is absent', () => {
      const result = formatWorldCongress({ Status: 'Recess' }, []);
      expect(result).toContain('Recess');
      expect(result).not.toContain('votes needed');
    });

    it('should list delegates sorted by descending delegate count', () => {
      const result = formatWorldCongress(
        {
          Status: 'In Session',
          // Intentionally out of order to verify sorting.
          Rome: { Delegates: 3, VictoryPercentage: 25 },
          Greece: { Delegates: 8, VictoryPercentage: 66 },
          Egypt: { Delegates: 5, VictoryPercentage: 41 },
        },
        [],
      );
      expect(result).not.toBeNull();
      const delegateLine = result!
        .split('\n')
        .find((l) => l.startsWith('Delegates:'));
      expect(delegateLine).toBeDefined();
      // Each civ rendered with its delegate count and percentage.
      expect(delegateLine).toContain('Greece 8 (66%)');
      expect(delegateLine).toContain('Egypt 5 (41%)');
      expect(delegateLine).toContain('Rome 3 (25%)');
      // Descending order: Greece before Egypt before Rome.
      const idxGreece = delegateLine!.indexOf('Greece');
      const idxEgypt = delegateLine!.indexOf('Egypt');
      const idxRome = delegateLine!.indexOf('Rome');
      expect(idxGreece).toBeLessThan(idxEgypt);
      expect(idxEgypt).toBeLessThan(idxRome);
    });

    it('should ignore non-civ diplomatic keys when collecting delegates', () => {
      const result = formatWorldCongress(
        {
          Status: 'In Session',
          VotesNeeded: 10,
          Contender: 'Greece',
          ActiveResolutions: { 'World Religion': {} },
          Proposals: { 'World Ideology': {} },
          // The only real civ entry.
          Greece: { Delegates: 4, VictoryPercentage: 50 },
        },
        [],
      );
      expect(result).not.toBeNull();
      const delegateLine = result!
        .split('\n')
        .find((l) => l.startsWith('Delegates:'));
      expect(delegateLine).toBe('Delegates: Greece 4 (50%)');
      // The non-civ keys must not appear as delegate entries.
      expect(delegateLine).not.toContain('Status');
      expect(delegateLine).not.toContain('VotesNeeded');
      expect(delegateLine).not.toContain('ActiveResolutions');
      expect(delegateLine).not.toContain('Proposals');
      expect(delegateLine).not.toContain('Contender');
    });

    it('should default victory percentage to 0 when missing', () => {
      const result = formatWorldCongress(
        { Greece: { Delegates: 2 } },
        [],
      );
      expect(result).toContain('Greece 2 (0%)');
    });

    it('should skip civ-shaped entries without a numeric Delegates field', () => {
      const result = formatWorldCongress(
        {
          Status: 'In Session',
          Greece: { Delegates: 4, VictoryPercentage: 50 },
          Bogus: { VictoryPercentage: 99 },
        },
        [],
      );
      const delegateLine = result!
        .split('\n')
        .find((l) => l.startsWith('Delegates:'));
      expect(delegateLine).toContain('Greece 4 (50%)');
      expect(delegateLine).not.toContain('Bogus');
    });

    it('should include the contender when present', () => {
      const result = formatWorldCongress(
        { Status: 'In Session', Contender: 'Greece' },
        [],
      );
      expect(result).toContain('Contender: Greece');
    });

    it('should list active resolutions and proposals by name', () => {
      const result = formatWorldCongress(
        {
          Status: 'In Session',
          ActiveResolutions: { 'World Religion': {}, 'Standing Army Tax': {} },
          Proposals: { 'World Ideology': {} },
        },
        [],
      );
      expect(result).not.toBeNull();
      const activeLine = result!
        .split('\n')
        .find((l) => l.startsWith('Active:'));
      const proposalsLine = result!
        .split('\n')
        .find((l) => l.startsWith('Proposals:'));
      expect(activeLine).toContain('World Religion');
      expect(activeLine).toContain('Standing Army Tax');
      expect(proposalsLine).toContain('World Ideology');
    });

    it('should format resolution-result facts from events', () => {
      const result = formatWorldCongress(null, [
        { IsEnact: true, Passed: true, ResolutionType: 'RESOLUTION_WORLD_RELIGION' },
        { IsEnact: false, Passed: false, ResolutionType: 'RESOLUTION_STANDING_ARMY_TAX' },
      ]);
      expect(result).not.toBeNull();
      const votingLine = result!
        .split('\n')
        .find((l) => l.startsWith('Voting Results:'));
      expect(votingLine).toBeDefined();
      // Enact + passed for the first, Repeal + failed for the second.
      expect(votingLine).toContain('Enact resolution RESOLUTION_WORLD_RELIGION passed');
      expect(votingLine).toContain('Repeal resolution RESOLUTION_STANDING_ARMY_TAX failed');
    });

    it('should combine diplomatic data and resolution events', () => {
      const result = formatWorldCongress(
        {
          Status: 'In Session',
          VotesNeeded: 9,
          Contender: 'Rome',
          Rome: { Delegates: 6, VictoryPercentage: 70 },
        },
        [{ IsEnact: true, Passed: true, ResolutionType: 'RESOLUTION_CASUS_BELLI' }],
      );
      expect(result).not.toBeNull();
      const lines = result!.split('\n');
      // Header, delegates, contender, voting results all present.
      expect(lines.some((l) => l.includes('In Session') && l.includes('9 votes needed'))).toBe(true);
      expect(lines.some((l) => l.startsWith('Delegates:') && l.includes('Rome 6 (70%)'))).toBe(true);
      expect(lines.some((l) => l === 'Contender: Rome')).toBe(true);
      expect(lines.some((l) => l.startsWith('Voting Results:') && l.includes('Enact resolution RESOLUTION_CASUS_BELLI passed'))).toBe(true);
    });
  });
});
