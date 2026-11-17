import { describe, expect, it } from 'vitest';
import { hasDefensivePact, isAlly, isAtWar, isFriend, isMasterOf, isVassalOf, parseRelationship } from '../../../src/diplomacy/relationships.js';

describe('public relationship parsing', () => {
  it('retains directional scores while discarding private war weariness', () => {
    const facts = parseRelationship(['Distance: Close', 'War (Our Score: -38%; Our War Weariness: 71%)']);
    expect(facts).toEqual({ state: 'war', warScore: -38 });
    expect(isAtWar(facts)).toBe(true);
    expect(isAtWar(['War (Our Score: 0%; Our War Weariness: 0%)'])).toBe(true);
    expect(parseRelationship('War (Our Score: -38%; Our War Weariness: 71%)')).toEqual(facts);
    expect(parseRelationship(['War (Our Score: 101%; Our War Weariness: 0%)'])).toEqual({ state: 'war' });
  });

  it.each(['War', 'Permanent War', 'War - Peace Currently Blocked'])('recognizes %s before private minor suffixes', status => {
    expect(parseRelationship(`${status} (Influence: -81, Distance: Close, Protected)`)).toEqual({ state: 'war' });
    expect(parseRelationship([`${status} (Influence: -81, Distance: Close, Protected)`])).toEqual({ state: 'war' });
  });

  it('recognizes public agreements and both directions of vassalage', () => {
    const pact = ['Distance: Close', 'Defensive Pact', 'Declaration of Friendship', 'Peace Treaty', 'Our Vassal (Capitulated)'];
    expect(hasDefensivePact(pact)).toBe(true);
    expect(isFriend(parseRelationship(pact))).toBe(true);
    expect(isMasterOf(pact)).toBe(true);
    expect(isVassalOf(['Our Master (Voluntary)'])).toBe(true);
    expect(parseRelationship(pact)).toMatchObject({ state: 'peace', vassal: 'capitulated', peaceTreaty: true });
  });

  it('keeps a malformed current war observation unknown alongside a valid distance observation', () => {
    const malformed = 'War (Our Score: unavailable%; Our War Weariness: 0%)';
    expect(parseRelationship(['Distance: Close', malformed])).toEqual({ state: 'unknown' });
    expect(parseRelationship([malformed, 'Distance: Close'])).toEqual({ state: 'unknown' });
    expect(parseRelationship(malformed)).toEqual({ state: 'unknown' });
  });

  it('checks city-state friendship and alliance without retaining influence', () => {
    expect(isFriend('Friends (Influence: 45, Distance: Far)')).toBe(true);
    expect(isAlly('Ally (Influence: 112, Distance: Far)')).toBe(true);
    expect(isFriend('Ally')).toBe(true);
    expect(isFriend(['Friends'])).toBe(true);
    expect(isAlly(['Ally (Influence: 112, Distance: Far)'])).toBe(true);
    expect(parseRelationship('Neutral (Influence: 0, Distance: Close)')).toEqual({ state: 'peace' });
  });

  it.each([null, undefined, {}, [], ['Something new'], ['Distance: Close', 12], ''])('keeps absent or unsupported facts unknown: %j', value => {
    expect(parseRelationship(value)).toEqual({ state: 'unknown' });
    expect(isAtWar(value)).toBe(false);
    expect(isFriend(value)).toBe(false);
  });
});
