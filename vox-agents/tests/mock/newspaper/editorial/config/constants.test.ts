import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { resolveEditorialSpan, scaleEditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { prepareTriggerExpressions } from '../../../../../src/newspaper/editorial/config/expressions.js';
import { getEditorialExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference } from '../../../../../src/newspaper/editorial/facts/model.js';
import { evaluateTriggerRules } from '../../../../../src/newspaper/editorial/rules/evaluate.js';

describe('editorial constants and shortcuts', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'vd-constants-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  /** Write a partial constants catalogue to the test overlay. */
  async function writeConstants(value: unknown): Promise<void> {
    await writeFile(path.join(directory, 'constants.json'), JSON.stringify(value));
  }

  it('should let an overlay change a rule that reads a named threshold through a shortcut', async () => {
    const base = await loadEditorialConfig();
    await writeConstants({
      distances: { neighboring: 9 },
      types: { settlers: ['Colonist'] },
      shortcuts: { city: { testNeighbor: 'city.is.neighbor' } },
    });
    const modified = await loadEditorialConfig(directory);
    const cities: NewspaperSnapshot[] = [0, 1].map(owner => ({
      subjectID: owner + 10,
      source: { table: 'CityInformations', id: owner + 100, turn: 12, createdAt: 1 },
      values: { OwnerID: owner, X: owner * 8, Y: 0, Population: 4 },
    }));
    const facts = buildNewspaperFacts({
      request: { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 12 },
      cities, players: [], comparisons: { cities: [], players: [] }, events: [],
    });
    const rule = { id: 'report-neighbor', tier: 'filler', when: 'city.is.neighbor' };
    for (const { constants, expected } of [
      { constants: base.constants, expected: false },
      { constants: modified.constants, expected: true },
    ]) {
      const { runner, slots } = await prepareTriggerExpressions([rule], constants);
      const [[[result]]] = await runner.evaluate({
        facts, constants: scaleEditorialConstants(constants, 1),
        groups: [{ expressions: slots.get(rule.id)!.when, subjects: [{ city: reference('city', 11) }] }],
      });
      expect(result).toEqual({ value: expected, sources: [cities[1].source, cities[0].source] });
    }
    expect(modified.constants.distances).toEqual({ ...base.constants.distances, neighboring: 9 });
    expect(modified.constants.types).toEqual({ ...base.constants.types, settlers: ['Colonist'] });
    expect(modified.constants.shortcuts.city).toEqual({
      ...base.constants.shortcuts.city, testNeighbor: 'city.is.neighbor',
    });
  });

  it('should apply overlay tier bases and numeric stakes and audit non-finite stakes', async () => {
    await writeConstants({
      tiers: { filler: 36 },
      stakes: { player: { testPoints: 'self.gold / 2', invalidPoints: 'Infinity' } },
    });
    const base = await loadEditorialConfig(directory);
    const config = await parseEditorialConfig({
      ...base,
      triggers: [{
        id: 'test-stakes', subject: 'world', tier: 'filler', when: 'true',
        adjust: ['self.stake.testPoints', 'self.stake.invalidPoints'],
      }],
      templates: [],
    });
    const facts = buildNewspaperFacts({
      request: { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 12 },
      cities: [], comparisons: { cities: [], players: [] }, events: [],
      players: [{
        subjectID: 0, values: { Gold: 26 },
        source: { table: 'PlayerSummaries', id: 1, turn: 12, createdAt: 1 },
      }],
    });
    const result = await evaluateTriggerRules({
      rules: config.triggers, compiled: await getEditorialExpressions(config),
      constants: config.constants, facts, speedMultiplier: 1,
    });
    expect(result.developments).toMatchObject([{ definitionId: 'test-stakes', tier: 'filler', importance: 49 }]);
    expect(result.audit[0].subjects[0]).toMatchObject({
      tierBase: 36, adjustments: [{ points: 13 }, { points: 0, error: expect.any(String) }],
    });
  });

  it('should classify the bound player using visible identity and the current regional list', async () => {
    const base = await loadEditorialConfig();
    await writeConstants({ types: { eastAsianCivilizations: ['Egypt', 'Geneva'] } });
    const modified = await loadEditorialConfig(directory);
    const players: NewspaperSnapshot[] = [0, 1, 2, 22].map(id => ({
      subjectID: id, source: { table: 'PlayerSummaries', id, turn: 12, createdAt: 1 }, values: {},
    }));
    const facts = buildNewspaperFacts({
      request: { receiverPlayerID: 0, previousCheckTurn: 10, cutoffTurn: 12 },
      cities: [], players, comparisons: { cities: [], players: [] }, events: [],
    }, { playerIdentities: {
      0: { name: 'Egypt', major: true },
      1: { name: 'China', major: true },
      22: { name: 'Geneva', major: false },
    } });
    const rule = { id: 'report-east-asian', tier: 'filler', when: 'player.is.eastAsian' };
    const subjects = players.map(({ subjectID }) => ({ player: reference('player', subjectID) }));
    for (const { constants, expected } of [
      { constants: base.constants, expected: [false, true] },
      { constants: modified.constants, expected: [true, false] },
    ]) {
      const { runner, slots } = await prepareTriggerExpressions([rule], constants);
      const [[[receiver], [rival], [hidden], [cityState]]] = await runner.evaluate({
        facts, constants: scaleEditorialConstants(constants, 1),
        groups: [{ expressions: slots.get(rule.id)!.when, subjects }],
      });
      expect(receiver).toMatchObject({ value: expected[0] });
      expect(rival).toMatchObject({ value: expected[1] });
      expect(hidden).toMatchObject({ error: { hidden: expect.any(String) } });
      expect(cityState).toMatchObject({ value: false });
    }
  });

  it('should scale named and literal spans in recorded turns while saving their Standard values', async () => {
    await writeConstants({ spans: { recent: 7, short: 0.5 } });
    const config = await loadEditorialConfig(directory);
    const scaled = scaleEditorialConstants(config.constants, 0.67);
    expect(scaled).toMatchObject({ recent: 5, short: 1, long: 27, neighboring: config.constants.distances.neighboring });
    expect(scaled.settlers).toEqual(config.constants.types.settlers);
    expect(resolveEditorialSpan(7, config.constants, 0.67)).toBe(scaled.recent);
    expect(resolveEditorialSpan('recent', config.constants, 3)).toBe(21);
    expect(() => resolveEditorialSpan('neighboring', config.constants, 1)).toThrow(RangeError);
    const restored = await parseEditorialConfig(JSON.parse(JSON.stringify(config)));
    expect(restored).toEqual(config);
    expect(restored.constants.spans.recent).toBe(7);
  });

  it('should reject invalid or ambiguous names and values after merging an overlay', async () => {
    for (const constants of [
      { distances: { 'too-far': 10 } },
      { distances: { turn: 10 } },
      ...['values', 'triggerValues', 'group', 'subject', 'period', '$kind'].map(name => ({ sizes: { [name]: 1 } })),
      { sizes: { neighboring: 10 } },
      { tiers: { neighboring: 10 } },
      { tiers: { turn: 75 } },
      { spans: { recent: 0 } },
      { shares: { dominant: 1.1 } },
      { types: { workers: ['Worker', 2] } },
      { shortcuts: { world: { alert: 'true' } } },
      { shortcuts: { city: { knows: 'true' } } },
      { terms: { 'too-far': '1' } },
      { terms: { turn: '1' } },
    ]) {
      await writeConstants(constants);
      await expect(loadEditorialConfig(directory)).rejects.toMatchObject({ issues: expect.any(Array) });
    }
  });

  it('should load printable terms in the authored and serialized catalogue', async () => {
    const stock = await loadEditorialConfig();
    const terms = {
      capital: 'self.capital.name',
      ruler: "self.ideology == 'Order' ? 'the Party' : 'the Crown'",
    };
    await writeConstants({ terms });
    const config = await loadEditorialConfig(directory);
    expect(config.constants.terms).toEqual({ ...stock.constants.terms, ...terms });
    const restored = await parseEditorialConfig(JSON.parse(JSON.stringify(config)));
    expect(restored.constants.terms).toEqual(config.constants.terms);
    const { terms: _terms, ...constants } = config.constants;
    const withoutTerms = await parseEditorialConfig({ ...config, constants });
    expect(withoutTerms.constants.terms).toBeUndefined();
  });

  it('should reject an invalid term expression with its catalogue name', async () => {
    await writeConstants({ terms: { broken: 'true &&' } });
    await expect(loadEditorialConfig(directory)).rejects.toThrow('constants.terms.broken');
  });

  it('should reject invalid shortcut expressions before evaluating any facts', async () => {
    const config = await loadEditorialConfig();
    const shortcuts = { city: { neighbor: 'city.foreign &&' } };
    await writeConstants({ shortcuts });
    await expect(loadEditorialConfig(directory)).rejects.toThrow('shortcuts.city.neighbor');
    await expect(parseEditorialConfig({ ...config, constants: { ...config.constants, shortcuts } }))
      .rejects.toThrow('shortcuts.city.neighbor');
  });
});
