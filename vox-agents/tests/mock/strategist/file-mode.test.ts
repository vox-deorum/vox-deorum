/**
 * Tests for file mode in the strategist prompt builders (src/strategist/agents).
 *
 * When a run's resolved tools include bash and the seat has files on, a strategist reads what its
 * prompt leaves out from its seat's records, so each builder adds the records directions and leaves
 * its cache anchors where the inline build puts them. The plain simple strategist keeps Military and
 * its own cities inline and points to the other owners' city files. Briefings are
 * pre-filled and episode retrieval is mocked, so nothing reaches a model, MCP server, or network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { recordsDirections } from '../../../src/knowledge/directions.js';
import { simpleStrategistInlineSections, strategistInlineSections } from '../../../src/knowledge/sections.js';
import { sections, type SectionKey } from '../../../src/knowledge/sections.js';
import { renderStrategistReports } from '../../../src/strategist/strategy-parameters.js';
import { splitEntries } from '../../../src/knowledge/records.js';
import { countCacheBreakpoints, hasCacheBreakpoint } from '../../../src/utils/models/cache-breakpoint.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { createFakeVoxContext, type FakeVoxContext } from '../../helpers/fake-vox-context.js';
import { makeFixtureGameState, makeFixtureParameters } from '../../fixtures/game-state/index.js';
import { enableFileMode, openTempRecords, recordableState, recordParameters, type TempRecords } from '../knowledge/directions-fixtures.js';

// Replace episode retrieval with a canned result; formatting stays the real implementation.
const episodeResults = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../../../src/utils/prompts/episode-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/utils/prompts/episode-utils.js')>()),
  requestEpisodes: vi.fn(async () => episodeResults.current),
}));

/** Sections the file-mode simple strategist still reads inline. */
const inlineSections: SectionKey[] = ['strategies', 'victory', 'players', 'cities', 'military'];

/** Sections the file-mode simple strategist reads from its records, so they leave the inline reports. */
const recordSections: SectionKey[] = ['events'];

/** Text only the retrieved episode carries, so the message it lands in is findable. */
const episodeMarker = 'Episode marker: a fragile peace on the tin coast';

/** A canned historical episode with the fields the real formatter reads. */
const episode = {
  gameId: 'past-game', turn: 88, civilization: 'Arabia', era: 'Classical Era',
  isWinner: true, victoryType: 'Cultural', similarity: 0.87,
  situationAbstract: episodeMarker,
  decisionAbstract: null, situation: null, decisions: 'Set Culture & Growth flavors.',
  outcomes: [],
  indicators: { culturePerPop: 2.25 },
};

/** Fetch an agent from the registry by name. */
function agent(name: string): any {
  return agentRegistry.get(name);
}

/** Matcher for one section's own level-1 heading, which report data never emits at that level. */
function sectionHeading(key: SectionKey): RegExp {
  return new RegExp(`^# ${sections[key].title}$`, 'm');
}

/** Index of the first message whose text contains `marker`, or -1 when none does. */
function messageWith(messages: ModelMessage[], marker: string): number {
  return messages.findIndex((m) => typeof m.content === 'string' && m.content.includes(marker));
}

/**
 * Assert the run holds exactly one breakpoint-free system message with the records directions,
 * first in the run, followed by the inline build's leading system messages (which carry the cache
 * breakpoint that now covers the directions) and then the game-state user message.
 */
function expectDirectionsFirst(messages: ModelMessage[], inline: ModelMessage[], directions: string): void {
  const boundary = inline.findIndex((m) => m.role !== 'system');
  expect(messages.filter((m) => m.content === directions)).toHaveLength(1);
  expect(messages[0]).toEqual({ role: 'system', content: directions });
  expect(hasCacheBreakpoint(messages[0])).toBe(false);
  expect(messages.slice(1, 1 + boundary)).toEqual(inline.slice(0, boundary));
  expect(messages.slice(1, 1 + boundary).some(hasCacheBreakpoint)).toBe(true);
  expect(messages[1 + boundary].role).toBe('user');
}

/** The messages without the records directions. */
function withoutDirections(messages: ModelMessage[], directions: string): ModelMessage[] {
  return messages.filter((m) => m.content !== directions);
}

/** Fresh fixture parameters for one builder call. */
function freshParameters(): StrategistParameters {
  return makeFixtureParameters();
}

/** Fixture parameters with the combined briefing pre-filled, so no briefer is called. */
function briefedParameters(): StrategistParameters {
  const parameters = makeFixtureParameters();
  parameters.gameStates[parameters.turn].reports['briefing'] = 'Combined briefing: the island empire grows, the peace holds.';
  return parameters;
}

/** {@link briefedParameters} plus the pending episode request that steers retrieval. */
function episodesParameters(): StrategistParameters {
  const parameters = briefedParameters();
  parameters.workingMemory['episode-request'] = 'A coastal peaceful culture game.';
  return parameters;
}

