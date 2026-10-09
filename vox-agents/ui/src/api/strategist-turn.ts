/**
 * Normalize one `strategist.turn.N` trace into the decisions the strategist made, so the
 * strategist turn view can show the evaluator and the LLM strategists with the same components.
 */

import type { LabeledAnswer, Span, StrategistDecision } from '@/utils/types';
import { labelEvaluation, type RecordedAnswer, type RecordedQuestion } from '@vox/utils/models/evaluation-record';

/** How one decision compares with the game before the turn. */
export type DecisionState = 'applied' | 'failed' | 'reaffirmed' | 'same';

/** One decided value: a choice, a flavor, a persona trait, or one side of a relationship. */
export interface DecisionItem {
  key: string;
  label: string;
  current?: number | string;
  /** The value sent to the game, if any. */
  next?: number | string;
  state: DecisionState;
  /** The evaluator's original answer to the question behind this value. */
  answer?: LabeledAnswer;
}

/** Public and private stance toward one other civilization. */
export interface RelationshipItem {
  target?: number;
  name: string;
  public: DecisionItem;
  private: DecisionItem;
  rationale?: string;
}

/** One step of an LLM strategist's tool loop. */
export interface StrategistStep {
  number: number;
  durationMs: number;
  reasoning: string;
  tools: string[];
}

/** The decisions and context of one strategist turn. */
export interface StrategistTurn {
  kind: 'evaluator' | 'llm' | 'other';
  root: Span;
  agent?: Span;
  player: { id: number; name: string };
  choices: DecisionItem[];
  flavors: DecisionItem[];
  persona: DecisionItem[];
  relationships: RelationshipItem[];
  /** Rationales by decision key or scale section. */
  rationales: Record<string, string | undefined>;
  statusQuo?: string;
  steps: StrategistStep[];
  evaluation?: { stateTokens?: number; questions: number; deadband?: number };
}

/** Value ranges of the scale sections. */
export const flavorRange: [number, number] = [0, 100];
export const personaRange: [number, number] = [1, 10];
export const relationshipRange: [number, number] = [-100, 100];

/** Tools a strategist uses to make or skip a decision. */
const decisionTools = ['set-flavors', 'set-strategy', 'set-persona', 'set-research', 'set-policy', 'set-relationship', 'keep-status-quo'];

type Attributes = Record<string, unknown>;
type Values = Record<string, number | string | undefined>;

/** A tool call made by the LLM strategist in one of its steps. */
interface LlmCall {
  tool: string;
  failed: boolean;
  input: Record<string, unknown>;
}

/** Parse a JSON attribute that telemetry stores as a string; other values pass through. */
function parse<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') return value as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** The attribute bag of a span, or an empty one. */
function attrs(span?: Span): Attributes {
  return (span?.attributes ?? {}) as Attributes;
}

/** Whether a span is a strategist turn root. */
export function isStrategistTurnSpan(span: Span): boolean {
  return /^strategist\.turn\.\d+$/.test(span.name);
}

/** Build the turn model from the spans of one trace with parsed attributes. */
export function buildStrategistTurn(root: Span, spans: Span[]): StrategistTurn {
  const tool = (name: string) => spans.find(s => attrs(s)['tool.name'] === name);
  const players = parse<Record<string, { Civilization?: string } | string>>(attrs(tool('get-players'))['tool.output']) ?? {};
  const civ = (id: number) => {
    const player = players[id];
    return typeof player === 'object' && player.Civilization ? player.Civilization : `Player ${id}`;
  };
  const playerId = Number(attrs(root)['player.id']);
  const agent = spans.find(s => s.parentSpanId === root.spanId && s.name.startsWith('agent.'));
  const decision = parse<StrategistDecision>(attrs(agent)['strategist.decision']);
  const turn: StrategistTurn = {
    kind: decision ? 'evaluator' : agent ? 'llm' : 'other',
    root, agent,
    player: { id: playerId, name: civ(playerId) },
    choices: [], flavors: [], persona: [], relationships: [], rationales: {}, steps: [],
  };
  if (decision) fillEvaluator(turn, spans, decision, civ);
  else if (agent) fillLlm(turn, spans, civ);
  return turn;
}

