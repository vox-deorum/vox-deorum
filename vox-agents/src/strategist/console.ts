/**
 * @module strategist/console
 *
 * Entry point for the Strategist workflow.
 * Manages command-line argument parsing, session configuration,
 * and graceful shutdown with keyboard input handling (Ctrl+A, Ctrl+C).
 * Supports both interactive and automated game sessions with configurable strategists.
 */

import { sqliteExporter } from "../instrumentation.js";
import { createLogger } from "../utils/logger.js";
import { loadConfigFromFile, getConfigsDir } from "../utils/config.js";
import { StrategistSession } from "./strategist-session.js";
import { runStrategistLoop } from "./loop.js";
import { resolveMaxRepetitions } from "./repetition.js";
import { StrategistSessionConfig } from "../types/config.js";
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import * as readline from 'node:readline';
import * as path from 'node:path';
import { startWebServer } from "../web/server.js";
import { processManager } from "../infra/process-manager.js";
import { mergeRandomSeeds, parseSeedArgument, validateRandomSeeds, validateRandomSeedsList } from "../utils/game/random-seeds.js";
import type { RandomSeedsConfig } from "../types/config.js";

const logger = createLogger('Strategists');

// Parse command line arguments using parseArgs
const { values, positionals } = parseArgs({
  options: {
    config: {
      type: 'string',
      short: 'c',
      default: 'play-simple.json'
    },
    load: {
      type: 'boolean',
      short: 'l',
      default: false
    },
    wait: {
      type: 'boolean',
      short: 'w',
      default: false
    },
    players: {
      type: 'string',
      short: 'p',
      multiple: true
    },
    strategist: {
      type: 'string',
      short: 's'
    },
    autoPlay: {
      type: 'boolean',
      short: 'a'
    },
    repetition: {
      type: 'string',
      short: 'r'
    },
    seed: {
      type: 'string'
    }
  },
  strict: false,
  allowPositionals: true
});

const configFile = values.config as string;
const isLoadMode = values.load as boolean;
const isWaitMode = values.wait as boolean;

// Default configuration (interactive mode)
const defaultConfig: StrategistSessionConfig = {
  name: 'default',
  type: 'strategist',
  llmPlayers: {
    1: { strategist: "simple-strategist" }
  },
  autoPlay: false,
  gameMode: 'start',
  repetition: 1
};

// Build command line overrides
const cmdOverrides: Partial<StrategistSessionConfig> = {};
let seedOverride: RandomSeedsConfig | undefined;

if (isLoadMode) {
  cmdOverrides.gameMode = 'load';
} else if (isWaitMode) {
  cmdOverrides.gameMode = 'wait';
}

if (values.players || values.strategist) {
  const strategist = (values.strategist as string) || "simple-strategist";

  if (values.players) {
    const playerList = Array.isArray(values.players) ? values.players : [values.players];
    const playerIDs = playerList.flatMap(p =>
      (p as string).split(',').map(id => parseInt(id.trim()))
    ).filter(id => !isNaN(id));

    // Build llmPlayers as a Record
    cmdOverrides.llmPlayers = {};
    for (const playerID of playerIDs) {
      cmdOverrides.llmPlayers[playerID] = { strategist };
    }
  } else if (values.strategist) {
    // If only strategist is specified, update the default player
    cmdOverrides.llmPlayers = {
      1: { strategist }
    };
  }
}

if (values.autoPlay !== undefined) {
  cmdOverrides.autoPlay = values.autoPlay as boolean;
}

if (values.repetition !== undefined) {
  const raw = String(values.repetition).trim();
  if (raw === 'auto') {
    cmdOverrides.repetition = 'auto';
  } else {
    const rep = parseInt(raw);
    if (!isNaN(rep)) {
      cmdOverrides.repetition = rep;
    }
  }
}

