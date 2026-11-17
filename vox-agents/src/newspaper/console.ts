import { newspaperCliHelp, parseNewspaperOptions } from './cli/options.js';
import { buildNewspaperDependencies } from './cli/build.js';

/** Run the offline command without requiring replay dependencies for help and argument errors. */
async function main(): Promise<void> {
  const options = parseNewspaperOptions(process.argv.slice(2));
  if (!options) {
    process.stdout.write(newspaperCliHelp);
    return;
  }
  const controller = new AbortController();
  const signals: [NodeJS.Signals, number][] = [['SIGINT', 130], ['SIGTERM', 143], ['SIGBREAK', 149], ['SIGHUP', 129]];
  const listeners = signals.map(([signal, exitCode]) => {
    /** Mark interruption as failure while allowing replay and browser cleanup to finish. */
    const listener = () => {
      process.exitCode ||= exitCode;
      controller.abort(new Error(`Newspaper replay was interrupted by ${signal}.`));
    };
    process.once(signal, listener);
    return { signal, listener };
  });
  try {
    await buildNewspaperDependencies(options.renderTurns.length > 0, controller.signal);
    const [{ runNewspaperReplay }, { createLogger }] = await Promise.all([
      import('./cli/replay.js'), import('../utils/logger.js'),
    ]);
    const logger = createLogger('Newspaper');
    controller.signal.throwIfAborted();
    if (options.renderTurns.length) {
      const { requireBuiltReader } = await import('./cli/render.js');
      const { launchInstalledBrowser } = await import('./export/browser.js');
      await requireBuiltReader();
      await (await launchInstalledBrowser()).close();
    }
    controller.signal.throwIfAborted();
    const manifest = await runNewspaperReplay(options, controller.signal);
    logger.info(`Saved ${manifest.counts.published} newspaper issues and ${manifest.counts.skipped} skipped checks to ${options.output}. Open index.html to inspect articles and sources.`);
    for (const missing of manifest.missingRenderTurns) logger.warn(`No PNG for turn ${missing.turn}: ${missing.reason}`);
  } finally {
    for (const { signal, listener } of listeners) process.removeListener(signal, listener);
  }
}

void main().catch(async error => {
  const { createLogger } = await import('../utils/logger.js');
  createLogger('Newspaper').error(error instanceof Error ? error.message : String(error));
  process.exitCode ||= 1;
});
