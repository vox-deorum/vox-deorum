import { describe, expect, it } from 'vitest';
import { pickPlayerFields, omitPlayerFields, pickCityFields, omitCityFields } from '../../../src/knowledge/reports/report-filters.js';

describe('Vox Agents report-filter consumers', () => {
  it('should preserve player labels, missing values and Markdown metadata using the compiled field helpers', () => {
    const players = { '0': { Gold: 0, FoundedReligion: null, IsMajor: false }, '1': 'Unmet' } as any;
    Object.defineProperty(players, '_markdownConfig', { value: ['Player {key}'], enumerable: false });
    const picked = pickPlayerFields(players, ['Gold', 'FoundedReligion', 'IsMajor', 'Era']);
    expect(picked['0']).toEqual({ Gold: 0, FoundedReligion: null, IsMajor: false });
    expect(picked['1']).toBe('Unmet');
    expect(picked).toHaveProperty('_markdownConfig', ['Player {key}']);
    expect(omitPlayerFields(players, ['Gold'])['0']).toEqual({ FoundedReligion: null, IsMajor: false });
    expect(players['0'].Gold).toBe(0);
  });

  it('should preserve owner and city grouping and Markdown metadata', () => {
    const cities = { Owner: { Harbor: { Population: 0, IsCoastal: false, MajorityReligion: null } } } as any;
    Object.defineProperty(cities, '_markdownConfig', { value: ['Owner {key}', '{key}'], enumerable: false });
    const picked = pickCityFields(cities, ['Population', 'MajorityReligion']);
    expect(picked.Owner.Harbor).toEqual({ Population: 0, MajorityReligion: null });
    expect(picked).toHaveProperty('_markdownConfig', ['Owner {key}', '{key}']);
    expect(omitCityFields(cities, ['Population']).Owner.Harbor).toEqual({ IsCoastal: false, MajorityReligion: null });
  });
});
