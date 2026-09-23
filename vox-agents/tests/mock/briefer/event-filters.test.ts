import { describe, it, expect } from 'vitest';
import { filterEventsByCategory } from '../../../src/utils/prompts/event-filters.js';

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
});