/** Evaluator: values from `strategist.decision`, original answers from the evaluate span. */
function fillEvaluator(turn: StrategistTurn, spans: Span[], decision: StrategistDecision, civ: (id: number) => string) {
  const evaluate = attrs(spans.find(s => s.name.endsWith('.evaluate')));
  const questions = parse<Record<string, RecordedQuestion>>(evaluate['evaluate.questions']) ?? {};
  const answers = labelEvaluation(
    questions,
    parse<Record<string, RecordedAnswer>>(evaluate['evaluate.answers']) ?? {},
    parse<Record<string, number>>(evaluate['evaluate.confidence']) ?? {},
  );
  const answerOf = new Map(answers.map(a => [a.id, a]));
  turn.evaluation = {
    stateTokens: Number(evaluate['evaluate.state_tokens']) || undefined,
    questions: Object.keys(questions).length,
    deadband: decision.deadband,
  };
  const failed = (tool: string, target?: number) =>
    decision.calls.some(c => c.tool === tool && c.target === target && c.status === 'failed');
  // Values inside the deadband are not sent, so they read as unchanged.
  const item = (id: string, label: string, tool: string, target?: number): DecisionItem | undefined => {
    const outcome = decision.questions[id];
    if (!outcome) return undefined;
    return {
      key: id, label, current: outcome.current,
      next: outcome.sent ? outcome.proposed : undefined,
      state: !outcome.sent ? 'same' : failed(tool, target) ? 'failed' : 'applied',
      answer: answerOf.get(id),
    };
  };
  turn.choices = [
    item('grand_strategy', 'Grand strategy', 'set-flavors'),
    item('research', 'Research', 'set-research'),
    item('policy', 'Policy', 'set-policy'),
  ].filter((i): i is DecisionItem => !!i);
  const ids = Object.keys(decision.questions);
  turn.flavors = ids.filter(id => id.startsWith('flavor_')).map(id => item(id, id.slice(7), 'set-flavors')!);
  turn.persona = ids.filter(id => id.startsWith('persona_')).map(id => item(id, id.slice(8), 'set-persona')!);
  const targets = [...new Set(ids.filter(id => id.startsWith('relationship_')).map(id => Number(id.split('_')[2])))];
  turn.relationships = targets.map(target => ({
    target, name: civ(target),
    public: item(`relationship_public_${target}`, 'Public', 'set-relationship', target) ?? { key: 'public', label: 'Public', state: 'same' },
    private: item(`relationship_private_${target}`, 'Private', 'set-relationship', target) ?? { key: 'private', label: 'Private', state: 'same' },
  }));
}

