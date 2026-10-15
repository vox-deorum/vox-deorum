/** Tests for the seat records writer and its catalog (src/knowledge/records.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogPath, eventCategoryFiles, formatTurnRanges, SeatRecords } from '../../../src/knowledge/records.js';
import { renderSection } from '../../../src/knowledge/sections.js';
import type { GameState, StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { filterEventsByCategory } from '../../../src/utils/prompts/event-filters.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';

/** Decode stored bytes as UTF-8 text. */
function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}

/** The heading configuration MCP attaches to a report, as `callTool` does. */
function markdownConfig(...formats: string[]) {
  return { configs: formats.map((format) => ({ format })) };
}

/** The catalog's note on which record files are Markdown only. */
function markdownOnlyNote(catalog: string): string {
  return catalog.split('\n').find((line) => line.includes('Markdown only'))!;
}

/** Whether a rendered category view ends with the note for a category holding no events of its own. */
function endsWithNote(file: string): boolean {
  const last = file.trimEnd().split('\n').at(-1)!;
  return !/^(?:#|-|\s)/.test(last);
}

/** Seat parameters with game metadata. */
function makeParameters(metadata: Record<string, unknown> = { Turn: 1, YouAre: { Name: 'Rome', Leader: 'Augustus' }, Speed: 'Standard' }): StrategistParameters {
  return { playerID: 1, gameID: 'g1', turn: 1, after: 0, before: 0, workingMemory: {}, gameStates: {}, mode: 'Flavor', metadata } as unknown as StrategistParameters;
}

/** A processed turn's state with small reports in each section. */
function makeState(turn: number, events: Record<string, unknown> = { '1': [{ Type: 'TileRevealed', Note: 'tile' }], _markdownConfig: markdownConfig('Turn {key}', '{key}') }): GameState {
  return {
    turn,
    reports: {},
    players: {
      '0': { Civilization: 'Rome', Leader: 'Augustus', IsMajor: true, Score: 10 },
      '1': { Civilization: 'Greece', Leader: 'Alexander', IsMajor: true, Score: 8 },
      '2': { Civilization: 'Greece', Leader: 'Pericles', IsMajor: true, Score: 7 },
      '63': 'Barbarians',
      _markdownConfig: markdownConfig('Player {key}'),
    },
    cities: {
      Rome: { Roma: { Population: 5 } },
      Greece: { Athens: { Population: 4 } },
      'City-States': { Geneva: { Population: 3 } },
      _markdownConfig: markdownConfig('Player: {key}', '{key}'),
    },
    military: {
      'Unit Stats': [{ Type: 'Warrior' }],
      'Friendly Land Zone 3': { ZoneValue: 10 },
      _markdownConfig: markdownConfig('{key}'),
    },
    options: {
      Options: { GrandStrategies: ['Conquest'], Technologies: ['Pottery'], Policies: ['Tradition'] },
      Strategy: { GrandStrategy: 'Conquest' },
      Technology: { Next: 'Pottery' },
      Policy: { Next: 'Tradition' },
      _markdownConfig: markdownConfig('{key}', '{key}', '{key}'),
    },
    victory: { Domination: 'Rome leads', _markdownConfig: markdownConfig('{key}') },
    events,
  } as unknown as GameState;
}

describe('SeatRecords', () => {
  let dir: string;
  let store: WorkspaceStore;
  let records: SeatRecords;

  /** A stored record file as text. */
  function read(storePath: string): string | undefined {
    return text(store.readFile(storePath));
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-records-'));
    store = WorkspaceStore.open(path.join(dir, 'seat.db'));
    records = new SeatRecords(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('recordTurn', () => {
    it('should write complete Markdown with the registry and the report config, and JSON without the config', () => {
      const state = makeState(5);
      records.recordTurn(makeParameters(), state);

      expect(read('records/turn-5/players.md')).toBe(`${renderSection('players', state.players)}\n`);
      expect(read('records/turn-5/players.md')).toContain('Player 1');
      expect(JSON.parse(read('records/turn-5/players.json')!)).toEqual(
        Object.fromEntries(Object.entries(state.players!).filter(([key]) => key !== '_markdownConfig')),
      );
      expect(read('records/turn-5/cities.md')).toContain('Player: Rome');
      expect(read('records/turn-5/military.md')).toBe(`${renderSection('military', state.military)}\n`);
      expect(read('records/turn-5/victory.md')).toBe(`${renderSection('victory', state.victory)}\n`);

      const { Options, ...strategies } = state.options!;
      expect(read('records/turn-5/options.md')).toBe(`${renderSection('options', Options)}\n`);
      expect(JSON.parse(read('records/turn-5/options.json')!)).toEqual(Options);
      expect(read('records/turn-5/strategies.md')).toBe(`${renderSection('strategies', strategies)}\n`);
      expect(JSON.parse(read('records/turn-5/strategies.json')!)).not.toHaveProperty('_markdownConfig');
    });

    it('should split players and cities into readable parts with collision suffixes, but keep military whole', () => {
      records.recordTurn(makeParameters(), makeState(5));
      const parts = [...store.manifest().keys()].filter((key) => /^records\/turn-5\/[a-z]+\//.test(key)).sort();
      expect(parts).toEqual([
        'records/turn-5/cities/alexander.md',
        'records/turn-5/cities/augustus.md',
        'records/turn-5/players/greece-2.md',
        'records/turn-5/players/greece.md',
        'records/turn-5/players/rome.md',
      ]);
      expect([...store.manifest().keys()].some((key) => key.startsWith('records/turn-5/military/'))).toBe(false);
      expect(read('records/turn-5/players/greece.md')).toContain('Alexander');
      expect(read('records/turn-5/players/greece.md')).not.toContain('Pericles');
      expect(read('records/turn-5/players/greece-2.md')).toContain('Pericles');
      expect(read('records/turn-5/players/greece-2.md')).toContain('Player 2');
      expect(read('records/turn-5/cities/augustus.md')).toContain('Roma');
      expect(read('records/turn-5/cities/augustus.md')).not.toContain('Athens');
    });

    it('should give string player entries no split file while keeping them in the report', () => {
      records.recordTurn(makeParameters(), makeState(5));
      const playerParts = [...store.manifest().keys()].filter((key) => key.startsWith('records/turn-5/players/'));
      expect(playerParts).not.toContain('records/turn-5/players/player-63.md');
      expect(playerParts.some((key) => key.includes('barbarian'))).toBe(false);
      expect(playerParts).toContain('records/turn-5/players/rome.md');
      expect(read('records/turn-5/players.md')).toContain('Barbarians');
    });

    it('should write the turn and its catalog in one turn commit by the host', () => {
      const before = store.history().length;
      const id = records.recordTurn(makeParameters(), makeState(5));
      const added = store.history().slice(before);
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ id, kind: 'turn', turn: 5, author: 'host' });
      const manifest = store.manifest(id);
      expect(manifest.has(catalogPath)).toBe(true);
      expect(text(store.readFile(catalogPath, id))).toContain(formatTurnRanges([5]));
    });

    it('should write game sections when missing or changed and leave them alone otherwise', () => {
      records.recordTurn(makeParameters(), makeState(1));
      const first = store.manifest().get('records/game/situation.json');
      expect(JSON.parse(read('records/game/civilization.json')!)).toEqual({ Name: 'Rome', Leader: 'Augustus' });
      expect(read('records/game/civilization.md')).toBe(`${renderSection('civilization', { Name: 'Rome', Leader: 'Augustus' })}\n`);
      expect(JSON.parse(read('records/game/situation.json')!)).toEqual({ Turn: 1, Speed: 'Standard' });

      const second = records.recordTurn(makeParameters(), makeState(2));
      expect(store.manifest(second).get('records/game/situation.json')).toEqual(first);

      records.recordTurn(makeParameters({ Turn: 1, YouAre: { Name: 'Rome', Leader: 'Augustus' }, Speed: 'Quick' }), makeState(3));
      expect(JSON.parse(read('records/game/situation.json')!)).toMatchObject({ Speed: 'Quick' });
    });

    it('should rewrite game sections after a rewind removed them', () => {
      records.recordTurn(makeParameters(), makeState(1));
      expect(store.rewind(1)).toBe(true);
      expect(read('records/game/situation.json')).toBeUndefined();
      records.recordTurn(makeParameters(), makeState(1));
      expect(read('records/game/situation.json')).toBeDefined();
    });

    it('should let a store error propagate', () => {
      store.close();
      expect(() => records.recordTurn(makeParameters(), makeState(1))).toThrow();
      store = WorkspaceStore.open(path.join(dir, 'seat.db'));
    });
  });

  describe('events', () => {
    const relayed = { Type: 'RelayedMessage', Categories: ['Military', 'Economy'], Content: 'marker-relayed' };
    const war = { Type: 'DeclareWar', Note: 'marker-war', Events: [{ Note: 'marker-nested' }] };
    const tile = { Type: 'TileRevealed', Note: 'marker-tile' };
    const unknown = { Type: 'UnknownEvent', Note: 'marker-unknown' };
    const late = { Type: 'CityTrained', Note: 'marker-late' };
    const turnStart = { Type: 'PlayerDoTurn', Note: 'marker-system' };
    const slice = {
      '3': [late],
      '5': [turnStart, relayed, war, tile, unknown],
      _markdownConfig: markdownConfig('Turn {key}', '{key}'),
    };
    const markers = ['marker-relayed', 'marker-war', 'marker-nested', 'marker-tile', 'marker-unknown', 'marker-late', 'marker-system'];

    /** Record turn 5 with the slice, plus a different merged window that must not be recorded. */
    function recordSlice(): void {
      const state = makeState(5, slice);
      state.mergedEvents = { '1': [{ Type: 'DeclareWar', Note: 'marker-merged' }] } as never;
      records.recordTurn(makeParameters(), state);
    }

    it('should keep the complete refresh slice with real turn keys, not the merged window', () => {
      recordSlice();
      const { _markdownConfig: _ignored, ...plain } = slice;
      expect(JSON.parse(read('records/turn-5/events-all.json')!)).toEqual(plain);
      const all = read('records/turn-5/events-all.md')!;
      for (const marker of markers) expect(all).toContain(marker);
      expect(all).not.toContain('marker-merged');
      expect(all).toContain('Turn 3');
    });

    it('should write all four category files matching the shared category-or-system filter', () => {
      recordSlice();
      expect(eventCategoryFiles.map(([suffix]) => suffix)).toEqual(['economic', 'military', 'diplomatic', 'others']);
      for (const [suffix, category] of eventCategoryFiles) {
        const file = read(`records/turn-5/events-${suffix}.md`);
        expect(file, suffix).toBeDefined();
        const expected = JSON.stringify(filterEventsByCategory(slice as never, [category, 'System']));
        for (const marker of markers) {
          expect(file!.includes(marker), `${suffix} ${marker}`).toBe(expected.includes(marker));
        }
      }
      // Overlapping membership: the relayed report and the war appear in more than one file.
      expect(read('records/turn-5/events-military.md')).toContain('marker-relayed');
      expect(read('records/turn-5/events-economic.md')).toContain('marker-relayed');
      expect(read('records/turn-5/events-diplomatic.md')).toContain('marker-nested');
      // Category files keep the report's heading configuration.
      expect(read('records/turn-5/events-economic.md')).toContain('Turn 5');
    });

    it('should keep each system event as a turn marker in every category view and write no system file', () => {
      recordSlice();
      expect(read('records/turn-5/events-system.md')).toBeUndefined();
      for (const [suffix] of eventCategoryFiles) {
        expect(read(`records/turn-5/events-${suffix}.md`)).toContain('marker-system');
      }
    });

    it('should keep uncategorized events only in the complete file and still write empty categories', () => {
      recordSlice();
      expect(read('records/turn-5/events-all.md')).toContain('marker-unknown');
      for (const [suffix] of eventCategoryFiles) {
        expect(read(`records/turn-5/events-${suffix}.md`)).not.toContain('marker-unknown');
      }
    });

    it('should keep the no-events note for a view whose own category has no events even with system events', () => {
      recordSlice();
      // The slice holds no Others-category events, only the system turn marker.
      const others = read('records/turn-5/events-others.md')!;
      expect(others).toContain('marker-system');
      expect(endsWithNote(others)).toBe(true);
      expect(endsWithNote(read('records/turn-5/events-economic.md')!)).toBe(false);
    });

    it('should write every event file for a refresh without events', () => {
      const state = makeState(6);
      delete state.events;
      records.recordTurn(makeParameters(), state);
      expect(read('records/turn-6/events-all.json')).toBeDefined();
      for (const [suffix] of eventCategoryFiles) {
        const file = read(`records/turn-6/events-${suffix}.md`)!;
        const body = file.split('\n').slice(2).join('\n').trim();
        expect(body.length).toBeGreaterThan(0);
        expect(endsWithNote(file)).toBe(true);
      }
    });
  });

  describe('recordBriefing', () => {
    it('should archive a briefing in one briefing commit and replace it on a repeat write', () => {
      const id = records.recordBriefing(4, 'military', 'first');
      expect(store.history().at(-1)).toMatchObject({ id, kind: 'briefing', turn: 4, author: 'host' });
      expect(read('records/turn-4/briefings/military.md')).toBe('first\n');
      records.recordBriefing(4, 'military', 'second\n');
      expect(read('records/turn-4/briefings/military.md')).toBe('second\n');
    });

    it('should write nothing for an aborted signal', () => {
      const head = store.head();
      const controller = new AbortController();
      controller.abort();
      expect(() => records.recordBriefing(4, 'combined', 'text', controller.signal)).toThrow();
      expect(store.head()).toBe(head);
    });

    it('should keep a briefing archived before its turn is recorded', () => {
      records.recordBriefing(2, 'combined', 'early');
      records.recordTurn(makeParameters(), makeState(2));
      expect(read('records/turn-2/briefings/combined.md')).toBe('early\n');
    });
  });

  describe('catalog', () => {
    it('should stay complete when turn and briefing commits interleave', () => {
      records.recordTurn(makeParameters(), makeState(1));
      records.recordBriefing(1, 'combined', 'one');
      const catalogAfterFirstBriefing = read(catalogPath)!;
      records.recordBriefing(2, 'military', 'early');
      records.recordTurn(makeParameters(), makeState(2));
      records.recordBriefing(2, 'economy', 'two');
      const catalog = read(catalogPath)!;
      expect(catalogAfterFirstBriefing).toContain('turn-1/briefings/combined.md');
      expect(read('records/turn-1/briefings/combined.md')).toBe('one\n');
      expect(catalog).toContain('turn-2/briefings/military.md');
      expect(catalog).toContain('turn-2/briefings/economy.md');
      expect(catalog).toContain('Recorded turns: 1-2');
    });

    it('should index the four event views as turn-marker holders and the military report without split parts', () => {
      records.recordTurn(makeParameters(), makeState(1));
      const catalog = read(catalogPath)!;
      expect(catalog).toContain('events-economic.md');
      expect(catalog).toContain('events-military.md');
      expect(catalog).toContain('events-diplomatic.md');
      expect(catalog).toContain('events-others.md');
      expect(catalog).not.toContain('events-system.md');
      expect(catalog).toMatch(/\| Military \| `turn-<N>\/military\.md` \|/);
    });

    it('should list briefings in the catalog only when the tree holds briefing files', () => {
      records.recordTurn(makeParameters(), makeState(1));
      const withoutBriefings = read(catalogPath)!;
      expect(withoutBriefings).not.toMatch(/^\| Briefings \|/m);
      expect(markdownOnlyNote(withoutBriefings)).not.toMatch(/briefing/i);

      records.recordBriefing(1, 'combined', 'one');
      const withBriefings = read(catalogPath)!;
      expect(withBriefings).toMatch(/^\| Briefings \|/m);
      expect(markdownOnlyNote(withBriefings)).toMatch(/briefing/i);
    });

    it('should list compressed turn ranges, missing turns, and the latest sizes', () => {
      for (const turn of [1, 2, 3, 5]) records.recordTurn(makeParameters(), makeState(turn));
      const catalog = read(catalogPath)!;
      expect(catalog).toContain(formatTurnRanges([1, 2, 3, 5]));
      expect(catalog).toMatch(/Missing[^\n]*\b4\b/);

      const size = store.manifest().get('records/turn-5/players.json');
      expect(size?.type).toBe('file');
      const row = catalog.split('\n').find((line) => line.includes('`turn-5/players.json`'));
      expect(row).toContain(String(size!.type === 'file' ? size!.size : -1));
      expect(catalog).not.toContain('`turn-3/players.json`');
    });
  });
});

describe('formatTurnRanges', () => {
  it('should compress consecutive turns and keep gaps', () => {
    expect(formatTurnRanges([42, 1, 2, 3, 40, 39, 2])).toBe('1-3, 39-40, 42');
    expect(formatTurnRanges([7])).toBe('7');
    expect(formatTurnRanges([])).toBe('');
  });
});
