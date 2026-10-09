/**
 * @module utils/prompts/prompt-files
 *
 * Loads system prompt templates from `vox-agents/prompts/` and an optional custom folder that
 * overrides them file by file. Templates are Mustache with HTML escaping off, so game data such
 * as `&` and `<` stays intact. A custom folder is validated when it loads: every file must match a
 * built-in path, every partial must exist without cycles, and each template may use only the names
 * its built-in counterpart uses, as the same kind (variable or section) and in the same section
 * scope. Folders are read and validated once and cached until a session or entry point reloads them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Mustache from 'mustache';
import type { PromptsSetting } from '../../types/config.js';
import { config } from '../config.js';

/** The vox-agents package root, found from this module so `src` and `dist` agree. */
export const voxAgentsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Folder holding the built-in prompt templates. */
export const builtInPromptsDir = path.join(voxAgentsRoot, 'prompts');

/** Values a template can read: plain data and flags supplied by code. */
export type PromptView = Record<string, unknown>;

/** Render options that turn off Mustache's HTML escaping. */
const renderOptions = { escape: (value: unknown) => String(value) };

/**
 * One name a template reads. `scope` lists the enclosing `{{#section}}` names, outermost first;
 * inverted sections do not change Mustache's lookup context, so they add no scope.
 */
interface NameUse {
  name: string;
  kind: 'variable' | 'section';
  scope: string[];
}

/** One partial a template includes, with the scope it is included in. */
interface PartialUse {
  name: string;
  scope: string[];
}

/** Names and partials one template references directly. */
interface TemplateRefs {
  uses: NameUse[];
  partials: PartialUse[];
}

/** Cached prompt sets by custom folder ("" for built-ins only). */
const promptSets = new Map<string, PromptSet>();

/**
 * One custom prompt folder layered over the built-ins, parsed and validated.
 */
export class PromptSet {
  /**
   * @param folder - The custom folder setting, or undefined for built-ins only
   * @param templates - Template sources by name, custom files already layered over built-ins
   */
  constructor(readonly folder: string | undefined, private readonly templates: Map<string, string>) {}

  /** Whether a template exists under this name. */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Render a template with its partials resolved through this set, trimmed.
   *
   * @param name - Template name, such as `diplomat` or `specialized-briefer.military`
   * @param view - Data and flags the template reads
   */
  render(name: string, view: PromptView = {}): string {
    const template = this.templates.get(name);
    if (template === undefined) throw new Error(`Unknown prompt template "${name}".`);
    return Mustache.render(template, view, (partial: string) => this.templates.get(partial), renderOptions).trim();
  }
}

/**
 * Read every `.md` file under a folder, keyed by its relative path without the extension. Line
 * endings become LF, so a CRLF checkout or an edit in a Windows editor renders the same text.
 */
function readTemplates(root: string): Map<string, string> {
  const templates = new Map<string, string>();
  /** Walk one directory, adding its Markdown files. */
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const name = path.relative(root, full).replace(/\\/g, '/').slice(0, -'.md'.length);
        templates.set(name, fs.readFileSync(full, 'utf8').replace(/\r\n?/g, '\n'));
      }
    }
  };
  walk(root);
  return templates;
}

/** Parse a template and collect the names and partials its token tree references. */
function templateRefs(name: string, source: string, folder: string): TemplateRefs {
  let tokens: unknown[];
  try {
    tokens = Mustache.parse(source);
  } catch (error) {
    throw new Error(`Prompt template ${folder}/${name}.md does not parse: ${(error as Error).message}`);
  }
  const refs: TemplateRefs = { uses: [], partials: [] };
  /** Visit tokens, descending into section bodies with their scope. */
  const visit = (list: unknown[], scope: string[]): void => {
    for (const token of list as [string, string, number, number, unknown[]?][]) {
      const [type, value] = token;
      if (type === '>') refs.partials.push({ name: value, scope });
      else if (type === 'name' || type === '&') refs.uses.push({ name: value, kind: 'variable', scope });
      else if (type === '#' || type === '^') {
        refs.uses.push({ name: value, kind: 'section', scope });
        if (Array.isArray(token[4])) visit(token[4], type === '#' ? [...scope, value] : scope);
      }
    }
  };
  visit(tokens, []);
  return refs;
}

