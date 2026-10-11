/**
 * Behavior tests for the section registry: the expected keys and scopes exist, and
 * `renderSection` overrides change only the overridden part of the output.
 */

import { describe, it, expect } from 'vitest';
import { sections, renderSection, type SectionKey } from '../../../src/knowledge/sections.js';

const keys: SectionKey[] = [
  'situation', 'civilization', 'options', 'strategies', 'victory',
  'players', 'cities', 'military', 'events', 'briefings',
];

describe('section registry', () => {
  it('registers every key with its own key and a title', () => {
    for (const key of keys) {
      expect(sections[key].key).toBe(key);
      expect(sections[key].title.length).toBeGreaterThan(0);
    }
  });

  it('scopes situation and civilization to the game and the rest to the turn', () => {
    for (const key of keys) {
      expect(sections[key].scope).toBe(key === 'situation' || key === 'civilization' ? 'game' : 'turn');
    }
  });
});

describe('renderSection', () => {
  const data = { A: { Gold: 5 } };
  const base = renderSection('players', data);
  const { title, description } = sections.players;

  it('renders the heading, description, and data in order', () => {
    const lines = base.split('\n');
    expect(lines[0]).toContain(title);
    expect(lines[1]).toBe(description);
    expect(base).toContain('Gold');
  });

  it('changes only the heading when the heading is overridden', () => {
    expect(renderSection('players', data, { heading: 'Other' })).toBe(base.replace(title, 'Other'));
  });

  it('changes only the description when the description is overridden', () => {
    expect(renderSection('players', data, { description: 'Custom text.' })).toBe(base.replace(description!, 'Custom text.'));
  });

  it('omits the description line when it is disabled', () => {
    const out = renderSection('players', data, { description: false });
    expect(out).not.toContain(description!);
    expect(out.split('\n')[0]).toBe(base.split('\n')[0]);
  });

  it('changes only the heading marker for another heading level', () => {
    expect(renderSection('players', data, { headingLevel: 2 })).toBe(`#${base}`);
  });

  it('uses the report\'s own markdown config unless one is supplied', () => {
    const report = { '1': { Gold: 5 }, _markdownConfig: { configs: [{ format: 'Player {key}' }] } };
    expect(renderSection('players', report)).toContain('Player 1');
    expect(renderSection('players', report, { markdown: { configs: [{}] } })).not.toContain('Player 1');
  });

  it('inserts already rendered text unchanged', () => {
    expect(renderSection('briefings', 'Already **rendered**.', { rendered: true })).toContain('Already **rendered**.');
  });
});
