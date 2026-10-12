/**
 * Tests for the reference renderer (src/knowledge/reference-format.ts): the heading structure
 * that keeps grep and awk entry extraction valid, compact facts with humanized bold labels ahead
 * of the tooltip, tooltip normalization (separator breaks, bullet characters, colon subheadings,
 * blank lines around blocks) that keeps every gameplay statement and its order, unique headings
 * for duplicate or missing names, and input that is never changed.
 */

import { describe, expect, it } from 'vitest';
import { renderReferenceMarkdown } from '../../../src/knowledge/reference-format.js';

/** One cleaned listing, as reference.ts hands it over: Name first, Help last, no Type. */
const technologies = [
  {
    Name: "The Wheel",
    Cost: 40,
    Era: "Ancient",
    UnitsUnlocked: ["Chariot Archer", "War Chariot"],
    Help: "Allows the construction of the Chariot Archer and the War Chariot.\n------\nLeads To:\n* Construction",
  },
  {
    Name: "Bronze Working",
    Cost: 55,
    Era: "Ancient",
    ResourcesRevealed: ["Copper", "Tin"],
    Help: "Allows the construction of the Composite Bowman.\nReveals Copper and Tin.",
  },
];

/** Policy help as the localized text arrives: no blank lines, mixed bullets, dashed separators. */
const policies = [
  {
    Name: "Oligarchy",
    Era: "Ancient",
    Branch: "Honor",
    PrereqPolicies: ["Warrior Cult"],
    Help: "+10% Strength when fighting in Friendly Lands\n---------\nFree Promotions:\n* Shock I\n\u2022 Wary\n---------\nGREAT GENERAL BONUS\nHeal 50 HP",
  },
  {
    Name: "Authority",
    Era: "Ancient",
    Branch: "Authority",
    Help: "Adopting Authority grants:\n\u2022 Capital provides +6 Gold and +6 Production\n--------\nUnlocks:",
  },
];

const buildings = [
  {
    Name: "Palace",
    UniqueOf: "America",
    Yields: { Culture: 1, Gold: 3 },
    Help: "Capital of the civilization.\nGrants:\n+1 Influence per era in capital",
  },
];

const units = [
  { Name: "Warrior", Combat: 8, Cost: 40, Moves: 2 },
  { Name: "Spearman", Combat: 11, Cost: 56, RequiredResources: { Iron: 1 }, FreePromotions: ["Drill I"] },
];

/** The `## ` entry headings of a rendered document, in order. */
function entryHeadings(markdown: string): string[] {
  return markdown.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3));
}

