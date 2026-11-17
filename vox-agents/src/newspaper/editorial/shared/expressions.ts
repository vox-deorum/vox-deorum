/** Compile editorial expressions once and evaluate each check in a fresh QuickJS sandbox. */
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { Intrinsics, QuickJS, type QuickJSOptions } from 'quickjs-wasi';
import { errorMessage } from '../../../utils/errors.js';

type FactValue = null | boolean | number | string | readonly FactValue[] | ExpressionBindings;
/** Only JSON data crosses from the fact builders into the sandbox. */
export interface ExpressionBindings {
  readonly [name: string]: FactValue;
}

export interface EditorialExpression {
  rule: string;
  field: string;
  source: string;
}

export interface ExpressionBatch {
  globals?: ExpressionBindings;
  groups: readonly {
    /** Zero-based indices in the list supplied at compile time. */
    expressions: readonly number[];
    /** Local bindings, which can override check globals. */
    subjects: readonly ExpressionBindings[];
  }[];
}

type ExpressionValue = undefined | null | boolean | number | string;
export type ExpressionResult =
  { value: ExpressionValue } | { error: EditorialExpression & { message: string; skipped?: true } };

export interface ExpressionRunner {
  /** Evaluate results in group, subject and expression order. */
  evaluate(batch: ExpressionBatch): Promise<ExpressionResult[][][]>;
}

const filename = 'newspaper-expressions.js';
const memoryLimit = 64 * 1024 * 1024;
const stackLimit = 256 * 1024;
const interruptLimit = 2_000;
const interruptionRecoveryLimit = 8;
type RawResult = { value?: ExpressionValue; error?: string; skipped?: true };
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
(function run(expressions, batch) {
  'use strict';
  delete globalThis.editorialBatch;
  delete globalThis.queueMicrotask;
  delete Math.random;
  const input = JSON.parse(batch.input);
  const disabled = new Set(JSON.parse(batch.disabled));
  const { begin, results } = batch;
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
  freeze(input);

  // Copy only scalar results so they can be retrieved safely if the VM interrupts.
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

  for (const { expressions: slots, subjects } of input.groups) {
    const size = slots.length * subjects.length;
    if (skip >= size) {
      skip -= size;
      continue;
    }
    for (let index = Math.floor(skip / slots.length); index < subjects.length; index++) {
      const bindings = Object.freeze(Object.assign(Object.create(null), input.globals, subjects[index]));
      for (let offset = skip % slots.length; offset < slots.length; offset++) {
        const slot = slots[offset];
        begin();
        results.push(disabled.has(slot)
          ? { error: 'Expression exceeded its allowance earlier in this check.', skipped: true }
          : evaluate(slot, bindings));
      }
      skip = 0;
    }
  }
  return JSON.stringify(results);
})([
`;
const endBatch = `], globalThis.editorialBatch);`;

/** Build a function with named fact bindings and strict expression semantics. */
function expressionFunction(source: string): string {
  return `function (bindings) {
  with (bindings) return (function () {
    'use strict';
    return (
${source}
    );
  })();
}`;
}

/** Compile the whole program, locating a QuickJS parser failure by its expression. */
function compileBatch(vm: QuickJS, expressions: readonly EditorialExpression[]): Uint8Array {
  const functions = expressions.map((expression) => {
    validateExpression(expression);
    return expressionFunction(expression.source);
  });
  try {
    return vm.compile(startBatch + functions.join(',\n') + endBatch, filename);
  } catch (error) {
    // QuickJS may reject syntax newer than its engine supports. Report the individual expression.
    for (let index = 0; index < functions.length; index++) {
      try {
        vm.compile(`(${functions[index]})`, filename);
      } catch (syntaxError) {
        throw expressionError(expressions[index], syntaxError);
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
  disabled: ReadonlySet<number>
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
  using payload = vm.newString(input);
  using skipCount = vm.newNumber(skip);
  using disabledSlots = vm.newString(JSON.stringify([...disabled]));
  vm.setProp(batch, 'input', payload);
  vm.setProp(batch, 'skip', skipCount);
  vm.setProp(batch, 'disabled', disabledSlots);
  vm.setProp(batch, 'begin', begin);
  vm.setProp(batch, 'results', results);
  vm.setProp(vm.global, 'editorialBatch', batch);
  try {
    using result = vm.evalBytecode(bytecode);
    return { results: JSON.parse(result.toString()) };
  } catch (error) {
    if (!interrupted || !started) throw error;
    const completed = vm.dump(results) as RawResult[];
    // If the active expression had completed, the interruption happened in the batch machinery.
    if (completed.length !== started - 1) throw error;
    completed.push({ error: 'Expression exceeded its execution allowance.' });
    return { results: completed, interrupted: true };
  }
}

/** Resolve an interrupted position back to its compiled expression across all groups. */
function slotAt(batch: ExpressionBatch, ordinal: number): number {
  for (const group of batch.groups) {
    const slots = group.expressions;
    const size = slots.length * group.subjects.length;
    if (ordinal < size) return slots[ordinal % slots.length];
    ordinal -= size;
  }
  throw new RangeError('Interrupted expression is outside the check.');
}

/** Evaluate a complete check, restarting only the suffix after any interrupted expression. */
async function evaluateBatch(
  batch: ExpressionBatch,
  expressions: readonly EditorialExpression[],
  bytecode: Uint8Array
): Promise<ExpressionResult[][][]> {
  let size = 0;
  for (const group of batch.groups) {
    size += group.expressions.length * group.subjects.length;
    for (const index of group.expressions)
      if (!Number.isInteger(index) || index < 0 || index >= expressions.length)
        throw new RangeError(`Unknown editorial expression index ${index}.`);
  }
  const input = JSON.stringify(batch, (key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new TypeError(`Nonfinite number in editorial expression input at "${key}".`);
    return value;
  });
  const output: RawResult[] = [];
  const disabled = new Set<number>();
  while (output.length < size && disabled.size < interruptionRecoveryLimit) {
    const chunk = await evaluateRemaining(input, bytecode, output.length, disabled);
    for (const result of chunk.results) output.push(result);
    if (!chunk.interrupted) break;
    disabled.add(slotAt(batch, output.length - 1));
  }
  let cursor = 0;
  return batch.groups.map(({ subjects, expressions: slots }) =>
    subjects.map(() =>
      slots.map((slot) => {
        const result: RawResult = output[cursor++] ?? {
          error: 'Expression skipped because the check reached its interruption limit.',
          skipped: true,
        };
        return result.error === undefined
          ? { value: result.value }
          : {
              error: {
                ...expressions[slot],
                message: result.error,
                ...(result.skipped ? { skipped: true } : {}),
              },
            };
      })
    )
  );
}

/** Prepare one catalogue's expressions, retaining only bytecode and source locations between checks. */
export async function compileEditorialExpressions(
  definitions: readonly EditorialExpression[]
): Promise<ExpressionRunner> {
  const expressions = definitions.map((definition) => ({ ...definition }));
  using vm = await createSandbox('compile');
  const bytecode = compileBatch(vm, expressions);
  return { evaluate: (batch) => evaluateBatch(batch, expressions, bytecode) };
}
