import { describe, it, expect } from 'vitest';
import { filterEventsByCategory, reportCategories } from '../../../src/utils/prompts/event-filters.js';
import { eventImportanceTiers } from '../../../src/utils/prompts/event-importance.js';

describe('filterEventsByCategory', () => {
  it('should route relayed reports to every assessed category without treating all reports as diplomacy', () => {
    const reports = [
      { Type: 'RelayedMessage', Categories: ['Military', 'Economy'], Content: 'Supply shortage' },
      { Type: 'RelayedMessage', Categories: ['Diplomacy'], Content: 'Peace proposal' },
      { Type: 'RelayedMessage', Categories: ['Others'], Content: 'Other intelligence' },
      { Type: 'RelayedMessage', Categories: [], Content: 'Uncategorized' },
    ];
    const events = { '10': reports };
    expect(filterEventsByCategory(events, 'Military')).toEqual({ '10': [reports[0]] });
    expect(filterEventsByCategory(events, 'Economy')).toEqual({ '10': [reports[0]] });
    expect(filterEventsByCategory(events, 'Diplomacy')).toEqual({ '10': [reports[1]] });
    expect(filterEventsByCategory(events, 'Others')).toEqual({ '10': [reports[2]] });
    expect(events['10']).toHaveLength(4);
  });

  it('should preserve static event filtering and omit turns with no matching events', () => {
    const war = { Type: 'DeclareWar' };
    expect(filterEventsByCategory({
      '9': [{ Type: 'RelayedMessage', Categories: ['Others'] }],
      '10': [war, { Type: 'UnknownEvent' }],
    }, 'Military')).toEqual({ '10': [war] });
  });

  it('should route the canonical renamed types to their mapped categories', () => {
    const buildDone = { Type: 'UnitBuildCompleted' };
    const buildStart = { Type: 'UnitBuildStart' };
    const moved = { Type: 'UnitMoved' };
    const spyResult = { Type: 'EspionageResult' };
    const wltkExtend = { Type: 'CityExtendsWeLoveKingDay' };
    const branch = { Type: 'PlayerAdoptPolicyBranch' };
    const era = { Type: 'TeamSetEra' };
    const events = { '7': [buildDone, buildStart, moved, spyResult, wltkExtend, branch, era] };

    // The build, WLTKD, era, and policy branch types carry Economy; movement is Military only.
    expect(filterEventsByCategory(events, 'Economy')).toEqual({ '7': [buildDone, buildStart, wltkExtend, branch, era] });
    expect(filterEventsByCategory(events, 'Military')).toEqual({ '7': [moved] });
    // Espionage is Diplomacy, and a policy branch adoption maps to both Economy and Diplomacy.
    expect(filterEventsByCategory(events, 'Diplomacy')).toEqual({ '7': [spyResult, branch] });
    // The era change is no longer a System event.
    expect(filterEventsByCategory(events, 'System')).toEqual({});
  });

  it('should drop the pre-remap raw type names, which no longer map to categories', () => {
    const events = {
      '8': [
        { Type: 'PlayerBuilt' }, { Type: 'PlayerBuilding' }, { Type: 'UnitSetXY' },
        { Type: 'EspionageNotificationData' }, { Type: 'CityExtendsWLTKD' }, { Type: 'IdeologyAdopted' },
      ],
    };
    expect(filterEventsByCategory(events, 'Economy')).toEqual({});
    expect(filterEventsByCategory(events, 'Military')).toEqual({});
    expect(filterEventsByCategory(events, 'Diplomacy')).toEqual({});
  });

  it('should give every ranked event type a category, so renames cannot silently drop it', () => {
    // Relayed reports are routed by their own assessed Categories instead of the type mapping.
    const types = eventImportanceTiers.flatMap(tier => tier.types).filter(type => type !== 'RelayedMessage');
    const events = { '9': types.map(type => ({ Type: type })) };
    const routed = new Set<unknown>();
    for (const category of [...reportCategories, 'System'] as const) {
      for (const event of filterEventsByCategory(events, category)['9'] ?? []) routed.add(event.Type);
    }
    expect(types.filter(type => !routed.has(type))).toEqual([]);
  });
});
