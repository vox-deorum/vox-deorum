/**
 * Tests for the evaluator strategist's pure helpers (src/strategist/agents/evaluator-questions.ts):
 * the question set built from an options report and the MCP tool schemas, the action tool calls
 * derived from the answers, and the evaluation state with its event trimming.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStrategistEvaluationState,
  buildStrategistQuestions,
  describeAnswers,
  evaluatorRationale,
  strategistActionsFromAnswers,
  type StrategistAnswer,
} from '../../../src/strategist/agents/evaluator-questions.js';
import type { GameState } from '../../../src/strategist/strategy-parameters.js';
import { makeGameState, makeStrategistParameters, makeStrategistToolSchemas } from '../../helpers/fake-vox-context.js';

/** The deciding player; Greece (player 2) is its only met rival. */
const playerID = 1;

/** The MCP tool schemas, keyed by name like `context.mcpToolMap`. */
const tools = new Map(makeStrategistToolSchemas().map(tool => [tool.name, tool]));

/** A Flavor-mode options report shaped like `get-options` output, with top-level overrides. */
function makeOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Options: {
      GrandStrategies: { Balanced: 'No single focus', Space: 'Race for the spaceship' },
      Flavors: { Science: 'Research priority', Culture: 'Culture priority' },
      Technologies: { Pottery: 'Enables pottery', TheWheel: 'Enables the wheel' },
      Policies: { 'Honor (New Branch)': 'Military bonuses' },
    },
    Strategy: { GrandStrategy: 'Balanced', Flavors: { Science: 50 } },
    Technology: { Next: 'Pottery' },
    Policy: { Next: 'Tradition (Policy)' },
    Relationships: { Greece: { Public: 0, Private: 0, Rationale: 'Steady', UpdatedTurn: 1 } },
    ...overrides,
  };
}

/** A game state with the player, one met rival, one unmet player, and one city-state. */
function makeState(options = makeOptions(), overrides: Partial<GameState> = {}): GameState {
  return makeGameState(5, {
    options: options as never,
    players: {
      '1': { Civilization: 'Rome', IsMajor: true },
      '2': { Civilization: 'Greece', IsMajor: true },
      '3': 'Babylon',
      '4': { Civilization: 'Genoa', IsMajor: false },
    } as never,
    ...overrides,
  });
}

/** Build the actions for a set of answers over the standard state. */
function actionsFor(answers: Record<string, StrategistAnswer>, state = makeState()) {
  return strategistActionsFromAnswers(answers, buildStrategistQuestions(state, playerID, tools), makeStrategistParameters({ playerID }));
}

/** Look up the arguments of the action with the given name. */
function argsOf(actions: Array<{ name: string; args: Record<string, unknown> }>, name: string) {
  return actions.find(action => action.name === name)?.args;
}

describe('buildStrategistQuestions', () => {
  it('should ask the whole Flavor-mode action space', () => {
    const set = buildStrategistQuestions(makeState(), playerID, tools);

    expect(Object.fromEntries(Object.entries(set.questions).map(([id, question]) => [id, question.type]))).toEqual({
      grand_strategy: 'choice',
      flavor_Science: 'score',
      flavor_Culture: 'score',
      research: 'choice',
      policy: 'choice',
      persona_Boldness: 'score',
      persona_WarBias: 'score',
      relationship_public_2: 'score',
      relationship_private_2: 'score',
    });
  });

  it('should read the flavor levels from the set-flavors schema', () => {
    const set = buildStrategistQuestions(makeState(), playerID, tools);

    expect(set.flavorScale.map(level => level.value)).toEqual([0, 30, 50, 70, 100]);
    expect(set.questions.flavor_Science.criteria).toHaveLength(5);
  });

  it('should read the persona axes from the set-persona schema', () => {
    expect(buildStrategistQuestions(makeState(), playerID, tools).persona)
      .toEqual([['persona_Boldness', 'Boldness'], ['persona_WarBias', 'WarBias']]);
  });

  it('should leave out questions with no options', () => {
    const options = makeOptions();
    options.Options = { Flavors: {} };

    const ids = Object.keys(buildStrategistQuestions(makeState(options), playerID, tools).questions);

    expect(ids.some(id => ['grand_strategy', 'research', 'policy'].includes(id) || id.startsWith('flavor_'))).toBe(false);
  });

  it('should throw when a tool schema is missing', () => {
    const partial = new Map(tools);
    partial.delete('set-persona');

    expect(() => buildStrategistQuestions(makeState(), playerID, partial)).toThrow();
  });
});

