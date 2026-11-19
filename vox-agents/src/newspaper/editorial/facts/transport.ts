/** Compact transport between the fact builders and the bounded QuickJS heap. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { DatedFact, FactSubject, NewspaperFactModel } from './index.js';
import type { FactObject } from './model.js';

interface PackedSubject {
  readonly c?: string;
  readonly history: readonly { turn: number; segment?: number; f?: string; s?: number }[];
}

/** The wire keeps each record opaque until a rule needs it and interns repeated citations. */
interface PackedDatedFact<Id> { readonly id: Id; readonly turn: number; readonly f: string; readonly s: number }

export interface PackedNewspaperFacts extends Omit<NewspaperFactModel, 'game' | 'cities' | 'players' | 'events' | 'pairs' | 'incidents'> {
  readonly g: string;
  readonly cities: Readonly<Record<number, PackedSubject>>;
  readonly players: Readonly<Record<number, PackedSubject>>;
  readonly pairs: Readonly<Record<string, PackedSubject>>;
  readonly events: readonly PackedDatedFact<number>[];
  readonly incidents: readonly PackedDatedFact<string>[];
  readonly sources: readonly NewspaperSourceReference[];
  readonly sourceLists: readonly (readonly number[])[];
}

/** Preserve row identity, ordering and dates while storing recurring references once per check. */
export function packNewspaperFacts(model: NewspaperFactModel): PackedNewspaperFacts {
  const sources: NewspaperSourceReference[] = [];
  const sourceIds = new Map<string, number>();
  const sourceLists: number[][] = [];
  const listIds = new Map<string, number>();
  const packedLists = new WeakMap<readonly NewspaperSourceReference[], number>();

  /** Share ordered lists as well as their individual source references. */
  function packSources(rows: readonly NewspaperSourceReference[]): number {
    const cached = packedLists.get(rows);
    if (cached !== undefined) return cached;
    const ids = rows.map(row => {
      const key = `${row.table}/${row.id}/${row.turn}/${row.createdAt}`;
      const id = sourceIds.get(key);
      if (id !== undefined) return id;
      const next = sources.length;
      sources.push({ ...row });
      sourceIds.set(key, next);
      return next;
    });
    const key = ids.join('/');
    let index = listIds.get(key);
    if (index === undefined) {
      index = sourceLists.length;
      sourceLists.push(ids);
      listIds.set(key, index);
    }
    packedLists.set(rows, index);
    return index;
  }

  /** Keep unrequested facts as text, without duplicating original row references in every field. */
  function packFields(fields: FactObject): string {
    return JSON.stringify(fields, (key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new TypeError(`Nonfinite number in editorial expression input at "${key}".`);
      // A recorded field named "sources" is wrapped in a FactField, so it cannot match this array.
      return key === 'sources' && Array.isArray(value) ? packSources(value) : value;
    });
  }

  /** Pack a timeline without dropping gaps or changing its dated subject keys. */
  function packSubjects(subjects: Readonly<Record<string, FactSubject>>): Record<string, PackedSubject> {
    return Object.fromEntries(Object.entries(subjects).map(([id, { current, history }]) => [id, {
      c: current && packFields(current),
      history: history.map(({ turn, segment, fields, sources }) => ({
        turn, segment, f: fields && packFields(fields), s: sources && packSources(sources),
      })),
    }]));
  }

  /** Pack dated event and incident rows using the same lazy record format. */
  function packDated<Id extends string | number>(items: readonly DatedFact<Id>[]): PackedDatedFact<Id>[] {
    return items.map(({ id, turn, fields, sources }) => ({
      id, turn, f: packFields(fields), s: packSources(sources),
    }));
  }

  return {
    turn: model.turn, previous: model.previous, earliestWindowTurn: model.earliestWindowTurn,
    earliestSnapshotTurn: model.earliestSnapshotTurn,
    longTurns: model.longTurns, receiverId: model.receiverId,
    g: packFields(model.game),
    press: model.press,
    subjects: model.subjects,
    cities: packSubjects(model.cities),
    players: packSubjects(model.players),
    pairs: packSubjects(model.pairs),
    events: packDated(model.events),
    incidents: packDated(model.incidents),
    sources, sourceLists,
  };
}

/** Trusted guest code. The returned facades remain private to one check's fact runtime. */
export const unpackFactSource = `
function unpackFacts(wire) {
  const lists = wire.sourceLists.map(list => list.map(id => wire.sources[id]));
  const records = new Map();

  // Each raw field uses an interned citation list. Game fields named sources stay wrapped.
  function unpackSource(key, value) {
    return key === 'sources' && Number.isInteger(value) ? lists[value] : value;
  }

  // Keep hot rows for repeated snapshot and rank lookups without inflating the entire archive.
  function unpackFields(text) {
    if (text === undefined) return undefined;
    const cached = records.get(text);
    if (cached !== undefined) return cached;
    const fields = JSON.parse(text, unpackSource);
    if (records.size >= 256) records.delete(records.keys().next().value);
    records.set(text, fields);
    return fields;
  }

  const row = {
    get fields() { return unpackFields(this.f); },
    get sources() { return lists[this.s]; },
  };
  const subject = {
    get current() { return unpackFields(this.c); },
  };

  // Give dated rows shared lazy getters without changing the parsed wire.
  function unpackRow(item) {
    return Object.assign(Object.create(row), item);
  }
  function unpackSubjects(subjects) {
    return Object.fromEntries(Object.entries(subjects).map(([id, item]) =>
      [id, Object.assign(Object.create(subject), { c: item.c, history: item.history.map(unpackRow) })]));
  }
  return {
    turn: wire.turn, previous: wire.previous, earliestWindowTurn: wire.earliestWindowTurn,
    earliestSnapshotTurn: wire.earliestSnapshotTurn,
    longTurns: wire.longTurns, receiverId: wire.receiverId,
    get game() { return unpackFields(wire.g); },
    press: wire.press,
    subjects: wire.subjects,
    cities: unpackSubjects(wire.cities),
    players: unpackSubjects(wire.players),
    pairs: unpackSubjects(wire.pairs),
    events: wire.events.map(unpackRow),
    incidents: wire.incidents.map(unpackRow),
  };
}
`;
