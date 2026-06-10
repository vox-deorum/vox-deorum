/**
 * Tests for Civ 5 localization tag stripping.
 */
import { describe, it, expect } from 'vitest';
import { stripTags } from '../../src/utils/database/localized.js';

describe('stripTags', () => {
  it('should return undefined for empty or missing text', () => {
    expect(stripTags('')).toBeUndefined();
    expect(stripTags(undefined as any)).toBeUndefined();
  });

  it('should pass through plain text unchanged', () => {
    expect(stripTags('Hello world')).toBe('Hello world');
  });

  it('should convert [ICON_BULLET] into a markdown-style bullet', () => {
    expect(stripTags('[ICON_BULLET]First point')).toBe('* First point');
  });

  it('should convert [NEWLINE] into newlines and collapse repeats', () => {
    expect(stripTags('a[NEWLINE]b')).toBe('a\nb');
    expect(stripTags('a[NEWLINE][NEWLINE]b')).toBe('a\nb');
  });

  it('should replace [SPACE] and [TAB] with spaces', () => {
    expect(stripTags('a[SPACE]b[TAB]c')).toBe('a b c');
  });

  it('should remove icon tags', () => {
    expect(stripTags('Gain [ICON_GOLD]Gold and [ICON_RESEARCH]Science')).toBe('Gain Gold and Science');
  });

  it('should remove color tags and [ENDCOLOR]', () => {
    expect(stripTags('[COLOR_POSITIVE_TEXT]+2[ENDCOLOR] Faith')).toBe('+2 Faith');
  });

  it('should remove link markers', () => {
    expect(stripTags('[LINK=BUILDING_GRANARY]Granary[\\LINK]')).toBe('Granary');
  });

  it('should collapse runs of spaces', () => {
    expect(stripTags('a    b')).toBe('a b');
  });

  it('should handle a realistic combined string', () => {
    const input = '[COLOR_YELLOW]Walls[ENDCOLOR][NEWLINE][ICON_BULLET]+5 [ICON_STRENGTH]Defense[NEWLINE][ICON_BULLET]See [LINK=CONCEPT_DEFENSE]defense[\\LINK]';
    expect(stripTags(input)).toBe('Walls\n* +5 Defense\n* See defense');
  });
});
