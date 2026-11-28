/** Compile editorial expressions once and evaluate each check in a fresh QuickJS sandbox. */
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { Intrinsics, QuickJS, type QuickJSOptions } from 'quickjs-wasi';
import { errorMessage } from '../../../utils/errors.js';
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { ChoiceExpressionError } from '../../contracts/publication.js';
import { factGuestSource } from '../facts/guest.js';
import { factModelWrap, type NewspaperFactModel } from '../facts/index.js';
import { packNewspaperFacts, unpackFactSource } from '../facts/transport.js';

type FactValue = null | boolean | number | string | readonly FactValue[] | ExpressionBindings;
/** Only JSON data crosses from the fact builders into the sandbox. */
export interface ExpressionBindings {
  readonly [name: string]: FactValue;
}

export const editorialShortcutSubjects = ['city', 'player', 'event', 'pair', 'incident'] as const;
export type EditorialShortcutDefinitions = Readonly<Partial<Record<
  typeof editorialShortcutSubjects[number], Readonly<Record<string, string>>
>>>;

type FactDefinitions = { shortcuts?: EditorialShortcutDefinitions; stakes?: EditorialShortcutDefinitions };

export interface EditorialExpression {
  rule: string;
  field: string;
  source: string;
}

export interface ExpressionBatch {
  globals?: ExpressionBindings;
  /** Scaled catalogue bindings shared by rules and shortcuts. */
  constants?: ExpressionBindings;
  /** One permission-filtered fact model, shared across trigger windows in this check. */
  facts?: NewspaperFactModel;
  groups: readonly {
    /** Exclusive lower bound of this group, defaulting to the reporting boundary. */
    windowFromTurn?: number;
    /** Zero-based indices in the list supplied at compile time. */
    expressions: readonly number[];
    /** Local bindings, which can override check globals. */
    subjects: readonly ExpressionBindings[];
    /** Optional ordered script: stop on a falsy guard or an error, and bind successful results by name. */
    ordered?: {
      guardCount: number;
      bind?: Readonly<Record<number, string>>;
      /** Limit how many steps may be evaluated for each subject. */
      limits?: readonly number[];
      /** Steps whose result must be a finite number. */
      numeric?: readonly number[];
      /** Independent rating steps whose errors do not stop later steps. */
      optional?: readonly number[];
    };
  }[];
}

type ExpressionValue = undefined | null | boolean | number | string;
export type ExpressionResult =
  ({ value: ExpressionValue } | { error: EditorialExpression & { message: string; interrupted?: true; skipped?: true; budgetExhausted?: true; unreached?: true; hidden?: string } }) &
  { sources?: NewspaperSourceReference[] };

/** Share interruption accounting when a check needs several dependent batches. */
export interface ExpressionCheckBudget {
  interruptedSlots: Set<number>;
  choiceErrors?: Map<number, ChoiceExpressionError>;
  /** At least one choice expression could not be attempted within the check's shared limit. */
  choiceEvaluationIncomplete?: true;
}

export interface ExpressionRunner {
  /** Evaluate results in group, subject and expression order. */
  evaluate(batch: ExpressionBatch, budget?: ExpressionCheckBudget): Promise<ExpressionResult[][][]>;
}

const filename = 'newspaper-expressions.js';
const memoryLimit = 128 * 1024 * 1024;
const stackLimit = 256 * 1024;
const interruptLimit = 2_000;
const interruptionRecoveryLimit = 8;
type ResumedBinding = { name: string; value?: ExpressionValue };

type RawResult = { value?: ExpressionValue; error?: string; interrupted?: true; skipped?: true; budgetExhausted?: true; unreached?: true; hidden?: string; sources?: NewspaperSourceReference[] };
type SandboxWasm = NonNullable<QuickJSOptions['wasm']>;
// Node provides WebAssembly, but this package's TypeScript config excludes browser types.
declare const WebAssembly: { compile(bytes: Uint8Array): Promise<SandboxWasm> };
let wasmModule: Promise<SandboxWasm> | undefined;

