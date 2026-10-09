/**
 * Tests for importance-based event trimming (src/utils/prompts/event-importance.ts): the explicit
 * tier table names each group of types once, in the approved order, using only the canonical
 * names the knowledge store records, `dropEventTiers` removes tiers by name in any combination
 * (unlisted, missing, and non-string types count as noise, so dropping `noise` removes them
 * together with the noise tier), and `dropLeastImportantEvents` removes one importance group per
 * level from the least important end.
 */
import { describe, expect, it } from 'vitest';
import {
  dropEventTiers,
  dropLeastImportantEvents,
  eventImportanceTiers,
  maxEventTrimLevel,
} from '../../../src/utils/prompts/event-importance.js';

/** A type no tier lists, so it counts as noise and drops with the least important tier. */
const unknownType = 'TypeNotInAnyTier';

/** The first type of every tier, most important first. */
const tierLeaders = eventImportanceTiers.map(tier => tier.types[0]);

/** The least important tier's type: dropped together with unknown types at level 1. */
const noiseType = tierLeaders[tierLeaders.length - 1];

/** The index of the tier with the given name. */
function tierIndex(name: string): number {
  return eventImportanceTiers.findIndex(tier => tier.name === name);
}

/** The name of the tier that explicitly lists a type, or `<unlisted>` when no tier names it. */
function tierOf(type: string): string {
  return eventImportanceTiers.find(tier => (tier.types as readonly string[]).includes(type))?.name ?? '<unlisted>';
}

/** One event of a type, shaped like a consolidated `get-events` entry. */
function event(type: string): { Type: string } {
  return { Type: type };
}

/** A single-turn report holding one event of each given type. */
function reportOf(types: string[]): Record<string, unknown[]> {
  return { '5': types.map(event) };
}

/** The event types a trimmed report still holds, in report order. */
function keptTypes(events: Record<string, unknown[]>): string[] {
  return Object.values(events).flat().map(entry => (entry as { Type: string }).Type);
}

/** The total number of events in a report. */
function countEvents(events: Record<string, unknown[]>): number {
  return Object.values(events).reduce((total, list) => total + list.length, 0);
}

describe('eventImportanceTiers', () => {
  it('should list each explicit type in no more than one tier', () => {
    const listed = new Set<string>();
    for (const tier of eventImportanceTiers) {
      for (const type of tier.types) {
        expect(listed.has(type), `${type} listed twice`).toBe(false);
        listed.add(type);
      }
    }
  });

  it('should keep turning points as the top tier and noise as the bottom one', () => {
    expect(eventImportanceTiers[0].name).toBe('turning-points');
    expect(eventImportanceTiers[eventImportanceTiers.length - 1].name).toBe('noise');
  });

  it('should list canonical names only, leaving the remapped raw names unlisted noise', () => {
    for (const raw of ['PlayerBuilt', 'PlayerBuilding', 'UnitSetXY', 'EspionageNotificationData', 'CityExtendsWLTKD', 'IdeologyAdopted']) {
      expect(tierOf(raw), raw).toBe('<unlisted>');
    }

    // Unlisted raw names drop with the first trim level, together with the noise tier.
    const events = { '5': [...tierLeaders.map(event), event('IdeologyAdopted')] };
    const result = dropLeastImportantEvents(events, 1);
    expect(keptTypes(result.events)).toEqual(tierLeaders.slice(0, -1));
    expect(result.droppedEvents).toBe(2); // the noise-tier leader and the unlisted raw name
  });

  it('should allow trimming past every tier except the top one', () => {
    expect(maxEventTrimLevel).toBe(eventImportanceTiers.length - 1);
  });
});

describe('dropEventTiers', () => {
  it('should drop only the named tiers, in any combination', () => {
    const events = reportOf(tierLeaders);

    // One tier: both its neighbours keep their events.
    const one = dropEventTiers(events, ['progress']);
    expect(keptTypes(one.events)).toEqual(tierLeaders.filter((_, index) => index !== tierIndex('progress')));
    expect(one.droppedEvents).toBe(1);

    // Two tiers at once, and an unnamed tier between them survives.
    const two = dropEventTiers(events, ['combat', 'noise']);
    expect(keptTypes(two.events)).toEqual(
      tierLeaders.filter((_, index) => index !== tierIndex('combat') && index !== tierIndex('noise')),
    );
    expect(two.droppedEvents).toBe(2);
  });

  it('should drop unlisted and malformed events together with the noise tier', () => {
    const events = { '5': [event(tierLeaders[0]), event(noiseType), event(unknownType), { Type: 42 }, {}] };

    const result = dropEventTiers(events, ['noise']);

    expect(keptTypes(result.events)).toEqual([tierLeaders[0]]);
    expect(result.droppedEvents).toBe(4);
  });

  it('should keep every event when no tier is named', () => {
    const events = reportOf([...tierLeaders, unknownType]);

    const result = dropEventTiers(events, []);

    expect(result.events).toEqual(events);
    expect(result.events).not.toBe(events);
    expect(result.droppedEvents).toBe(0);
  });

  it('should keep non-array entries such as the markdown config', () => {
    const markdownConfig = { configs: [{ format: 'Turn {key}' }] };
    const events = { '5': [...tierLeaders, unknownType].map(event), _markdownConfig: markdownConfig };

    const trimmed = dropEventTiers(events, ['noise']).events;

    expect(trimmed._markdownConfig).toEqual(markdownConfig);
    expect(trimmed['5'].length).toBe(tierLeaders.length - 1);
  });

  it('should remove turns left without events and keep the others', () => {
    const events = {
      '3': [event(noiseType)],
      '4': [event(unknownType)],
      '5': [event(tierLeaders[0]), event(noiseType)],
    };

    const result = dropEventTiers(events, ['noise']);

    expect(Object.keys(result.events)).toEqual(['5']);
    expect(keptTypes(result.events)).toEqual([tierLeaders[0]]);
  });

  it('should report how many events were dropped, across every turn', () => {
    const progress = tierLeaders[tierIndex('progress')];
    const economy = tierLeaders[tierIndex('economy')];
    const events = {
      '3': [event(progress), event(unknownType)],
      '4': [event(progress), event(tierLeaders[0])],
      '5': [event(economy)],
    };

    const result = dropEventTiers(events, ['progress', 'economy']);

    expect(result.droppedEvents).toBe(3);
    expect(keptTypes(result.events)).toEqual([unknownType, tierLeaders[0]]);
  });

  it('should not mutate the report it trims', () => {
    const events = reportOf([...tierLeaders, unknownType]);
    const before = JSON.parse(JSON.stringify(events));

    dropEventTiers(events, ['noise', 'economy', 'progress']);

    expect(events).toEqual(before);
  });
});