describe('strategist prompt builders in file mode', () => {
  let temp: TempRecords;

  beforeEach(() => {
    temp = openTempRecords();
    temp.records.recordTurn(recordParameters(), recordableState(98));
    temp.records.recordTurn(recordParameters(), recordableState(99));
  });

  afterEach(() => {
    episodeResults.current = [];
    temp.dispose();
  });

  /**
   * Build one agent's initial messages twice, with independent parameters each time: inline, and in
   * file mode over the temp records store with `tools` as the run's resolved tools (undefined means
   * every registered tool). Also returns the file-mode context and the directions text it implies.
   */
  async function build(
    name: string,
    makeParameters: () => StrategistParameters = freshParameters,
    tools?: string[],
    inPrompt: SectionKey[] = strategistInlineSections,
  ): Promise<{ inline: ModelMessage[]; messages: ModelMessage[]; fake: FakeVoxContext; directions: string }> {
    const inlineContext = createFakeVoxContext();
    const inline = (await agent(name).getInitialMessages(makeParameters(), undefined, inlineContext.asContext())) as ModelMessage[];

    const fake = enableFileMode(createFakeVoxContext(), temp.store, tools);
    const parameters = makeParameters();
    const messages = (await agent(name).getInitialMessages(parameters, undefined, fake.asContext())) as ModelMessage[];
    return { inline, messages, fake, directions: recordsDirections(fake.asContext(), inPrompt) };
  }

  describe('simple-strategist', () => {
    it('should keep the overview and shrink the reports to the core plus directions', async () => {
      const { inline, messages, directions } = await build('simple-strategist', freshParameters, undefined, simpleStrategistInlineSections);

      expect(messages).toHaveLength(inline.length + 1);
      expect(withoutDirections(messages, directions).map((m) => m.role)).toEqual(inline.map((m) => m.role));
      // The system overview is the inline one and still carries its breakpoint.
      expect(messages[1]).toEqual(inline[0]);
      expect(hasCacheBreakpoint(messages[1])).toBe(true);

      // The inline reports hold all six sections; the core keeps only the ones records do not cover.
      const inlineReports = String(inline[inline.findIndex((m) => m.role !== 'system')].content);
      for (const key of [...inlineSections, ...recordSections]) expect(inlineReports).toMatch(sectionHeading(key));
      const core = String(messages[messages.findIndex((m) => m.role !== 'system')].content);
      for (const key of inlineSections) expect(core).toMatch(sectionHeading(key));
      for (const key of recordSections) expect(core).not.toMatch(sectionHeading(key));
      expect(core).not.toBe(inlineReports);

      expectDirectionsFirst(messages, inline, directions);
      expect(countCacheBreakpoints(messages)).toBe(countCacheBreakpoints(inline));
    });

    it("should keep only our cities inline and name the other owners' city files", async () => {
      const parameters = freshParameters();
      const state = makeFixtureGameState();
      const ownName = parameters.metadata!.YouAre!.Name;
      const others = splitEntries('cities', state.cities).filter(({ entry }) => entry !== ownName);
      expect(others.length).toBeGreaterThan(0);

      const [, inline] = renderStrategistReports(parameters, state);
      const [, core] = renderStrategistReports(parameters, state, { fileMode: true });
      const cityHeading = (owner: string) => `## Player: ${owner}`;

      expect(core).toContain(cityHeading(ownName));
      expect(inline).toContain(cityHeading(ownName));
      for (const { entry, name } of others) {
        expect(inline).toContain(cityHeading(entry));
        expect(core).not.toContain(cityHeading(entry));
        expect(core).toContain(`/workspace/records/turn-${state.turn}/cities/${name}.md`);
      }
    });

    it('should keep the whole cities report when our civilization has no entry', async () => {
      const parameters = freshParameters();
      parameters.metadata!.YouAre!.Name = 'Atlantis';
      const state = makeFixtureGameState();
      const [, core] = renderStrategistReports(parameters, state, { fileMode: true });
      for (const { entry } of splitEntries('cities', state.cities)) expect(core).toContain(`## Player: ${entry}`);
      expect(core).not.toContain('/cities/');
    });

    it('should build exactly the inline messages when the resolved tools exclude bash', async () => {
      const { inline, messages } = await build('simple-strategist', freshParameters, ['set-flavors']);
      expect(messages).toEqual(inline);
    });
  });

  for (const name of ['simple-strategist-briefed', 'simple-strategist-staffed']) {
    describe(name, () => {
      it('should insert one directions message ahead of the inline messages', async () => {
        const { inline, messages, fake, directions } = await build(name, briefedParameters);

        // The pre-filled briefing means no briefer runs for either build.
        expect(fake.callAgent).not.toHaveBeenCalled();
        expect(messages).toHaveLength(inline.length + 1);
        expect(withoutDirections(messages, directions)).toEqual(inline);

        expectDirectionsFirst(messages, inline, directions);
        expect(countCacheBreakpoints(messages)).toBe(countCacheBreakpoints(inline));
      });
    });
  }

  describe('simple-strategist-learned', () => {
    it('should put the directions first and the episodes in the last message', async () => {
      episodeResults.current = [episode];
      const { inline, messages, directions } = await build('simple-strategist-learned', episodesParameters);

      expectDirectionsFirst(messages, inline, directions);
      expect(messageWith(messages, episodeMarker)).toBe(messages.length - 1);
      expect(messages[messages.length - 1].role).toBe('user');
      expect(countCacheBreakpoints(messages)).toBe(countCacheBreakpoints(inline));
    });

    it('should put the episodes in the last message without file mode', async () => {
      episodeResults.current = [episode];
      const inline = (await agent('simple-strategist-learned').getInitialMessages(
        episodesParameters(), undefined, createFakeVoxContext().asContext(),
      )) as ModelMessage[];

      expect(messageWith(inline, episodeMarker)).toBe(inline.length - 1);
    });
  });
});
