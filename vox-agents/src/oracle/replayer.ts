/**
 * @module oracle/replayer
 *
 * Replay phase: loads RetrievedRows (from memory or disk), applies modifyPrompt,
 * runs each through the LLM via VoxContext, and writes result CSV + trails.
 * Supports multiple models per source row when modelOverride returns an array.
 */

import fs from 'node:fs';
import path from 'node:path';
import { VoxContext } from '../infra/vox-context.js';
import { agentRegistry } from '../infra/agent-registry.js';
import { processManager } from '../infra/process-manager.js';
import { OracleAgent } from './oracle-agent.js';
import type { ExecuteTokenOutput } from '../infra/vox-run.js';
import { VoxSpanExporter } from '../utils/telemetry/vox-exporter.js';
import { mcpClient } from '../utils/models/mcp-client.js';
import { spanProcessor } from '../instrumentation.js';
import { config as appConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { errorMessage } from '../utils/errors.js';
import { resolveModel } from './utils/model-resolver.js';
import { runOracleTasks } from './run-control.js';
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

/** Marker on a task that shutdown dropped before it ran, rather than a real replay failure. */
const INTERRUPTED_ERROR = 'Interrupted by shutdown';

/**
 * Replay phase: run retrieved rows through the LLM.
 *
 * @param config - Experiment configuration
 * @param rows - Optional pre-loaded RetrievedRows; if absent, loads from {experimentDir}/retrieved/*.json
 * @param shouldStop - Optional predicate that stops admitting queued tasks
 * @returns Compact, source-ordered array of settled ReplayResults
 */
export async function runReplay(
  config: OracleConfig,
  rows?: RetrievedRow[],
  shouldStop?: () => boolean
): Promise<ReplayResult[]> {
  const outputDir = resolvePath(config.outputDir || '../temp/oracle');
  const experimentDir = path.join(outputDir, config.experimentName);
  const retrieveBaseName = config.retrievalName ?? config.experimentName;
  const retrieveDir = path.join(outputDir, retrieveBaseName, 'retrieved');

  // Load retrieved rows from disk if not provided
  if (!rows) {
    if (!fs.existsSync(retrieveDir)) {
      throw new Error(`No retrieved rows found at ${retrieveDir}. Run --retrieve first.`);
    }
    const files = fs.readdirSync(retrieveDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error(`No retrieved rows found at ${retrieveDir}. Run --retrieve first.`);
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

    const override = config.modelOverride?.(retrieved.originalModel, retrieved.row, {
      framing: retrieved.framing,
    });
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

    // Apply this experiment's tool policy before any task runs: VoxContext reads both settings as
    // plain fields off the registered agent, and one replay process runs one experiment.
    const oracleAgent = agentRegistry.get<OracleParameters>('oracle') as OracleAgent | undefined;
    if (!oracleAgent) throw new Error('Oracle agent is not registered');
    oracleAgent.configure(config);
    logger.info(`Tool policy: choice=${oracleAgent.toolChoice}, completion tools=${oracleAgent.completionTools.join(', ')}`);

    await VoxSpanExporter.getInstance().createContext(config.experimentName, 'oracle');

    // Start batch manager if batch mode is enabled.
    // The batch manager is transparent infrastructure. streamTextWithConcurrency
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

    const { results, stopped } = await runOracleTasks(
      tasks.map(({ retrieved, resolvedModel, suffix, repetition }, i) =>
        async (): Promise<ReplayResult> => {
          const failed = (error: string): ReplayResult => ({
            row: retrieved.row,
            model: `${resolvedModel.provider}/${resolvedModel.name}`,
            decisions: [],
            tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
            messages: [],
            error,
            ...(repetition !== undefined ? { repetition } : {}),
          });

          // Ctrl+C: drop tasks still queued rather than starting work against telemetry and
          // MCP state the shutdown hooks are concurrently tearing down.
          if (processManager.isShuttingDown) return failed(INTERRUPTED_ERROR);

          const { game_id: gameId, player_id: playerId, turn } = retrieved.row;
          logger.info(`Replaying task ${i + 1}/${tasks.length}: game=${gameId}, player=${playerId}, turn=${turn}${suffix}`);
          try {
            const result = await replaySingleRow(retrieved, resolvedModel, config, voxContext, experimentDir, suffix);
            if (repetition !== undefined) result.repetition = repetition;
            return result;
          } catch (error) {
            const errorMsg = errorMessage(error);
            logger.error(`Error replaying task ${i + 1}: ${errorMsg}`);
            return failed(errorMsg);
          }
        }
      ),
      config.concurrency ?? 5,
      shouldStop
    );

    // Tasks Ctrl+C dropped carry the interrupted marker rather than a real failure, and a
    // graceful stop leaves its withheld tasks out of the results entirely.
    const interrupted = results.filter(r => r.error === INTERRUPTED_ERROR).length;
    const errors = results.filter(r => r.error && r.error !== INTERRUPTED_ERROR).length;
    const succeeded = results.length - errors - interrupted;

    // An interrupted run must not publish its results: each trail is written as its task
    // completes, so completed work survives on disk and is reused as cache next time, but
    // overwriting a full results CSV with a mostly-interrupted one would lose real data.
    // A graceful stop that still admitted every task is a complete run and publishes normally.
    if (processManager.isShuttingDown || stopped) {
      logger.warn([
        `Replay stopped: ${succeeded} succeeded, ${errors} failed, ${interrupted + tasks.length - results.length} never ran`,
        `  ${config.experimentName}-results.csv left untouched; completed trails are kept and reused as cache`,
        `  Trails: ${experimentDir}`,
      ].join('\n'));
      return results;
    }

    // Write output CSV
    const outputCsvPath = path.join(outputDir, `${config.experimentName}-results.csv`);
    writeCsv(outputCsvPath, results);

    logger.info([
      `Replay complete: ${succeeded} succeeded, ${errors} failed`,
      `  Results: ${outputCsvPath}`,
      `  Trails: ${experimentDir}`,
    ].join('\n'));

    return results;
  } finally {
    // Flush replay spans before tearing down the context, including interrupted and failed runs.
    // A flush failure must not replace the error that actually ended the run.
    try {
      await spanProcessor.forceFlush();
      // The oracle span DB lives under the exporter's telemetry root (see instrumentation.ts),
      // which is the app-level directory; OracleConfig.telemetryDir is the retrieve phase's input.
      const telemetryRoot = appConfig.telemetryDir || 'telemetry';
      logger.info(`Telemetry flushed to: ${resolvePath(path.join(telemetryRoot, 'oracle', `${config.experimentName}.db`))}`);
    } catch (flushError) {
      logger.error('Failed to flush replay telemetry:', flushError);
    } finally {
      // Shut down batch manager first. It flushes remaining requests and waits for polls.
      if (config.batch) {
        await shutdownBatchManager();
      }
      await voxContext.shutdown();
      if (connectedToMcp) {
        await mcpClient.disconnect();
      }
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
      const errorMsg = errorMessage(error);
      logger.warn(`Failed to read cached oracle replay at ${trailJsonPath}; rerunning task: ${errorMsg}`);
    }
  }

  // Build callback context from raw retrieved data. framing is the original turn's recorded
  // fact, exposed for experiments; it does NOT drive replay framing.
  const promptContext: OriginalPromptContext = {
    row: retrieved.row,
    system: retrieved.system,
    messages: retrieved.messages,
    activeTools: retrieved.activeTools,
    originalModel: retrieved.originalModel,
    agentName: retrieved.agentName,
    framing: retrieved.framing,
  };

  // Apply modifyPrompt
  const modifications = await config.modifyPrompt(promptContext);

  // Merge modifications with originals
  const finalSystem = modifications.system ?? retrieved.system;
  const finalMessages = modifications.messages ?? retrieved.messages;
  const finalActiveTools = modifications.activeTools ?? retrieved.activeTools;

  // Replay framing derives solely from the replay model (via resolveToolFraming): a
  // 'prompt'-mode model replaying a Claude-Code turn is told "tools", not "actions".
  // Experiments that want to reproduce the original 'action' view opt in explicitly
  // (e.g. modelOverride returning a model with options.framing, or applying
  // reframeToolWording to ctx.system). The source turn's framing never silently
  // overrides the replay model here.

  // Build parameters and input
  const parameters: OracleParameters = {
    playerID: parseInt(playerId, 10),
    gameID: gameId,
    turn,
    activeTools: finalActiveTools,
    stepTools: retrieved.stepTools ?? [],
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
