import type {
  PacingInterruption,
  ProductionMode,
  RandomSeedsConfig,
  StrategistSessionConfig
} from './types.js';

export type ProductionOption = ProductionMode | 'default';

export interface RunControlFormState {
  production: ProductionOption;
  seatingCycleSeed: number | null;
  mapSeedsInput: string;
  gameSeedsInput: string;
}

const uint32Max = 0xffffffff;

/** Add explicit pacing defaults so player controls always have values to edit. */
export function hydratePacing(
  config: StrategistSessionConfig,
  knownInterruptions: PacingInterruption[],
  registryLoaded: boolean
): void {
  for (const player of Object.values(config.llmPlayers)) {
    const interruption = player.pacing?.interruption ?? 'none';
    const knownInterruption = knownInterruptions.includes(interruption);
    player.pacing = {
      everyTurns: player.pacing?.everyTurns ?? 1,
      interruption: registryLoaded && !knownInterruption ? 'none' : interruption
    };
  }
}

/** Remove default pacing values before a configuration is saved. */
export function cleanDefaultPacing(config: StrategistSessionConfig): void {
  for (const player of Object.values(config.llmPlayers)) {
    const everyTurns = player.pacing?.everyTurns ?? 1;
    const interruption = player.pacing?.interruption ?? 'none';
    const pacing: NonNullable<typeof player.pacing> = {};
    if (everyTurns !== 1) pacing.everyTurns = everyTurns;
    if (interruption !== 'none') pacing.interruption = interruption;
    if (Object.keys(pacing).length === 0) delete player.pacing;
    else player.pacing = pacing;
  }
}

/** Convert persisted run controls into the form representation. */
export function hydrateRunControls(config: StrategistSessionConfig): RunControlFormState {
  const seedSets = Array.isArray(config.randomSeeds)
    ? config.randomSeeds
    : config.randomSeeds
      ? [config.randomSeeds]
      : [];
  return {
    production: config.production && config.production !== 'none' ? config.production : 'default',
    seatingCycleSeed: config.randomizeSeating === true
      ? 0
      : typeof config.randomizeSeating === 'number'
        ? config.randomizeSeating
        : -1,
    mapSeedsInput: seedSets
      .map(seed => seed.map)
      .filter((seed): seed is number => seed !== undefined)
      .join(', '),
    gameSeedsInput: seedSets
      .map(seed => seed.sync)
      .filter((seed): seed is number => seed !== undefined)
      .join(', ')
  };
}

/** Apply validated run-control form values to a configuration clone. */
export function applyRunControls(config: StrategistSessionConfig, state: RunControlFormState): void {
  if (state.production === 'default') delete config.production;
  else config.production = state.production;

  if (state.seatingCycleSeed == null || state.seatingCycleSeed < 0) delete config.randomizeSeating;
  else config.randomizeSeating = state.seatingCycleSeed;

  const randomSeeds = buildControlledSeeds(state.mapSeedsInput, state.gameSeedsInput);
  if (randomSeeds === undefined) delete config.randomSeeds;
  else config.randomSeeds = randomSeeds;
}

/** Validate all advanced run-control fields and return the first error. */
export function validateRunControls(state: RunControlFormState): string | null {
  const seatingSeed = state.seatingCycleSeed;
  if (seatingSeed == null || !Number.isInteger(seatingSeed) || seatingSeed < -1 || seatingSeed > uint32Max) {
    return 'Seating cycle seed must be -1 or a uint32 integer.';
  }
  return validateControlledSeedInputs(state.mapSeedsInput, state.gameSeedsInput);
}

/** Validate comma-separated controlled seed fields. */
export function validateControlledSeedInputs(mapInput: string, gameInput: string): string | null {
  const mapSeeds = parseSeedInput(mapInput, 'Map seeds');
  if (mapSeeds.error) return mapSeeds.error;
  const gameSeeds = parseSeedInput(gameInput, 'Game seeds');
  if (gameSeeds.error) return gameSeeds.error;
  if (mapSeeds.values.length > 0 && gameSeeds.values.length > 0 && mapSeeds.values.length !== gameSeeds.values.length) {
    return 'Map seeds and game seeds must have the same number of entries.';
  }
  return null;
}

/** Build the backend seed shape from two validated input strings. */
function buildControlledSeeds(
  mapInput: string,
  gameInput: string
): RandomSeedsConfig | RandomSeedsConfig[] | undefined {
  const mapSeeds = parseSeedInput(mapInput, 'Map seeds').values;
  const gameSeeds = parseSeedInput(gameInput, 'Game seeds').values;
  const seedCount = Math.max(mapSeeds.length, gameSeeds.length);
  if (seedCount === 0) return undefined;
  const seedSets = Array.from({ length: seedCount }, (_, index) => {
    const seedSet: RandomSeedsConfig = {};
    if (mapSeeds[index] !== undefined) seedSet.map = mapSeeds[index];
    if (gameSeeds[index] !== undefined) seedSet.sync = gameSeeds[index];
    return seedSet;
  });
  return seedSets.length === 1 ? seedSets[0] : seedSets;
}

/** Parse a comma-separated list of positive uint32 seeds. */
function parseSeedInput(value: string, label: string): { values: number[]; error: string | null } {
  const trimmed = value.trim();
  if (trimmed === '') return { values: [], error: null };
  const values: number[] = [];
  for (const token of trimmed.split(',').map(part => part.trim())) {
    if (token === '' || !/^\d+$/.test(token)) {
      return { values: [], error: `${label} must be comma-separated positive integers.` };
    }
    const parsed = Number(token);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > uint32Max) {
      return { values: [], error: `${label} must use positive uint32 integers.` };
    }
    values.push(parsed);
  }
  return { values, error: null };
}

export { uint32Max };