/** Load and compile the engine once per process; guest code has no filesystem bindings. */
function loadEngine(): Promise<SandboxWasm> {
  return (wasmModule ??= readFile(new URL(import.meta.resolve('quickjs-wasi/quickjs.wasm'))).then(
    (bytes) => WebAssembly.compile(bytes)
  ));
}

/** Send no clock, randomness, or output through the WASI shim. */
function unavailable(): number {
  return 52; // WASI ENOSYS
}

/** Compile or run without host APIs, dynamic code, asynchronous jobs or nondeterministic intrinsics. */
async function createSandbox(
  mode: 'compile' | 'run',
  interruptHandler?: () => boolean
): Promise<QuickJS> {
  return QuickJS.create({
    wasm: await loadEngine(),
    memoryLimit,
    maxStackSize: stackLimit,
    intrinsics:
      Intrinsics.JSON |
      Intrinsics.REGEXP |
      Intrinsics.MAP_SET |
      Intrinsics.PROXY |
      (mode === 'compile' ? Intrinsics.EVAL : 0),
    interruptHandler,
    wasi: () => ({ clock_time_get: unavailable, random_get: unavailable, fd_write: unavailable }),
  });
}

/** Attach the catalogue location and original source to a compiler or batch failure. */
function expressionError(expression: EditorialExpression, error: unknown): Error {
  return new Error(
    `Rule ${expression.rule}, ${expression.field} (${expression.source}): ${errorMessage(error)}`
  );
}

/** Ensure the authored text is exactly one expression before placing it in the batch program. */
function validateExpression(expression: EditorialExpression): void {
  try {
    const prefix = '"use strict";\n';
    const wrapped = `${prefix}(\n${expression.source}\n)`;
    const { body } = parse(wrapped, {
      ecmaVersion: 'latest',
      preserveParens: true,
    });
    if (
      body.length !== 2 ||
      body[1].type !== 'ExpressionStatement' ||
      body[1].expression.type !== 'ParenthesizedExpression' ||
      body[1].expression.start !== prefix.length ||
      body[1].expression.end !== wrapped.length
    )
      throw new SyntaxError('Expected one JavaScript expression.');
  } catch (error) {
    throw expressionError(expression, error);
  }
}

