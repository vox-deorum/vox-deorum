/** Decide when a rule's subject can produce another development. */
import { resolveEditorialSpan, type EditorialConstants } from '../config/constants.js';
import type { EditorialTriggerRule } from '../config/schema.js';
import type { TriggerRepeatState } from '../../contracts/triggers.js';

type Repeat = 'once' | 'rearm' | number;

/** Use recorded turns for repeat intervals; events and incidents occur once in a reporting period. */
export function repeatPolicy(rule: EditorialTriggerRule, constants: EditorialConstants, speed: number): Repeat {
  const policy = rule.repeat ?? 'rearm';
  if (rule.subject === 'event' || rule.subject === 'incident') return 'once';
  if (policy === 'once' || policy === 'rearm') return policy;
  return resolveEditorialSpan(policy, constants, speed);
}

/** A first match fires, then the repeat policy consults the last emitted development. */
export function canRepeat(entry: TriggerRepeatState[string] | undefined, policy: Repeat, turn: number): boolean {
  return !entry || (policy === 'rearm' ? entry.armed : typeof policy === 'number' && turn - entry.lastTurn >= policy);
}
