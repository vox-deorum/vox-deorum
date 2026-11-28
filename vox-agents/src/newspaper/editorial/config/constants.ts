/** Validate authored constants and resolve game-speed-dependent expression bindings. */
import { parse } from 'acorn';
import { z } from 'zod';
import { editorialShortcutSubjects } from '../shared/expressions.js';

const reservedValueNames = new Set([
  ...editorialShortcutSubjects, 'world', 'self', 'cities', 'players', 'events', 'pairs', 'incidents',
  'turn', 'game', 'activeResolution', 'held', 'crossed', 'dropped', 'pct', 'changed', 'majorsWith', 'key', 'matches',
  'press', 'printed', 'story',
  'values', 'triggerValues', 'group', 'subject', 'period', '$kind',
  'cityId', 'playerId', 'pairId', 'eventId', 'incidentId', 'ownerId',
  'globalThis', 'undefined', 'Infinity', 'NaN', '__proto__', 'constructor',
  'Object', 'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'String', 'Array', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError',
  'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'Math', 'JSON', 'Reflect', 'Proxy', 'Iterator', 'Date', 'Promise', 'parseInt', 'parseFloat',
  'isFinite', 'isNaN', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'escape', 'unescape',
]);

/** Identifier names must be usable as unescaped bindings in strict JavaScript. */
function isBindingName(name: string): boolean {
  if (!/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name)) return false;
  try {
    parse(`"use strict"; let ${name};`, { ecmaVersion: 'latest' });
    return true;
  } catch {
    return false;
  }
}

const identifierSchema = z.string().refine(isBindingName, 'Expected a JavaScript identifier.');
const constantNameSchema = identifierSchema.refine(
  name => !reservedValueNames.has(name) && name !== 'distance' && name !== 'count',
  'Name collides with an expression binding.',
);
/** The documented distance and count values are local to a rule and may reuse those names. */
export const editorialValueNameSchema = identifierSchema.refine(
  name => !reservedValueNames.has(name), 'Name collides with an expression binding.',
);
const shortcutNameSchema = identifierSchema.refine(name => !['knows', 'get', 'relations', 'toJSON'].includes(name), 'Name is reserved by the fact view.');
const spanSchema = z.number().positive();
const shortcutGroupSchema = z.record(shortcutNameSchema, z.string().refine(source => source.trim().length > 0, 'Expected an expression.'));
const termGroupSchema = z.record(
  constantNameSchema, z.string().refine(source => source.trim().length > 0, 'Expected an expression.')
);

/** Authoring format and serialized replay format. Spans are always stored in Standard turns. */
export const editorialConstantsSchema = z.strictObject({
  distances: z.record(constantNameSchema, z.number().int().nonnegative()),
  spans: z.record(constantNameSchema, spanSchema).and(z.object({ long: spanSchema })),
  sizes: z.record(constantNameSchema, z.number().int().nonnegative()),
  shares: z.record(constantNameSchema, z.number().min(0).max(1)),
  types: z.record(constantNameSchema, z.array(z.string().min(1))),
  tiers: z.record(constantNameSchema, z.number().finite()),
  stakes: z.partialRecord(z.enum(editorialShortcutSubjects), shortcutGroupSchema),
  shortcuts: z.partialRecord(z.enum(editorialShortcutSubjects), shortcutGroupSchema),
  terms: termGroupSchema.optional(),
}).superRefine((constants, ctx) => {
  const seen = new Set<string>();
  for (const group of ['distances', 'spans', 'sizes', 'shares', 'types', 'tiers'] as const) {
    for (const name of Object.keys(constants[group])) {
      if (seen.has(name)) ctx.addIssue({
        code: 'custom', path: [group, name], message: `Duplicate expression constant "${name}".`,
      });
      seen.add(name);
    }
  }
});

export type EditorialConstants = z.infer<typeof editorialConstantsSchema>;
type ScaledEditorialConstants = Readonly<Record<string, number | string | readonly string[]> & { long: number }>;

/** Resolve a named span or a literal in Standard turns to a positive whole recorded count. */
export function resolveEditorialSpan(
  span: string | number,
  constants: EditorialConstants,
  speedMultiplier: number,
): number {
  if (typeof span === 'string' && !Object.hasOwn(constants.spans, span))
    throw new RangeError(`Unknown editorial span "${span}".`);
  const standardTurns = typeof span === 'number' ? span : constants.spans[span];
  if (!Number.isFinite(standardTurns) || standardTurns <= 0 || !Number.isFinite(speedMultiplier) || speedMultiplier <= 0)
    throw new RangeError('Editorial spans and game speed multipliers must be finite and positive.');
  const turns = Math.max(1, Math.round(standardTurns * speedMultiplier));
  if (!Number.isSafeInteger(turns)) throw new RangeError('Editorial span has too many recorded turns.');
  return turns;
}

/** Flatten constants for expressions without changing the saved Standard turn spans. */
export function scaleEditorialConstants(constants: EditorialConstants, speedMultiplier: number): ScaledEditorialConstants {
  return {
    ...constants.distances, ...constants.sizes, ...constants.shares, ...constants.types,
    ...Object.fromEntries(Object.keys(constants.tiers).map(name => [name, name])),
    ...Object.fromEntries(Object.keys(constants.spans).map(name => [
      name, resolveEditorialSpan(name, constants, speedMultiplier),
    ])),
    long: resolveEditorialSpan('long', constants, speedMultiplier),
  };
}
