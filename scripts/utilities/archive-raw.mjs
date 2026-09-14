/** Assemble one finalized DLL recording into a shared raw ZIP package. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageRoot = resolve(process.env.VOX_RL_ROOT ?? resolve(repositoryRoot, '../vox-deorum-rl'));

/** Run the shared package writer and preserve its exit status for shell callers. */
function runWriter(sourceRoot, outputDirectory) {
  const args = ['-m', 'shared.package_io', 'archive-raw', sourceRoot, outputDirectory];
  const child = spawn(process.env.VOX_PACKAGE_PYTHON ?? 'python', args, {
    cwd: packageRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', (error) => {
    process.stderr.write(`archive-raw: ${String(error)}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.stderr.write(`archive-raw: writer terminated by ${signal}\n`);
      process.exitCode = 1;
    } else if (code !== 0) {
      process.exitCode = code ?? 1;
    }
  });
}

/** Parse the manual archive command and validate its required positional paths. */
function main() {
  const [sourceRoot, outputDirectory, ...extra] = process.argv.slice(2);
  if (!sourceRoot || !outputDirectory || extra.length > 0) {
    process.stderr.write('Usage: npm run archive:raw -- SOURCE_ROOT OUTPUT_DIRECTORY\n');
    process.exitCode = 2;
    return;
  }
  runWriter(resolve(sourceRoot), resolve(outputDirectory));
}

main();
