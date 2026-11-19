import { describe, expect, it } from 'vitest';
import { hasDefensivePact, isAlly, isAtWar, isFriend, isMasterOf, isVassalOf, parseRelationship } from '../../../src/diplomacy/relationships.js';

describe('public relationship parsing', () => {
  it('retains directional scores and weariness while exposing proximity', () => {
    const facts = parseRelationship(['Distance: Close', 'War (Our Score: -38%; Our War Weariness: 71%)']);
    expect(facts).toEqual({
      state: 'war', warScore: -38, warWeariness: 71, proximity: 'Close',
      denouncedThem: false, openBordersTo: false
    });
    expect(isAtWar(facts)).toBe(true);
    expect(isAtWar(['War (Our Score: 0%; Our War Weariness: 0%)'])).toBe(true);
    expect(parseRelationship('War (Our Score: -38%; Our War Weariness: 71%)')).toMatchObject({
      state: 'war', warScore: -38, warWeariness: 71
    });
    expect(parseRelationship(['War (Our Score: 101%; Our War Weariness: 0%)'])).toEqual({
      state: 'war', warWeariness: 0
    });
  });

  it('keeps a malformed score from hiding a valid weariness or war state', () => {
    expect(parseRelationship(['Distance: Close', 'War (Our Score: 101%; Our War Weariness: 120%)'])).toEqual({
      state: 'war', proximity: 'Close', denouncedThem: false, openBordersTo: false
    });
  });

  it.each(['War', 'Permanent War', 'War - Peace Currently Blocked'])('recognizes %s before city-state measurements', status => {
    const expected = { state: 'war', influence: -81, proximity: 'Close', protected: true };
    expect(parseRelationship(`${status} (Influence: -81, Distance: Close, Protected)`)).toEqual(expected);
    expect(parseRelationship([`${status} (Influence: -81, Distance: Close, Protected)`])).toEqual(expected);
  });

  it('preserves war and omits measurements when a city-state suffix is malformed', () => {
    expect(parseRelationship('War (Influence: unavailable, Distance: Close)')).toEqual({ state: 'war' });
    expect(parseRelationship('War (Influence: 9007199254740992, Distance: Close)')).toEqual({ state: 'war' });
  });

  it('recognizes public agreements and both directions of vassalage', () => {
    const pact = ['Distance: Close', 'Defensive Pact', 'Declaration of Friendship', 'Peace Treaty', 'Our Vassal (Capitulated)'];
    expect(hasDefensivePact(pact)).toBe(true);
    expect(isFriend(parseRelationship(pact))).toBe(true);
    expect(isMasterOf(pact)).toBe(true);
    expect(isVassalOf(['Our Master (Voluntary)'])).toBe(true);
    expect(parseRelationship(pact)).toMatchObject({ state: 'peace', vassal: 'capitulated', peaceTreaty: true });
  });

  it('keeps denouncements directional and ignores the retired incoming token', () => {
    expect(parseRelationship(['Distance: Close', 'Denounced Them'])).toMatchObject({
      denouncedThem: true, state: 'peace'
    });
    expect(parseRelationship(['Distance: Close', 'They Denounced Us'])).toMatchObject({
      denouncedByThem: true, denouncedThem: false, state: 'peace'
    });
    expect(parseRelationship(['Distance: Close', 'Denounced By Them'])).toEqual({
      state: 'peace', proximity: 'Close', denouncedThem: false, openBordersTo: false
    });
  });

  it('marks a whole major entry as open or closed to the target', () => {
    expect(parseRelationship(['Distance: Far', 'Open Borders'])).toMatchObject({ openBordersTo: true });
    expect(parseRelationship(['Distance: Far'])).toMatchObject({ openBordersTo: false, denouncedThem: false });
    // A standalone token is positive-only, so absence proves nothing.
    expect(parseRelationship('Open Borders')).toEqual({ state: 'peace', openBordersTo: true });
    expect(parseRelationship(['Open Borders'])).toEqual({ state: 'peace', openBordersTo: true });
  });

  it('keeps a malformed current war observation unknown alongside a valid distance observation', () => {
    const malformed = 'War (Our Score: unavailable%; Our War Weariness: 0%)';
    const expected = { state: 'unknown', proximity: 'Close', denouncedThem: false, openBordersTo: false };
    expect(parseRelationship(['Distance: Close', malformed])).toEqual(expected);
    expect(parseRelationship([malformed, 'Distance: Close'])).toEqual(expected);
    expect(parseRelationship(malformed)).toEqual({ state: 'unknown' });
  });

  it('checks city-state friendship and alliance with signed influence and explicit protection', () => {
    expect(isFriend('Friends (Influence: 45, Distance: Far)')).toBe(true);
    expect(isAlly('Ally (Influence: 112, Distance: Far)')).toBe(true);
    expect(isFriend('Ally')).toBe(true);
    expect(isFriend(['Friends'])).toBe(true);
    expect(isAlly(['Ally (Influence: 112, Distance: Far)'])).toBe(true);
    expect(parseRelationship('Neutral (Influence: 0, Distance: Close)')).toEqual({
      state: 'peace', influence: 0, proximity: 'Close', protected: false
    });
    expect(parseRelationship('Friends (Influence: -45, Distance: Close)')).toEqual({
      state: 'peace', friendship: true, influence: -45, proximity: 'Close', protected: false
    });
  });

  it('omits the placeholder distance without dropping other measurements', () => {
    expect(parseRelationship(['Distance: Unknown'])).toEqual({
      state: 'peace', denouncedThem: false, openBordersTo: false
    });
    expect(parseRelationship('Neutral (Influence: 3, Distance: Unknown)')).toEqual({
      state: 'peace', influence: 3, protected: false
    });
  });

  it.each([null, undefined, {}, [], ['Something new'], ['Distance: Close', 12], ''])('keeps absent or unsupported facts unknown: %j', value => {
    expect(parseRelationship(value)).toEqual({ state: 'unknown' });
    expect(isAtWar(value)).toBe(false);
    expect(isFriend(value)).toBe(false);
  });
});
