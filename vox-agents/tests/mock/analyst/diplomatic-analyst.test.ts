import { describe, it, expect, vi } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { createFakeVoxContext, makeStrategistParameters, makeGameState } from '../../helpers/fake-vox-context.js';

const analyst = agentRegistry.get('diplomatic-analyst') as any;
const report = {
  Content: 'Germany proposes peace.', Context: 'A border war is active.',
  Memo: 'The diplomat is wary.', FromPlayer: 'Germany', AboutPlayers: ['Greece'],
};
/** The report after handoff resolution: Germany (1) about Greece (2). */
const input = {
  Content: report.Content, Context: report.Context, Memo: report.Memo, FromPlayerID: 1, AboutPlayerIDs: [2],
};

/** Build evaluation answers with independent category probabilities. */
function evaluation(relayProbability = 0.9) {
  return { answers: {
    relay: { probability: relayProbability },
    type: { type: 'choice', choice: 'Rumor' },
    confidence: { type: 'score', score: 6.5 },
    importance: { type: 'score', score: 2.25 },
    Diplomacy: { probability: 0.9 },
    Military: { probability: 0.5 },
    Economy: { probability: 0.49 },
    Others: { probability: 0.7 },
  } };
}

/** Prepare a context with deterministic history, evaluation, and relay results. */
function setup() {
  const fake = createFakeVoxContext();
  const parameters = makeStrategistParameters({ playerID: 0, gameStates: { 5: makeGameState(5, { players: {
    '0': { Civilization: 'Rome', Leader: 'Caesar', IsMajor: true },
    '1': { Civilization: 'Germany', Leader: 'Frederick', IsMajor: true },
    '2': { Civilization: 'Greece', Leader: 'Alexander', IsMajor: true },
  } } as any) } });
  fake.setBaseParameters(parameters);
  const context = fake.asContext();
  const evaluate = vi.fn().mockResolvedValue(evaluation());
  const callTool = vi.fn(async (name: string, _args?: unknown, _parameters?: unknown) =>
    name === 'get-diplomatic-events' ? { '4': ['recent event'] } : { Success: true });
  Object.assign(context, { evaluate, callTool, currentSignal: () => new AbortController().signal });
  return { context, evaluate, callTool, parameters };
}

describe('DiplomaticAnalyst handoff', () => {
  it('should resolve and deduplicate explicit civilization and leader names', () => {
    const { context } = setup();
    const result = analyst.resolveHandoffInput({ ...report, FromPlayer: 'FREDERICK', AboutPlayers: ['greece', 'Alexander'] }, context);
    expect(result).toEqual(input);
  });

  it('should resolve the counterpart and extract subjects when the snapshot omits the conversation players', () => {
    const { context, parameters } = setup();
    parameters.gameStates = {};
    Object.assign(context, { currentInput: {
      diplomacy: true, agent: 0, player1ID: 0, player2ID: 1,
      player1Identity: { name: 'Rome', leader: 'Caesar' },
      player2Identity: { name: 'Germany', leader: 'Frederick' },
    } });
    const result = analyst.resolveHandoffInput({ ...report, FromPlayer: undefined, AboutPlayers: undefined }, context);
    expect(result).toMatchObject({ FromPlayerID: 1, AboutPlayerIDs: [1] });
  });

  it('should extract subjects from both content and memo using whole civilization and leader names', () => {
    const { context } = setup();
    const result = analyst.resolveHandoffInput({
      ...report, AboutPlayers: undefined, Content: 'GREECE and Greece are trading.',
      Memo: "Frederick's response mentions a micrometer.",
    }, context);
    expect(result.AboutPlayerIDs).toEqual([1, 2]);
    expect(analyst.resolveHandoffInput({
      ...report, AboutPlayers: undefined, Content: 'A micrometer.', Memo: 'No subjects.',
    }, context).AboutPlayerIDs).toEqual([]);
  });

  it('should never list the receiving civilization as a subject', () => {
    const { context } = setup();
    expect(analyst.resolveHandoffInput({
      ...report, AboutPlayers: undefined, Content: 'Germany threatens Rome and Greece.',
    }, context).AboutPlayerIDs).toEqual([1, 2]);
    expect(analyst.resolveHandoffInput({ ...report, AboutPlayers: ['Caesar', 'Greece'] }, context).AboutPlayerIDs).toEqual([2]);
  });

  it('should honor explicit subjects, including an empty list, instead of extracting mentions', () => {
    const { context } = setup();
    expect(analyst.resolveHandoffInput(report, context).AboutPlayerIDs).toEqual([2]);
    expect(analyst.resolveHandoffInput({ ...report, AboutPlayers: [] }, context).AboutPlayerIDs).toEqual([]);
  });

  it('should reject unknown and ambiguous explicit names', () => {
    const { context, parameters } = setup();
    expect(() => analyst.resolveHandoffInput({ ...report, AboutPlayers: ['Atlantis'] }, context)).toThrow();
    parameters.gameStates[5].players!['3'] = { Civilization: 'Germany', IsMajor: true } as any;
    expect(() => analyst.resolveHandoffInput(report, context)).toThrow();
  });

  it('should require a source outside a diplomacy conversation', () => {
    const { context } = setup();
    expect(() => analyst.resolveHandoffInput({ ...report, FromPlayer: undefined }, context)).toThrow();
  });
});

