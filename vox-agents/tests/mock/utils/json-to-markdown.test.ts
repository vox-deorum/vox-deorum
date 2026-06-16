/**
 * Tests for JSON to Markdown transformation utility
 */

import { describe, it, expect } from 'vitest';
import { jsonToMarkdown, type JsonToMarkdownConfig } from '../../../src/utils/tools/json-to-markdown.js';

describe('jsonToMarkdown', () => {
  describe('primitive values', () => {
    it('should handle null values', () => {
      const result = jsonToMarkdown(null);
      expect(result).toBe('null');
    });

    it('should handle undefined values', () => {
      const result = jsonToMarkdown(undefined);
      expect(result).toBe('null');
    });

    it('should handle string values', () => {
      const result = jsonToMarkdown('test string');
      expect(result).toBe('- test string');
    });

    it('should handle number values', () => {
      const result = jsonToMarkdown(42);
      expect(result).toBe('- 42');
    });

    it('should handle boolean values', () => {
      expect(jsonToMarkdown(true)).toBe('- true');
      expect(jsonToMarkdown(false)).toBe('- false');
    });

    it('should handle multiline strings with proper indentation', () => {
      const multiline = 'line 1\nline 2\nline 3';
      const obj = { text: multiline };
      const result = jsonToMarkdown(obj);
      expect(result).toBe('- text: line 1\n  line 2\n  line 3');
    });
  });

  describe('simple objects', () => {
    it('should transform flat object to list format', () => {
      const obj = {
        name: 'John',
        age: 30,
        active: true
      };
      const result = jsonToMarkdown(obj);
      expect(result).toContain('- name: John');
      expect(result).toContain('- age: 30');
      expect(result).toContain('- active: true');
    });

    it('should handle nested objects with indentation', () => {
      const obj = {
        user: {
          name: 'Alice',
          profile: {
            age: 25,
            city: 'Boston'
          }
        }
      };
      const result = jsonToMarkdown(obj);
      expect(result).toContain('- user:');
      expect(result).toContain('  - name: Alice');
      expect(result).toContain('  - profile:');
      expect(result).toContain('    - age: 25');
      expect(result).toContain('    - city: Boston');
    });
  });

  describe('heading configuration', () => {
    it('should use heading format when config provided', () => {
      const obj = {
        Player1: { name: 'Alice', score: 100 },
        Player2: { name: 'Bob', score: 90 }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { format: 'Player {key}' }
        ],
        startingLevel: 2
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('## Player Player1');
      expect(result).toContain('## Player Player2');
      expect(result).toContain('- name: Alice');
      expect(result).toContain('- score: 100');
    });

    it('should support {0} placeholder in format string', () => {
      const obj = {
        Section1: { content: 'test' }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { format: 'Part {0}' }
        ]
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('## Part Section1');
    });

    it('should skip levels when skip flag is true', () => {
      const obj = {
        wrapper: {
          item1: 'value1',
          item2: 'value2'
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { skip: true }
        ]
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).not.toContain('wrapper');
      expect(result).toContain('- item1: value1');
      expect(result).toContain('- item2: value2');
    });

    it('should respect maxLevel setting', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: 'value'
            }
          }
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { format: 'L1: {key}' },
          { format: 'L2: {key}' },
          { format: 'L3: {key}' }
        ],
        startingLevel: 4,
        maxLevel: 5
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('#### L1: level1');
      expect(result).toContain('##### L2: level2');
      expect(result).toContain('- level3:'); // Should use list format beyond maxLevel
    });
  });

  describe('custom transformers', () => {
    it('should apply custom transformer at specified depth', () => {
      const obj = {
        players: {
          alice: { score: 100, level: 5 },
          bob: { score: 90, level: 4 }
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { format: 'Game: {key}' },  // Format for "players" heading
          {},  // No config for player names level
          {
            transformer: (value: any, key: string) => {
              if (typeof value === 'object' && value.score !== undefined) {
                return `**Player** - Score: ${value.score}, Level: ${value.level}`;
              }
              return `${key}: ${value}`;
            }
          }
        ]
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('## Game: players');
      expect(result).toContain('**Player** - Score: 100, Level: 5');
      expect(result).toContain('**Player** - Score: 90, Level: 4');
    });

    it('should skip normal processing when transformer returns value', () => {
      const obj = {
        data: {
          item: { nested: 'should not appear' }
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          {},
          {
            transformer: () => 'Custom output only'
          }
        ]
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('Custom output only');
      expect(result).not.toContain('nested');
      expect(result).not.toContain('should not appear');
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed depth configurations', () => {
      const obj = {
        game: {
          players: {
            player1: { name: 'Alice', stats: { wins: 10, losses: 3 } },
            player2: { name: 'Bob', stats: { wins: 8, losses: 5 } }
          },
          settings: {
            difficulty: 'hard',
            timeLimit: 300
          }
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        configs: [
          { format: 'Game Data' },
          { format: '{key}' },
          { skip: false }
        ],
        startingLevel: 1,
        maxLevel: 3
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('# Game Data');
      expect(result).toContain('## players');
      expect(result).toContain('### player1');
      expect(result).toContain('- name: Alice');
      expect(result).toContain('- stats:');
      expect(result).toContain('  - wins: 10');
    });

    it('should handle custom indentation string', () => {
      const obj = {
        root: {
          child: {
            grandchild: 'value'
          }
        }
      };

      const config: Partial<JsonToMarkdownConfig> = {
        indentString: '    '  // 4 spaces instead of 2
      };

      const result = jsonToMarkdown(obj, config);
      expect(result).toContain('- root:');
      expect(result).toContain('    - child:');
      expect(result).toContain('        - grandchild: value');
    });

    it('should handle empty objects', () => {
      const obj = {
        empty: {},
        hasContent: { key: 'value' }
      };

      const result = jsonToMarkdown(obj);
      // Empty objects are intentionally skipped to avoid confusion
      expect(result).not.toContain('- empty:');
      expect(result).toContain('- hasContent:');
      expect(result).toContain('  - key: value');
    });

    it('should handle arrays as values', () => {
      const obj = {
        items: ['item1', 'item2', 'item3']
      };

      const result = jsonToMarkdown(obj);
      expect(result).toContain('- items:');
      // Array items are rendered without numeric indices
      expect(result).toContain('  - item1');
      expect(result).toContain('  - item2');
      expect(result).toContain('  - item3');
    });
  });

  describe('edge cases', () => {
    it('should handle objects with null values', () => {
      const obj = {
        key1: null,
        key2: 'value',
        key3: undefined
      };

      const result = jsonToMarkdown(obj);
      expect(result).toContain('- key1: null');
      expect(result).toContain('- key2: value');
      // Undefined gets converted to 'undefined' string via String(undefined)
      expect(result).toContain('- key3: undefined');
    });

    it('should handle deeply nested structures', () => {
      const obj = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: {
                  l6: {
                    l7: 'deep value'
                  }
                }
              }
            }
          }
        }
      };

      const result = jsonToMarkdown(obj);
      expect(result).toContain('deep value');
      const indentCount = (result.match(/^ {12}/gm) || []).length;
      expect(indentCount).toBeGreaterThan(0); // Should have deep indentation
    });

    it('should handle special characters in keys', () => {
      const obj = {
        'key-with-dash': 'value1',
        'key.with.dots': 'value2',
        'key with spaces': 'value3',
        'key_with_underscore': 'value4'
      };

      const result = jsonToMarkdown(obj);
      expect(result).toContain('- key-with-dash: value1');
      expect(result).toContain('- key.with.dots: value2');
      expect(result).toContain('- key with spaces: value3');
      expect(result).toContain('- key_with_underscore: value4');
    });

    it('should handle empty config gracefully', () => {
      const obj = { test: 'value' };
      const result = jsonToMarkdown(obj, {});
      expect(result).toContain('- test: value');
    });

    it('should filter out empty strings from results', () => {
      const obj = {
        hasValue: 'test',
        nested: {
          inner: 'value'
        }
      };

      const result = jsonToMarkdown(obj);
      const lines = result.split('\n');
      expect(lines.every(line => line === '' || line.trim().length > 0)).toBe(true);
    });
  });
});