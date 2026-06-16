/**
 * Tests for MutableKnowledge field-level change detection.
 */
import { describe, it, expect } from 'vitest';
import { detectChanges } from '../../../src/utils/knowledge/changes.js';

describe('detectChanges', () => {
  describe('first version (no previous data)', () => {
    it('should report all non-metadata fields as changes', () => {
      const changes = detectChanges(null, { Name: 'Rome', Gold: 100, ID: 1, Turn: 5 });
      expect(changes.sort()).toEqual(['Gold', 'Name']);
    });

    it('should respect ignoreFields', () => {
      const changes = detectChanges(null, { Name: 'Rome', Gold: 100 }, ['Gold']);
      expect(changes).toEqual(['Name']);
    });
  });

  describe('subsequent versions', () => {
    it('should return an empty array when nothing changed', () => {
      const data = { Name: 'Rome', Gold: 100 };
      expect(detectChanges({ ...data }, { ...data })).toEqual([]);
    });

    it('should detect changed scalar values', () => {
      expect(detectChanges({ Gold: 100 }, { Gold: 150 })).toEqual(['Gold']);
    });

    it('should detect null-to-value and value-to-null transitions', () => {
      expect(detectChanges({ Leader: null } as any, { Leader: 'Caesar' } as any)).toEqual(['Leader']);
      expect(detectChanges({ Leader: 'Caesar' } as any, { Leader: null } as any)).toEqual(['Leader']);
    });

    it('should treat null and undefined as equivalent (no change)', () => {
      expect(detectChanges({ Leader: null } as any, { Leader: undefined } as any)).toEqual([]);
    });

    it('should treat falsy-but-present values (0, "") as distinct from null', () => {
      expect(detectChanges({ Gold: 0 } as any, { Gold: null } as any)).toEqual(['Gold']);
      expect(detectChanges({ Name: '' } as any, { Name: null } as any)).toEqual(['Name']);
      expect(detectChanges({ Gold: 0 }, { Gold: 0 })).toEqual([]);
    });

    it('should not detect fields absent from the new data', () => {
      // Detection iterates newData keys only: versioned rows always carry the
      // full column set, so a "removed" field must arrive as an explicit null.
      expect(detectChanges({ Gold: 100, Name: 'Rome' } as any, { Name: 'Rome' } as any)).toEqual([]);
    });

    it('should deep-compare JSON object fields', () => {
      const oldData = { Cities: { Rome: { pop: 5 } } };
      const sameData = { Cities: { Rome: { pop: 5 } } };
      const newData = { Cities: { Rome: { pop: 6 } } };
      expect(detectChanges(oldData, sameData)).toEqual([]);
      expect(detectChanges(oldData, newData)).toEqual(['Cities']);
    });

    it('should deep-compare array fields', () => {
      expect(detectChanges({ Techs: [1, 2] }, { Techs: [1, 2] })).toEqual([]);
      expect(detectChanges({ Techs: [1, 2] }, { Techs: [1, 2, 3] })).toEqual(['Techs']);
    });

    it('should skip metadata fields', () => {
      const oldData = { ID: 1, Turn: 5, Key: 1, Version: 1, IsLatest: 1, CreatedAt: 'a', Changes: '[]', Gold: 1 };
      const newData = { ID: 2, Turn: 6, Key: 2, Version: 2, IsLatest: 0, CreatedAt: 'b', Changes: '["x"]', Gold: 1 };
      expect(detectChanges(oldData, newData)).toEqual([]);
    });

    it('should skip ignored fields even when changed', () => {
      expect(detectChanges({ Gold: 1, Science: 1 }, { Gold: 2, Science: 2 }, ['Gold'])).toEqual(['Science']);
    });
  });
});
