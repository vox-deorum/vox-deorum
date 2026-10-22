/** Tests for the game journal's turn headings and window (src/utils/workspace/journal.ts). */

import { describe, expect, it } from 'vitest';
import { journalTail, stampJournal } from '../../../../src/utils/workspace/journal.js';

/** A journal entry for a turn with a body. */
function entry(turn: number, body: string): string {
  return `### Turn ${turn}\n\n${body}`;
}

describe('stampJournal', () => {
  it('should not add a heading when the appended text already starts this turn', () => {
    const appended = `${entry(5, 'own heading')}\n`;
    expect(stampJournal('', appended, 5)).toBe(appended);
  });

  it('should separate a new turn from text that ends without a newline', () => {
    const stamped = stampJournal(`${entry(4, 'old')}`, `${entry(4, 'old')}new\n`, 5);
    expect(stamped).toMatch(/old\n\n### Turn 5\n\nnew\n$/);
  });

  it('should ignore turn headings quoted in fenced code when deciding on a heading', () => {
    const before = `${entry(4, '```\n### Turn 5\n```')}\n`;
    const stamped = stampJournal(before, `${before}new\n`, 5);
    expect(stamped.slice(before.length)).toMatch(/^\n### Turn 5\n\nnew\n$/);
  });

  it('should return a change that is not an append unchanged', () => {
    expect(stampJournal('abc\n', 'xyz\n', 5)).toBe('xyz\n');
    expect(stampJournal('abc\n', 'ab', 5)).toBe('ab');
  });
});

describe('journalTail', () => {
  it('should be undefined for a journal without entries', () => {
    expect(journalTail('')).toBeUndefined();
    expect(journalTail('\n\n')).toBeUndefined();
  });

  it('should keep the newest whole entries within the budget, in file order', () => {
    const text = [1, 2, 3, 4].map((turn) => entry(turn, 'x'.repeat(30))).join('\n\n');
    const tail = journalTail(text, 100)!;
    expect(tail.content).toBe([3, 4].map((turn) => entry(turn, 'x'.repeat(30))).join('\n\n'));
    expect(tail.older).toBe(2);
  });

  it('should keep the newest entry even when it is over the budget', () => {
    const tail = journalTail(`${entry(1, 'a')}\n\n${entry(2, 'b'.repeat(500))}`, 100)!;
    expect(tail.content).toBe(entry(2, 'b'.repeat(500)));
    expect(tail.older).toBe(1);
  });

  it('should keep the heading and newest text of a newest entry over the cap', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line-${index} ${'z'.repeat(20)}`);
    const tail = journalTail(`${entry(1, 'a')}\n\n${entry(2, lines.join('\n'))}`, 100, 200)!;
    expect(tail.content.startsWith('### Turn 2\n\n')).toBe(true);
    expect(tail.content).toContain('line-49');
    expect(tail.content).not.toContain('line-0 ');
    expect(tail.content.length).toBeLessThanOrEqual(200);
    expect(tail.cut).toBeGreaterThan(0);
    expect(tail.older).toBe(1);
  });

  it('should report no cut for an entry within the cap', () => {
    expect(journalTail(entry(1, 'a'.repeat(500)), 100, 1000)!.cut).toBe(0);
  });

  it('should count text before the first heading as one entry', () => {
    const tail = journalTail(`preamble\n\n${entry(1, 'a')}`)!;
    expect(tail.content).toBe(`preamble\n\n${entry(1, 'a')}`);
    expect(tail.older).toBe(0);
  });

  it('should not split at a turn heading inside a fenced block', () => {
    const text = `${entry(1, '```\n### Turn 9\n```')}\n\n${entry(2, 'b')}`;
    expect(journalTail(text, 10_000)!.older).toBe(0);
    expect(journalTail(text, 1)!.content).toBe(entry(2, 'b'));
  });
});
