/** Trusted QuickJS program for materializing editor facts inside a single check. */
import { hexDistance, nearestPlotPair, plot } from './distance.js';

// Share the geometry code with the host. The nearest-pair helper calls hexDistance below.
export const factGuestSource = `
const hexDistance = (${hexDistance.toString()});
const plot = (${plot.toString()});
const nearestPlotPair = (${nearestPlotPair.toString()});

// Keep data, source rows and wrapping in this closure. Rules receive only public views.
function factRuntime(model, wrap, constants, shortcuts) {
  const views = new Map();
  const datedFacts = {
    event: new Map(model.events.map(event => [event.id, event])),
    incident: new Map(model.incidents.map(incident => [incident.id, incident])),
  };
  const timelines = { city: model.cities, player: model.players, pair: model.pairs };
  const playerIds = Object.keys(model.players);
  const currentIds = {
    city: new Set(model.subjects.city), player: new Set(model.subjects.player), pair: new Set(model.subjects.pair),
  };
  const subjectInfo = new WeakMap();
  const printedSubjectKeys = new WeakMap();
  const expressionSubjects = new Map();
  const shortcutsByKind = new Map();
  const internalFields = new Set(['relations', 'technologyChanges']);
  const constantNames = new Set(Object.keys(constants ?? {}));
  for (const [kind, name, test] of shortcuts) {
    if (!shortcutsByKind.has(kind)) shortcutsByKind.set(kind, new Map());
    shortcutsByKind.get(kind).set(name, test);
  }
  let hidden;
  let sources = new Map();

  // Copy prior issue memory once and freeze it so expressions cannot alter later checks.
  const press = Object.freeze({
    issues: model.press ? model.press.issues : 0,
    lastIssueTurn: model.press ? model.press.lastIssueTurn : null,
  });
  const printedRules = Object.create(null);
  const printedSubjects = Object.create(null);
  if (model.press) {
    for (const [key, entry] of Object.entries(model.press.rules))
      printedRules[key] = Object.freeze({ turn: entry.turn, count: entry.count });
    for (const [key, entry] of Object.entries(model.press.subjects))
      printedSubjects[key] = Object.freeze({ turn: entry.turn, count: entry.count });
  }
  Object.freeze(printedRules);
  Object.freeze(printedSubjects);

  // Register a printable key for a trusted city, player or pair view.
  function registerPrintedSubject(view, kind, id) {
    if (kind !== 'city' && kind !== 'player' && kind !== 'pair') return;
    if (typeof id === 'number' || typeof id === 'string') printedSubjectKeys.set(view, kind + '/' + id);
  }

  // Return the latest printed count for a rule, optionally limited to one registered subject.
  function printedArticles(ruleId, subject) {
    if (typeof ruleId !== 'string' || ruleId === '') return null;
    if (subject === undefined)
      return Object.hasOwn(printedRules, ruleId) ? printedRules[ruleId] : null;
    const subjectKey = typeof subject === 'object' && subject !== null ? printedSubjectKeys.get(subject) : undefined;
    if (subjectKey === undefined) return null;
    const key = JSON.stringify([ruleId, subjectKey]);
    return Object.hasOwn(printedSubjects, key) ? printedSubjects[key] : null;
  }

  // Record a readable fact's permitted supporting rows once in order of first use.
  function cite(rows) {
    if (rows) for (const row of rows) sources.set(row.table + '/' + row.id, row);
  }

  // A rule cannot recover from a hidden read by catching the error. It can use knows().
  function missing(path) {
    hidden ??= path;
    throw new Error('Hidden or missing fact: ' + path);
  }

  // Probe a shortcut without poisoning the enclosing expression if its inputs are hidden.
  function canReadShortcut(read) {
    const previousHidden = hidden, previousSources = sources;
    hidden = undefined;
    sources = new Map();
    try {
      read();
      if (hidden) return false;
      for (const [key, row] of sources) previousSources.set(key, row);
      return true;
    } catch (error) {
      if (hidden) return false;
      throw error;
    } finally {
      hidden = previousHidden;
      sources = previousSources;
    }
  }

  // Find the latest observation or gap at the requested date.
  function observation(subject, turn) {
    if (!subject || turn < 0 || turn > model.turn) return undefined;
    const entries = subject.history;
    let lo = 0, hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].turn <= turn) lo = mid + 1;
      else hi = mid;
    }
    return entries[lo - 1];
  }

  // Find the known subject's series without exposing timeline data or object prototypes.
  function series(kind, id) {
    const subjects = timelines[kind];
    return subjects && Object.hasOwn(subjects, id) ? subjects[id] : undefined;
  }

  // Group windows share the same evidence, but have different event and comparison views.
  function view(from) {
    if (views.has(from)) return views.get(from);
    const currentSubjectsByKey = new Map();
    const resolutionViews = new WeakMap();
    const selectedEvents = model.events.filter(event => event.turn > from);
    const has = (record, field) => Object.hasOwn(record, field);

    // Resolve only IDs and versions that the builders already established as readable.
    function target(ref, date) {
      if (datedFacts[ref.kind]) return datedFacts[ref.kind].get(ref.id)?.fields;
      const subject = series(ref.kind, ref.id);
      const turn = ref.turn ?? date;
      return ref.turn === undefined && turn === model.turn ? subject?.current : observation(subject, turn)?.fields;
    }

    // Availability can be checked from the timeline without unpacking a referenced row.
    function visibleTarget(ref, date) {
      if (datedFacts[ref.kind]) return datedFacts[ref.kind].has(ref.id);
      const turn = ref.turn ?? date;
      return ref.turn === undefined && turn === model.turn ? currentIds[ref.kind].has(ref.id) :
        observation(series(ref.kind, ref.id), turn)?.segment !== undefined;
    }

    // Array reads cite the entry; length also depends on every readable member.
    function list(items, read, membership) {
      const result = new Array(items.length);
      for (let index = 0; index < items.length; index++)
        Object.defineProperty(result, index, { enumerable: true, get: Object.freeze(() => read(items[index], index)) });
      Object.freeze(result);
      if (!membership) return result;
      return new Proxy(result, {
        get(target, key, receiver) {
          if (key === 'length') for (const item of items) cite(membership(item));
          return Reflect.get(target, key, receiver);
        },
      });
    }

    // Move only public values into the rule, with references and window lists resolved lazily.
    function expose(value, path, date) {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return list(value, (item, index) => expose(item, path + '[' + index + ']', date));
      if (value.$kind === 'reference') return resolve(value, path, date);
      if (value.$kind === 'elapsed') return date - value.since;
      if (value.$kind === 'anchoredPair') return subjectView('pair', value.id, value.turn, value.fields, false, undefined, true);
      if (value.$kind === 'window')
        return list(value.entries.filter(entry => entry.turn > from && entry.turn <= model.turn),
          (entry, index) => read(entry.field, path + '[' + index + ']', date),
          entry => entry.field.sources);
      // Keep active resolution entries identical whether read by index or through the helper.
      if (path.startsWith('game.congress.activeResolutions[')) {
        let resolution = resolutionViews.get(value);
        if (!resolution) resolutionViews.set(value, resolution = record(value, path, date));
        return resolution;
      }
      return record(value, path, date);
    }

    // Reading a declared field is the boundary where its provenance becomes part of this evaluation.
    function read(field, path, date) {
      if (!field) return missing(path);
      cite(field.sources);
      return expose(field.value, path, date);
    }

    // Hide unavailable fields from introspection and still fail a direct property read.
    function record(fields, path, date, methods = {}) {
      const object = Object.create(null);
      for (const key of Object.keys(fields)) {
        if (internalFields.has(key) || key === 'knows' || has(methods, key)) continue;
        if (!knownField(key, false)) continue;
        Object.defineProperty(object, key, {
          enumerable: true, get: Object.freeze(() => read(fields[key], path + '.' + key, date)),
        });
      }
      for (const key of Object.keys(methods))
        if (knownField(key, false)) Object.defineProperty(object, key, { get: Object.freeze(methods[key].get) });
      Object.defineProperty(object, 'knows', { value: Object.freeze(field => knownField(field, true)) });
      // This also lets standard JSON serialization inspect only available public fields.
      if (!has(object, 'toJSON')) Object.defineProperty(object, 'toJSON', { value: undefined });
      Object.freeze(object);
      return new Proxy(object, {
        get(object, key, receiver) {
          if (typeof key === 'symbol' || has(object, key)) return Reflect.get(object, key, receiver);
          if (has(fields, key) && !internalFields.has(key)) cite(fields[key].sources);
          return missing(path + '.' + key);
        },
      });

      // Existence checks avoid reading hidden values and cite a positive resolution.
      function knownField(key, track) {
        if (typeof key !== 'string' || internalFields.has(key)) return false;
        if (has(methods, key)) return methods[key].known(track);
        const field = has(fields, key) ? fields[key] : undefined;
        if (!field || field.hidden || field.value?.$kind === 'reference' && !visibleTarget(field.value, date)) return false;
        if (track) cite(field.sources);
        return true;
      }
    }

    // Date a snapshot and reject a row from a different city that reused the same ID.
    function snapshot(kind, id, date, segment) {
      const entry = observation(series(kind, id), date);
      return entry?.segment !== undefined && entry.segment === segment ? entry : undefined;
    }

    // Give snapshot subjects stable identities and expose only their dated facts.
    function subjectView(kind, id, date, fields, current, entry, anchored = false) {
      const key = (anchored ? 'anchor/' : '') + kind + '/' + id + '/' + date;
      const cache = current && timelines[kind] ? currentSubjectsByKey : expressionSubjects;
      if (cache.has(key)) return cache.get(key);
      const methods = Object.create(null);
      const segment = entry?.segment;
      const subjectShortcuts = shortcutsByKind.get(kind);
      let shortcutsView;
      if (subjectShortcuts)
        method('is', undefined, () => shortcutsView ??= shortcutView(kind, date, result, subjectShortcuts));
      if (kind === 'player') {
        method('rank', Object.freeze(field => rank(id, date, fields, current, field)));
        method('relation', Object.freeze(other => relation(id, date, fields, other)));
        method('hasTechnology', Object.freeze(name => {
          const changes = fields.technologyChanges?.value;
          if (typeof name !== 'string' || !changes || !has(changes, name)) return undefined;
          return read(changes[name], 'player.hasTechnology', date);
        }));
        // Exact recorded policy names only. Counts, empty maps and null give no positive evidence.
        method('hasPolicy', Object.freeze(name => {
          const branches = fields.policyBranches;
          const map = branches?.value;
          if (typeof name !== 'string' || !map || typeof map !== 'object' || Array.isArray(map)) return undefined;
          for (const key of Object.keys(map)) {
            const policies = map[key]?.value;
            if (Array.isArray(policies) && policies.includes(name)) {
              cite(branches.sources);
              return true;
            }
          }
          return undefined;
        }));
        // An exact readable branch key is enough, even when only a policy count is recorded.
        method('hasBranch', Object.freeze(name => {
          const branches = fields.policyBranches;
          const map = branches?.value;
          if (typeof name !== 'string' || branches?.hidden || !map || typeof map !== 'object' || Array.isArray(map))
            return undefined;
          if (!Object.keys(expose(map, 'player.policyBranches', date)).includes(name)) return undefined;
          cite(branches.sources);
          return true;
        }));
        // Count only visible cities with a readable leading cause.
        method('complaintShare', Object.freeze(causes => {
          if (!result.knows('cities')) return 0;
          let readable = 0, matching = 0;
          for (const city of result.cities) {
            if (!city.knows('unhappiness')) continue;
            const unhappiness = city.unhappiness;
            if (!unhappiness.knows('top')) continue;
            const top = unhappiness.top;
            if (top === null) continue;
            readable++;
            if (causes.includes(top)) matching++;
          }
          return readable ? matching / readable : 0;
        }));
      }
      // Current cities expose the receiver's matching tactical zones from the same cutoff observation.
      if (kind === 'city' && current)
        method('tacticalZones', Object.freeze(() => tacticalZonesForCity(result)));
      if (timelines[kind] && current) {
        relative('before', from);
        relative('previous', model.previous);
        method('at', Object.freeze(span => {
          if (!Number.isSafeInteger(span) || span < 0 || span > model.longTurns) return missing(kind + '.at');
          return getSnapshot(date - span, kind + '.at');
        }));
        method('history', undefined, () => {
          const seen = new Set();
          const entries = series(kind, id).history.filter(candidate => {
            if (candidate.segment === undefined || candidate.segment !== segment || candidate.turn > date) return false;
            if (kind === 'pair') return candidate.turn > from;
            const source = candidate.sources[0];
            if (source.turn <= from || seen.has(source.id)) return false;
            seen.add(source.id);
            return true;
          });
          return list(entries, candidate => {
            cite(candidate.sources);
            return subjectView(kind, id, candidate.turn, candidate.fields, false, candidate);
          }, candidate => candidate.sources);
        });
      }
      const result = record(fields, kind, date, methods);
      cache.set(key, result);
      subjectInfo.set(result, { kind, id, date, segment, anchored });
      registerPrintedSubject(result, kind, anchored && kind === 'pair' ? fields.id?.value : id);
      return result;

      // Present native-looking immutable helper methods rather than wire-only descriptors.
      function method(name, value, get = () => value) {
        methods[name] = { known: () => true, get };
      }
      // A missing cutoff/previous observation stays hidden, even with a stale earlier row.
      function relative(name, date) {
        methods[name] = {
          known: track => {
            const prior = pastObservation(date);
            if (track && prior) cite(prior.sources);
            return !!prior;
          },
          get: () => getSnapshot(date, kind + '.' + name),
        };
      }
      // Attach the observation's evidence to reading a temporal subject.
      function getSnapshot(date, path) {
        const prior = pastObservation(date);
        if (!prior) return missing(path);
        cite(prior.sources);
        let past = prior.fields;
        // Older phases can prove war or peace, but their score cannot seed this phase's trend.
        if (kind === 'pair' && prior.segment !== segment && has(past, 'warScore')) {
          past = { ...past };
          delete past.warScore;
        }
        return subjectView(kind, id, date, past, false, prior);
      }
      // Pairs retain prior known states across phase changes; cities must keep the same lifetime.
      function pastObservation(date) {
        if (kind !== 'pair') return snapshot(kind, id, date, segment);
        if (date < model.earliestSnapshotTurn) return undefined;
        const prior = observation(series(kind, id), date);
        return prior?.segment === undefined ? undefined : prior;
      }
      // Match a zone only when the readable city name and the absolute zone ID both agree.
      function tacticalZonesForCity(city) {
        if (!city.knows('id') || !city.knows('name')) return undefined;
        if (!currentIds.player.has(model.receiverId)) return undefined;
        const self = resolve({ kind: 'player', id: model.receiverId }, 'self', model.turn);
        if (!self.knows('tacticalZones')) return undefined;
        const zones = self.tacticalZones;
        if (!Array.isArray(zones)) return undefined;
        const id = city.id, name = city.name;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof name !== 'string') return undefined;
        return zones.filter(zone => zone.knows('city') && zone.knows('zoneID') &&
          zone.city === name && Math.abs(zone.zoneID) === id);
      }
    }

    // Rebind the shortcut to the actual dated subject, with this group's globals and constants.
    function shortcutView(kind, date, subject, definitions) {
      const path = kind + '.is';
      const bindings = Object.freeze(Object.assign(Object.create(globals), { [kind]: subject }));
      const methods = Object.create(null);
      const active = new Set();
      for (const [name, test] of definitions) {
        const get = () => {
          if (active.has(name)) throw new Error('Circular shortcut: ' + path + '.' + name);
          active.add(name);
          try {
            return !!test(bindings);
          } finally {
            active.delete(name);
          }
        };
        methods[name] = { get, known: track => !track || canReadShortcut(get) };
      }
      return record(Object.create(null), path, date, methods);
    }

    // A reference follows the queried snapshot's turn unless it specifies a date.
    function resolve(ref, path, date) {
      if (datedFacts[ref.kind]) {
        const item = datedFacts[ref.kind].get(ref.id);
        if (!item) return missing(path);
        cite(item.sources);
        return subjectView(ref.kind, ref.id, model.turn, item.fields, true, undefined);
      }
      const turn = ref.turn ?? date;
      const current = ref.turn === undefined && turn === model.turn;
      const entry = observation(series(ref.kind, ref.id), turn);
      const fields = target(ref, date);
      if (!fields) return missing(path);
      return subjectView(ref.kind, ref.id, turn, fields, current, entry);
    }

    // No unknown competitor is treated as zero or permitted to establish a rank.
    function rank(id, date, fields, current, field) {
      if (typeof field !== 'string' || fields.major?.value !== true || !Number.isFinite(fields[field]?.value))
        return missing('player.rank');
      cite(fields.major.sources);
      cite(fields[field].sources);
      const value = fields[field].value;
      let position = 1;
      for (const key of playerIds) {
        if (Number(key) === id) continue;
        const target = current ? model.players[key].current : observation(model.players[key], date)?.fields;
        if (target?.major?.value !== true || !Number.isFinite(target[field]?.value)) continue;
        cite(target.major.sources);
        cite(target[field].sources);
        if (target[field].value > value) position++;
      }
      return position;
    }

    // Resolve the latest directional observations on both sides at the queried date.
    function relation(id, date, fields, other) {
      const info = subjectInfo.get(other);
      const otherId = info?.kind === 'player' ? info.id : Number.isSafeInteger(other) ? other : undefined;
      const target = otherId === undefined ? undefined : observation(model.players[otherId], date)?.fields;
      if (!target) return missing('player.relation');
      const direct = fields.relations?.value[otherId];
      const reverse = target.relations?.value[id];
      const directTurn = direct?.sources?.[0]?.turn ?? -Infinity;
      const reverseTurn = reverse?.sources?.[0]?.turn ?? -Infinity;
      const forward = directTurn >= reverseTurn ? direct?.value : undefined;
      const backward = reverseTurn >= directTurn ? reverse?.value : undefined;
      const rows = [...(forward ? direct.sources : []), ...(backward ? reverse.sources : [])];
      if (!direct && !reverse) {
        rows.push(...(fields.relations?.value.$gap?.sources ?? []), ...(target.relations?.value.$gap?.sources ?? []));
      }
      const atWar = forward?.state.value === 'war' || backward?.state.value === 'war';
      const atPeace = forward?.state.value === 'peace' || backward?.state.value === 'peace';
      const unresolved = rows.length > 0 && atWar === atPeace;
      const vassal = forward?.vassalOf.value === true || backward?.masterOf.value === true;
      const master = forward?.masterOf.value === true || backward?.vassalOf.value === true;
      const available = {
        war: unresolved ? { hidden: true, sources: rows } : { value: atWar, sources: rows },
        friend: { value: forward?.friend.value === true || backward?.friend.value === true, sources: rows },
        pact: { value: forward?.pact.value === true || backward?.pact.value === true, sources: rows },
        vassalOf: { value: vassal && !master, sources: rows },
        masterOf: { value: master && !vassal, sources: rows },
      };
      if (unresolved) available.warScore = { hidden: true, sources: rows };
      else if (atWar && forward?.warScore) available.warScore = forward.warScore;
      else if (atWar && backward?.warScore)
        available.warScore = { value: -backward.warScore.value, sources: backward.warScore.sources };
      // A positive observation on either side proves a denouncement; only the outgoing row can prove absence.
      const positive = (...fields) => {
        const present = fields.filter(field => field && field.value === true);
        if (present.length) return { value: true, sources: present.flatMap(field => field.sources ?? []) };
        return undefined;
      };
      const denouncedThem = positive(forward?.denouncedThem, backward?.denouncedByThem);
      if (denouncedThem) available.denouncedThem = denouncedThem;
      else if (forward?.denouncedThem?.value === false)
        available.denouncedThem = { value: false, sources: forward.denouncedThem.sources };
      const denouncedByThem = positive(forward?.denouncedByThem, backward?.denouncedThem);
      if (denouncedByThem) available.denouncedByThem = denouncedByThem;
      else if (backward?.denouncedThem?.value === false)
        available.denouncedByThem = { value: false, sources: backward.denouncedThem.sources };
      if (forward?.openBordersTo) available.openBordersTo = forward.openBordersTo;
      if (backward?.openBordersTo) available.openBordersFrom = backward.openBordersTo;
      const proximity = forward?.proximity ?? backward?.proximity;
      if (proximity) available.proximity = proximity;
      if (atWar && !atPeace && forward?.warWeariness) available.warWeariness = forward.warWeariness;
      const influence = forward?.influence ?? backward?.influence;
      if (influence) available.influence = influence;
      const protection = forward?.protected ?? backward?.protected;
      if (protection) available.protected = protection;
      return record(available, 'player.relation', date);
    }

    // Unloaded turns are hidden. Within covered history, a gap makes held false regardless of the test.
    function held(subject, test, span) {
      const info = subjectInfo.get(subject);
      if (!info || !timelines[info.kind] || info.anchored || typeof test !== 'function' ||
          !Number.isSafeInteger(span) || span < 1) return false;
      // Pair spans compare the score at both endpoints, and every dated observation between them.
      const first = info.date - span + (info.kind === 'pair' ? 0 : 1);
      if (first < model.earliestSnapshotTurn) return missing('held');
      const history = series(info.kind, info.id);
      const current = info.kind === 'pair' ? observation(history, info.date) : undefined;
      let priorPhase, phaseStart;
      for (let date = first; date <= info.date; date++) {
        const entry = observation(history, date);
        if (entry?.segment === undefined || (info.kind === 'pair' ? entry.turn !== date : entry.segment !== info.segment)) {
          if (info.kind === 'pair') {
            cite(entry?.sources);
            cite(current?.sources);
          }
          return false;
        }
        if (info.kind === 'pair') {
          if (entry.segment !== info.segment) priorPhase = entry;
          else phaseStart ??= entry;
        }
      }
      if (priorPhase) {
        cite(priorPhase.sources);
        cite(phaseStart?.sources);
        cite(current?.sources);
        return false;
      }
      for (let date = first; date <= info.date; date++) {
        const entry = snapshot(info.kind, info.id, date, info.segment);
        cite(entry.sources);
        if (!test(subjectView(info.kind, info.id, date, entry.fields, false, entry))) return false;
      }
      return true;
    }

    // Compare lists and recorded mappings by their readable values, and links by subject identity.
    function same(now, past) {
      if (now === past) return true;
      if (now === null || past === null || typeof now !== 'object' || typeof past !== 'object') return false;
      const a = subjectInfo.get(now), b = subjectInfo.get(past);
      if (a || b) return a?.kind === b?.kind && a?.id === b?.id && a?.segment === b?.segment;
      const keys = Object.keys(now), former = Object.keys(past);
      return keys.length === former.length && keys.every(key => has(past, key) && same(now[key], past[key]));
    }

    // Resolve an event's plot; city and plain plot objects already have coordinates.
    function point(value) {
      const source = subjectInfo.get(value)?.kind === 'event' ? value.plot : value;
      return source == null ? undefined : plot(source.x, source.y);
    }

    // A player contributes every visible city at the cutoff, with the rows that prove ownership.
    function distanceOperand(value) {
      const info = subjectInfo.get(value);
      if (info?.kind === 'player') {
        const cities = model.players[info.id]?.current?.cities?.value ?? [];
        const positions = [];
        for (const city of cities) {
          const { x, y } = model.cities[city.id]?.current ?? {};
          const position = plot(x?.value, y?.value);
          if (position) positions.push({ ...position, sources: x.sources });
        }
        return positions;
      }
      const position = point(value);
      return position ? [position] : [];
    }

    const globals = Object.create(null);
    Object.defineProperties(globals, {
      self: { get: Object.freeze(() => resolve({ kind: 'player', id: model.receiverId }, 'self', model.turn)) },
      players: { value: currentSubjects('player') },
      cities: { value: currentSubjects('city') },
      events: { value: list(selectedEvents, event => resolve({ kind: 'event', id: event.id }, 'event', model.turn),
        event => event.sources) },
      turn: { value: model.turn },
      press: { value: press },
      printed: { value: Object.freeze((ruleId, subject) => printedArticles(ruleId, subject)) },
      game: { value: record(model.game, 'game', model.turn) },
      // Find the first named match without reading an unavailable league or agenda.
      activeResolution: { value: Object.freeze(prefix => {
        const game = globals.game;
        if (typeof prefix !== 'string' || !game.knows('congress')) return undefined;
        const congress = game.congress;
        if (!congress.knows('available') || congress.available !== true || !congress.knows('activeResolutions'))
          return undefined;
        return congress.activeResolutions.find(resolution =>
          resolution.knows('name') && typeof resolution.name === 'string' && resolution.name.startsWith(prefix));
      }) },
      distance: { value: Object.freeze((a, b) => {
        const first = distanceOperand(a), second = distanceOperand(b);
        const nearest = nearestPlotPair(first, second, wrap);
        if (!nearest) return missing('distance');
        cite(nearest.from.sources);
        cite(nearest.to.sources);
        return nearest.distance;
      }) },
      held: { value: Object.freeze((subject, test, span) => held(subject, test, span)) },
      crossed: { value: Object.freeze((now, before, boundary) => before < boundary && now >= boundary) },
      dropped: { value: Object.freeze((now, before, boundary) => before >= boundary && now < boundary) },
      pct: { value: Object.freeze((now, before) => before === 0 ? missing('pct') : (now - before) / before) },
      changed: { value: Object.freeze((subject, field) => !same(subject[field], subject.before[field])) },
    });
    Object.freeze(Object.assign(globals, constants));

    // Cite membership in the dated visible set even when a rule reads only the count.
    function currentSubjects(kind) {
      const membership = id => observation(series(kind, id), model.turn)?.sources;
      return list(model.subjects[kind], id => {
        cite(membership(id));
        return resolve({ kind, id }, kind, model.turn);
      }, membership);
    }

    // Give expression bindings the same lazy access to subject references inside match lists.
    function bindingValue(value, path) {
      if (value === null || typeof value !== 'object') return value;
      if (value.$kind === 'reference' && has(model.subjects, value.kind))
        return resolve(value, path, model.turn);
      if (value.$kind === 'subject') {
        const fields = target(value.ref ?? {}, model.turn);
        const subject = record({
          key: { value: value.key }, kind: { value: value.kind },
          ...(fields?.id ? { id: fields.id } : {}),
          ...(fields?.name ? { name: fields.name } : {}),
        }, path, model.turn);
        registerPrintedSubject(subject, value.ref?.kind, value.ref?.id);
        return subject;
      }
      if (Array.isArray(value)) return list(value, (item, index) => bindingValue(item, path + '[' + index + ']'));
      return bindingRecord(value, path);
    }

    // Bindings carry trusted references alongside plain, immutable expression data.
    function bindingRecord(values, path) {
      const properties = Object.create(null);
      for (const key of Object.keys(values))
        properties[key] = { enumerable: true, get: Object.freeze(() => bindingValue(values[key], path + '.' + key)) };
      return Object.freeze(Object.defineProperties(Object.create(null), properties));
    }

    // Resolve a subject only when the expression actually uses that binding.
    function bindings(globalsInput, local) {
      const descriptors = Object.create(null);
      for (const values of [globalsInput, local]) if (values) for (const key of Object.keys(values)) {
        if (constantNames.has(key)) continue;
        const value = values[key];
        descriptors[key] = { get: Object.freeze(() => bindingValue(value, key)) };
      }
      return Object.freeze(Object.defineProperties(Object.create(globals), descriptors));
    }
    const result = { bindings };
    views.set(from, result);
    return result;
  }

  return {
    view,
    // A fresh tracker for each expression survives caught hidden reads inside authored code.
    reset() { hidden = undefined; sources.clear(); expressionSubjects.clear(); },
    // Return only public references and the name of the unavailable fact.
    result(value) {
      return {
        ...(hidden ? { error: 'Hidden or missing fact: ' + hidden, hidden } : value),
        ...(sources.size ? { sources: [...sources.values()] } : {}),
      };
    },
  };
}
`;
