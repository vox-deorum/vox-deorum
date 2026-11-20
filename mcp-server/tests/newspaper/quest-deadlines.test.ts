import { describe, expect, it } from 'vitest';
import { projectReceiverQuestDeadlines } from '../../src/newspaper/quest-deadlines.js';

/** Wrap the receiver's listing with one other seat so attribution can be verified. */
function seats(receiver: string[], other: string[] = ['* Build a Wonder']): Record<string, string[]> {
  return { Player0: receiver, Player1: other, Player2: [] };
}

describe('receiver quest deadline projection', () => {
  it('should add receiver countdowns to the observation turn, sorted and deduplicated', () => {
    const deadlines = projectReceiverQuestDeadlines(seats([
      'They want you to build Pyramids. (Turns remaining: 3) Potential Quest Reward: * 44 Influence',
      '* Connect a resource 1 turn remaining',
      '* Trade route 3 turns remaining',
    ]), 0, 20);
    expect(deadlines).toEqual([21, 23]);
  });

  it('should read only the receiver seat and never another major countdown', () => {
    const deadlines = projectReceiverQuestDeadlines({
      Player0: ['* Connect a resource 3 turns remaining'],
      Player1: ['* Build a Wonder 5 turns remaining'],
      Player2: ['* Denounce a City-State'],
    }, 0, 20);
    expect(deadlines).toEqual([23]);
  });

  it('should accept a raw tooltip string separated by newline markers', () => {
    const deadlines = projectReceiverQuestDeadlines({
      Player0: 'Global Quests:[NEWLINE]* Build a Wonder[NEWLINE]Personal Quests:[NEWLINE]* Connect a resource 2 turns remaining',
      Player1: ['* Denounce a City-State'],
    }, 0, 20);
    expect(deadlines).toEqual([22]);
  });

  it('should reject the identical broadcast tooltip recorded under every seat', () => {
    const broadcast = ['* Build a Wonder 3 turns remaining'];
    expect(projectReceiverQuestDeadlines({
      Player0: broadcast, Player1: broadcast, Player2: broadcast,
    }, 0, 20)).toBeUndefined();
  });

  it('should allow shared quest text when the full listings prove separate seat observations', () => {
    const noQuests = ['There are currently no quests this city-state has given to you.'];
    expect(projectReceiverQuestDeadlines({
      Player0: ['* Build a Wonder 3 turns remaining', '* Denounce a City-State'],
      Player1: ['* Denounce a City-State', '* Connect a resource'],
      Player2: noQuests, Player3: noQuests,
    }, 0, 20)).toEqual([23]);
  });

  it('should require at least two valid numbered seat listings', () => {
    const onlyReceiver = { Player0: ['* Build a Wonder 3 turns remaining'] };
    expect(projectReceiverQuestDeadlines(onlyReceiver, 0, 20)).toBeUndefined();
    expect(projectReceiverQuestDeadlines({
      Player0: ['* Build a Wonder 3 turns remaining'], Player1: 3,
    }, 0, 20)).toBeUndefined();
    expect(projectReceiverQuestDeadlines({
      Player0: ['* Build a Wonder 3 turns remaining'], CityState2: ['* Connect a resource'],
    }, 0, 20)).toBeUndefined();
  });

  it('should require the receiver seat to be present', () => {
    expect(projectReceiverQuestDeadlines({
      Player1: ['* Build a Wonder 3 turns remaining'], Player2: ['* Connect a resource'],
    }, 0, 20)).toBeUndefined();
  });

  it('should return an empty list only for an explicitly empty receiver listing', () => {
    expect(projectReceiverQuestDeadlines(seats([]), 0, 20)).toEqual([]);
    expect(projectReceiverQuestDeadlines(seats(['There are currently no quests this city-state has given to you. They may refrain if you have bullied them recently.']), 0, 20)).toEqual([]);
    expect(projectReceiverQuestDeadlines({
      Player0: '  ', Player1: ['* Build a Wonder'],
    }, 0, 20)).toEqual([]);
  });

  it('should ignore unsupported countdown wording and unusable values', () => {
    const deadlines = projectReceiverQuestDeadlines(seats([
      '* Build a Wonder 3 turns left',
      '* Establish an embassy: Estimated in 3 turns',
      '* Connect a resource 3 turn remaining',
      '* Denounce a City-State 1 turns remaining',
      '* Trade route 0 turns remaining',
      '* Construct a building 10000 turns remaining',
      '* Research a technology soon',
    ]), 0, 20);
    expect(deadlines).toBeUndefined();
  });

  it('should keep the same absolute deadline as the recorded countdown ticks down', () => {
    const earlier = projectReceiverQuestDeadlines(seats(['* Connect a resource 3 turns remaining']), 0, 20);
    const later = projectReceiverQuestDeadlines(seats(['* Connect a resource 2 turns remaining']), 0, 21);
    expect(earlier).toEqual([23]);
    expect(later).toEqual([23]);
  });

  it('should reject unreadable input and invalid observation turns', () => {
    expect(projectReceiverQuestDeadlines(null, 0, 20)).toBeUndefined();
    expect(projectReceiverQuestDeadlines([], 0, 20)).toBeUndefined();
    expect(projectReceiverQuestDeadlines(undefined, 0, 20)).toBeUndefined();
    expect(projectReceiverQuestDeadlines(seats(['* Connect a resource 3 turns remaining']), 0, -1)).toBeUndefined();
  });
});
