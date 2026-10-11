/** Tests for the records directions and file-mode check (src/knowledge/directions.ts). */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileMode, recordsDirections } from '../../../src/knowledge/directions.js';
import { eventCategoryFiles } from '../../../src/knowledge/records.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import { workspaceGuide, workspaceGuideFile } from '../../../src/utils/workspace/player-workspace.js';
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

    it('should give recorded ranges and the latest turn folder', () => {
      record(1, 2, 3, 5);
      const text = recordsDirections(enableFileMode(bareContext(), temp.store));
      expect(text).toContain('1-3, 5');
      expect(text).toContain('turn-5/');
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
  });

  describe('folders and notes guide', () => {
    /** Commit a game notes guide, as an agent's bash command would. */
    function writeGuide(content: string): void {
      temp.store.commit({ kind: 'notes', turn: 1, author: 'simple-strategist', changes: [{ path: `game/${workspaceGuideFile}`, type: 'file', content }] });
    }

    /** Directions for a seat with the given folders. */
    function directions(files: Partial<ResolvedFilesConfig>): string {
      return recordsDirections(enableFileMode(bareContext(), temp.store, undefined, files));
    }

    it('should show the default guide when the game folder is writable and the guide is not seeded yet', () => {
      const text = directions({ game: 'write', shared: {} });
      expect(text).toContain(`/workspace/game/${workspaceGuideFile}`);
      expect(text).toContain(workspaceGuide('game').trim());
    });

    it('should show an edited guide instead of the default', () => {
      writeGuide('# Guide\nKeep war plans in plans/war.md.\n');
      const text = directions({ game: 'write', shared: {} });
      expect(text).toContain('Keep war plans in plans/war.md.');
      expect(text).not.toContain(workspaceGuide('game').trim());
    });

    it('should tell a writable seat apart from a read-only one', () => {
      writeGuide('# Guide\nShared rules.\n');
      const write = directions({ game: 'write', shared: {} });
      const read = directions({ game: 'read', shared: {} });
      expect(read).toContain('Shared rules.');
      expect(read).not.toBe(write);
    });

    it('should not invent a guide for a read-only folder without one', () => {
      const missing = directions({ game: 'read', shared: {} });
      writeGuide('   \n');
      const blank = directions({ game: 'read', shared: {} });
      expect(missing).toContain(`/workspace/game/${workspaceGuideFile}`);
      expect(missing).not.toContain(workspaceGuide('game').trim());
      expect(blank).toBe(missing);
    });

    it('should leave out the game folder and guide when the seat has none, and list shared folders', () => {
      const text = directions({ game: false, shared: { lessons: 'write', library: 'read' } });
      expect(text).not.toContain('/workspace/game');
      expect(text).not.toContain(workspaceGuide('game').trim());
      expect(text).toContain('/workspace/shared/lessons');
      expect(text).toContain('/workspace/shared/library');
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

    it('should expose every recorded turn as one range', () => {
      record(0, 1, 2, 3, 4, 5);
      const text = recordsDirections(enableFileMode(bareContext(), temp.store));
      expect(text).toContain('0-5');
      expect(text).toContain('turn-5/');
    });
  });
});