// Kept as guest source so host compilation cannot rewrite the sandbox program.
const startBatch = `
// Evaluate the supplied expressions for each subject, group by group and in catalogue order.
(function run(expressions, factDefinitions, batch) {
  'use strict';
  delete globalThis.editorialBatch;
  delete globalThis.queueMicrotask;
  delete Math.random;
  const input = JSON.parse(batch.input);
  delete batch.input;
  const disabled = new Set(JSON.parse(batch.disabled));
  const { begin, results } = batch;
  const resumedBindings = JSON.parse(batch.resumedBindings);
  let skip = batch.skip;

  const frozen = new Set();
  // Freeze bindings and built-ins so expressions cannot change what other subjects read.
  function freeze(value) {
    if (
      value === null || (typeof value !== 'object' && typeof value !== 'function') ||
      frozen.has(value)
    ) return;
    frozen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      freeze(property.value);
      freeze(property.get);
      freeze(property.set);
    }
    freeze(Object.getPrototypeOf(value));
    Object.freeze(value);
  }
  freeze(globalThis);
  // Several shared prototypes are only reachable through instances, not the globals.
  const arrayIterator = [][Symbol.iterator]();
  for (const iterator of [
    arrayIterator,
    ''[Symbol.iterator](),
    new Map()[Symbol.iterator](),
    new Set()[Symbol.iterator](),
    ''.matchAll(/./g),
    arrayIterator.map(value => value),
    Iterator.from({ next: () => ({ done: true }) }),
  ]) freeze(Object.getPrototypeOf(iterator));
  freeze(function* () {});
  freeze(async function () {});
  freeze(async function* () {});
  // Raw fact rows and wrapping stay within the dispatcher and need no recursive traversal.
  freeze(input.globals);
  freeze(input.constants);
  freeze(input.groups);

${unpackFactSource}
${factGuestSource}
  const facts = input.facts && factRuntime(
    unpackFacts(input.facts), input.wrap ?? { x: 0, y: 0 }, input.constants, factDefinitions
  );

  // Authored expressions return scalars so results can be retrieved safely if the VM interrupts.
  function evaluate(slot, bindings) {
    try {
      const value = expressions[slot](bindings);
      if (
        value !== undefined && value !== null &&
        typeof value !== 'boolean' && typeof value !== 'string' && !Number.isFinite(value)
      ) return { error: 'Expected a finite number, string, boolean, null, or undefined.' };
      return { value: value === 0 ? 0 : value };
    } catch (error) {
      // A direct error brand check and data descriptor do not call user getters or Proxy traps.
      const message = Error.isError(error)
        ? Object.getOwnPropertyDescriptor(error, 'message')?.value
        : error;
      return { error: typeof message === 'string' ? message : 'Expression threw a value.' };
    }
  }

  for (const { expressions: slots, subjects, windowFromTurn, ordered } of input.groups) {
    const size = slots.length * subjects.length;
    if (skip >= size) {
      skip -= size;
      continue;
    }
    const view = facts?.view(windowFromTurn ?? input.facts.previous);
    for (let index = Math.floor(skip / slots.length); index < subjects.length; index++) {
      const base = view
        ? view.bindings(input.globals, subjects[index])
        : Object.freeze(Object.assign(Object.create(null), input.globals, subjects[index], input.constants));
      let bindings = base;
      const first = skip % slots.length;
      // Only an interrupted optional step can resume an ordered subject.
      let stopped = !!ordered && first > 0 && resumedBindings === null;
      // Restore earlier values if an independent adjustment was interrupted.
      if (first > 0 && resumedBindings)
        for (const { name, value } of resumedBindings) bind(name, value);
      // Bind each successful scalar result for subsequent expressions.
      function bind(name, value) {
        bindings = Object.freeze(Object.defineProperty(Object.create(bindings), name, { value }));
      }
      function step(offset, result) {
        if (!ordered) return;
        if (result.error !== undefined) {
          if (!ordered.optional?.includes(offset)) stopped = true;
          return;
        }
        if (offset < ordered.guardCount && !result.value) {
          stopped = true;
          return;
        }
        const name = ordered.bind?.[offset];
        if (name !== undefined) bind(name, result.value);
      }
      for (let offset = first; offset < slots.length; offset++) {
        const slot = slots[offset];
        begin();
        if (stopped || offset >= (ordered?.limits?.[index] ?? slots.length)) {
          results.push({ error: 'Expression was not reached.', unreached: true });
          continue;
        }
        facts?.reset();
        let result = disabled.has(slot)
          ? { error: 'Expression exceeded its allowance earlier in this check.', skipped: true }
          : facts ? facts.result(evaluate(slot, bindings)) : evaluate(slot, bindings);
        if (result.error === undefined && ordered?.numeric?.includes(offset) && !Number.isFinite(result.value)) {
          result = { ...result, error: 'Expected a finite number.' };
        }
        results.push(result);
        step(offset, result);
      }
      skip = 0;
    }
  }
})([
`;
const endBatch = `], globalThis.editorialBatch);`;

/** Build a strict expression function with named bindings and truthy objects in conditions. */
function expressionFunction({ field, source }: EditorialExpression): string {
  const condition = /^(?:match|when(?:\[\d+\])?|weight\.adjustments\[\d+\]\.when)$/.test(field);
  // Keep object results inside the sandbox while preserving scalar results for the audit.
  const normalize = condition ? "(value => value !== null && typeof value === 'object' ? true : value)" : '';
  return `function (bindings) {
  with (bindings) return (function () {
    'use strict';
    return ${normalize}((
${source}
    ));
  })();
}`;
}