/**
 * Collect the names a template uses, including through its partials, each with its full scope,
 * plus any missing partials (with the file that includes each) and partial cycles.
 */
function transitiveUses(name: string, refs: Map<string, TemplateRefs>): { uses: NameUse[]; missing: Set<string>; cycles: Set<string> } {
  const uses: NameUse[] = [];
  const missing = new Set<string>();
  const cycles = new Set<string>();
  /** Add one template's names under the scope it is included in, and recurse into its partials. */
  const visit = (current: string, scope: string[], stack: string[]): void => {
    if (stack.includes(current)) {
      cycles.add([...stack.slice(stack.indexOf(current)), current].join(' > '));
      return;
    }
    const entry = refs.get(current)!;
    for (const use of entry.uses) uses.push({ ...use, scope: [...scope, ...use.scope] });
    for (const partial of entry.partials) {
      if (refs.has(partial.name)) visit(partial.name, [...scope, ...partial.scope], [...stack, current]);
      else missing.add(`${partial.name} (included by ${current}.md)`);
    }
  };
  visit(name, [], []);
  return { uses, missing, cycles };
}

/** A lookup key for a name of one kind in one scope. */
function useKey(kind: NameUse['kind'], name: string, scope: string[]): string {
  return JSON.stringify([kind, name, scope]);
}

/** Describe a name use for an error message, such as `#teammate` or `civName inside teammate`. */
function describeUse(use: NameUse): string {
  const label = use.kind === 'section' ? `#${use.name}` : use.name;
  return use.scope.length > 0 ? `${label} inside ${use.scope.join('/')}` : label;
}

/**
 * Whether a built-in template allows a name use: it must use the same name, as the same kind
 * (variable or section), in the same scope or an enclosing one. Mustache looks a name up through
 * the enclosing sections, so a name the built-in reads outside a section stays valid inside one.
 */
function allowedUse(use: NameUse, allowed: Set<string>): boolean {
  for (let depth = use.scope.length; depth >= 0; depth--) {
    if (allowed.has(useKey(use.kind, use.name, use.scope.slice(0, depth)))) return true;
  }
  return false;
}

/** Resolve a prompts setting to an absolute folder, relative to the vox-agents package. */
export function resolvePromptsFolder(folder: string): string {
  return path.resolve(voxAgentsRoot, folder);
}

/**
 * Read and validate a prompt set: the built-ins, with a custom folder layered over them. The
 * built-ins alone get the same partial checks, since Mustache renders a missing partial as nothing.
 *
 * @param folder - The custom folder setting, or undefined for built-ins only
 * @throws if the folder is missing, a file has no built-in counterpart, a partial is missing or
 * includes itself, a template does not parse, or a template uses a name its built-in counterpart
 * does not use in that kind and scope
 */
export function loadPromptSet(folder?: string): PromptSet {
  const builtIn = readTemplates(builtInPromptsDir);
  const builtInRefs = new Map([...builtIn].map(([name, source]) => [name, templateRefs(name, source, 'prompts')]));
  const label = folder === undefined ? 'Built-in prompt folder' : `Prompt folder "${folder}"`;

  let custom = new Map<string, string>();
  if (folder !== undefined) {
    const dir = resolvePromptsFolder(folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`Prompt folder "${folder}" does not exist (resolved to ${dir}).`);
    }
    custom = readTemplates(dir);
    const unknown = [...custom.keys()].filter(name => !builtIn.has(name));
    if (unknown.length > 0) {
      throw new Error(`Prompt folder "${folder}" has files without a built-in counterpart: ${unknown.map(name => `${name}.md`).join(', ')}.`);
    }
  }

  const templates = new Map([...builtIn, ...custom]);
  const refs = new Map(builtInRefs);
  for (const [name, source] of custom) refs.set(name, templateRefs(name, source, folder!));

  // Check every template, so an overridden fragment is checked both alone and where it is included.
  for (const name of builtIn.keys()) {
    const effective = transitiveUses(name, refs);
    if (effective.missing.size > 0) {
      throw new Error(`${label}: ${name}.md includes missing partials: ${[...effective.missing].join(', ')}.`);
    }
    if (effective.cycles.size > 0) {
      throw new Error(`${label}: ${name}.md includes itself through partials: ${[...effective.cycles].join('; ')}.`);
    }
    const builtInUses = transitiveUses(name, builtInRefs).uses;
    const allowed = new Set(builtInUses.map(use => useKey(use.kind, use.name, use.scope)));
    const extra = new Set(effective.uses.filter(use => !allowedUse(use, allowed)).map(describeUse));
    if (extra.size > 0) {
      const known = new Set(builtInUses.map(describeUse));
      throw new Error(`${label}: ${name}.md uses names its built-in counterpart does not (${[...extra].join(', ')}); allowed: ${known.size > 0 ? [...known].join(', ') : 'none'}.`);
    }
  }
  return new PromptSet(folder, templates);
}