/** LLM: current values from get-options, new values and rationales from the step tool calls. */
function fillLlm(turn: StrategistTurn, spans: Span[], civ: (id: number) => string) {
  const options = parse<{
    Strategy?: { GrandStrategy?: string; Flavors?: Values; EconomicStrategies?: string[]; MilitaryStrategies?: string[] };
    Persona?: Values;
    Technology?: { Next?: string };
    Policy?: { Next?: string };
    Relationships?: Record<string, { Public?: number; Private?: number }>;
    Options?: { Flavors?: Record<string, unknown> };
  }>(attrs(spans.find(s => attrs(s)['tool.name'] === 'get-options'))['tool.output']) ?? {};
  const steps = spans
    .filter(s => s.parentSpanId === turn.agent?.spanId && /\.step\.\d+$/.test(s.name))
    .sort((a, b) => Number(attrs(a)['step.number']) - Number(attrs(b)['step.number']));
  const stepIds = new Set(steps.map(s => s.spanId));
  const calls: LlmCall[] = spans
    .filter(s => decisionTools.includes(String(attrs(s)['tool.name'])) && stepIds.has(s.parentSpanId ?? ''))
    .sort((a, b) => a.startTime - b.startTime)
    .map(s => {
      const output = parse<{ Success?: boolean; isError?: boolean }>(attrs(s)['tool.output']);
      return {
        tool: String(attrs(s)['tool.name']),
        failed: s.statusCode === 2 || output == null || output.isError === true || output.Success === false,
        input: parse<Record<string, unknown>>(attrs(s)['tool.input']) ?? {},
      };
    });

  turn.steps = steps.map(s => {
    const responses = parse<{ role: string; content?: { type: string; text?: string; toolName?: string }[] }[]>(attrs(s)['step.responses']) ?? [];
    const parts = responses.filter(m => m.role === 'assistant').flatMap(m => m.content ?? []);
    return {
      number: Number(attrs(s)['step.number']),
      durationMs: s.durationMs,
      // Reasoning summaries arrive as back-to-back bold headers; split them into lines.
      reasoning: parts.filter(p => p.type === 'reasoning').map(p => (p.text ?? '').replace(/\*\*\*\*/g, '**\n\n**')).join('\n\n').trim(),
      tools: parts.filter(p => p.type === 'tool-call').map(p => p.toolName ?? ''),
    };
  });

  /** Read a supplied field, optionally from a nested argument such as Flavors. */
  const value = (call: LlmCall | undefined, key: string, group?: string) =>
    (group ? call?.input[group] as Attributes | undefined : call?.input)?.[key];
  /** Find the latest call that actually supplied the field being displayed. */
  const last = (tool: string, key?: string, group?: string) => calls
    .filter(c => c.tool === tool && (key === undefined || value(c, key, group) !== undefined)).pop();
  const state = (current: unknown, next: unknown, call?: LlmCall): DecisionState =>
    next === undefined ? 'same' : call?.failed ? 'failed' : next === current ? 'reaffirmed' : 'applied';
  const item = (key: string, label: string, current: unknown, next: unknown, call?: LlmCall): DecisionItem => ({
    key, label, current: current as DecisionItem['current'], next: next as DecisionItem['next'], state: state(current, next, call),
  });
  const rationale = (call?: LlmCall) => typeof call?.input.Rationale === 'string' ? call.input.Rationale : undefined;

  const flavorCall = last('set-flavors'), personaCall = last('set-persona');
  const grandCall = calls.filter(c => value(c, 'GrandStrategy') !== undefined).pop();
  const researchCall = last('set-research', 'Technology'), policyCall = last('set-policy', 'Policy');
  const strategy = options.Strategy ?? {};
  const currentFlavors = strategy.Flavors ?? {};
  turn.choices = [
    item('grand_strategy', 'Grand strategy', strategy.GrandStrategy, grandCall?.input.GrandStrategy, grandCall),
    item('research', 'Research', options.Technology?.Next, researchCall?.input.Technology, researchCall),
    item('policy', 'Policy', options.Policy?.Next, policyCall?.input.Policy, policyCall),
  ];
  for (const [key, label, field] of [
    ['economic_strategies', 'Economic strategies', 'EconomicStrategies'],
    ['military_strategies', 'Military strategies', 'MilitaryStrategies'],
  ] as const) {
    const call = last('set-strategy', field);
    const current = strategy[field];
    if (current === undefined && !call) continue;
    const next = call?.input[field] as string[] | undefined;
    turn.choices.push(item(key, label, current?.join(', '), next?.join(', '), call));
    turn.rationales[key] = rationale(call);
  }
  turn.flavors = Object.keys(options.Options?.Flavors ?? currentFlavors)
    .map(k => {
      const call = last('set-flavors', k, 'Flavors');
      return item(k, k, currentFlavors[k], value(call, k, 'Flavors'), call);
    });
  const { Rationale: _personaRationale, ...persona } = options.Persona ?? {};
  turn.persona = Object.keys(persona).map(k => {
    const call = last('set-persona', k);
    return item(k, k, persona[k], value(call, k), call);
  });

  // Current stances are keyed by civ name; new stances by target player id.
  const stances = options.Relationships ?? {};
  const relationshipCalls = calls.filter(c => c.tool === 'set-relationship');
  const playerIds = Object.keys(parse<Record<string, unknown>>(attrs(spans.find(s => attrs(s)['tool.name'] === 'get-players'))['tool.output']) ?? {}).map(Number);
  const names = new Set([...Object.keys(stances), ...relationshipCalls.map(c => civ(Number(c.input.TargetID)))]);
  turn.relationships = [...names].map(name => {
    const current = stances[name] ?? {};
    const call = relationshipCalls.filter(c => civ(Number(c.input.TargetID)) === name).pop();
    const side = (key: 'Public' | 'Private') => item(key.toLowerCase(), key, current[key] ?? 0, call?.input[key], call);
    return {
      target: call ? Number(call.input.TargetID) : playerIds.find(id => civ(id) === name),
      name, public: side('Public'), private: side('Private'), rationale: rationale(call),
    };
  }).sort((a, b) => (a.target ?? Infinity) - (b.target ?? Infinity));

  turn.rationales = {
    ...turn.rationales,
    grand_strategy: rationale(grandCall),
    flavors: rationale(flavorCall),
    persona: rationale(personaCall),
    research: rationale(researchCall),
    policy: rationale(policyCall),
  };
  turn.statusQuo = rationale(last('keep-status-quo'));
}

