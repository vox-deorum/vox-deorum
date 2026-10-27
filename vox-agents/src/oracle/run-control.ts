/**
 * @module oracle/run-control
 *
 * Bounded scheduling for Oracle phases.
 */

/** A unit of Oracle work that is admitted by the bounded scheduler. */
export type OracleTaskFactory<T> = () => Promise<T>;

/** A task factory tagged with the source index of the result it produces. */
export interface IndexedOracleTask<T> {
  index: number;
  run: OracleTaskFactory<T>;
}

/** Outcome of one chain scheduler run. */
export interface OracleChainRun<T> {
  /** Results in completion order, each tagged with its source index. */
  results: Array<{ index: number; result: T }>;
  /** True when any chain still has factories unfinished after active work drained. */
  stopped: boolean;
}

/** Outcome of one bounded scheduler run. */
export interface OracleTaskRun<T> {
  /** Results of the admitted tasks, in source order. */
  results: T[];
  /** True only when the stop predicate left queued work unadmitted. */
  stopped: boolean;
}

/**
 * Runs chains of indexed factories with bounded concurrency.
 *
 * The scheduler has two FIFO queues. Every nonempty chain starts in the episode queue, in input
 * order, and a chain's later factories enter the replay queue when the previous one settles.
 * Admission always takes replay work first. A chain runs one factory at a time, so these queues
 * serialize each chain's members while independent chains run in parallel. The priority is strict
 * on purpose: it lets a repeated prompt reuse the work of the sample before it.
 *
 * @param chains - Ordered chains of indexed task factories
 * @param concurrency - Maximum number of factories running at once
 * @param shouldStop - Optional predicate that blocks admission from both queues
 * @returns Settled results tagged by their source indexes, plus whether work was withheld
 */
export async function runOracleTaskChains<T>(
  chains: readonly (readonly IndexedOracleTask<T>[])[],
  concurrency: number,
  shouldStop?: () => boolean
): Promise<OracleChainRun<T>> {
  validateConcurrency(concurrency);

  const states = chains
    .filter(chain => chain.length > 0)
    .map(chain => ({ tasks: chain, cursor: 0 }));
  const episodeQueue = [...states];
  const replayQueue: typeof states = [];
  const results: Array<{ index: number; result: T }> = [];
  let activeCount = 0;
  let settled = false;

  return new Promise<OracleChainRun<T>>((resolve, reject) => {
    /** Starts available work, then completes once admitted work has drained. */
    const schedule = (): void => {
      if (settled) return;

      while (activeCount < concurrency && !shouldStop?.()) {
        const chain = replayQueue.shift() ?? episodeQueue.shift();
        if (!chain) break;
        const task = chain.tasks[chain.cursor];
        activeCount += 1;

        Promise.resolve()
          .then(task.run)
          .then(
            result => {
              results.push({ index: task.index, result });
              chain.cursor += 1;
              if (chain.cursor < chain.tasks.length) replayQueue.push(chain);
            },
            error => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            }
          )
          .then(() => {
            activeCount -= 1;
            schedule();
          });
      }

      if (activeCount === 0) {
        settled = true;
        // A chain is unfinished while its cursor is short of its factories. That includes a
        // continuation a stop withheld, so indexes need not form a dense prefix. A pending stop
        // only counts once it actually withheld work: a run that admitted everything is complete.
        resolve({ results, stopped: states.some(state => state.cursor < state.tasks.length) });
      }
    };

    schedule();
  });
}

/**
 * Runs independent task factories with bounded concurrency and an optional graceful-stop predicate.
 *
 * Each factory is a one-task chain, so admission follows source order and the admitted tasks
 * are always a prefix of the source list, returned in that order.
 */
export async function runOracleTasks<T>(
  taskFactories: readonly OracleTaskFactory<T>[],
  concurrency: number,
  shouldStop?: () => boolean
): Promise<OracleTaskRun<T>> {
  const { results, stopped } = await runOracleTaskChains(
    taskFactories.map((run, index) => [{ index, run }]),
    concurrency,
    shouldStop
  );
  return { results: results.sort((a, b) => a.index - b.index).map(entry => entry.result), stopped };
}

/** Validates the scheduler's concurrency the same way p-limit does. */
function validateConcurrency(concurrency: number): void {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('Expected `concurrency` to be a number from 1 and up');
  }
}