/**
 * Check a proposed prompts setting and its folder without caching it, so a caller can reject a
 * bad value before saving it.
 *
 * @param setting - The raw setting value
 * @param source - The config path, used in the error message
 * @throws if the value or its folder is invalid (see {@link checkPromptsSetting} and {@link loadPromptSet})
 */
export function validatePromptsSetting(setting: unknown, source: string): void {
  const checked = checkPromptsSetting(setting, source);
  if (checked !== false) loadPromptSet(checked);
}

/**
 * Get a cached prompt set, loading it on first use.
 *
 * @param folder - The custom folder setting, or undefined for built-ins only
 */
export function getPromptSet(folder?: string): PromptSet {
  const key = folder ?? '';
  let set = promptSets.get(key);
  if (!set) {
    set = loadPromptSet(folder);
    promptSets.set(key, set);
  }
  return set;
}

/**
 * Reload and validate prompt sets at session start, so edits take effect in the next session and
 * an invalid folder fails before any player loop. Sets for other folders stay cached, so a session
 * running in the same process keeps its text unless the two sessions share a folder.
 *
 * @param folders - Every custom folder setting the session uses; undefined stands for built-ins only
 * @throws if any folder fails validation (see {@link loadPromptSet})
 */
export function reloadPromptSets(folders: Iterable<string | undefined>): void {
  const loaded = new Map<string, PromptSet>();
  for (const folder of [undefined, ...folders]) {
    const key = folder ?? '';
    if (!loaded.has(key)) loaded.set(key, loadPromptSet(folder));
  }
  for (const [key, set] of loaded) promptSets.set(key, set);
}

/**
 * Validate a prompts setting from one config level.
 *
 * @param setting - The raw setting value
 * @param source - The config path, used in the error message
 * @throws if the value is neither false nor a non-empty folder name
 */
export function checkPromptsSetting(setting: unknown, source: string): PromptsSetting {
  if (setting === false) return false;
  if (typeof setting !== 'string' || setting.trim().length === 0) {
    throw new Error(`${source} must be false or a folder path relative to vox-agents/.`);
  }
  return setting;
}

/** The root config's prompts setting, which applies to runs outside a seat. */
export function rootPrompts(): PromptsSetting {
  return checkPromptsSetting(config.prompts ?? false, 'config.prompts');
}

/**
 * Reload and validate the root prompt folder. Entry points that run agents outside a session,
 * such as the web UI, the telepathist console, and summary preparation, call this at startup so
 * an invalid folder fails there rather than in the middle of a run.
 *
 * @throws if the root setting or its folder is invalid (see {@link loadPromptSet})
 */
export function reloadRootPrompts(): void {
  const setting = rootPrompts();
  reloadPromptSets([setting === false ? undefined : setting]);
}

/**
 * Render a system prompt template for a context: the seat's prompt folder when it has one,
 * else the root setting.
 *
 * @param context - Any context carrying a resolved prompts setting (seat contexts set one)
 * @param name - Template name, such as `simple-strategist`
 * @param view - Data and flags the template reads
 */
export function renderSystemPrompt(context: { prompts?: PromptsSetting } | undefined, name: string, view: PromptView = {}): string {
  const setting = context?.prompts ?? rootPrompts();
  return getPromptSet(setting === false ? undefined : setting).render(name, view);
}
