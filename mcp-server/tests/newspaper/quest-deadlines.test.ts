import { describe, expect, it } from 'vitest';
import { projectReceiverQuestDeadlines, projectReceiverQuests } from '../../src/newspaper/quest-deadlines.js';

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

describe('receiver quest terms projection', () => {
  it('should read the objective and reward from a marked-up tooltip', () => {
    const raw = '[COLOR_POSITIVE_TEXT]Personal Quests:[ENDCOLOR][NEWLINE]' +
      'They want you to connect [ICON_RES_PORCELAIN] Porcelain to your trade network.[NEWLINE]' +
      '(Turns remaining: 51)[NEWLINE]Potential Quest Reward:[NEWLINE]' +
      '[ICON_BULLET] 27 [ICON_INFLUENCE] Influence[NEWLINE][ICON_BULLET] 114 [ICON_GOLD] Gold';
    expect(projectReceiverQuests({ Player0: raw, Player1: [] }, 0, 20)).toEqual({
      deadlines: [71],
      terms: [{ deadline: 71, type: 'Connect a resource', condition: 'Connect Porcelain to your trade network.', reward: '27 Influence, 114 Gold' }],
    });
  });

  it('should keep two objectives that share a deadline without moving a later reward to an earlier quest', () => {
    const quests = seats([
      'Protect them from a barbarian horde! If there are barbarians next to the city when the quest ends, the city will be sacked! (Turns remaining: 21) ' +
      'They want you to build Temple of Artemis. (Turns remaining: 51) Potential Quest Reward: * 36 Influence * 63 Faith ' +
      'They want you to connect Porcelain to your trade network. (Turns remaining: 51) Potential Quest Reward: * 27 Influence * 114 Gold',
    ]);
    expect(projectReceiverQuests(quests, 0, 20)).toEqual({
      deadlines: [41, 71],
      terms: [
        { deadline: 41, type: 'Protect the city-state', condition: 'Keep barbarians away from the city when the quest ends.' },
        { deadline: 71, type: 'Build a wonder', condition: 'Build Temple of Artemis.', reward: '36 Influence, 63 Faith' },
        { deadline: 71, type: 'Connect a resource', condition: 'Connect Porcelain to your trade network.', reward: '27 Influence, 114 Gold' },
      ],
    });
  });

  it('should keep deadlines while leaving out private targets and ambiguous reward text', () => {
    const quests = seats([
      'They want you to build Secret Project. (Turns remaining: 3) Potential Quest Reward: * 44 Influence',
      'They want you to build Pyramids. (Turns remaining: 5) Potential Quest Reward: * 42 Influence from the secret treaty',
      'They want you to connect Cotton to your trade network. (Turns remaining: 7) Another quest Potential Quest Reward: * 20 Gold',
    ]);
    expect(projectReceiverQuests(quests, 0, 20)).toEqual({
      deadlines: [23, 25, 27],
      terms: [
        { deadline: 25, type: 'Build a wonder', condition: 'Build Pyramids.' },
        { deadline: 27, type: 'Connect a resource', condition: 'Connect Cotton to your trade network.' },
      ],
    });
  });

  it('should recognize trade routes, diplomatic missions, Great People, and national wonders without copying other targets', () => {
    const quests = seats([
      'They want you to start a land or sea trade route to their city. (Turns remaining: 1)',
      'Diplomatic Missions are temporarily more effective. (Turns remaining: 2)',
      'They want you to generate a Great Merchant. (Turns remaining: 3)',
      'They want you to build the Grand Temple. (Turns remaining: 4)',
      "They want you to build the Scrivener's Office. (Turns remaining: 5)",
      'They want you to generate a Great Double Agent. (Turns remaining: 6)',
    ]);
    expect(projectReceiverQuests(quests, 0, 20)).toEqual({
      deadlines: [21, 22, 23, 24, 25, 26],
      terms: [
        { deadline: 21, type: 'Establish a trade route', condition: 'Start a land or sea trade route to the city-state.' },
        { deadline: 22, type: 'Diplomatic mission bonus', condition: 'Use diplomatic missions while they are more effective.' },
        { deadline: 23, type: 'Generate a Great Person', condition: 'Generate a Great Merchant.' },
        { deadline: 24, type: 'Build a national wonder', condition: 'Build the Grand Temple.' },
        { deadline: 25, type: 'Build a national wonder', condition: "Build the Scrivener's Office." },
      ],
    });
  });

  it('should preserve localized reward amounts and scopes for each quest', () => {
    const quests = seats([
      'They want you to generate a Great Engineer. (Turns remaining: 3) Potential Quest Reward: ' +
      '* 42 Production in Capital * 12 Great Person Points in all Cities * 14 Food in Capital ' +
      'They want you to build the Grand Temple. (Turns remaining: 9) Potential Quest Reward: ' +
      '* 7 Happiness in Capital * 18 Tourism with all known Civilizations * 1 Juggernaut Unit(150 Bonus XP) ' +
      '* 8 Great People Points in Capital * 10 Experience for all Military Units',
    ]);
    expect(projectReceiverQuests(quests, 0, 20)?.terms.map(term => [term.deadline, term.reward])).toEqual([
      [23, '42 Production in Capital, 12 Great Person Points in all Cities, 14 Food in Capital'],
      [29, '7 Happiness in Capital, 18 Tourism with all known Civilizations, 1 Juggernaut Unit (150 Bonus XP), ' +
        '8 Great People Points in Capital, 10 Experience for all Military Units'],
    ]);
  });

  it('should treat tags, headings, and line grouping as formatting when comparing seats', () => {
    expect(projectReceiverQuests({
      Player0: '[COLOR_POSITIVE_TEXT]Personal Quests:[ENDCOLOR][NEWLINE]They want you to build Pyramids. (Turns remaining: 3)[NEWLINE]Potential Quest Reward:[NEWLINE][ICON_BULLET] 44 Influence',
      Player1: ['They want you to build Pyramids. (Turns remaining: 3) Potential Quest Reward: *44 Influence'],
    }, 0, 20)).toBeUndefined();
  });
});
