/**
 * @module utils/models/discovery
 *
 * Discovers the models exposed by configured LLM providers.
 */

import type { DiscoveredModel, DiscoveryErrorKind } from '../../types/api.js';
import { applyModelRules } from './rules.js';
import { discoverClaudeCodeModelValues } from './providers/claude-code-discovery.js';
import { ensureCodexProxy, getActiveCodexProxyPort, getCodexProxyApiBase } from './providers/codex-proxy.js';

/** The credentials supplied by the configuration UI, keyed by environment variable name. */
export type DiscoveryCredentials = Record<string, string | undefined>;

/** A typed failure that routes can safely turn into an HTTP response. */
export class DiscoveryError extends Error {
  /** Construct a provider-discovery failure with its client-facing kind and status. */
  constructor(
    public readonly kind: DiscoveryErrorKind,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * Reports whether a provider accepts manually configured model references
 * even when they are absent from the discovered catalog. Claude Code does:
 * it permits configured aliases and full model IDs that the picker may not
 * list, so resolution warns and synthesizes instead of rejecting them.
 */
export function allowsUnlistedModelReferences(provider: string): boolean {
  return provider === 'claude-code';
}

/** Gets a credential from the request first, then falls back to the process environment. */
function getCredential(credentials: DiscoveryCredentials, key: string): string | undefined {
  return Object.hasOwn(credentials, key) ? credentials[key] : process.env[key];
}

/** Raises a missing-credential error with a provider-specific message. */
function requireCredential(credentials: DiscoveryCredentials, key: string, provider: string): string {
  const credential = getCredential(credentials, key);
  if (!credential) throw new DiscoveryError('missing-credential', 400, `${provider} requires ${key}.`);
  return credential;
}

/** Builds a normalized discovered-model record with established and registry options. */
function model(provider: string, name: string): DiscoveredModel {
  const recommendedOptions = applyModelRules(provider, name);
  return {
    id: `${provider}/${name}`,
    provider,
    name,
    ...(recommendedOptions === undefined ? {} : { recommendedOptions }),
  };
}

/** Narrows unknown JSON to an object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a bounded, safe response excerpt for a provider error. */
async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, ' ').slice(0, 240);
  } catch {
    return '';
  }
}

/** Fetches JSON with the discovery deadline and maps transport and HTTP failures. */
async function fetchJson(url: string, init: RequestInit, provider: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new DiscoveryError('network', 502, `Could not reach ${provider}.`);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new DiscoveryError('auth', 401, `${provider} rejected the supplied credentials.`);
    }
    const body = await safeBody(response);
    const suffix = body ? `: ${body}` : '';
    throw new DiscoveryError('provider', 502, `${provider} returned ${response.status}${suffix}`);
  }

  try {
    return await response.json();
  } catch {
    throw new DiscoveryError('provider', 502, `${provider} returned an invalid model list.`);
  }
}

/** Returns entries under a validated OpenAI-style `{ data: [{ id }] }` response. */
function openAiEntries(payload: unknown, provider: string): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new DiscoveryError('provider', 502, `${provider} returned an invalid model list.`);
  }
  return payload.data.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return [];
    return [entry.id];
  });
}

/** Discovers an OpenAI-compatible model catalog from its versioned API base. */
async function openAiCompatibleModels(
  provider: string,
  apiBase: string,
  init: RequestInit,
  providerLabel: string,
): Promise<DiscoveredModel[]> {
  const payload = await fetchJson(`${apiBase.replace(/\/+$/, '')}/models`, init, providerLabel);
  return openAiEntries(payload, providerLabel).map((name) => model(provider, name));
}

/** Returns a validated page from Anthropic's cursor-based models endpoint. */
function anthropicPage(payload: unknown): { names: string[]; hasMore: boolean; lastId: string | null } {
  if (!isRecord(payload) || !Array.isArray(payload.data) || typeof payload.has_more !== 'boolean') {
    throw new DiscoveryError('provider', 502, 'Anthropic returned an invalid model list.');
  }
  const lastId = typeof payload.last_id === 'string' && payload.last_id ? payload.last_id : null;
  return {
    names: payload.data.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return [];
      return [entry.id];
    }),
    hasMore: payload.has_more,
    lastId,
  };
}