describe('DiplomaticAnalyst evaluation', () => {
  it('should prepare history once and relay structured subjects with all categories at or above 0.5', async () => {
    const { context, parameters, callTool, evaluate } = setup();
    callTool.mockImplementation(async (name: string, args?: any) => name === 'get-diplomatic-events'
      ? { '4': [`event with ${args.OtherPlayerID}`] }
      : { Success: true });
    const messages = await analyst.getInitialMessages(parameters, input, context);
    const prepared = { system: 'system', messages };
    await analyst.executeEvaluation(parameters, input, context, prepared, {});

    expect(callTool).toHaveBeenCalledTimes(3);
    expect(callTool).toHaveBeenCalledWith('get-diplomatic-events', {
      PlayerID: parameters.playerID, OtherPlayerID: 1, FromTurn: 0, ToTurn: parameters.turn, Formatted: true,
    }, parameters);
    expect(JSON.parse(messages.at(-1).content).diplomaticHistory).toEqual([
      { PlayerID: 1, status: 'available', events: { '4': ['event with 1'] } },
      { PlayerID: 2, status: 'available', events: { '4': ['event with 2'] } },
    ]);
    expect(evaluate).toHaveBeenCalledExactlyOnceWith({}, prepared, expect.anything());
    expect(callTool).toHaveBeenCalledWith('relay-message', {
      PlayerID: parameters.playerID, FromPlayerID: 1, AboutPlayerIDs: [2],
      Message: 'Rumor', Content: input.Content, Memo: input.Memo,
      Confidence: 6.5, Importance: 2.25, Categories: ['Diplomacy', 'Military', 'Others'],
    }, parameters);
  });

  it('should list an event shared by the source and a subject only once', async () => {
    const { context, parameters } = setup();
    const messages = await analyst.getInitialMessages(parameters, input, context);
    expect(JSON.parse(messages.at(-1).content).diplomaticHistory).toEqual([
      { PlayerID: 1, status: 'available', events: { '4': ['recent event'] } },
      { PlayerID: 2, status: 'available', events: {} },
    ]);
  });

  it('should preserve 4000 content characters and the full memo allowance without subject prefixes', async () => {
    const { context, parameters, callTool } = setup();
    await analyst.executeEvaluation(parameters, { ...input, Content: 'X'.repeat(4100), Memo: 'M'.repeat(600) }, context, { messages: [] }, {});
    expect(callTool).toHaveBeenCalledWith('relay-message', expect.objectContaining({
      Content: 'X'.repeat(4000), Memo: 'M'.repeat(500), AboutPlayerIDs: [2],
    }), parameters);
  });

  it('should mark missing history as unavailable', async () => {
    const { context, parameters, callTool } = setup();
    callTool.mockResolvedValueOnce(undefined as any);
    const messages = await analyst.getInitialMessages(parameters, input, context);
    expect(JSON.parse(messages.at(-1).content).diplomaticHistory[0]).toEqual({ PlayerID: 1, status: 'unavailable' });
  });

  it('should use relay probability alone as the gate and allow no qualifying categories', async () => {
    const { context, parameters, callTool, evaluate } = setup();
    evaluate.mockResolvedValueOnce(evaluation(0.49));
    await analyst.executeEvaluation(parameters, input, context, { messages: [] }, {});
    expect(callTool).not.toHaveBeenCalled();

    const result = evaluation(0.5);
    for (const category of ['Diplomacy', 'Military', 'Economy', 'Others'] as const) {
      result.answers[category].probability = 0.49;
    }
    evaluate.mockResolvedValueOnce(result);
    await analyst.executeEvaluation(parameters, input, context, { messages: [] }, {});
    expect(callTool).toHaveBeenCalledWith('relay-message', expect.objectContaining({ Categories: [] }), parameters);
  });

  it('should respect cancellation and surface relay failure', async () => {
    const { context, parameters, callTool } = setup();
    const controller = new AbortController();
    controller.abort();
    Object.assign(context, { currentSignal: () => controller.signal });
    await expect(analyst.executeEvaluation(parameters, input, context, { messages: [] }, {})).rejects.toThrow();
    expect(callTool).not.toHaveBeenCalled();

    Object.assign(context, { currentSignal: () => new AbortController().signal });
    for (const failure of [undefined, null, { isError: true }, { Success: false }]) {
      callTool.mockResolvedValueOnce(failure as any);
      await expect(analyst.executeEvaluation(parameters, input, context, { messages: [] }, {})).rejects.toThrow();
    }
  });

  it('should not relay when evaluation fails', async () => {
    const { context, parameters, callTool, evaluate } = setup();
    evaluate.mockRejectedValueOnce(new Error('evaluation failed'));
    await expect(analyst.executeEvaluation(parameters, input, context, { messages: [] }, {})).rejects.toThrow();
    expect(callTool).not.toHaveBeenCalled();
  });
});
