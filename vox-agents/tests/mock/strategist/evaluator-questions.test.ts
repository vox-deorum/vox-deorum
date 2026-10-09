/**
 * Tests for the evaluator strategist's pure helpers (src/strategist/agents/evaluator-questions.ts):
 * the question set built from an options report and the MCP tool schemas, the plan of action tool
 * calls and decision record derived from the answers (calls that do not change something versus the
 * game are dropped), and the evaluation state: its text plus the trim ladder record the text was
 * shortened with.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStrategistEvaluationState,
  buildStrategistQuestions,
  evaluatorRationale,
  strategistActionsFromAnswers,
  type StrategistAnswer,
  type StrategistPlan,
} from '../../../src/strategist/agents/evaluator-questions.js';
import { evaluatorTrimConfig } from '../../../src/strategist/agents/evaluator-trim-config.js';
import type { GameState } from '../../../src/strategist/strategy-parameters.js';
import { countTokens } from '../../../src/utils/models/token-counter.js';
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

/** A state whose game already holds these flavor values (the standard state has no Culture value). */
function stateWithFlavors(flavors: Record<string, number>): GameState {
  return makeState(makeOptions({ Strategy: { GrandStrategy: 'Balanced', Flavors: flavors } }));
}

/** Build the plan (action calls and decision record) for answers over the given state. */
function actionsFor(answers: Record<string, StrategistAnswer>, state = makeState()): StrategistPlan {
  return strategistActionsFromAnswers(answers, buildStrategistQuestions(state, playerID, tools), makeStrategistParameters({ playerID }));
}

/** Look up the arguments of the planned action with the given name. */
function argsOf(plan: StrategistPlan, name: string) {
  return plan.actions.find(action => action.name === name)?.args;
}

