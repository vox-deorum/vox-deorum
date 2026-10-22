/** Tests for the records directions and file-mode check (src/knowledge/directions.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileMode, insertRecordsDirections, recordsDirections, recordsNotes } from '../../../src/knowledge/directions.js';
import { eventCategoryFiles } from '../../../src/knowledge/records.js';
import { sections } from '../../../src/knowledge/sections.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import { journalStorePath, journalWindow } from '../../../src/utils/workspace/journal.js';
import { workspaceGuideFile } from '../../../src/utils/workspace/player-workspace.js';
import type { ModelMessage } from 'ai';
import type { ResolvedFilesConfig } from '../../../src/types/index.js';
import { enableFileMode, openTempRecords, recordableState, recordParameters, type TempRecords } from './directions-fixtures.js';

/** A bare context object standing in for a VoxContext. */
function bareContext(): any {
  return { tools: {}, prompts: false };
}

describe('fileMode', () => {
  it('should be false outside an execution and without files', () => {
    expect(fileMode(bareContext())).toBe(false);
    expect(fileMode({ ...bareContext(), currentRunTools: { tools: undefined } })).toBe(false);
  });

  it('should follow the resolved tools when files are on', () => {
    expect(fileMode(enableFileMode(bareContext()))).toBe(true);
    expect(fileMode(enableFileMode(bareContext(), undefined, [bashToolName, 'set-strategy']))).toBe(true);
    expect(fileMode(enableFileMode(bareContext(), undefined, ['set-strategy']))).toBe(false);
  });
});

