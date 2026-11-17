import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryDirectory = fileURLToPath(new URL('../../../../', import.meta.url));

/** Run an existing workspace build and stop its child processes when cancelled. */
async function buildWorkspace(workspace: string, script: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run the newspaper command through npm so it can build its dependencies.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, 'run', script, '--workspace', workspace], {
      cwd: repositoryDirectory, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    /** Cancel the full build tree, including npm's compiler or Vite subprocess. */
    const abort = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGTERM');
        }
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code, childSignal) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(signal.reason); return; }
      if (code === 0) { resolve(); return; }
      process.exitCode ||= code && code > 0 ? code : 1;
      reject(new Error(`Newspaper dependency build failed: ${workspace} ${script} (${childSignal ?? code}).`));
    });
  });
}

/** Build compiled MCP queries before importing replay, plus reader assets for PNG capture. */
export async function buildNewspaperDependencies(renderPreviews: boolean, signal: AbortSignal): Promise<void> {
  await buildWorkspace('mcp-server', 'build', signal);
  if (renderPreviews) await buildWorkspace('vox-agents', 'build:newspaper', signal);
  signal.throwIfAborted();
}
