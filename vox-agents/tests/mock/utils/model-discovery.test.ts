import { afterEach, describe, expect, it, vi } from 'vitest';

const codexMocks = vi.hoisted(() => ({
  ensureCodexProxy: vi.fn(async () => undefined),
  getActiveCodexProxyPort: vi.fn(() => 9123),
}));

vi.mock('../../../src/utils/models/providers/codex-proxy.js', () => ({
  ensureCodexProxy: codexMocks.ensureCodexProxy,
  getActiveCodexProxyPort: codexMocks.getActiveCodexProxyPort,
  getCodexProxyApiBase: (port: number) => `http://127.0.0.1:${port}/v1`,
}));

const sdkMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkMocks.query }));

import { allowsUnlistedModelReferences, DiscoveryError, discoverModels } from '../../../src/utils/models/discovery.js';
import { resetClaudeCodeDiscovery } from '../../../src/utils/models/providers/claude-code-discovery.js';

/** Builds a JSON response for the mocked provider fetch implementation. */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** Builds a fake Claude Code runtime session with stubbed catalog and shutdown hooks. */
function fakeClaudeCodeSession() {
  return { supportedModels: vi.fn(), interrupt: vi.fn(), close: vi.fn() };
}

describe('discoverModels', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetClaudeCodeDiscovery();
  });

  it('should prefer request credentials when discovering OpenAI models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-oss-120b' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('openai', { OPENAI_API_KEY: 'request-key' })).resolves.toEqual([
      expect.objectContaining({
        id: 'openai/gpt-oss-120b',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer request-key' } }),
    );
  });

  it('should filter Google models without generateContent and remove the models prefix', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] })));

    await expect(discoverModels('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'key' })).resolves.toEqual([
      expect.objectContaining({ id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash' }),
    ]);
  });

  it('should validate OpenRouter credentials before requesting its public catalogue', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { label: 'key' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'openai/gpt-oss-120b' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('openrouter', { OPENROUTER_API_KEY: 'key' })).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/models',
    ]);
  });

  it('should use the request credential ahead of an environment fallback', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-test' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-test' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await discoverModels('openai', { OPENAI_API_KEY: 'request-key' });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer request-key' },
    }));

    await discoverModels('openai');
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer environment-key' },
    }));
  });

  it.each([
    ['chutes', 'CHUTES_API_KEY', 'https://llm.chutes.ai/v1/models', 'Bearer'],
    ['synthetic', 'SYNTHETIC_API_KEY', 'https://api.synthetic.new/openai/v1/models', 'Bearer'],
  ])('should use the documented %s discovery endpoint and credentials', async (provider, key, url, headerMarker) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await discoverModels(provider, { [key]: 'test-key' });

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ headers: expect.any(Object) }));
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    if (headerMarker === 'Anthropic') {
      expect(headers).toEqual({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' });
    } else {
      expect(headers.Authorization).toBe('Bearer test-key');
    }
  });

  it('should fetch every Anthropic model page with the documented cursor and credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'cursor/a b' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-b' }], has_more: false, last_id: 'cursor-b' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('anthropic', { ANTHROPIC_API_KEY: 'test-key' })).resolves.toEqual([
      expect.objectContaining({ id: 'anthropic/claude-a' }),
      expect.objectContaining({ id: 'anthropic/claude-b' }),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.anthropic.com/v1/models',
      'https://api.anthropic.com/v1/models?after_id=cursor%2Fa%20b',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual(expect.objectContaining({
        headers: { 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' },
        signal: expect.any(AbortSignal),
      }));
    }
  });

  it('should reject Anthropic pagination with a missing or repeated cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: true, last_id: '' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('anthropic', { ANTHROPIC_API_KEY: 'test-key' })).rejects.toMatchObject({
      kind: 'provider', status: 502,
    });

    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: true, last_id: 'again' }))
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: true, last_id: 'again' }));
    await expect(discoverModels('anthropic', { ANTHROPIC_API_KEY: 'test-key' })).rejects.toMatchObject({
      kind: 'provider', status: 502,
    });
  });

  it('should read the Claude Code model catalog from the live runtime', async () => {
    const session = fakeClaudeCodeSession();
    sdkMocks.query.mockReturnValue(session);
    session.supportedModels.mockResolvedValue([
      { value: 'default' },
      { value: 'sonnet' },
      { value: 'opus[1m]' },
      { value: 'claude-fable-5-1[1m]' },
      { value: 'haiku' },
    ]);

    await expect(discoverModels('claude-code', {})).resolves.toEqual([
      { id: 'claude-code/default', provider: 'claude-code', name: 'default', recommendedOptions: { concurrencyLimit: 1 } },
      { id: 'claude-code/sonnet', provider: 'claude-code', name: 'sonnet', recommendedOptions: { concurrencyLimit: 1 } },
      { id: 'claude-code/opus[1m]', provider: 'claude-code', name: 'opus[1m]', recommendedOptions: { concurrencyLimit: 1 } },
      { id: 'claude-code/claude-fable-5-1[1m]', provider: 'claude-code', name: 'claude-fable-5-1[1m]', recommendedOptions: { concurrencyLimit: 1 } },
      { id: 'claude-code/haiku', provider: 'claude-code', name: 'haiku', recommendedOptions: { concurrencyLimit: 1 } },
    ]);
    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
    expect(sdkMocks.query).toHaveBeenCalledWith({ prompt: '', options: { settingSources: [] } });
    expect(session.interrupt).toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it('should share one lookup across concurrent discovery calls', async () => {
    const session = fakeClaudeCodeSession();
    sdkMocks.query.mockReturnValue(session);
    let resolveSupported!: (value: { value: string }[]) => void;
    session.supportedModels.mockReturnValue(new Promise((resolve) => {
      resolveSupported = resolve;
    }));

    const first = discoverModels('claude-code', {});
    const second = discoverModels('claude-code', {});

    expect(sdkMocks.query).toHaveBeenCalledTimes(1);

    resolveSupported([{ value: 'sonnet' }, { value: 'haiku' }]);
    const expected = [
      { id: 'claude-code/sonnet', provider: 'claude-code', name: 'sonnet', recommendedOptions: { concurrencyLimit: 1 } },
      { id: 'claude-code/haiku', provider: 'claude-code', name: 'haiku', recommendedOptions: { concurrencyLimit: 1 } },
    ];
    await expect(Promise.all([first, second])).resolves.toEqual([expected, expected]);
  });

  it('should cache a successful catalog for the process lifetime', async () => {
    const session = fakeClaudeCodeSession();
    sdkMocks.query.mockReturnValue(session);
    session.supportedModels.mockResolvedValue([{ value: 'sonnet' }]);

    await discoverModels('claude-code', {});
    await discoverModels('claude-code', {});

    expect(sdkMocks.query).toHaveBeenCalledTimes(1);
  });

  it('should retry a failed Claude Code discovery', async () => {
    const session = fakeClaudeCodeSession();
    sdkMocks.query.mockReturnValue(session);
    session.supportedModels
      .mockRejectedValueOnce(new Error('not signed in'))
      .mockResolvedValueOnce([{ value: 'sonnet' }]);

    await expect(discoverModels('claude-code', {})).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'provider', status: 502, message: expect.stringContaining('Claude Code sign-in'),
    });
    expect(session.close).toHaveBeenCalledTimes(1);

    await expect(discoverModels('claude-code', {})).resolves.toEqual([
      { id: 'claude-code/sonnet', provider: 'claude-code', name: 'sonnet', recommendedOptions: { concurrencyLimit: 1 } },
    ]);
    expect(sdkMocks.query).toHaveBeenCalledTimes(2);
  });

  it('should report Claude Code as an unlisted-reference provider', () => {
    expect(allowsUnlistedModelReferences('claude-code')).toBe(true);
    expect(allowsUnlistedModelReferences('codex')).toBe(false);
    expect(allowsUnlistedModelReferences('openai')).toBe(false);
  });

  it('should discover Codex models through the active managed proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [
      { id: 'gpt-5.6-sol' },
      { id: 'gpt-5.4-mini' },
    ] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(discoverModels('codex', {})).resolves.toEqual([
      { id: 'codex/gpt-5.6-sol', provider: 'codex', name: 'gpt-5.6-sol', recommendedOptions: { concurrencyLimit: 1, reasoningEffort: 'high' } },
      { id: 'codex/gpt-5.4-mini', provider: 'codex', name: 'gpt-5.4-mini' },
    ]);
    expect(codexMocks.ensureCodexProxy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9123/v1/models', expect.any(Object));
  });

  it('should map managed Codex proxy startup failures to discovery errors', async () => {
    codexMocks.ensureCodexProxy.mockRejectedValueOnce(new Error('startup failed'));

    await expect(discoverModels('codex', {})).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'provider', status: 502,
    });
  });

  it('should construct an optional-auth compatible URL without a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'local-model' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await discoverModels('openai-compatible', { OPENAI_COMPATIBLE_URL: 'http://localhost:11434/' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/models',
      expect.any(Object),
    );
  });

  it('should expose typed errors for missing credentials, auth failures, and unsupported providers', async () => {
    await expect(discoverModels('synthetic', { SYNTHETIC_API_KEY: '' })).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'missing-credential', status: 400,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    await expect(discoverModels('chutes', { CHUTES_API_KEY: 'key' })).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'auth', status: 401,
    });
    await expect(discoverModels('aws', {})).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'unsupported', status: 400,
    });
  });

  it('should classify network, provider, and invalid-response failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(discoverModels('openai', { OPENAI_API_KEY: 'key' })).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'network', status: 502,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'upstream unavailable' }, 503)));
    await expect(discoverModels('openai', { OPENAI_API_KEY: 'key' })).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'provider', status: 502,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ models: 'not-an-array' })));
    await expect(discoverModels('openai', { OPENAI_API_KEY: 'key' })).rejects.toMatchObject<Partial<DiscoveryError>>({
      kind: 'provider', status: 502,
    });
  });
});