describe('strategistActionsFromAnswers', () => {
  it('should set flavors and persona from the scores and the grand strategy from the choice', () => {
    const actions = actionsFor({
      grand_strategy: { choice: 'Space', probabilities: { Space: 0.8 } },
      flavor_Science: { probabilities: { '0': 1 } },
      flavor_Culture: { probabilities: { '2': 0.5, '3': 0.5 } },
      persona_Boldness: { probabilities: { '1': 0.5, '2': 0.5 } },
      persona_WarBias: { probabilities: { '4': 1 } },
    });

    expect(argsOf(actions, 'set-flavors')).toMatchObject({ PlayerID: playerID, GrandStrategy: 'Space', Flavors: { Science: 0, Culture: 60 } });
    expect(argsOf(actions, 'set-persona')).toMatchObject({ PlayerID: playerID, Boldness: 4, WarBias: 10 });
  });

  it('should omit the grand strategy when none was chosen', () => {
    expect(argsOf(actionsFor({}), 'set-flavors')).not.toHaveProperty('GrandStrategy');
  });

  it('should set research and policy whenever they were answered', () => {
    const actions = actionsFor({ research: { choice: 'TheWheel' }, policy: { choice: 'Honor (New Branch)' } });

    expect(actions.map(action => action.name)).toEqual(['set-flavors', 'set-persona', 'set-research', 'set-policy']);
    expect(argsOf(actions, 'set-research')).toMatchObject({ Technology: 'TheWheel' });
    expect(argsOf(actions, 'set-policy')).toMatchObject({ Policy: 'Honor (New Branch)' });
  });

  it('should set both relationship modifiers when either one changes', () => {
    const actions = actionsFor({ relationship_public_2: { probabilities: { '2': 1 } }, relationship_private_2: { probabilities: { '0': 1 } } });

    expect(argsOf(actions, 'set-relationship')).toMatchObject({ PlayerID: playerID, TargetID: 2, Public: 0, Private: -100 });
  });

  it('should skip a relationship whose modifiers both already match', () => {
    const state = makeState(makeOptions({ Relationships: { Greece: { Public: 50, Private: -100, Rationale: 'Wary', UpdatedTurn: 4 } } }));

    const actions = actionsFor({ relationship_public_2: { probabilities: { '3': 1 } }, relationship_private_2: { probabilities: { '0': 1 } } }, state);

    expect(argsOf(actions, 'set-relationship')).toBeUndefined();
  });

  it('should average the level values by probability, not the level positions', () => {
    const actions = actionsFor({ flavor_Culture: { probabilities: { '1': 0.5, '4': 0.5 } } });

    expect(argsOf(actions, 'set-flavors')).toMatchObject({ Flavors: { Culture: 65 } });
  });

  it('should map a real-run relationship distribution onto the weighted values', () => {
    const actions = actionsFor({
      relationship_public_2: { probabilities: { '0': 0.02, '1': 0.01, '2': 0.51, '3': 0.38, '4': 0.08 } },
      relationship_private_2: { probabilities: { '3': 1 } },
    });

    expect(argsOf(actions, 'set-relationship')).toMatchObject({ PlayerID: playerID, TargetID: 2, Public: 25, Private: 50 });
  });

  it('should take the middle level value when an answer has no probabilities', () => {
    const actions = actionsFor({});

    expect(argsOf(actions, 'set-flavors')).toMatchObject({ Flavors: { Science: 50, Culture: 50 } });
    expect(argsOf(actions, 'set-persona')).toMatchObject({ Boldness: 5 });
    expect(argsOf(actions, 'set-relationship')).toBeUndefined();
  });

  it('should give every action the fixed evaluator rationale', () => {
    const actions = actionsFor({
      flavor_Science: { probabilities: { '0': 1 } },
      relationship_public_2: { probabilities: { '4': 1 } },
      research: { choice: 'TheWheel' },
      policy: { choice: 'Honor (New Branch)' },
    });

    expect(actions.map(action => action.name)).toEqual(['set-flavors', 'set-persona', 'set-relationship', 'set-research', 'set-policy']);
    for (const action of actions) expect(action.args.Rationale).toBe(evaluatorRationale);
  });

  it('should describe each question with its applied value or choice and its probabilities', () => {
    const set = buildStrategistQuestions(makeState(), playerID, tools);
    const text = describeAnswers({
      relationship_public_2: { probabilities: { '0': 0.02, '1': 0.01, '2': 0.51, '3': 0.38, '4': 0.08 } },
      relationship_private_2: { probabilities: { '3': 1 } },
      research: { choice: 'TheWheel', probabilities: { TheWheel: 0.7, Pottery: 0.3 } },
    }, set);
    // The description line for one question id, or an empty string when there is none.
    const lineOf = (id: string) => text.split('\n').find(line => line.startsWith(id)) ?? '';

    const publicLine = lineOf('relationship_public_2');
    expect(publicLine).toContain('25');
    for (const share of ['51%', '38%', '8%', '2%', '1%']) expect(publicLine).toContain(share);

    const researchLine = lineOf('research');
    expect(researchLine).toContain('TheWheel');
    expect(researchLine).toContain('70%');
    expect(researchLine).toContain('30%');
    expect(researchLine.indexOf('TheWheel')).toBeLessThan(researchLine.indexOf('Pottery'));

    expect(lineOf('policy')).not.toContain('%');
  });
});