/** Fetches every page from Anthropic's cursor-based models endpoint. */
async function anthropicModels(key: string): Promise<string[]> {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const seenCursors = new Set<string>();
  const names: string[] = [];
  let afterId: string | undefined;

  for (;;) {
    const url = afterId === undefined
      ? 'https://api.anthropic.com/v1/models'
      : `https://api.anthropic.com/v1/models?after_id=${encodeURIComponent(afterId)}`;
    const page = anthropicPage(await fetchJson(url, { headers }, 'Anthropic'));
    names.push(...page.names);
    if (!page.hasMore) return names;
    if (page.lastId === null || seenCursors.has(page.lastId)) {
      throw new DiscoveryError('provider', 502, 'Anthropic returned an invalid pagination cursor.');
    }
    seenCursors.add(page.lastId);
    afterId = page.lastId;
  }
}

/**
 * Discovers model records for one supported provider. Claude Code catalogs
 * are cached by the discovery helper across the process lifetime; other
 * providers are fetched fresh on each call.
 */
export async function discoverModels(provider: string, credentials: DiscoveryCredentials = {}): Promise<DiscoveredModel[]> {
  switch (provider) {
    case 'claude-code': {
      try {
        const values = await discoverClaudeCodeModelValues();
        return values.map((value) => model(provider, value));
      } catch (error) {
        throw new DiscoveryError(
          'provider',
          502,
          error instanceof Error ? error.message : 'Could not read the Claude Code model list from your local Claude Code sign-in.',
        );
      }
    }
    case 'openai': {
      const key = requireCredential(credentials, 'OPENAI_API_KEY', 'OpenAI');
      const payload = await fetchJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'OpenAI');
      return openAiEntries(payload, 'OpenAI').map((name) => model(provider, name));
    }
    case 'anthropic': {
      const key = requireCredential(credentials, 'ANTHROPIC_API_KEY', 'Anthropic');
      return (await anthropicModels(key)).map((name) => model(provider, name));
    }
    case 'google': {
      const key = requireCredential(credentials, 'GOOGLE_GENERATIVE_AI_API_KEY', 'Google AI');
      const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {}, 'Google AI');
      if (!isRecord(payload) || !Array.isArray(payload.models)) throw new DiscoveryError('provider', 502, 'Google AI returned an invalid model list.');
      return payload.models.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.supportedGenerationMethods)
          || !entry.supportedGenerationMethods.includes('generateContent')) return [];
        const name = entry.name.replace(/^models\//, '');
        return name ? [model(provider, name)] : [];
      });
    }
    case 'openrouter': {
      const key = requireCredential(credentials, 'OPENROUTER_API_KEY', 'OpenRouter');
      await fetchJson('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } }, 'OpenRouter');
      const payload = await fetchJson('https://openrouter.ai/api/v1/models', {}, 'OpenRouter');
      return openAiEntries(payload, 'OpenRouter').map((name) => model(provider, name));
    }
    case 'chutes': {
      const key = requireCredential(credentials, 'CHUTES_API_KEY', 'Chutes.ai');
      const payload = await fetchJson('https://llm.chutes.ai/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'Chutes.ai');
      return openAiEntries(payload, 'Chutes.ai').map((name) => model(provider, name));
    }
    case 'synthetic': {
      const key = requireCredential(credentials, 'SYNTHETIC_API_KEY', 'Synthetic.new');
      const payload = await fetchJson('https://api.synthetic.new/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } }, 'Synthetic.new');
      return openAiEntries(payload, 'Synthetic.new').map((name) => model(provider, name));
    }
    case 'openai-compatible': {
      const url = requireCredential(credentials, 'OPENAI_COMPATIBLE_URL', 'OpenAI Compatible');
      const key = getCredential(credentials, 'OPENAI_COMPATIBLE_API_KEY');
      return openAiCompatibleModels(provider, url, { headers: key ? { Authorization: `Bearer ${key}` } : undefined }, 'OpenAI Compatible');
    }
    case 'codex': {
      try {
        await ensureCodexProxy();
      } catch {
        throw new DiscoveryError('provider', 502, 'Could not start the managed Codex proxy for model discovery.');
      }
      const apiBase = getCodexProxyApiBase(getActiveCodexProxyPort());
      return openAiCompatibleModels(provider, apiBase, {}, 'Codex');
    }
    case 'aws':
      throw new DiscoveryError('unsupported', 400, 'AWS Bedrock model discovery is not supported.');
    default:
      throw new DiscoveryError('unsupported', 400, `Model discovery is not supported for ${provider}.`);
  }
}
