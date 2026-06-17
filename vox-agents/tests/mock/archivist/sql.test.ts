/**
 * Tests for archivist DuckDB SQL generation and result-mapping helpers.
 * Pure string/array construction plus a fake DuckDB result object.
 */
import { describe, it, expect } from 'vitest';
import {
  toRealArrayLiteral,
  buildEraCaseExpr,
  escapeSql,
  rowsToObjects,
} from '../../../src/archivist/utils/sql.js';
import { eraMap } from '../../../src/archivist/types.js';

// ---------------------------------------------------------------------------
// escapeSql
// ---------------------------------------------------------------------------

describe('escapeSql', () => {
  it('should double single quotes', () => {
    expect(escapeSql("O'Brien")).toBe("O''Brien");
    expect(escapeSql("''")).toBe("''''");
  });

  it('should leave quote-free strings untouched', () => {
    expect(escapeSql('Rome')).toBe('Rome');
  });
});

// ---------------------------------------------------------------------------
// toRealArrayLiteral
// ---------------------------------------------------------------------------

describe('toRealArrayLiteral', () => {
  it('should build a comma-joined REAL[] literal', () => {
    expect(toRealArrayLiteral([1, 2, 3])).toBe('[1,2,3]::REAL[]');
  });

  it('should produce an empty REAL[] literal for an empty array', () => {
    expect(toRealArrayLiteral([])).toBe('[]::REAL[]');
  });

  it('should preserve fractional and negative values', () => {
    const lit = toRealArrayLiteral([0.5, -1.25]);
    expect(lit).toBe('[0.5,-1.25]::REAL[]');
    expect(lit.endsWith('::REAL[]')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEraCaseExpr
// ---------------------------------------------------------------------------

describe('buildEraCaseExpr', () => {
  const expr = buildEraCaseExpr();

  it('should be a CASE ... ELSE 0 END expression', () => {
    expect(expr.startsWith('CASE ')).toBe(true);
    expect(expr.trimEnd().endsWith('ELSE 0 END')).toBe(true);
  });

  it('should include a WHEN clause for every era label and its ordinal', () => {
    for (const [era, ord] of Object.entries(eraMap)) {
      expect(expr).toContain(`WHEN era = '${era}' THEN ${ord}`);
    }
  });
});

// ---------------------------------------------------------------------------
// rowsToObjects
// ---------------------------------------------------------------------------

/** Minimal fake DuckDB result mimicking columnCount/columnName/getRows. */
function makeResult(columns: string[], rows: any[][]) {
  return {
    columnCount: columns.length,
    columnName: (i: number) => columns[i],
    getRows: async () => rows,
  };
}

describe('rowsToObjects', () => {
  it('should map row arrays to objects keyed by column name', async () => {
    const result = makeResult(['game_id', 'turn', 'score'], [
      ['g1', 100, 42],
      ['g2', 200, 7],
    ]);
    const objs = await rowsToObjects(result);
    expect(objs).toEqual([
      { game_id: 'g1', turn: 100, score: 42 },
      { game_id: 'g2', turn: 200, score: 7 },
    ]);
  });

  it('should return an empty array when there are no rows', async () => {
    const result = makeResult(['game_id'], []);
    expect(await rowsToObjects(result)).toEqual([]);
  });

  it('should preserve null cell values under their column keys', async () => {
    const result = makeResult(['a', 'b'], [[null, 5]]);
    const objs = await rowsToObjects(result);
    expect(objs[0]).toEqual({ a: null, b: 5 });
    expect(Object.keys(objs[0])).toEqual(['a', 'b']);
  });
});