describe('dropLeastImportantEvents', () => {
  it('should copy the report unchanged at level 0', () => {
    const events = reportOf([...tierLeaders, unknownType]);

    const result = dropLeastImportantEvents(events, 0);

    expect(result.events).toEqual(events);
    expect(result.events).not.toBe(events);
    expect(result.droppedEvents).toBe(0);
    expect(result.droppedTiers).toBe(0);
  });

  it('should drop the noise tier together with unknown types at level 1', () => {
    const events = reportOf([...tierLeaders, unknownType]);

    const result = dropLeastImportantEvents(events, 1);

    expect(keptTypes(result.events)).toEqual(tierLeaders.slice(0, -1));
    expect(result.droppedEvents).toBe(2);
    expect(result.droppedTiers).toBe(1);
  });

  it('should drop one more tier per level, from the least important end', () => {
    const events = reportOf(tierLeaders);

    for (let level = 1; level <= maxEventTrimLevel; level++) {
      const kept = tierLeaders.slice(0, eventImportanceTiers.length - level);
      const result = dropLeastImportantEvents(events, level);

      expect(keptTypes(result.events), `level ${level}`).toEqual(kept);
      expect(result.droppedEvents, `level ${level}`).toBe(tierLeaders.length - kept.length);
    }
  });

  it('should treat missing and non-string Type values as noise', () => {
    const events = {
      '5': [event(tierLeaders[0]), event(noiseType), event(unknownType), { Type: 42 }, {}],
    };

    // Nothing is special at level 0: the malformed entries ride along.
    expect(countEvents(dropLeastImportantEvents(events, 0).events)).toBe(5);

    // Level 1 removes them with the noise tier and the unknown type, keeping only the top tier.
    const result = dropLeastImportantEvents(events, 1);

    expect(keptTypes(result.events)).toEqual([tierLeaders[0]]);
    expect(result.droppedEvents).toBe(4);
  });

  it('should keep the top tier at the deepest level and clamp levels outside the range', () => {
    const events = reportOf([...tierLeaders, unknownType]);

    const deepest = dropLeastImportantEvents(events, maxEventTrimLevel);
    expect(keptTypes(deepest.events)).toEqual([tierLeaders[0]]);
    expect(deepest.droppedEvents).toBe(tierLeaders.length);

    // Levels beyond the deepest one trim no further than the deepest.
    expect(keptTypes(dropLeastImportantEvents(events, maxEventTrimLevel + 3).events)).toEqual([tierLeaders[0]]);
    // Negative levels drop nothing.
    expect(keptTypes(dropLeastImportantEvents(events, -2).events)).toEqual(keptTypes(events));
  });

  it('should keep non-array entries such as the markdown config at every level', () => {
    const markdownConfig = { configs: [{ format: 'Turn {key}' }] };
    const events = { '5': [...tierLeaders, unknownType].map(event), _markdownConfig: markdownConfig };

    for (const level of [1, 3, maxEventTrimLevel]) {
      const trimmed = dropLeastImportantEvents(events, level).events;
      expect(trimmed._markdownConfig, `level ${level}`).toEqual(markdownConfig);
      expect(trimmed['5'].length, `level ${level}`).toBeGreaterThan(0);
    }
  });

  it('should remove turns left without events and keep the others', () => {
    const events = {
      '3': [event(noiseType)],
      '4': [event(unknownType)],
      '5': [event(tierLeaders[0])],
    };

    // One level empties the noise turn and the unknown-type turn together.
    const result = dropLeastImportantEvents(events, 1);

    expect(Object.keys(result.events)).toEqual(['5']);
    expect(result.droppedEvents).toBe(2);
  });

  it('should count dropped events across every turn', () => {
    const events = {
      '3': [event(unknownType), event(noiseType), event(tierLeaders[0])],
      '4': [event(noiseType), event(tierLeaders[0])],
    };

    // The level that drops noise also drops the unknown type in the other turn.
    const result = dropLeastImportantEvents(events, 1);

    expect(result.droppedEvents).toBe(3);
    expect(countEvents(result.events)).toBe(2);
  });

  it('should not mutate the report it trims', () => {
    const events = reportOf([...tierLeaders, unknownType]);
    const before = JSON.parse(JSON.stringify(events));

    dropLeastImportantEvents(events, maxEventTrimLevel);

    expect(events).toEqual(before);
  });
});