if (values.seed !== undefined) {
  try {
    // CLI seed values are parsed separately so each side can override the file
    // config independently: `--seed 1:` changes only sync, `--seed :2` only map.
    seedOverride = parseSeedArgument(values.seed as string);
  } catch (error) {
    logger.error(`Invalid --seed argument: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Load configuration from file with command line overrides
const sessionConfig: StrategistSessionConfig = loadConfigFromFile(
  path.join(getConfigsDir(), configFile),
  defaultConfig,
  cmdOverrides
);

try {
  // Validate config-file seeds before applying CLI overrides. This catches bad
  // saved configs even when the CLI only overrides one of the two fields.
  // Array-form `randomSeeds` is preserved as-is unless the CLI passes --seed,
  // in which case the override collapses the array to a single seed set
  // (the cycle's seed dimension is effectively disabled for that run).
  const fileSeeds = sessionConfig.randomSeeds;
  if (Array.isArray(fileSeeds)) {
    if (seedOverride !== undefined) {
      logger.warn(
        `--seed override collapses configured randomSeeds array (${fileSeeds.length} entries) to a single set`
      );
      sessionConfig.randomSeeds = mergeRandomSeeds(undefined, seedOverride);
    } else {
      // Validate each entry early so bad seeds fail before launching Civ.
      validateRandomSeedsList(fileSeeds);
    }
  } else {
    sessionConfig.randomSeeds = mergeRandomSeeds(validateRandomSeeds(fileSeeds), seedOverride);
  }
} catch (error) {
  logger.error(`Invalid random seed configuration: ${(error as Error).message}`);
  process.exit(1);
}

// Ensure the config has a name (use filename without extension if not set)
if (!sessionConfig.name) {
  sessionConfig.name = configFile.replace('.json', '');
}

// Session instance
let session: StrategistSession | null = null;
let rl: readline.Interface | null = null;

let shuttingdownAfter = false;

// Register shutdown hooks with processManager
processManager.register('terminal', async () => {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  if (rl) rl.close();
});
processManager.register('session', async () => {
  if (session) await session.shutdown();
});
processManager.register('telemetry', async () => {
  await sqliteExporter.forceFlush();
  await setTimeout(1000);
});

// Web UI
await startWebServer();

// Setup readline interface for keyboard input
rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

// Enable raw mode to capture Ctrl key combinations
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

// Listen for keypress events
process.stdin.on('data', (key) => {
  // Ctrl+A is ASCII code 1
  if (key[0] === 1) {
    if (!shuttingdownAfter) {
      shuttingdownAfter = true;
      logger.info('Ctrl+A pressed: Will stop after current session completes');
    } else {
      shuttingdownAfter = false;
      logger.info('Ctrl+A pressed again: Cancelled shutdown after current session');
    }
  }
  // Ctrl+P is ASCII code 16 - toggle pause/resume on the active session
  else if (key[0] === 16) {
    if (session) {
      if (session.isPaused()) {
        logger.info('Ctrl+P pressed: Resuming session');
        session.resume();
      } else {
        logger.info('Ctrl+P pressed: Pausing session (no new agent runs; game stalls in place)');
        session.pause();
      }
    } else {
      logger.info('Ctrl+P pressed: No active session to pause');
    }
  }
  // Ctrl+C is ASCII code 3 - immediate shutdown via processManager
  else if (key[0] === 3) {
    processManager.shutdown('SIGINT');
  }
});

/**
 * Main entry point.
 * Runs configured number of game sessions with the selected strategist.
 */
async function main() {
  logger.info(`Starting in ${sessionConfig.gameMode} mode`);

  // "auto" repetition runs until the seating × seed cycle completes; the loop itself terminates
  // on `claimNextCell() === null` (cycle finished), so here we only set the cap.
  const { maxRepetitions, cycleEnabled, isAutoRepetition } = resolveMaxRepetitions(sessionConfig);

  try {
    await runStrategistLoop({
      config: sessionConfig,
      maxRepetitions,
      stopAfterCurrentCycle: isAutoRepetition && cycleEnabled,
      onSession: (s) => { session = s; },
      shouldStop: () => shuttingdownAfter,
    });
  } catch (error) {
    logger.error('Session failed:', error);
    process.exit(1);
  } finally {
    await processManager.shutdown('main-complete');
  }
}

// Run the main function
main();
