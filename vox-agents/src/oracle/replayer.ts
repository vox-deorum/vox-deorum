/**
 * @module oracle/replayer
 *
 * Replay phase: loads RetrievedRows (from memory or disk), applies modifyPrompt,
 * runs each through the LLM via VoxContext, and writes result CSV + trails.
 * Supports multiple models per source row when modelOverride returns an array.
 */

import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { VoxContext } from '../infra/vox-context.js';
import type { ExecuteTokenOutput } from '../infra/vox-run.js';
import { VoxSpanExporter } from '../utils/telemetry/vox-exporter.js';
import { mcpClient } from '../utils/models/mcp-client.js';
import { spanProcessor } from '../instrumentation.js';
import { createLogger } from '../utils/logger.js';
import { resolveModel } from './utils/model-resolver.js';
import { loadToolSchemaCache, replaceToolsWithSchemaOnly } from './utils/schema-tools.js';
import { getTrailBase, getTrailPaths, readReplayCache, resolvePath, writeCsv, writeTrail } from './utils/output.js';
import { startBatchManager, shutdownBatchManager } from './batch/batch-manager.js';
import type {
  OracleConfig,
  OracleParameters,
  OracleInput,
  ReplayResult,
  RetrievedRow,
  OriginalPromptContext,
  ExtractionContext,
} from './types.js';
import type { Model } from '../types/index.js';

const logger = createLogger('OracleReplayer');

/**
 * Replay phase: run retrieved rows through the LLM.
 *
 * @param config - Experiment configuration
 * @param rows - Optional pre-loaded RetrievedRows; if absent, loads from {experimentDir}/retrieved/*.json
 * @returns Array of ReplayResult (one per source row per model)
 */