/** Whether a decision changed or was explicitly reaffirmed, the rows the Changed filter shows. */
export function isChanged(item: DecisionItem): boolean {
  return item.state !== 'same';
}

/** Count tags for a section header, such as "2 changed" or "no change". */
export function countTags(items: DecisionItem[]): { label: string; severity: 'success' | 'danger' | 'secondary' }[] {
  const count = (state: DecisionState) => items.filter(i => i.state === state).length;
  const tags: { label: string; severity: 'success' | 'danger' | 'secondary' }[] = [];
  if (count('applied')) tags.push({ label: `${count('applied')} changed`, severity: 'success' });
  if (count('failed')) tags.push({ label: `${count('failed')} failed`, severity: 'danger' });
  if (count('reaffirmed')) tags.push({ label: `${count('reaffirmed')} reaffirmed`, severity: 'secondary' });
  return tags.length ? tags : [{ label: 'no change', severity: 'secondary' }];
}

/** The evaluator's original answer as tooltip text: the choice or score, its probabilities, and confidence. */
export function formatAnswer(answer?: LabeledAnswer): string | undefined {
  if (!answer) return undefined;
  if (!answer.answered) return 'No answer';
  const head = answer.type === 'choice' ? `Choice: ${answer.choice}`
    : answer.type === 'score' ? `Score: ${answer.score}`
    : `Probability: ${answer.probability}`;
  const lines = answer.probabilities.map(p => `${p.option}: ${Math.round(p.probability * 100)}%`);
  const confidence = answer.confidence === undefined ? [] : [`Confidence: ${Math.round(answer.confidence * 100)}%`];
  return [head, ...lines, ...confidence].join('\n');
}

/** Histogram bars for a score answer: each level's position on the scale and its probability. */
export function answerHistogram(answer?: LabeledAnswer): { at: number; probability: number }[] {
  if (answer?.type !== 'score') return [];
  return answer.probabilities
    .map(p => ({ at: parseFloat(p.option), probability: p.probability }))
    .filter(p => !Number.isNaN(p.at) && p.probability > 0.005);
}

/** Row classes for a decision state: changed (applied or failed), reaffirmed, or same. */
export function stateClass(item: DecisionItem): Record<string, boolean> {
  return {
    'state-changed': item.state === 'applied' || item.state === 'failed',
    'state-reaffirmed': item.state === 'reaffirmed',
    'state-same': item.state === 'same',
  };
}

/** Tooltip options showing the evaluator's original answer, or undefined without one. */
export function answerTooltip(item: DecisionItem): { value: string; class: string } | undefined {
  const value = formatAnswer(item.answer);
  return value ? { value, class: 'answer-tooltip' } : undefined;
}

/** Pacing flags of a turn root (decided, interrupted, skipped) as header tags. */
export function turnFlags(root: Span): { label: string; severity: 'success' | 'warn' | 'secondary' }[] {
  const a = attrs(root);
  const yes = (value: unknown) => value === true || value === 'true';
  const flags: { label: string; severity: 'success' | 'warn' | 'secondary' }[] = [];
  if (yes(a['pacing.decided'])) flags.push({ label: 'decided', severity: 'success' });
  if (yes(a['pacing.interrupted'])) flags.push({ label: 'interrupted', severity: 'warn' });
  if (yes(a['pacing.skipped'])) flags.push({ label: 'skipped', severity: 'secondary' });
  return flags;
}
