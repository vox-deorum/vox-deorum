/**
 * @module web/routes/config
 *
 * Configuration management API endpoints for reading and updating
 * config.json and .env files.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { isDeepStrictEqual } from 'node:util';
import { createLogger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';
import { config, loadVoxConfig, refreshConfig } from '../../utils/config.js';
import { reloadRootPrompts, validatePromptsSetting } from '../../utils/prompts/prompt-files.js';
import { defaultConfig } from '../../utils/config/defaults.js';
import { computeConfigDiff } from '../../utils/config/diff.js';
import { discoverModels, DiscoveryError } from '../../utils/models/discovery.js';
import { getModelConfig } from '../../utils/models/models.js';
import { recommendTierModels } from '../../utils/models/rules.js';
import { codexProxyManager, ensureCodexProxy } from '../../utils/models/providers/codex-proxy.js';
import { isEvaluationOnlyProvider, providerCredentials } from '../../types/constants.js';
import { isAllowedDashboardRequest } from '../origin.js';
import { sendError } from '../http-utils.js';
import type {
  CodexLoginResponse,
  CodexStatusResponse,
  ConfigCheckResponse,
  ConfiguredModelsResponse,
  ConfigResponse,
  DiscoverModelsRequest,
  DiscoverModelsResponse,
  DiscoveryErrorResponse,
  ErrorResponse,
  Model,
  VoxAgentsConfig,
} from '../../types/index.js';

const logger = createLogger('config', 'webui');
const router = Router();
let codexLoginError: string | null = null;

/** Reports whether any credential required by a configured provider is nonempty. */
function hasConfiguredCredential(): boolean {
  return Object.values(providerCredentials).some(({ required }) =>
    required.some((key) => Boolean(process.env[key]?.trim()))
  );
}

/** Reports whether an effective LLM entry is unchanged from the shipped default registry. */
function isUnchangedDefaultLlm(name: string, definition: Model | string): boolean {
  const defaultDefinition = defaultConfig.llms[name];
  return defaultDefinition !== undefined && isDeepStrictEqual(definition, defaultDefinition);
}

/** Returns providers with complete credentials or a user-configured model definition, excluding evaluation-only providers. */
function configuredProviders(): string[] {
  const credentialProviders = Object.entries(providerCredentials)
    .filter(([provider, credentials]) => !isEvaluationOnlyProvider(provider)
      && credentials.required.length > 0
      && credentials.required.every((key) => Boolean(process.env[key]?.trim())))
    .map(([provider]) => provider);
  const configuredModelProviders = Object.entries(config.llms)
    .flatMap(([name, definition]) => {
      if (isUnchangedDefaultLlm(name, definition)) return [];
      if (typeof definition !== 'string') return [definition.provider];
      const separator = definition.indexOf('/');
      return separator > 0 ? [definition.slice(0, separator)] : [];
    })
    .filter((provider) => !isEvaluationOnlyProvider(provider));
  return [...new Set([...credentialProviders, ...configuredModelProviders])];
}

/** Converts a saved model definition into a response-safe discovered-model record. */
function configuredModel(definition: Model): NonNullable<ConfiguredModelsResponse['defaultModel']> {
  return {
    id: `${definition.provider}/${definition.name}`,
    provider: definition.provider,
    name: definition.name,
  };
}

/** Returns literal, non-embedding, non-evaluation-only global model definitions when every catalog lookup fails. */
function fallbackModels(): ConfiguredModelsResponse['models'] {
  return Object.values(config.llms).flatMap((definition) => {
    if (typeof definition === 'string'
      || definition.options?.embeddingSize !== undefined
      || isEvaluationOnlyProvider(definition.provider)) return [];
    return [configuredModel(definition)];
  });
}

/** Validates the narrow JSON shape accepted by the model-discovery route. */
function isDiscoveryRequest(value: unknown): value is DiscoverModelsRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.provider !== 'string' || request.provider.trim() === '') return false;
  if (request.credentials === undefined) return true;
  return request.credentials !== null
    && typeof request.credentials === 'object'
    && !Array.isArray(request.credentials)
    && Object.values(request.credentials).every((credential) => typeof credential === 'string');
}

/**
 * Format environment variables into .env file content
 * Properly handles multi-line values by using double quotes and escaping
 */
function formatEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      // Check if value contains newlines or needs quoting
      if (value.includes('\n') || value.includes('"')) {
        // Escape existing backslashes and quotes, then quote the value
        const escaped = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');
        return `${key}="${escaped}"`;
      }
      // Simple values don't need quotes
      return `${key}=${value}`;
    })
    .join('\n') + '\n';
}

/**
 * GET /api/config
 * Get current configuration from config.json and .env
 */
router.get('/', async (req: Request, res: Response<ConfigResponse | ErrorResponse>) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to read configuration.');
    return;
  }
  try {
    // Load config.json (deep-merges diff with defaults)
    const config = loadVoxConfig('config.json');

    // Load .env file
    const envPath = path.join(process.cwd(), '.env');
    let apiKeys: Record<string, string> = {};

    try {
      const envContent = await fs.readFile(envPath, 'utf-8');
      apiKeys = dotenv.parse(envContent);
    } catch (error) {
      logger.debug('.env file not found or could not be read');
    }

    res.json({
      config,
      apiKeys
    });
  } catch (error) {
    logger.error('Error loading configuration', error);
    sendError(res, 500, 'Failed to load configuration');
  }
});

/**
 * GET /api/config/check
 * Check whether the current runtime has been configured.
 */
