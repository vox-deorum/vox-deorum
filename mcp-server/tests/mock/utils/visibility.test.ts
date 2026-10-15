/** Tests for the caller-visible player visibility array and PlayerN fields. */
import { describe, it, expect } from 'vitest';
import {
  applyVisibility,
  parseVisibility,
  getVisibility,
  getPlayerVisibility,
  composeVisibility,
} from '../../../src/utils/knowledge/visibility.js';

const playerSlots = 22;
const emptyVisibility = Array.from({ length: playerSlots }, () => 0);

describe('composeVisibility', () => {
  it('returns one zero entry per supported player when nobody is selected', () => {
    expect(composeVisibility([])).toEqual(emptyVisibility);
  });

  it('marks selected players as detailed and leaves other players hidden', () => {
    const expected = [...emptyVisibility];
    expected[0] = 2;
    expected[3] = 2;
    expect(composeVisibility([0, 3])).toEqual(expected);
  });

  it('ignores invalid player IDs and accepts the final supported player', () => {
    const expected = [...emptyVisibility];
    expected[21] = 2;
    expect(composeVisibility([-1, 21, 22, 27])).toEqual(expected);
  });
});

describe('applyVisibility', () => {
  it('leaves data fields alone when no visibility array is supplied', () => {
    expect(applyVisibility({ Name: 'Rome' })).toEqual({ Name: 'Rome' });
  });

  it('writes visibility levels onto the matching PlayerN fields', () => {
    const visibility = [...emptyVisibility];
    visibility[0] = 1;
    visibility[1] = 2;
    const result = applyVisibility({ Name: 'Rome' }, visibility) as Record<string, unknown>;
    expect(result).toMatchObject({ Name: 'Rome', Player0: 1, Player1: 2, Player2: 0, Player21: 0 });
  });
});

describe('parseVisibility', () => {
  it('reads existing PlayerN fields into the visibility array', () => {
    const expected = [...emptyVisibility];
    expected[2] = 1;
    expected[5] = 2;
    expected[21] = 2;
    const row: Record<string, number> = Object.fromEntries(
      emptyVisibility.map((value, player) => [`Player${player}`, value]),
    );
    row.Player2 = 1;
    row.Player5 = 2;
    row.Player21 = 2;
    expect(parseVisibility(row as any)).toEqual(expected);
  });
});

describe('getVisibility', () => {
  it('returns the stored level for the requested player', () => {
    const row = { Player4: 1, Player5: 2, Player6: 0 };
    expect(getVisibility(row, 4)).toBe(1);
    expect(getVisibility(row, 5)).toBe(2);
    expect(getVisibility(row, 6)).toBe(0);
  });
});

describe('getPlayerVisibility', () => {
  const summary = (key: number, fields: Record<string, number>) => ({ Key: key, ...fields });

  it('grants full visibility when no viewing player is supplied', () => {
    expect(getPlayerVisibility([], undefined, 3)).toBe(2);
  });

  it('grants full visibility when the target summary is unavailable', () => {
    expect(getPlayerVisibility([summary(1, { Player0: 0 })], 0, 99)).toBe(2);
  });

  it('uses the viewer-specific level from the target summary', () => {
    const summaries = [
      summary(1, { Player0: 2 }),
      summary(2, { Player0: 0 }),
    ];
    expect(getPlayerVisibility(summaries as any, 0, 1)).toBe(2);
    expect(getPlayerVisibility(summaries as any, 0, 2)).toBe(0);
  });
});