/** Compile the whole program, locating a QuickJS parser failure by its expression. */
function compileBatch(
  vm: QuickJS,
  expressions: readonly EditorialExpression[],
  definitions: FactDefinitions
): Uint8Array {
  const facts = (['shortcuts', 'stakes'] as const).flatMap(group =>
    editorialShortcutSubjects.flatMap(kind => Object.entries(definitions[group]?.[kind] ?? {}).map(
      ([name, source]) => ({ group, kind, name, expression: { rule: 'constants', field: `${group}.${kind}.${name}`, source } }),
    )),
  );
  const sources = [...expressions, ...facts.map(({ expression }) => expression)];
  for (const expression of sources) validateExpression(expression);
  const functions = sources.map(expressionFunction);
  const rules = functions.slice(0, expressions.length);
  const getters = facts.map(({ group, kind, name }, index) =>
    `[...${JSON.stringify([group, kind, name])}, ${functions[expressions.length + index]}]`
  );
  try {
    return vm.compile(startBatch + rules.join(',\n') + '], [\n' + getters.join(',\n') + endBatch, filename);
  } catch (error) {
    // QuickJS may reject syntax newer than its engine supports. Report the individual expression.
    for (let index = 0; index < functions.length; index++) {
      try {
        vm.compile(`(${functions[index]})`, filename);
      } catch (syntaxError) {
        throw expressionError(sources[index], syntaxError);
      }
    }
    throw error;
  }
}

/** Run the remaining batch, retaining completed values if an expression exhausts its allowance. */
async function evaluateRemaining(
  input: string,
  bytecode: Uint8Array,
  skip: number,
  disabled: ReadonlySet<number>,
  resumedBindings: ResumedBinding[] | null,
): Promise<{ results: RawResult[]; interrupted?: true }> {
  let started = 0;
  let remaining = interruptLimit * 16; // Allow the check to parse and freeze its input.
  let interrupted = false;
  using vm = await createSandbox('run', () => (interrupted = --remaining < 0));
  // The trusted dispatcher captures the control data and removes its global before running rules.
  using begin = vm.newFunction('beginExpression', () => {
    started++;
    remaining = interruptLimit;
    return vm.undefined;
  });
  using results = vm.newArray();
  using batch = vm.newObject();
  // Let the dispatcher release the encoded input as soon as it parses it.
  {
    using payload = vm.newString(input);
    vm.setProp(batch, 'input', payload);
  }
  using skipCount = vm.newNumber(skip);
  using disabledSlots = vm.newString(JSON.stringify([...disabled]));
  using resumed = vm.newString(JSON.stringify(resumedBindings));
  vm.setProp(batch, 'skip', skipCount);
  vm.setProp(batch, 'disabled', disabledSlots);
  vm.setProp(batch, 'resumedBindings', resumed);
  vm.setProp(batch, 'begin', begin);
  vm.setProp(batch, 'results', results);
  vm.setProp(vm.global, 'editorialBatch', batch);
  try {
    vm.evalBytecode(bytecode).dispose();
  } catch (error) {
    if (!interrupted || !started) throw error;
    const completed = vm.dump(results) as RawResult[];
    // If the active expression had completed, the interruption happened in the batch machinery.
    if (completed.length !== started - 1) throw error;
    completed.push({ error: 'Expression exceeded its execution allowance.', interrupted: true });
    return { results: completed, interrupted: true };
  }
  // Transfer the results without allocating a second copy as JSON inside the sandbox.
  return { results: vm.dump(results) as RawResult[] };
}

/** Resolve an interruption and recover prior bindings when the step was optional. */
function interruptionAt(batch: ExpressionBatch, results: readonly RawResult[]) {
  let ordinal = results.length - 1;
  for (const { expressions, subjects, ordered } of batch.groups) {
    const size = expressions.length * subjects.length;
    if (ordinal < size) {
      const offset = ordinal % expressions.length;
      const resume = ordered?.optional?.includes(offset) && offset + 1 < expressions.length;
      const prior = resume ? results.slice(results.length - 1 - offset, -1) : [];
      return {
        slot: expressions[offset],
        bindings: resume ? prior.flatMap(({ value, error }, index) => {
          const name = ordered?.bind?.[index];
          return name === undefined || error !== undefined ? [] : [{ name, value }];
        }) : null,
      };
    }
    ordinal -= size;
  }
  throw new RangeError('Interrupted expression is outside the check.');
}