describe('buildStrategistEvaluationState', () => {
  /** A state carrying every report the simple strategist reads. */
  function fullState(overrides: Partial<GameState> = {}): GameState {
    return makeState(makeOptions(), {
      victory: { Domination: { Percent: 10 } } as never,
      cities: { '1': { Name: 'Rome' } } as never,
      military: { Units: [] } as never,
      ...overrides,
    });
  }

  it('should carry the same reports as the simple strategist', () => {
    const state = fullState({ events: { '5': [{ Type: 'DeclareWar' }], _markdownConfig: { configs: [] } } as never });

    const evaluation = buildStrategistEvaluationState(makeStrategistParameters({ playerID }), state);

    expect(Object.keys(evaluation)).toEqual([
      'Situation', 'YouAre', 'Options', 'Strategies', 'VictoryProgress', 'Players', 'Cities', 'Military', 'Events', 'Context',
    ]);
    expect(evaluation.Strategies).not.toHaveProperty('Options');
    expect(evaluation.Events).toEqual({ '5': [{ Type: 'DeclareWar' }] });
  });

  it('should prefer the merged decision window over the per-turn slice', () => {
    const state = fullState({
      events: { '5': [{ Type: 'GameSave' }] } as never,
      mergedEvents: { '4': [{ Type: 'DeclareWar' }] } as never,
    });

    expect(buildStrategistEvaluationState(makeStrategistParameters({ playerID }), state).Events)
      .toEqual({ '4': [{ Type: 'DeclareWar' }] });
  });

  it('should trim the least important events to the budget the other sections leave', () => {
    const noise = Array.from({ length: 60 }, (_, index) => ({ Type: 'TileRevealed', Detail: `plot ${index} `.repeat(30) }));
    const war = { Type: 'DeclareWar', OriginatingPlayer: 2 };
    const state = fullState({ events: { '5': [...noise, war] } as never });

    const evaluation = buildStrategistEvaluationState(makeStrategistParameters({ playerID }), state, 1_000);

    expect(evaluation.Events).toEqual({ '5': [war] });
    expect(evaluation.EventsTrimmed).toMatchObject({ DroppedEvents: noise.length });
  });

  it('should keep every event when there is no input limit', () => {
    const state = fullState({ events: { '5': [{ Type: 'TileRevealed' }] } as never });

    const evaluation = buildStrategistEvaluationState(makeStrategistParameters({ playerID }), state);

    expect(evaluation.Events).toEqual({ '5': [{ Type: 'TileRevealed' }] });
    expect(evaluation).not.toHaveProperty('EventsTrimmed');
  });
});
