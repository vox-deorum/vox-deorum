import { describe, expect, it } from 'vitest';
import { repairCopy } from '../../../../src/newspaper/desk/repair.js';

describe('newspaper desk placeholder repair', () => {
  it('should repair runtime aliases, nearby spellings and whitespace in every copy field', () => {
    const variables = [
      { name: 'city', aliases: ['city.name', 'subject.name'] },
      { name: 'owner', aliases: ['city.owner.name'] },
      { name: 'victim', aliases: ['triggerValues.some-trigger.victim'] },
      { name: 'count', aliases: ['group.count'] },
    ];
    expect(repairCopy({
      headline: 'Dispatch from {{ subject.name }}',
      subheadline: '{{city.owner.name}} responds',
      byline: 'Staff in {{ City_Name }}',
      body: [
        '{{triggerValues.some-trigger.victim}} sent {{ group.count |regiment|regiments}} to {{ city }}.',
        'Reports from {{cityName}} and {{City_Owner_Name}} followed.',
      ],
    }, variables)).toEqual({
      headline: 'Dispatch from {{city}}',
      subheadline: '{{owner}} responds',
      byline: 'Staff in {{city}}',
      body: [
        '{{victim}} sent {{count|regiment|regiments}} to {{city}}.',
        'Reports from {{city}} and {{owner}} followed.',
      ],
    });
  });

  it('should keep listed names and prefer an exact alias over a loose match', () => {
    expect(repairCopy({ headline: '{{ cityName }} in {{city.name}}', body: ['Report.'] }, [
      { name: 'city', aliases: ['city.name', 'cityName'] },
      { name: 'cityName', aliases: [] },
    ])).toEqual({ headline: '{{cityName}} in {{city}}', body: ['Report.'] });
  });

  it('should leave ambiguous and unknown placeholders as written', () => {
    const text = {
      headline: '{{ victim }} in {{ CITY_NAME }}',
      body: ['Follow {{ mystery |regiment|regiments}}.'],
    };
    expect(repairCopy(text, [
      { name: 'city', aliases: ['city.name'] },
      { name: 'cityName', aliases: [] },
      { name: 'triggerValues.first.victim', aliases: ['victim'] },
      { name: 'triggerValues.second.victim', aliases: ['victim'] },
    ])).toEqual(text);
  });
});