describe('recordsDirections', () => {
  let temp: TempRecords;

  beforeEach(() => {
    temp = openTempRecords();
  });
  afterEach(() => temp.dispose());

  /** Record the given turns. */
  function record(...turns: number[]): void {
    for (const turn of turns) temp.records.recordTurn(recordParameters(), recordableState(turn));
  }

  describe('records and reference', () => {
    it('should name the mounts and the catalog', () => {
      record(1);
      const text = recordsDirections(enableFileMode(bareContext(), temp.store));
      expect(text).toContain('/workspace/records');
      expect(text).toContain('/workspace/reference');
      expect(text).toContain('CATALOG.md');
    });

    it('should handle no recorded turns and no store without throwing', () => {
      const empty = recordsDirections(enableFileMode(bareContext(), temp.store));
      expect(empty).toContain('/workspace/records');
      expect(empty).not.toMatch(/turn-\d+\//);
      expect(() => recordsDirections(enableFileMode(bareContext()))).not.toThrow();
    });

    it('should list the sections that are not inline with their patterns', () => {
      record(1);
      const text = recordsDirections(enableFileMode(bareContext(), temp.store));
      for (const title of ['Cities', 'Military', 'Events']) expect(text).toContain(title);
      expect(text).toContain('turn-<N>/cities.md');
      expect(text).toContain('turn-<N>/military.md');
      expect(text).toContain('turn-<N>/events-all.md');
      for (const [suffix] of eventCategoryFiles) expect(text).toContain(`events-${suffix}.md`);
      expect(text).not.toContain('turn-<N>/players.md');
    });

    it('should leave sections the caller keeps inline out of the omitted list', () => {
      record(1);
      const text = recordsDirections(enableFileMode(bareContext(), temp.store), ['cities', 'military']);
      expect(text).not.toContain('turn-<N>/cities.md');
      expect(text).not.toContain('turn-<N>/military.md');
      expect(text).toContain('turn-<N>/events-all.md');
    });

    it('should name the sections the caller keeps in the prompt, and only those', () => {
      record(1);
      const context = enableFileMode(bareContext(), temp.store);
      const oldOptionsTitle = sections.options.title;
      const oldVictoryTitle = sections.victory.title;
      sections.options.title = 'Caller options marker';
      sections.victory.title = 'Caller victory marker';
      try {
        const plain = recordsDirections(context);
        const inline = recordsDirections(context, ['options', 'victory']);
        expect(inline).toContain('Caller options marker');
        expect(inline).toContain('Caller victory marker');
        expect(plain).not.toContain('Caller victory marker');
        expect(inline.length).toBeGreaterThan(plain.length);
      } finally {
        sections.options.title = oldOptionsTitle;
        sections.victory.title = oldVictoryTitle;
      }
    });
  });

  describe('folders and notes guide', () => {
    let promptDir: string;

    beforeEach(() => {
      promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-guide-prompts-'));
      fs.writeFileSync(path.join(promptDir, 'records-directions.md'),
        '{{#game}}G={{#writable}}write{{/writable}}{{^writable}}read{{/writable}};{{/game}}'
          + '{{#guide}}empty={{#empty}}yes{{/empty}}{{^empty}}no{{/empty}};content={{content}}{{/guide}}'
          + '{{#shared}}{{name}}={{#writable}}write{{/writable}}{{^writable}}read{{/writable}};{{/shared}}');
    });

    afterEach(() => fs.rmSync(promptDir, { recursive: true, force: true }));

    /** Commit a game notes guide, as an agent's bash command would. */
    function writeGuide(content: string): void {
      temp.store.commit({ kind: 'notes', turn: 1, author: 'simple-strategist', changes: [{ path: `game/${workspaceGuideFile}`, type: 'file', content }] });
    }

    /** Directions for a seat with the given folders. */
    function directions(files: Partial<ResolvedFilesConfig>): string {
      return recordsDirections({ ...enableFileMode(bareContext(), temp.store, undefined, files), prompts: promptDir });
    }

    it('should show the default guide when the game folder is writable and the guide is not seeded yet', () => {
      const text = directions({ game: 'write', shared: {} });
      expect(text).toContain('G=write;empty=no;content=');
      expect(text.match(/content=([\s\S]*)/)?.[1].trim().length).toBeGreaterThan(0);
    });

    it('should show an edited guide instead of the default', () => {
      const guide = '# Guide\nKeep war plans in plans/war.md.\n';
      writeGuide(guide);
      const text = directions({ game: 'write', shared: {} });
      expect(text).toBe(`G=write;empty=no;content=${guide.trim()}`);
    });

    it('should tell a writable seat apart from a read-only one', () => {
      writeGuide('# Guide\nShared rules.\n');
      const write = directions({ game: 'write', shared: {} });
      const read = directions({ game: 'read', shared: {} });
      expect(read).toContain('Shared rules.');
      expect(read).toContain('G=read;empty=no;content=');
      expect(write).toContain('G=write;empty=no;content=');
    });

    it('should not invent a guide for a read-only folder without one', () => {
      const missing = directions({ game: 'read', shared: {} });
      writeGuide('   \n');
      const blank = directions({ game: 'read', shared: {} });
      expect(missing).toContain('G=read;empty=yes;content=');
      expect(blank).toContain('G=read;empty=yes;content=');
    });

    it('should leave out the game folder and guide when the seat has none, and list shared folders', () => {
      const text = directions({ game: false, shared: { lessons: 'write', library: 'read' } });
      expect(text).not.toContain('G=');
      expect(text).toContain('lessons=write;');
      expect(text).toContain('library=read;');
    });
  });

  describe('recent notes', () => {
    /** Commit one note file with a fixed write time. */
    function writeNote(storePath: string, content: string, mtime: number): void {
      temp.store.commit({ kind: 'notes', turn: 1, author: 'simple-strategist', changes: [{ path: storePath, type: 'file', content, mtime }] });
    }

    /** A file-mode context for a seat with the given game folder access. */
    function seat(game: ResolvedFilesConfig['game'] = 'write'): any {
      return enableFileMode(bareContext(), temp.store, undefined, { game, shared: {} });
    }

    /** The bulleted note paths, in order. */
    function listedPaths(text: string): string[] {
      return [...text.matchAll(/^- `(\/workspace\/game\/[^`]+)`$/gm)].map((match) => match[1]);
    }

    it('should name the five most recent notes without their text, newest first', () => {
      for (let index = 0; index < 8; index++) writeNote(`game/notes/turn-${index}.md`, `Note body ${index}.`, 1000 + index);
      writeNote(`game/${workspaceGuideFile}`, '# Guide\nNewest write of all.\n', 5000);

      const text = recordsNotes(seat())!;
      expect(text).not.toContain('Note body');
      expect(listedPaths(text)).toEqual([7, 6, 5, 4, 3].map((index) => `/workspace/game/notes/turn-${index}.md`));
    });

    it('should give no notes without notes or without a game folder', () => {
      expect(recordsNotes(seat())).toBeUndefined();
      writeNote('game/plan.md', 'Plan body.', 1000);
      expect(recordsNotes(seat(false))).toBeUndefined();
      expect(listedPaths(recordsNotes(seat())!)).toEqual(['/workspace/game/plan.md']);
    });

    describe('with a journal', () => {
      /** A journal of turn entries, each a heading and a body of the given size. */
      function journal(turns: number[], bodySize = 100): string {
        return turns.map((turn) => `### Turn ${turn}\n\nbody-${turn} ${'y'.repeat(bodySize)}`).join('\n\n') + '\n';
      }

      it('should show the newest whole entries that fit, in file order, and count the older ones', () => {
        const turns = Array.from({ length: 40 }, (_, index) => index + 1);
        writeNote(journalStorePath, journal(turns, 1000), 1000);
        const text = recordsNotes(seat())!;
        const shown = [...text.matchAll(/^### Turn (\d+)$/gm)].map((match) => Number(match[1]));
        expect(shown.length).toBeGreaterThan(1);
        expect(shown).toEqual(turns.slice(-shown.length));
        expect(text).toContain(String(40 - shown.length));
        expect(text.length).toBeLessThan(journalWindow + 2000);
      });

      it('should show a newest entry over the window alone, cut to the window', () => {
        writeNote(journalStorePath, journal([1, 2], journalWindow + 10), 1000);
        const text = recordsNotes(seat())!;
        expect(text).toMatch(/^### Turn 2$/m);
        expect(text).not.toMatch(/^### Turn 1$/m);
        expect(text.length).toBeLessThan(journalWindow + 1000);
      });

      it('should show the journal and list the other notes by name', () => {
        writeNote(journalStorePath, journal([1, 2]), 1000);
        writeNote('game/lessons.md', 'Lesson body.', 2000);
        const text = recordsNotes(seat())!;
        expect(text).toContain('body-2');
        expect(text).not.toContain('Lesson body.');
        expect(listedPaths(text)).toEqual(['/workspace/game/lessons.md']);
      });

      it('should give no notes for a blank journal alone', () => {
        writeNote(journalStorePath, '\n', 1000);
        expect(recordsNotes(seat())).toBeUndefined();
      });
    });

    it('should leave the directions unchanged when a note is written', () => {
      const before = recordsDirections(seat());
      writeNote('game/plan.md', 'Plan body.', 1000);
      const after = recordsDirections(seat());
      expect(after).toBe(before);
      expect(after).not.toContain('Plan body.');
    });
  });

  describe('insertRecordsDirections', () => {
    /** Opening messages shaped like a strategist's: a cached overview, then the game state. */
    function opening(): ModelMessage[] {
      return [
        { role: 'system', content: 'overview', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
        { role: 'user', content: 'game state' },
      ];
    }

    it('should put the directions first and the notes between the overview and the game state', () => {
      temp.store.commit({ kind: 'notes', turn: 1, author: 'simple-strategist', changes: [{ path: 'game/plan.md', type: 'file', content: 'Plan body.', mtime: 1000 }] });
      const context = enableFileMode(bareContext(), temp.store, undefined, { game: 'write', shared: {} });
      const messages = opening();
      insertRecordsDirections(messages, context);
      expect(messages.map((m) => m.content)).toEqual([recordsDirections(context), 'overview', recordsNotes(context), 'game state']);
      expect(messages[2].role).toBe('system');
    });

    it('should add only the directions without notes, and nothing outside file mode', () => {
      const context = enableFileMode(bareContext(), temp.store, undefined, { game: 'write', shared: {} });
      const messages = opening();
      insertRecordsDirections(messages, context);
      expect(messages).toEqual([{ role: 'system', content: recordsDirections(context) }, ...opening()]);

      const plain = opening();
      insertRecordsDirections(plain, bareContext());
      expect(plain).toEqual(opening());
    });
  });

  describe('stability', () => {
    it('should stay unchanged, with the recorded turn files, when briefing retries archive', () => {
      record(1, 2);
      const context = enableFileMode(bareContext(), temp.store);
      const before = recordsDirections(context);
      /** Every recorded file except briefings and the catalog, which briefing commits may rewrite. */
      const turnFiles = () => [...temp.store.manifest().entries()]
        .filter(([storePath]) => !storePath.includes('/briefings/') && !storePath.endsWith('CATALOG.md'));
      const filesBefore = turnFiles();

      // A briefing for a turn not yet recorded, then a trimmed retry replacing it.
      temp.records.recordBriefing(3, 'military', 'first attempt');
      temp.records.recordBriefing(3, 'military', 'trimmed retry');
      temp.records.recordBriefing(2, 'combined', 'combined briefing');

      expect(recordsDirections(context)).toBe(before);
      expect(turnFiles()).toEqual(filesBefore);
    });

    it('should stay unchanged and name no turn numbers when new turns are recorded', () => {
      record(1);
      const context = enableFileMode(bareContext(), temp.store);
      const before = recordsDirections(context);
      record(2, 3);
      expect(recordsDirections(context)).toBe(before);
      expect(before).not.toMatch(/turn-\d+/);
    });
  });

  describe('custom prompt folders', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-prompts-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('should still load and fill a custom file that reads the retired turn names', () => {
      fs.writeFileSync(path.join(dir, 'records-directions.md'),
        '{{#hasTurns}}[{{turnRanges}}|{{latestTurn}}]{{/hasTurns}}{{^hasTurns}}[none]{{/hasTurns}}\n');
      const context = { ...enableFileMode(bareContext(), temp.store), prompts: dir };
      expect(recordsDirections(context).trim()).toBe('[none]');
      record(1, 2, 3);
      expect(recordsDirections(context).trim()).toBe('[1-3|3]');
    });
  });
});