/** Evaluate a complete check, restarting only the suffix after any interrupted expression. */
async function evaluateBatch(
  batch: ExpressionBatch,
  expressions: readonly EditorialExpression[],
  bytecode: Uint8Array,
  budget: ExpressionCheckBudget
): Promise<ExpressionResult[][][]> {
  let size = 0;
  for (const group of batch.groups) {
    size += group.expressions.length * group.subjects.length;
    const from = group.windowFromTurn;
    if (from !== undefined && (!batch.facts || !Number.isSafeInteger(from) || from < -1 || from > batch.facts.turn))
      throw new RangeError('Invalid editorial fact window start.');
    if (from !== undefined && batch.facts && from < batch.facts.earliestWindowTurn)
      throw new RangeError('Editorial fact window starts before the loaded evidence.');
    for (const index of group.expressions)
      if (!Number.isInteger(index) || index < 0 || index >= expressions.length)
        throw new RangeError(`Unknown editorial expression index ${index}.`);
  }
  const input = JSON.stringify({
    ...batch,
    facts: batch.facts && packNewspaperFacts(batch.facts),
    wrap: batch.facts && factModelWrap(batch.facts),
  }, (key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new TypeError(`Nonfinite number in editorial expression input at "${key}".`);
    return value;
  });
  const output: RawResult[] = [];
  const disabled = budget.interruptedSlots;
  let resumedBindings: ResumedBinding[] | null = null;
  while (output.length < size && disabled.size < interruptionRecoveryLimit) {
    const chunk = await evaluateRemaining(input, bytecode, output.length, disabled, resumedBindings);
    for (const result of chunk.results) output.push(result);
    if (!chunk.interrupted) break;
    const interruption = interruptionAt(batch, output);
    resumedBindings = interruption.bindings;
    disabled.add(interruption.slot);
  }
  let cursor = 0;
  return batch.groups.map(({ subjects, expressions: slots, ordered }) =>
    subjects.map(() => {
      let stopped = false;
      return slots.map((slot, offset) => {
        const result: RawResult = output[cursor++] ?? (stopped ? {
          error: 'Expression was not reached.', unreached: true,
        } : {
          error: 'Expression skipped because the check reached its interruption limit.',
          skipped: true,
          budgetExhausted: true,
        });
        if (ordered && ((result.error !== undefined && !ordered.optional?.includes(offset)) ||
            (offset < ordered.guardCount && !result.value))) stopped = true;
        const sources = result.sources?.length ? { sources: result.sources } : {};
        return result.error === undefined
          ? { value: result.value, ...sources }
          : {
              error: {
                ...expressions[slot],
                message: result.error,
                ...(result.interrupted ? { interrupted: true } : {}),
                ...(result.skipped ? { skipped: true } : {}),
                ...(result.budgetExhausted ? { budgetExhausted: true } : {}),
                ...(result.unreached ? { unreached: true } : {}),
                ...(result.hidden === undefined ? {} : { hidden: result.hidden }),
              },
              ...sources,
            };
      });
    })
  );
}
/** Prepare one catalogue's expressions, retaining only bytecode and source locations between checks. */
export async function compileEditorialExpressions(
  definitions: readonly EditorialExpression[],
  options: FactDefinitions = {}
): Promise<ExpressionRunner> {
  const expressions = definitions.map((definition) => ({ ...definition }));
  using vm = await createSandbox('compile');
  const bytecode = compileBatch(vm, expressions, options);
  return { evaluate: (batch, budget = { interruptedSlots: new Set() }) => evaluateBatch(batch, expressions, bytecode, budget) };
}
