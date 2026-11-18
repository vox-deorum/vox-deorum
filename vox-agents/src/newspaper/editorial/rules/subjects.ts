/** Enumerate subjects exclusively from the check's permitted fact model. */
import type { EditorialTriggerRule } from '../config/schema.js';
import type { NewspaperFactModel } from '../facts/index.js';
import { reference } from '../facts/model.js';
import type { ExpressionBindings } from '../shared/expressions.js';

export interface RuleSubject {
  key: string;
  bindings: ExpressionBindings;
  sources?: NewspaperFactModel['events'][number]['sources'];
}

/** Identify one rule and subject for repeat memory and continuing coverage. */
export function ruleSubjectKey(rule: string, subject: string): string {
  return JSON.stringify([rule, subject]);
}
/** Return stable subject identities; event filters always use the reporting period. */
export function listRuleSubjects(rule: EditorialTriggerRule, facts: NewspaperFactModel): RuleSubject[] {
  switch (rule.subject) {
    case 'world':
      return [{ key: 'world', bindings: {} }];
    case 'city':
    case 'player': {
      const kind = rule.subject;
      return [...facts.subjects[kind]].sort((a, b) => a - b).map(id => ({
        key: `${kind}/${id}`, bindings: { [kind]: reference(kind, id) },
      }));
    }
    case 'event': {
      const types = new Set(typeof rule.event === 'string' ? [rule.event] : rule.event);
      return facts.events.filter(event =>
        event.turn > facts.previous && event.turn <= facts.turn &&
        typeof event.fields.type?.value === 'string' && types.has(event.fields.type.value)
      ).sort((a, b) => a.turn - b.turn || a.id - b.id).map(event => ({
        key: `event/${event.id}`, bindings: { event: reference('event', event.id) }, sources: event.sources,
      }));
    }
    case 'pair':
    case 'incident':
      return [];
  }
}
