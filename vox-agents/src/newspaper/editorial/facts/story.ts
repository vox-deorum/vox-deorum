/** Project names and IDs for authored prose from the same subjects expressions can read. */
import type { EditorialCivicTerms } from '../config/civic-terms.js';
import { resolveCivicVocabulary } from './civic-terms.js';
import type { NewspaperFactModel } from './index.js';
import { fact, reference, type FactField, type FactKind, type FactObject, type FactReference } from './model.js';

const kinds = ['city', 'player', 'event', 'incident', 'pair'] as const;

interface StorySubject {
  key: string;
  kind: FactKind | 'world' | 'group';
  fields?: FactObject;
  ref?: FactReference;
}

const identityKeys = ['name', 'id'] as const;
const playerIdentityKeys = [...identityKeys, 'leader'] as const;

/** Find visible subjects without interpreting an authored or recorded label as an ID. */
export function storySubject(key: string, facts?: NewspaperFactModel): StorySubject {
  const slash = key.indexOf('/');
  const rawKind = key.slice(0, slash);
  const kind = kinds.find((entry) => entry === rawKind);
  if (!kind) return { key, kind: key === 'world' ? 'world' : 'group' };
  if (!facts) return { key, kind };
  const rawId = key.slice(slash + 1);
  const id = kind === 'city' || kind === 'player' || kind === 'event' ? Number(rawId) : rawId;
  if (String(id) !== rawId || !(facts.subjects[kind] as readonly (number | string)[]).includes(id))
    return { key, kind };
  const ref = reference(kind, id);
  return { key, kind, ref, fields: storyFields(ref, facts) };
}

/** Follow a permitted reference at its explicit date or the cutoff. */
function storyFields(ref: FactReference, facts: NewspaperFactModel): FactObject | undefined {
  if (ref.kind === 'event') return facts.events.find(({ id }) => id === ref.id)?.fields;
  if (ref.kind === 'incident') return facts.incidents.find(({ id }) => id === ref.id)?.fields;
  const subject = ref.kind === 'city' ? facts.cities[Number(ref.id)] :
    ref.kind === 'player' ? facts.players[Number(ref.id)] : facts.pairs[ref.id];
  const turn = ref.turn;
  if (turn === undefined) return subject?.current;
  for (let index = (subject?.history.length ?? 0) - 1; index >= 0; index--) {
    const entry = subject!.history[index];
    if (entry.turn <= turn) return entry.fields;
  }
  return undefined;
}

/** Copy a readable identity field into prose metadata, retaining the sources behind a reference. */
function readIdentity(fields: FactObject | undefined, key: typeof playerIdentityKeys[number], link?: FactField): FactField | undefined {
  const field = fields?.[key];
  if (typeof field?.value !== 'number' && typeof field?.value !== 'string') return undefined;
  if (key === 'leader' && (typeof field.value !== 'string' || !field.value.trim())) return undefined;
  return fact(field.value, [...(link?.sources ?? []), ...(field.sources ?? [])]);
}

/** Read one visible player's civic slots as prose fields, adding the link that reached them. */
function civicIdentity(
  fields: FactObject | undefined,
  civic: EditorialCivicTerms | undefined,
  link?: FactField
): Record<string, FactField> {
  const result: Record<string, FactField> = Object.create(null);
  if (!civic || !fields) return result;
  for (const [slot, term] of resolveCivicVocabulary(fields, civic))
    result[`civic.${slot}`] = fact(term.value, [...(link?.sources ?? []), ...term.sources]);
  return result;
}

/** List the runtime placeholder names for one subject or reference identity field. */
export function identityNames(kind: StorySubject['kind'], key: string, reference?: string): string[] {
  if (reference !== undefined) {
    const names = [`${kind}.${reference}.${key}`];
    if (key === 'name') names.push(reference);
    else if (key === 'id') names.push(`${reference}Id`);
    else if (key.startsWith('civic.')) names.push(`${reference}.${key}`);
    return names;
  }
  const names = [`${kind}.${key}`, `subject.${key}`];
  if (key === 'name') names.push(kind);
  else if (key === 'id') names.push(`${kind}Id`);
  else if (key.startsWith('civic.')) names.push(key);
  return names;
}

/** Add qualified identity fields and short name and ID aliases for the visible subjects. */
export function storyIdentity(
  subject: StorySubject,
  facts?: NewspaperFactModel,
  civic?: EditorialCivicTerms
): Record<string, FactField> {
  const fields: Record<string, FactField> = Object.create(null);
  for (const key of subject.kind === 'player' ? playerIdentityKeys : identityKeys) {
    const field = readIdentity(subject.fields, key);
    if (!field) continue;
    for (const name of identityNames(subject.kind, key)) fields[name] = field;
  }
  if (subject.kind === 'player')
    for (const [key, field] of Object.entries(civicIdentity(subject.fields, civic)))
      for (const name of identityNames(subject.kind, key)) fields[name] = field;
  if (!facts) return fields;
  for (const [name, link] of Object.entries(subject.fields ?? {})) {
    const value = link.value;
    if (typeof value !== 'object' || value === null || !('$kind' in value) || value.$kind !== 'reference') continue;
    const ref = value as FactReference;
    const target = storyFields(ref, facts);
    if (!target) continue;
    for (const key of ref.kind === 'player' ? playerIdentityKeys : identityKeys) {
      const field = readIdentity(target, key, link);
      if (!field) continue;
      for (const alias of identityNames(subject.kind, key, name)) fields[alias] = field;
    }
    if (ref.kind === 'player')
      for (const [key, field] of Object.entries(civicIdentity(target, civic, link)))
        for (const alias of identityNames(subject.kind, key, name)) fields[alias] = field;
  }
  return fields;
}
