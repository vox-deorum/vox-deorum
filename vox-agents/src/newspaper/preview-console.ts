import { buildNewspaperDependencies } from './cli/build.js';
import { errorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import open from 'open';

const logger = createLogger('Newspaper Preview');

/** Build the saved-game query dependency, then serve the preview until interrupted. */
async function main(): Promise<void> {
  const controller = new AbortController();
  const signals: [NodeJS.Signals, number][] = [['SIGINT', 130], ['SIGTERM', 143], ['SIGBREAK', 149], ['SIGHUP', 129]];
  const listeners = signals.map(([signal, exitCode]) => {
    /** Cancel a build or request shutdown of a running host. */
    const listener = () => {
      process.exitCode ||= exitCode;
      controller.abort(new Error(`Newspaper preview was interrupted by ${signal}.`));
    };
    process.once(signal, listener);
    return { signal, listener };
  });
  try {
    await buildNewspaperDependencies(false, controller.signal);
    const { createNewspaperPreview } = await import('./cli/preview.js');
    controller.signal.throwIfAborted();
    if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
    const host = await createNewspaperPreview();
    try {
      const url = `${host.url}/`;
      logger.info(`Newspaper preview at ${url}`);
      if (!controller.signal.aborted) {
        void open(url).catch(error => logger.warn(`Could not open the preview browser: ${errorMessage(error)}`));
      }
      if (!controller.signal.aborted) {
        await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      }
    } finally {
      await host.close();
    }
  } finally {
    for (const { signal, listener } of listeners) process.removeListener(signal, listener);
  }
}

void main().catch(error => {
  logger.error(errorMessage(error));
  process.exitCode ||= 1;
});
