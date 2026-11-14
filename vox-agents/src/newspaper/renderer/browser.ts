/** Installed-browser lifecycle for serial publication render batches. */
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';
import { errorMessage } from '../../utils/errors.js';

/** Identify missing browser support separately from invalid publication input. */
export class NewspaperBrowserUnavailableError extends Error {}

/** Launch Edge, then Chrome, without invoking Playwright's browser installer. */
export async function launchInstalledBrowser(executablePath?: string): Promise<Browser> {
  const choices: LaunchOptions[] = executablePath
    ? [{ executablePath }]
    : [{ channel: 'msedge' }, { channel: 'chrome' }];
  const failures: string[] = [];
  for (const choice of choices) {
    try {
      return await chromium.launch({ ...choice, headless: true, timeout: 20_000 });
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }
  throw new NewspaperBrowserUnavailableError(`Newspaper texture export needs installed Edge or Chrome, or --browser with an executable path. Cached issues remain readable. ${failures.join('\n')}`);
}

/** Reuse one browser through a batch, then close it after inactivity or shutdown. */
export class NewspaperBrowser {
  private browser?: Browser;
  private pending: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private stopped = false;

  /** Accept an injectable launcher so failure and shutdown behavior can be tested. */
  constructor(
    private readonly launch: () => Promise<Browser> = () => launchInstalledBrowser(),
    private readonly idleMs = 15_000,
  ) {}

  /** Serialize requests so context closure and the idle timer cannot interrupt a render. */
  run<T>(operation: (browser: Browser) => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Newspaper renderer is closed.'));
    clearTimeout(this.idle);
    const result = this.pending.then(async () => {
      clearTimeout(this.idle);
      if (!this.browser?.isConnected()) this.browser = await this.launch();
      return operation(this.browser);
    });
    this.pending = result.catch(() => undefined).then(() => {
      if (!this.stopped) {
        this.idle = setTimeout(() => {
          // Join the same queue so a newly submitted render cannot race browser closure.
          this.pending = this.pending.then(() => this.closeBrowser()).catch(() => undefined);
        }, this.idleMs);
        this.idle.unref();
      }
    });
    return result;
  }

  /** Finish accepted renders and release the process before shutdown returns. */
  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.idle);
    await this.pending;
    await this.closeBrowser();
  }

  /** Detach the process reference before closing it. */
  private async closeBrowser(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
}