router.get('/check', async (_req: Request, res: Response<ConfigCheckResponse | ErrorResponse>) => {
  try {
    const config = loadVoxConfig('config.json');
    const configured = hasConfiguredCredential()
      || config.llms.default !== defaultConfig.llms.default;
    res.json({ configured });
  } catch (error) {
    logger.error('Error checking setup status', error);
    sendError(res, 500, 'Failed to check setup status');
  }
});

/** Discovers models for one provider using credentials supplied by the setup flow. */
router.post('/models', async (
  req: Request<object, object, DiscoverModelsRequest>,
  res: Response<DiscoverModelsResponse | DiscoveryErrorResponse>,
) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to discover models.', { kind: 'unsupported' });
    return;
  }
  if (!isDiscoveryRequest(req.body)) {
    sendError(res, 400, 'A provider and string credentials are required for model discovery.', { kind: 'unsupported' });
    return;
  }
  try {
    const models = await discoverModels(req.body.provider, req.body.credentials ?? {});
    const recommendedTiers = recommendTierModels(req.body.provider, models);
    res.json({
      provider: req.body.provider,
      models,
      ...(recommendedTiers === undefined ? {} : { recommendedTiers }),
    });
  } catch (error) {
    if (error instanceof DiscoveryError) {
      sendError(res, error.status, error.message, { kind: error.kind });
      return;
    }
    logger.error('Error discovering models', error);
    sendError(res, 502, 'Could not discover models', { kind: 'network' });
  }
});

/**
 * GET /api/config/models
 * Discover models from every configured provider without exposing credentials.
 */
router.get('/models', async (req: Request, res: Response<ConfiguredModelsResponse | ErrorResponse>) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to discover models.');
    return;
  }

  const providers = configuredProviders();
  const results = await Promise.all(providers.map(async (provider) => {
    try {
      return { provider, models: await discoverModels(provider, {}) };
    } catch (error) {
      return { provider, error: errorMessage(error, 'Unexpected error') };
    }
  }));
  const successful = results.filter((result): result is { provider: string; models: ConfiguredModelsResponse['models'] } => 'models' in result);
  const failures = results.flatMap((result) => 'error' in result ? [`${result.provider}: ${result.error}`] : []);

  let defaultModel: ConfiguredModelsResponse['defaultModel'];
  try {
    defaultModel = configuredModel(getModelConfig('default'));
  } catch (error) {
    logger.warn(`Could not resolve the configured default model: ${errorMessage(error, 'Unexpected error')}`);
  }

  res.json({
    ...(defaultModel === undefined ? {} : { defaultModel }),
    models: successful.length === 0 ? fallbackModels() : successful.flatMap((result) => result.models),
    failures,
  });
});

/** Starts Codex authentication without holding the dashboard request open. */
router.post('/codex/login', (req: Request, res: Response<CodexLoginResponse | ErrorResponse>) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to start Codex sign-in.');
    return;
  }
  codexLoginError = null;
  void ensureCodexProxy().catch((error) => {
    codexLoginError = errorMessage(error, 'Unexpected error');
    logger.warn(`Codex login startup failed: ${codexLoginError}`);
  });
  res.status(202).json({ state: codexProxyManager.state });
});

/** Returns Codex lifecycle state plus a non-secret login prompt or startup error. */
router.get('/codex/status', (req: Request, res: Response<CodexStatusResponse | ErrorResponse>) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to read Codex sign-in status.');
    return;
  }
  res.json({
    state: codexProxyManager.state,
    login: codexProxyManager.loginPrompt ?? null,
    error: codexLoginError,
  });
});

/**
 * POST /api/config
 * Update configuration in config.json and .env
 */
router.post('/', async (req: Request<object, object, Partial<ConfigResponse>>, res: Response<{ success: boolean } | ErrorResponse>) => {
  if (!isAllowedDashboardRequest(req.hostname, req.get('origin'))) {
    sendError(res, 403, 'This browser origin is not allowed to update configuration.');
    return;
  }
  try {
    const { config, apiKeys } = req.body;
    const configDiff = config === undefined
      ? undefined
      : computeConfigDiff(config as VoxAgentsConfig, defaultConfig);

    // Reject an invalid root prompt folder before writing anything, so it is never saved and the
    // dashboard shows the reason.
    if (configDiff !== undefined) {
      try {
        validatePromptsSetting((config as VoxAgentsConfig).prompts ?? false, 'config.prompts');
      } catch (error) {
        sendError(res, 400, errorMessage(error));
        return;
      }
    }

    // Update .env before config.json so an API-key write failure cannot install a new default model.
    if (apiKeys) {
      const envPath = path.join(process.cwd(), '.env');

      // Read existing .env and merge. New keys override while existing keys are preserved.
      let existingKeys: Record<string, string> = {};
      try {
        const existingContent = await fs.readFile(envPath, 'utf-8');
        existingKeys = dotenv.parse(existingContent);
      } catch {
        // .env doesn't exist yet, start fresh.
      }

      const mergedKeys = { ...existingKeys, ...apiKeys };
      await fs.writeFile(envPath, formatEnvFile(mergedKeys));
      logger.info('Updated .env file');

      // Reload the environment variables into process.env.
      dotenv.config({ path: envPath, override: true });
      logger.info('Reloaded environment variables');
    }

    // Update config.json if config provided
    if (configDiff !== undefined) {
      const configPath = path.join(process.cwd(), 'config.json');

      // Write only the diff
      await fs.writeFile(configPath, JSON.stringify(configDiff, null, 2));
      logger.info('Updated config.json');

      // Refresh the in-memory configuration
      refreshConfig();
      logger.info('Refreshed system configuration');
      // Reload the root prompt folder, validated above, so later chats read the saved files.
      reloadRootPrompts();
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating configuration', error);
    sendError(res, 500, 'Failed to update configuration');
  }
});

export default router;
