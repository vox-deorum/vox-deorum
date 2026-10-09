/** Tests for system prompt templates, custom prompt folders, and their validation (src/utils/prompts/prompt-files.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../../src/utils/config.js';
import {
  builtInPromptsDir,
  getPromptSet,
  loadPromptSet,
  reloadPromptSets,
  reloadRootPrompts,
  renderSystemPrompt,
} from '../../../src/utils/prompts/prompt-files.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';

const strategists = ['simple-strategist', 'simple-strategist-briefed', 'simple-strategist-staffed', 'simple-strategist-learned'];

let tempDirs: string[] = [];
const originalPrompts = config.prompts;

/** Create a custom prompt folder holding the given files (relative path to content). */
function promptFolder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-prompts-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

/** The text of a built-in template file. */
function builtIn(name: string): string {
  return fs.readFileSync(path.join(builtInPromptsDir, `${name}.md`), 'utf8');
}

beforeEach(() => {
  config.prompts = false;
  reloadPromptSets([]);
});

afterEach(() => {
  config.prompts = originalPrompts;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('prompt files', () => {
  describe('built-in templates', () => {
    it('should load and validate every built-in template', () => {
      expect(() => loadPromptSet()).not.toThrow();
      expect(() => loadPromptSet(builtInPromptsDir)).not.toThrow();
    });

    it('should switch decision text between Strategy and Flavor modes', () => {
      for (const name of strategists) {
        const flavor = renderSystemPrompt(undefined, name, { flavor: true });
        const strategy = renderSystemPrompt(undefined, name, { flavor: false });
        expect(flavor).not.toBe(strategy);
        expect(flavor).toContain('set-flavors');
        expect(strategy).toContain('set-strategy');
      }
    });

    it('should add the episodes resource only when episodes were requested', () => {
      const without = renderSystemPrompt(undefined, 'simple-strategist-learned', { flavor: true, episodes: false });
      const withEpisodes = renderSystemPrompt(undefined, 'simple-strategist-learned', { flavor: true, episodes: true });
      expect(withEpisodes.startsWith(without)).toBe(true);
      expect(withEpisodes.length).toBeGreaterThan(without.length);
    });

    it('should leave & and < in game data unescaped', () => {
      const system = renderSystemPrompt(undefined, 'diplomatic-analyst', { leader: 'Kame & <Co>', civilization: 'Nuku <Hiva> & Co' });
      expect(system).toContain('Kame & <Co>');
      expect(system).toContain('Nuku <Hiva> & Co');
      expect(system).not.toContain('&amp;');
      expect(system).not.toContain('&lt;');
    });
  });

  describe('custom folders', () => {
    it('should replace an agent template and keep the others built in', () => {
      const dir = promptFolder({ 'diplomatic-analyst.md': 'Custom analyst for {{civilization}}.\n' });
      expect(renderSystemPrompt({ prompts: dir }, 'diplomatic-analyst', { leader: 'L', civilization: 'Rome' })).toBe('Custom analyst for Rome.');
      expect(renderSystemPrompt({ prompts: dir }, 'keyword-librarian')).toBe(renderSystemPrompt(undefined, 'keyword-librarian'));
    });

    it('should apply an overridden shared fragment to every template that includes it', () => {
      const dir = promptFolder({ 'shared/goals.md': 'CUSTOM GOALS MARKER\n' });
      for (const name of strategists) {
        const system = renderSystemPrompt({ prompts: dir }, name, { flavor: true });
        expect(system).toContain('CUSTOM GOALS MARKER');
        expect(renderSystemPrompt(undefined, name, { flavor: true })).not.toContain('CUSTOM GOALS MARKER');
      }
    });

    it('should resolve partials of a custom template through the custom folder', () => {
      const dir = promptFolder({
        'simple-strategist.md': 'Intro\n{{> shared/goals}}\n{{> shared/decision}}\n',
        'shared/goals.md': 'CUSTOM GOALS MARKER\n',
      });
      const system = renderSystemPrompt({ prompts: dir }, 'simple-strategist', { flavor: true });
      expect(system.startsWith('Intro\nCUSTOM GOALS MARKER\n')).toBe(true);
      expect(system).toContain('set-flavors');
    });

    it('should render a file saved with CRLF line endings like its LF form', () => {
      const lf = promptFolder({ 'simple-strategist.md': 'Intro\n{{> shared/goals}}\n{{> shared/decision}}\n' });
      const crlf = promptFolder({ 'simple-strategist.md': 'Intro\r\n{{> shared/goals}}\r\n{{> shared/decision}}\r\n' });
      const system = renderSystemPrompt({ prompts: crlf }, 'simple-strategist', { flavor: true });
      expect(system).toBe(renderSystemPrompt({ prompts: lf }, 'simple-strategist', { flavor: true }));
      expect(system).not.toContain('\r');
    });

    it('should keep each context on its own folder', () => {
      const seatA = promptFolder({ 'diplomatic-analyst.md': 'Seat A\n' });
      const seatB = promptFolder({ 'diplomatic-analyst.md': 'Seat B\n' });
      expect(renderSystemPrompt({ prompts: seatA }, 'diplomatic-analyst')).toBe('Seat A');
      expect(renderSystemPrompt({ prompts: seatB }, 'diplomatic-analyst')).toBe('Seat B');
      expect(renderSystemPrompt({ prompts: false }, 'diplomatic-analyst', { leader: 'L', civilization: 'C' })).not.toMatch(/^Seat/);
    });

    it('should use the root setting for a context without its own', () => {
      config.prompts = promptFolder({ 'summarizer.md': 'Root summarizer\n' });
      expect(renderSystemPrompt(undefined, 'summarizer')).toBe('Root summarizer');
      expect(renderSystemPrompt({}, 'summarizer')).toBe('Root summarizer');
      expect(renderSystemPrompt({ prompts: false }, 'summarizer')).not.toBe('Root summarizer');
    });

    it('should render an agent through its context prompt folder', async () => {
      const dir = promptFolder({ 'diplomatic-analyst.md': 'Analyst of {{civilization}} under {{leader}}\n' });
      const agent = agentRegistry.get('diplomatic-analyst')!;
      const parameters = makeStrategistParameters({ metadata: { YouAre: { Leader: 'Kamehameha', Name: 'Polynesia' } } as never });
      const system = await agent.getSystem(parameters, {} as never, { prompts: dir } as never);
      expect(system).toBe('Analyst of Polynesia under Kamehameha');
    });

    it('should pick up edits only after the prompt sets reload', () => {
      const dir = promptFolder({ 'diplomatic-analyst.md': 'First\n' });
      expect(renderSystemPrompt({ prompts: dir }, 'diplomatic-analyst')).toBe('First');
      fs.writeFileSync(path.join(dir, 'diplomatic-analyst.md'), 'Second\n');
      expect(renderSystemPrompt({ prompts: dir }, 'diplomatic-analyst')).toBe('First');
      reloadPromptSets([dir]);
      expect(renderSystemPrompt({ prompts: dir }, 'diplomatic-analyst')).toBe('Second');
    });
  });

  describe('validation', () => {
    it('should reject a file without a built-in counterpart', () => {
      const dir = promptFolder({ 'simple-stratgist.md': 'Typo\n' });
      expect(() => loadPromptSet(dir)).toThrow('simple-stratgist.md');
    });

    it('should reject a variable the built-in template does not use', () => {
      const dir = promptFolder({ 'keyword-librarian.md': 'Hello {{leader}}\n' });
      expect(() => loadPromptSet(dir)).toThrow('leader');
    });

    it('should reject a section the built-in template does not use', () => {
      const dir = promptFolder({ 'diplomatic-analyst.md': '{{#teammate}}Team{{/teammate}}\n' });
      expect(() => loadPromptSet(dir)).toThrow('teammate');
    });

    it('should reject a name reached only through an included partial', () => {
      const dir = promptFolder({ 'keyword-librarian.md': `${builtIn('keyword-librarian')}{{> shared/decision}}\n` });
      expect(() => loadPromptSet(dir)).toThrow('flavor');
    });

    it('should reject a section name used as a variable', () => {
      const dir = promptFolder({ 'negotiator.md': `${builtIn('negotiator')}{{teammate}}\n` });
      expect(() => loadPromptSet(dir)).toThrow('teammate');
    });

    it('should reject a section field used outside its section', () => {
      const dir = promptFolder({ 'negotiator.md': `${builtIn('negotiator')}{{civName}}\n` });
      expect(() => loadPromptSet(dir)).toThrow('civName');
    });

    it('should accept a section field inside its section and outer names inside a section', () => {
      const dir = promptFolder({
        'negotiator.md': `${builtIn('negotiator')}{{#teammate}}{{civName}} and {{leader}}{{/teammate}}{{^teammate}}{{coopWarLabel}}{{/teammate}}\n`,
      });
      expect(() => loadPromptSet(dir)).not.toThrow();
    });

    it('should reject a partial that includes itself', () => {
      const dir = promptFolder({ 'shared/goals.md': '{{> shared/goals}}\n' });
      expect(() => loadPromptSet(dir)).toThrow('shared/goals > shared/goals');
    });

    it('should reject a missing partial', () => {
      const dir = promptFolder({ 'simple-strategist.md': '{{> shared/no-such-fragment}}\n' });
      expect(() => loadPromptSet(dir)).toThrow('shared/no-such-fragment');
    });

    it('should name the fragment that includes a missing partial', () => {
      const dir = promptFolder({ 'shared/audience.md': '{{> shared/no-such-fragment}}\n' });
      expect(() => loadPromptSet(dir)).toThrow('shared/audience.md');
    });

    it('should reject a template that does not parse', () => {
      const dir = promptFolder({ 'diplomatic-analyst.md': '{{#civilization}} unclosed\n' });
      expect(() => loadPromptSet(dir)).toThrow('diplomatic-analyst.md');
    });

    it('should reject a folder that does not exist', () => {
      expect(() => loadPromptSet(path.join(os.tmpdir(), 'vox-prompts-missing-folder'))).toThrow('does not exist');
    });

    it('should keep another session\'s folder cached when a session reloads its own', () => {
      const first = promptFolder({ 'diplomatic-analyst.md': 'First session\n' });
      const second = promptFolder({ 'diplomatic-analyst.md': 'Second session\n' });
      reloadPromptSets([first]);
      fs.writeFileSync(path.join(first, 'diplomatic-analyst.md'), 'Edited mid-session\n');
      reloadPromptSets([second]);
      expect(renderSystemPrompt({ prompts: first }, 'diplomatic-analyst')).toBe('First session');
      expect(renderSystemPrompt({ prompts: second }, 'diplomatic-analyst')).toBe('Second session');
    });

    it('should validate the root folder when an entry point reloads it', () => {
      config.prompts = promptFolder({ 'unknown.md': 'Bad\n' });
      expect(() => reloadRootPrompts()).toThrow('unknown.md');
      config.prompts = '';
      expect(() => reloadRootPrompts()).toThrow('config.prompts');
    });

    it('should fail a reload when any folder is invalid and keep the previous sets', () => {
      const good = promptFolder({ 'diplomatic-analyst.md': 'Good\n' });
      const bad = promptFolder({ 'unknown.md': 'Bad\n' });
      reloadPromptSets([good]);
      expect(() => reloadPromptSets([good, bad])).toThrow('unknown.md');
      expect(getPromptSet(good).render('diplomatic-analyst')).toBe('Good');
    });
  });
});