/** The flavor map the planned `set-flavors` call sends. */
function sentFlavors(plan: StrategistPlan): Record<string, number> {
  return (argsOf(plan, 'set-flavors') as { Flavors: Record<string, number> }).Flavors;
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

  it('should record the current values the answers are compared against', () => {
    const set = buildStrategistQuestions(
      makeState(makeOptions({ Persona: { Boldness: 5, WarBias: 10 } })),
      playerID,
      tools,
    );

    expect(set.current).toEqual({
      grandStrategy: 'Balanced',
      flavors: { Science: 50 },
      persona: { Boldness: 5, WarBias: 10 },
      technology: 'Pottery',
      policy: 'Tradition (Policy)',
    });
    expect(set.relationships).toEqual([[2, { Public: 0, Private: 0 }]]);
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
    const plan = actionsFor({
      grand_strategy: { choice: 'Space', probabilities: { Space: 0.8 } },
      flavor_Science: { probabilities: { '0': 1 } },
      flavor_Culture: { probabilities: { '2': 0.5, '3': 0.5 } },
      persona_Boldness: { probabilities: { '1': 0.5, '2': 0.5 } },
      persona_WarBias: { probabilities: { '4': 1 } },
    });

    expect(argsOf(plan, 'set-flavors')).toMatchObject({ PlayerID: playerID, GrandStrategy: 'Space', Flavors: { Science: 0, Culture: 60 } });
    expect(argsOf(plan, 'set-persona')).toMatchObject({ PlayerID: playerID, Boldness: 4, WarBias: 10 });
  });

  it('should omit the grand strategy when none was chosen', () => {
    expect(argsOf(actionsFor({}), 'set-flavors')).not.toHaveProperty('GrandStrategy');
  });

  it('should set research and policy whose choices differ from the game', () => {
    const plan = actionsFor({ research: { choice: 'TheWheel' }, policy: { choice: 'Honor (New Branch)' } });

    expect(plan.actions.map(action => action.name)).toEqual(['set-flavors', 'set-persona', 'set-research', 'set-policy']);
    expect(argsOf(plan, 'set-research')).toMatchObject({ Technology: 'TheWheel' });
    expect(argsOf(plan, 'set-policy')).toMatchObject({ Policy: 'Honor (New Branch)' });
  });

  it('should set both relationship modifiers when either one changes', () => {
    const plan = actionsFor({ relationship_public_2: { probabilities: { '2': 1 } }, relationship_private_2: { probabilities: { '0': 1 } } });

    expect(argsOf(plan, 'set-relationship')).toMatchObject({ PlayerID: playerID, TargetID: 2, Public: 0, Private: -100 });
  });

  it('should skip a relationship whose modifiers both already match', () => {
    const state = makeState(makeOptions({ Relationships: { Greece: { Public: 50, Private: -100, Rationale: 'Wary', UpdatedTurn: 4 } } }));

    const plan = actionsFor({ relationship_public_2: { probabilities: { '3': 1 } }, relationship_private_2: { probabilities: { '0': 1 } } }, state);

    expect(argsOf(plan, 'set-relationship')).toBeUndefined();
  });

  it('should average the level values by probability, not the level positions', () => {
    const plan = actionsFor({ flavor_Culture: { probabilities: { '1': 0.5, '4': 0.5 } } });

    expect(sentFlavors(plan)).toEqual({ Culture: 65 });
  });

  it('should map a real-run relationship distribution onto the weighted values', () => {
    const plan = actionsFor({
      relationship_public_2: { probabilities: { '0': 0.02, '1': 0.01, '2': 0.51, '3': 0.38, '4': 0.08 } },
      relationship_private_2: { probabilities: { '3': 1 } },
    });

    expect(argsOf(plan, 'set-relationship')).toMatchObject({ PlayerID: playerID, TargetID: 2, Public: 25, Private: 50 });
  });

  it('should take the middle level value when an answer has no probabilities', () => {
    const plan = actionsFor({});

    // Science already holds the middle value (50), so only the value-less Culture moves.
    expect(sentFlavors(plan)).toEqual({ Culture: 50 });
    expect(argsOf(plan, 'set-persona')).toMatchObject({ Boldness: 5 });
    expect(argsOf(plan, 'set-relationship')).toBeUndefined();
  });

  it('should give every action the fixed evaluator rationale', () => {
    const plan = actionsFor({
      flavor_Science: { probabilities: { '0': 1 } },
      relationship_public_2: { probabilities: { '4': 1 } },
      research: { choice: 'TheWheel' },
      policy: { choice: 'Honor (New Branch)' },
    });

    expect(plan.actions.map(action => action.name)).toEqual(['set-flavors', 'set-persona', 'set-relationship', 'set-research', 'set-policy']);
    for (const action of plan.actions) expect(action.args.Rationale).toBe(evaluatorRationale);
  });

  it('should keep the status quo when every flavor sits within the deadband and the grand strategy matches', () => {
    const plan = actionsFor({ grand_strategy: { choice: 'Balanced' } }, stateWithFlavors({ Science: 48, Culture: 52 }));

    // Both unanswered flavors land on 50, two points from the game value, which is noise.
    expect(plan.actions[0]).toEqual({ name: 'keep-status-quo', args: { PlayerID: playerID, Mode: 'Flavor', Rationale: evaluatorRationale } });
    expect(argsOf(plan, 'set-flavors')).toBeUndefined();
  });

  it('should send only the flavors that moved past the deadband', () => {
    const plan = actionsFor({ flavor_Science: { probabilities: { '4': 1 } } }, stateWithFlavors({ Science: 50, Culture: 50 }));

    expect(sentFlavors(plan)).toEqual({ Science: 100 });
  });

  it('should send set-flavors with only the grand strategy when no flavor moved', () => {
    const plan = actionsFor({ grand_strategy: { choice: 'Space' } }, stateWithFlavors({ Science: 50, Culture: 50 }));

    expect(argsOf(plan, 'set-flavors')).toMatchObject({ GrandStrategy: 'Space' });
    expect(sentFlavors(plan)).toEqual({});
  });

  it('should send a flavor the game has no current value for', () => {
    // The standard state holds a value only for Science; both answers land on 50.
    const plan = actionsFor({ flavor_Science: { probabilities: { '2': 1 } }, flavor_Culture: { probabilities: { '2': 1 } } });

    expect(sentFlavors(plan)).toEqual({ Culture: 50 });
  });

  it('should send only the persona axes that differ from the game', () => {
    const plan = actionsFor(
      { persona_Boldness: { probabilities: { '2': 1 } }, persona_WarBias: { probabilities: { '1': 1 } } },
      makeState(makeOptions({ Persona: { Boldness: 5, WarBias: 10 } })),
    );

    // Boldness stays at the game's 5; WarBias moves 10 to 3.
    expect(argsOf(plan, 'set-persona')).toMatchObject({ WarBias: 3 });
    expect(argsOf(plan, 'set-persona')).not.toHaveProperty('Boldness');
  });

  it('should drop set-persona when every axis already matches the game', () => {
    const plan = actionsFor({}, makeState(makeOptions({ Persona: { Boldness: 5, WarBias: 5 } })));

    expect(argsOf(plan, 'set-persona')).toBeUndefined();
    expect(plan.decision.calls).toContainEqual({ tool: 'set-persona', status: 'dropped' });
  });

  it('should hold a relationship side within the deadband at its current value', () => {
    const plan = actionsFor(
      { relationship_public_2: { probabilities: { '3': 1 } }, relationship_private_2: { probabilities: { '4': 1 } } },
      makeState(makeOptions({ Relationships: { Greece: { Public: 48, Private: 0, Rationale: 'Wary', UpdatedTurn: 4 } } })),
    );

    // The public proposal of 50 is two points from the game's 48, so the call carries 48.
    expect(argsOf(plan, 'set-relationship')).toMatchObject({ TargetID: 2, Public: 48, Private: 100 });
  });

  it('should drop a relationship whose sides all sit within the deadband', () => {
    const plan = actionsFor({}, makeState(makeOptions({ Relationships: { Greece: { Public: 1, Private: -1, Rationale: 'Wary', UpdatedTurn: 4 } } })));

    // Both unanswered sides land on 0, one point from the game values.
    expect(argsOf(plan, 'set-relationship')).toBeUndefined();
    expect(plan.decision.calls).toContainEqual({ tool: 'set-relationship', status: 'dropped', target: 2 });
  });

  it('should drop set-research when the choice matches the technology in progress', () => {
    const plan = actionsFor({ research: { choice: 'Pottery' } });

    expect(argsOf(plan, 'set-research')).toBeUndefined();
    expect(plan.decision.calls).toContainEqual({ tool: 'set-research', status: 'dropped' });
  });

  it('should drop set-policy when only the trailing kind differs from the current policy', () => {
    const plan = actionsFor(
      { policy: { choice: 'Honor (New Branch)' } },
      makeState(makeOptions({ Policy: { Next: 'Honor (Policy)' } })),
    );

    expect(argsOf(plan, 'set-policy')).toBeUndefined();
    expect(plan.decision.calls).toContainEqual({ tool: 'set-policy', status: 'dropped' });
  });

  it('should send set-policy when the base name differs', () => {
    const plan = actionsFor({ policy: { choice: 'Honor (New Branch)' } });

    expect(argsOf(plan, 'set-policy')).toMatchObject({ Policy: 'Honor (New Branch)' });
  });

  it('should record the current, proposed, and sent values of each question', () => {
    const plan = actionsFor({
      grand_strategy: { choice: 'Space' },
      flavor_Science: { probabilities: { '4': 1 } },
      research: { choice: 'Pottery' },
    });

    expect(plan.decision.questions.grand_strategy).toEqual({ current: 'Balanced', proposed: 'Space', sent: true });
    expect(plan.decision.questions.flavor_Science).toEqual({ current: 50, proposed: 100, sent: true });
    expect(plan.decision.questions.research).toEqual({ current: 'Pottery', proposed: 'Pottery', sent: false });
    // Unanswered questions still record the middle level; a game value of 0 is recorded, and a
    // missing persona or flavor value leaves `current` out.
    expect(plan.decision.questions.flavor_Culture).toEqual({ proposed: 50, sent: true });
    expect(plan.decision.questions.persona_Boldness).toEqual({ proposed: 5, sent: true });
    expect(plan.decision.questions.relationship_public_2).toEqual({ current: 0, proposed: 0, sent: false });
  });
});