export async function runReplay(config: OracleConfig, rows?: RetrievedRow[]): Promise<ReplayResult[]> {
  const outputDir = resolvePath(config.outputDir || '../temp/oracle');
  const experimentDir = path.join(outputDir, config.experimentName);
  const retrieveBaseName = config.retrievalName ?? config.experimentName;
  const retrieveDir = path.join(outputDir, retrieveBaseName, 'retrieved');

  // Load retrieved rows from disk if not provided
  if (!rows) {
    if (!fs.existsSync(retrieveDir)) {
      logger.error(`No retrieved rows found at ${retrieveDir}. Run --retrieve first.`);
      process.exit(1);
    }
    const files = fs.readdirSync(retrieveDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      logger.error(`No retrieved rows found at ${retrieveDir}. Run --retrieve first.`);
      process.exit(1);
    }
    rows = files.map(f => JSON.parse(fs.readFileSync(path.join(retrieveDir, f), 'utf-8')) as RetrievedRow);
    logger.info(`Loaded ${rows.length} retrieved rows from ${retrieveDir}`);
  }

  // Apply filter if provided
  if (config.filter) {
    const before = rows.length;
    rows = rows.filter((r, i) => config.filter!(r.row, i));
    logger.info(`Filtered to ${rows.length} of ${before} rows`);
  }

  // Ensure output directory exists for trails
  fs.mkdirSync(experimentDir, { recursive: true });

  // Expand rows into (retrieved, resolvedModel, suffix, repetition) tasks for multi-model support
  const tasks = rows.flatMap(retrieved => {
    if (retrieved.error) {
      logger.warn(`Skipping row with error: game=${retrieved.row.game_id}, player=${retrieved.row.player_id}, turn=${retrieved.row.turn}: ${retrieved.error}`);
      return [];
    }

    const override = config.modelOverride?.(retrieved.originalModel, retrieved.row);
    const modelInputs: (string | Model)[] = override === undefined
      ? [retrieved.originalModel]
      : Array.isArray(override) ? override : [override];

    if (modelInputs.length <= 1) {
      return [{ retrieved, resolvedModel: resolveModel(modelInputs[0]), suffix: '', repetition: undefined as number | undefined }];
    }

    // Resolve all models and count occurrences for duplicate detection
    const resolved = modelInputs.map(m => resolveModel(m));
    const nameCounts = new Map<string, number>();
    for (const r of resolved) {
      nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
    }
    const nameIndexes = new Map<string, number>();

    return resolved.map(resolvedModel => {
      const baseSuffix = resolvedModel.name.split('/').pop()!.replace(/[^a-zA-Z0-9._-]/g, '-');
      const isDuplicate = nameCounts.get(resolvedModel.name)! > 1;
      let suffix: string;
      let repetition: number | undefined;

      if (isDuplicate) {
        const index = (nameIndexes.get(resolvedModel.name) ?? 0) + 1;
        nameIndexes.set(resolvedModel.name, index);
        suffix = `-${baseSuffix}-${index}`;
        repetition = index;
      } else {
        suffix = `-${baseSuffix}`;
        repetition = undefined;
      }

      return { retrieved, resolvedModel, suffix, repetition };
    });
  });

  // Removed interleave to increase cache hit rate
  // tasks.sort((a, b) => (a.repetition ?? 0) - (b.repetition ?? 0));

  logger.info(`Replaying ${tasks.length} tasks (${rows.length} rows × models)`);

  // Initialize VoxContext with MCP for schema-only tools
  const voxContext = new VoxContext<OracleParameters>({}, config.experimentName);
  let connectedToMcp = false;

  try {
    const loadedCachedSchemas = loadToolSchemaCache(voxContext);
    if (loadedCachedSchemas) {
      logger.info('Using cached MCP tool schemas for replay');
    } else {
      logger.info('Connecting to MCP server for tool schemas...');
      await mcpClient.connect();
      connectedToMcp = true;
      await voxContext.registerTools();
    }
    replaceToolsWithSchemaOnly(voxContext, config.rewriteToolSchemas);
    logger.info(`Registered ${Object.keys(voxContext.tools).length} schema-only tools`);

    await VoxSpanExporter.getInstance().createContext(config.experimentName, 'oracle');

    // Start batch manager if batch mode is enabled.
    // The batch manager is transparent infrastructure — streamTextWithConcurrency
    // checks for it and routes requests automatically.
    if (config.batch) {
      const batchOpts = typeof config.batch === 'object' ? config.batch : {};
      await startBatchManager({
        stateDir: path.join(experimentDir, 'batch'),
        flushInterval: batchOpts.flushInterval,
        pollInterval: batchOpts.pollInterval,
      });
      logger.info('Batch mode enabled');
    }

    const limit = pLimit(config.concurrency ?? 5);

    const results = await Promise.all(
      tasks.map(({ retrieved, resolvedModel, suffix, repetition }, i) =>
        limit(async (): Promise<ReplayResult> => {
          const { game_id: gameId, player_id: playerId, turn } = retrieved.row;
          logger.info(`Replaying task ${i + 1}/${tasks.length}: game=${gameId}, player=${playerId}, turn=${turn}${suffix}`);
          try {
            const result = await replaySingleRow(retrieved, resolvedModel, config, voxContext, experimentDir, suffix);
            if (repetition !== undefined) result.repetition = repetition;
            return result;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Error replaying task ${i + 1}: ${errorMsg}`);
            return {
              row: retrieved.row,
              model: `${resolvedModel.provider}/${resolvedModel.name}`,
              decisions: [],
              tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
              messages: [],
              error: errorMsg,
              ...(repetition !== undefined ? { repetition } : {}),
            };
          }
        })
      )
    );

    // Write output CSV
    const outputCsvPath = path.join(outputDir, `${config.experimentName}-results.csv`);
    writeCsv(outputCsvPath, results);
    logger.info(`Results written to: ${outputCsvPath}`);

    // Flush telemetry
    await spanProcessor.forceFlush();
    logger.info(`Telemetry flushed to: ${resolvePath(`telemetry/oracle/${config.experimentName}.db`)}`);

    const errors = results.filter(r => r.error).length;
    logger.info(`Replay complete: ${results.length - errors} succeeded, ${errors} failed`);

    return results;
  } finally {
    // Shut down batch manager first — flushes remaining requests and waits for polls
    if (config.batch) {
      await shutdownBatchManager();
    }
    await voxContext.shutdown();
    if (connectedToMcp) {
      await mcpClient.disconnect();
    }
  }
}

/**
 * Replay a single RetrievedRow for one resolved model.
 * Applies modifyPrompt, executes through VoxContext, writes trails.
 */
async function replaySingleRow(
  retrieved: RetrievedRow,
  resolvedModel: Model,
  config: OracleConfig,
  voxContext: VoxContext<OracleParameters>,
  experimentDir: string,
  trailSuffix: string
): Promise<ReplayResult> {
  const { game_id: gameId, player_id: playerId, turn: turnStr } = retrieved.row;
  const turn = parseInt(turnStr, 10);
  const trailBase = getTrailBase(retrieved.row, trailSuffix);
  const { jsonPath: trailJsonPath } = getTrailPaths(experimentDir, trailBase);

  if (config.readCache !== false && fs.existsSync(trailJsonPath)) {
    try {
      const cachedResult = readReplayCache(trailJsonPath);
      logger.info(`Using cached oracle replay: ${trailJsonPath}`);
      return cachedResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to read cached oracle replay at ${trailJsonPath}; rerunning task: ${errorMsg}`);
    }
  }

  // Build callback context from raw retrieved data
  const promptContext: OriginalPromptContext = {
    row: retrieved.row,
    system: retrieved.system,
    messages: retrieved.messages,
    activeTools: retrieved.activeTools,
    originalModel: retrieved.originalModel,
    agentName: retrieved.agentName,
  };

  // Apply modifyPrompt
  const modifications = await config.modifyPrompt(promptContext);

  // Merge modifications with originals
  const finalSystem = modifications.system ?? retrieved.system;
  const finalMessages = modifications.messages ?? retrieved.messages;
  const finalActiveTools = modifications.activeTools ?? retrieved.activeTools;

  // Build parameters and input
  const parameters: OracleParameters = {
    playerID: parseInt(playerId, 10),
    gameID: gameId,
    turn,
    activeTools: finalActiveTools,
    resolvedModel,
    agentType: retrieved.agentType,
    capturedSteps: [],
  };

  const input: OracleInput = {
    system: finalSystem,
    messages: finalMessages,
    row: retrieved.row,
    metadata: modifications.metadata,
  };

  // Hide messages/system from JSON.stringify to keep agent.input span small
  Object.defineProperty(input, 'messages', { enumerable: false, value: input.messages });
  Object.defineProperty(input, 'system', { enumerable: false, value: input.system });

  // Execute through VoxContext. Each replay task gets its own root (and token sink) on the
  // shared Oracle context, so concurrent tasks never share cancellation or token accounting.
  // OracleParameters carry their own turn, so no overrides are needed.
  const tokenOutput: ExecuteTokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };
  const result = await voxContext.withRun({ parameters }, () =>
    voxContext.execute('oracle', input, undefined, tokenOutput)
  ) as ReplayResult | undefined;

  if (!result) {
    throw new Error('Oracle agent returned no result');
  }

  result.tokens = tokenOutput;

  // Call extractColumns if provided
  if (config.extractColumns) {
    const extractionCtx: ExtractionContext = {
      originalPrompts: retrieved.system,
      originalMessages: retrieved.messages,
      replayPrompts: finalSystem,
      decisions: result.decisions,
      model: result.model,
      row: retrieved.row,
      agentName: retrieved.agentName,
    };
    result.extractedColumns = config.extractColumns(extractionCtx);
  }

  // Write trail
  writeTrail(experimentDir, trailBase, {
    row: retrieved.row,
    originalModel: retrieved.originalModel,
    model: result.model,
    modifications: {
      systemModified: modifications.system !== undefined,
      messagesModified: modifications.messages !== undefined,
      activeToolsModified: modifications.activeTools !== undefined,
      metadata: modifications.metadata,
    },
    ...(result.extractedColumns ? { extractedColumns: result.extractedColumns } : {}),
    original: {
      system: retrieved.system,
      messages: retrieved.messages,
    },
    replay: {
      system: finalSystem,
      decisions: result.decisions,
      tokens: result.tokens,
      messages: result.messages,
    },
  });

  return result;
}