/** One entry's Markdown, from its heading to the next entry or the document end. */
function entry(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line === `## ${heading}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return rest.slice(0, end === -1 ? rest.length : end).join("\n");
}

/** The normalized tooltip of one entry, after its `### Help` subheading. */
function helpOf(markdown: string, heading: string): string {
  const body = entry(markdown, heading);
  const marker = body.indexOf("### Help");
  expect(marker).toBeGreaterThanOrEqual(0);
  return body.slice(marker + "### Help".length);
}

describe('renderReferenceMarkdown', () => {
  describe('category and entry structure', () => {
    it('should keep the title heading and one entry heading per item in order, with a final newline', () => {
      const markdown = renderReferenceMarkdown('Technologies', technologies);
      expect(markdown.startsWith('# Technologies\n\n## The Wheel\n')).toBe(true);
      expect(entryHeadings(markdown)).toEqual(['The Wheel', 'Bronze Working']);
      expect(markdown.endsWith('\n')).toBe(true);
      expect(markdown.endsWith('\n\n')).toBe(false);
    });

    it('should render an empty category as just the title heading and a final newline', () => {
      expect(renderReferenceMarkdown('Units', [])).toBe('# Units\n');
    });
  });

  describe('facts before the tooltip', () => {
    it('should label scalar facts with humanized bold names as bullets', () => {
      const body = entry(renderReferenceMarkdown('Units', units), 'Warrior');
      expect(body).toContain('- **Combat**: 8');
      expect(body).toContain('- **Cost**: 40');
      expect(body).toContain('- **Moves**: 2');
    });

    it('should render nested unlocks, resources, promotions, and yields as indented bullets', () => {
      const tech = entry(renderReferenceMarkdown('Technologies', technologies), 'The Wheel');
      expect(tech).toContain('- **Units Unlocked**:\n  - Chariot Archer\n  - War Chariot');
      const unit = entry(renderReferenceMarkdown('Units', units), 'Spearman');
      expect(unit).toContain('- **Required Resources**:\n  - Iron: 1');
      expect(unit).toContain('- **Free Promotions**:\n  - Drill I');
      const building = entry(renderReferenceMarkdown('Buildings', buildings), 'Palace');
      expect(building).toContain('- **Yields**:\n  - Culture: 1\n  - Gold: 3');
    });

    it('should indent multiline facts and omit nested renderer metadata', () => {
      const markdown = renderReferenceMarkdown('Units', [{
        Name: 'Example',
        FreePromotions: { Effect: 'First effect\nSecond effect', _markdownConfig: { startingLevel: 1 } },
      }]);
      expect(markdown).toContain('- **Free Promotions**:\n  - Effect: First effect\n    Second effect');
      expect(markdown).not.toContain('_markdownConfig');
    });

    it('should omit the Name and Help keys from the fact bullets', () => {
      const body = entry(renderReferenceMarkdown('Technologies', technologies), 'Bronze Working');
      expect(body).not.toMatch(/\*\*Name\*\*/);
      expect(body).not.toMatch(/\*\*Help\*\*/);
    });

    it('should place every fact between the entry heading and Help', () => {
      const body = entry(renderReferenceMarkdown('Technologies', technologies), 'Bronze Working');
      const help = body.indexOf('### Help');
      expect(help).toBeGreaterThan(-1);
      for (const label of ['**Cost**', '**Era**', '**Resources Revealed**']) {
        expect(body.indexOf(label)).toBeGreaterThan(-1);
        expect(body.indexOf(label)).toBeLessThan(help);
      }
    });
  });

  describe('tooltip normalization', () => {
    it('should leave out the Help subheading when an entry has no Help', () => {
      expect(entry(renderReferenceMarkdown('Units', units), 'Warrior')).not.toContain('###');
    });

    it('should turn separator lines into paragraph breaks that never underline the text above', () => {
      const help = helpOf(renderReferenceMarkdown('Policies', policies), 'Oligarchy');
      expect(help).toContain('Friendly Lands\n\n#### Free Promotions');
      expect(help).toContain('- Wary\n\nGREAT GENERAL BONUS');
      expect(help).not.toMatch(/-{2,}/);
    });

    it.each(['-', '--', '---', '=', '===='])('should prevent %s separators from creating setext headings', (separator) => {
      const help = helpOf(renderReferenceMarkdown('Units', [{ Name: 'Example', Help: `First effect\n${separator}\nSecond effect` }]), 'Example');
      expect(help.trim()).toBe('First effect\n\nSecond effect');
    });

    it('should normalize asterisk and Unicode bullets to Markdown list items', () => {
      const help = helpOf(renderReferenceMarkdown('Policies', policies), 'Oligarchy');
      expect(help).toContain('- Shock I\n- Wary');
      expect(help).not.toMatch(/^\*/m);
      expect(help).not.toContain('\u2022');
    });

    it('should promote colon section labels ahead of a bullet list to subheadings', () => {
      const tech = helpOf(renderReferenceMarkdown('Technologies', technologies), 'The Wheel');
      expect(tech).toContain('#### Leads To\n\n- Construction');
      const authority = helpOf(renderReferenceMarkdown('Policies', policies), 'Authority');
      expect(authority).toContain('#### Adopting Authority grants\n\n- Capital provides +6 Gold and +6 Production');
    });

    it('should keep a colon line as plain text when no bullets follow it', () => {
      const authority = helpOf(renderReferenceMarkdown('Policies', policies), 'Authority');
      expect(authority).toContain('Unlocks:');
      expect(authority).not.toContain('#### Unlocks');
      const building = entry(renderReferenceMarkdown('Buildings', buildings), 'Palace');
      expect(building).toContain('Grants:');
      expect(building).not.toContain('#### Grants');
    });

    it('should put blank lines around every paragraph, list, and subheading', () => {
      const help = helpOf(renderReferenceMarkdown('Policies', policies), 'Oligarchy');
      expect(help.startsWith('\n\n')).toBe(true);
      expect(help.trim().split('\n\n')).toEqual([
        '+10% Strength when fighting in Friendly Lands',
        '#### Free Promotions',
        '- Shock I\n- Wary',
        'GREAT GENERAL BONUS\nHeal 50 HP',
      ]);
    });

    it('should preserve every gameplay statement of the tooltip in order', () => {
      const help = helpOf(renderReferenceMarkdown('Policies', policies), 'Oligarchy');
      const statements = [
        '+10% Strength when fighting in Friendly Lands',
        '#### Free Promotions',
        '- Shock I',
        '- Wary',
        'GREAT GENERAL BONUS',
        'Heal 50 HP',
      ];
      let cursor = -1;
      for (const statement of statements) {
        const at = help.indexOf(statement, cursor + 1);
        expect(at).toBeGreaterThan(cursor);
        cursor = at;
      }
    });
  });

  describe('unique entry headings', () => {
    it('should keep duplicate names as separate entries qualified by their unique-of name', () => {
      const markdown = renderReferenceMarkdown('Units', [
        { Name: 'Longswordsman', UniqueOf: 'England', Cost: 70 },
        { Name: 'Longswordsman', UniqueOf: 'France', Cost: 75 },
      ]);
      expect(entryHeadings(markdown)).toEqual(['Longswordsman (England)', 'Longswordsman (France)']);
      expect(markdown).toContain('- **Cost**: 70');
      expect(markdown).toContain('- **Cost**: 75');
    });

    it('should qualify duplicate policies by their branch', () => {
      const markdown = renderReferenceMarkdown('Policies', [
        { Name: 'Subsistence', Branch: 'Tradition' },
        { Name: 'Subsistence', Branch: 'Piety' },
      ]);
      expect(entryHeadings(markdown)).toEqual(['Subsistence (Tradition)', 'Subsistence (Piety)']);
    });

    it('should number occurrences when suffixes cannot tell entries apart', () => {
      const markdown = renderReferenceMarkdown('Units', [
        { Name: 'Longswordsman', UniqueOf: 'England', Cost: 70 },
        { Name: 'Longswordsman', UniqueOf: 'England', Cost: 75 },
        { Name: 'Worker' },
        { Name: 'Worker' },
        { Name: 'Worker' },
      ]);
      expect(entryHeadings(markdown)).toEqual([
        'Longswordsman (England)',
        'Longswordsman (England 2)',
        'Worker (1)',
        'Worker (2)',
        'Worker (3)',
      ]);
    });

    it('should fall back to Item N and keep suffixed and fallback headings from colliding', () => {
      const markdown = renderReferenceMarkdown('Units', [
        { Name: 'Warrior', UniqueOf: 'England' },
        { Name: 'Warrior', UniqueOf: 'England' },
        { Name: 'Warrior (England 2)' },
        { Cost: 10 },
        { Name: 'Item 4' },
      ]);
      const headings = entryHeadings(markdown);
      expect(headings).toEqual(['Warrior (England)', 'Warrior (England 3)', 'Warrior (England 2)', 'Item 4 (1)', 'Item 4 (2)']);
      expect(new Set(headings).size).toBe(headings.length);
      expect(headings.join(' ')).not.toContain('UNIT_');
    });
  });

  it('should preserve existing paragraphs and Markdown lists without stripping inline emphasis', () => {
    const markdown = renderReferenceMarkdown('Units', [{ Name: 'Example', Help: '*Strong* unit.\n\nA paragraph.\n- First effect\n- Second effect\nAfter the list.' }]);
    expect(markdown).toContain('*Strong* unit.\n\nA paragraph.\n\n- First effect\n- Second effect\n\nAfter the list.');
  });

  it('should not change the items it is given', () => {
    const before = JSON.parse(JSON.stringify(technologies));
    renderReferenceMarkdown('Technologies', technologies);
    renderReferenceMarkdown('Policies', policies);
    expect(JSON.parse(JSON.stringify(technologies))).toEqual(before);
    expect(Object.keys(technologies[0])).toEqual(Object.keys(before[0]));
  });
});