describe('buildStrategistEvaluationState', () => {
  /** A stand-in system prompt the state must lead with. */
  const system = 'SYSTEM-MARKER';

  /** A state carrying every report the simple strategist reads. */
  function fullState(overrides: Partial<GameState> = {}): GameState {
    return makeState(makeOptions(), {
      victory: { Domination: { Percent: 10 } } as never,
      cities: { '1': { Name: 'Antium' } } as never,
      military: { Units: ['Legion'] } as never,
      ...overrides,
    });
  }

  it('should lead with the system prompt and carry the same reports as the simple strategist', () => {
    const state = fullState({ events: { '5': [{ Type: 'DeclareWar' }] } as never });

    const evaluation = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state);

    expect(evaluation.text.startsWith(system)).toBe(true);
    for (const value of ['Caesar', 'TheWheel', 'Tradition (Policy)', 'Domination', 'Greece', 'Antium', 'Legion', 'DeclareWar']) {
      expect(evaluation.text).toContain(value);
    }
  });

  it('should render markdown without the rendering hints', () => {
    const hint = { _markdownConfig: { configs: ['{key}'] } };
    const state = fullState({
      options: { ...makeOptions(), ...hint } as never,
      players: { '2': { Civilization: 'Greece', IsMajor: true }, ...hint } as never,
      events: { '5': [{ Type: 'DeclareWar' }], ...hint } as never,
    });

    const evaluation = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state);

    expect(evaluation.text).not.toContain('_markdownConfig');
    expect(evaluation.text).not.toContain('{"');
  });

  it('should prefer the merged decision window over the per-turn slice', () => {
    const state = fullState({
      events: { '5': [{ Type: 'GameSave' }] } as never,
      mergedEvents: { '4': [{ Type: 'DeclareWar' }] } as never,
    });

    const evaluation = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state);

    expect(evaluation.text).toContain('DeclareWar');
    expect(evaluation.text).not.toContain('GameSave');
  });

  it('should trim with event steps alone when dropping events makes the state fit', () => {
    const noise = Array.from({ length: 60 }, (_, index) => ({ Type: 'TileRevealed', Detail: `plot ${index} `.repeat(30) }));
    const war = { Type: 'DeclareWar', OriginatingPlayer: 2 };
    const state = fullState({ events: { '5': [...noise, war] } as never });
    const limit = 1_000;

    const evaluation = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state, limit);

    expect(evaluation.text).toContain('DeclareWar');
    expect(evaluation.text).not.toContain('TileRevealed');
    expect(countTokens(evaluation.text)).toBeLessThanOrEqual(limit);
    // The reports were small enough: only event tiers were dropped, and only noise held events.
    expect(evaluation.trim!.steps).toEqual(['events-noise']);
    expect(evaluation.trim!.steps.every(id => id.startsWith('events-'))).toBe(true);
    expect(evaluation.trim!.droppedEvents).toBe(noise.length);
    expect(evaluation.trim!.fits).toBe(true);
  });

  it('should apply a report step when dropping events alone cannot fit', () => {
    const noise = Array.from({ length: 20 }, (_, index) => ({ Type: 'TileRevealed', Detail: `plot ${index} `.repeat(30) }));
    const buildings = Array.from({ length: 400 }, (_, index) => `Shrine of ${index}`);
    const state = fullState({
      events: { '5': [...noise, { Type: 'DeclareWar' }] } as never,
      cities: {
        '1': {
          Antium: {
            ID: 1, X: 4, Y: 6, Population: 5, MajorityReligion: null, DefenseStrength: 20,
            ImportantBuildings: buildings, FoodPerTurn: 6,
          },
        },
      } as never,
    });
    const limit = 1_000;

    const evaluation = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state, limit);

    // Dropping events cannot save enough: the walk goes on until the buildings step, applying
    // steps in ladder order and skipping the ones that match nothing.
    const ladderIds = evaluatorTrimConfig.ladder.map(step => step.id);
    const buildingsStep = evaluatorTrimConfig.ladder.find(
      step => 'cityFields' in step && step.cityFields.includes('ImportantBuildings'),
    )!;
    const steps = evaluation.trim!.steps;
    expect(steps.at(-1)).toBe(buildingsStep.id);
    expect(steps.map(id => ladderIds.indexOf(id))).toEqual(steps.map(id => ladderIds.indexOf(id)).sort((a, b) => a - b));
    expect(evaluation.trim!.fits).toBe(true);
    expect(evaluation.text).toContain('DeclareWar');
    expect(evaluation.text).not.toContain('Shrine of 7');
    expect(evaluation.text).toContain('Population');
    expect(countTokens(evaluation.text)).toBeLessThanOrEqual(limit);
  });

  it('should report no trim when no limit is given or the state already fits', () => {
    const noise = { Type: 'TileRevealed', Detail: 'plot 0' };
    const state = fullState({ events: { '5': [noise] } as never });

    const withoutLimit = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state);
    const withRoom = buildStrategistEvaluationState(system, makeStrategistParameters({ playerID }), state, 100_000);

    expect(withoutLimit.trim).toBeUndefined();
    expect(withoutLimit.text).toContain('TileRevealed');
    expect(withRoom.trim).toBeUndefined();
    expect(withRoom.text).toBe(withoutLimit.text);
  });
});
