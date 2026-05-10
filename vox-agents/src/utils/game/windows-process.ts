import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type CommandRunner = (command: string) => Promise<{ stdout: string }>;

async function runCommand(command: string): Promise<{ stdout: string }> {
  const { stdout } = await execAsync(command);
  return { stdout };
}

/** Find the first process ID matching a Windows image name via tasklist CSV. */
export async function findProcessByImageName(
  imageName: string,
  commandRunner: CommandRunner = runCommand
): Promise<number | null> {
  try {
    const { stdout } = await commandRunner(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV`);
    // tasklist emits a header row followed by quoted CSV rows. We keep parsing
    // here instead of shelling through findstr so callers can inject fixtures.
    for (const row of parseTasklistCsv(stdout).slice(1)) {
      if (!row[0]?.includes(imageName)) continue;
      const pid = Number.parseInt(row[1]?.replace(/"/g, '') ?? '', 10);
      if (!Number.isNaN(pid)) return pid;
    }
  } catch {
    // A failed tasklist call means Windows could not report a matching process.
  }
  return null;
}

/** Check whether Windows still reports a process with the given PID. */
export async function isProcessRunning(
  pid: number,
  commandRunner: CommandRunner = runCommand
): Promise<boolean> {
  try {
    const { stdout } = await commandRunner(`tasklist /FI "PID eq ${pid}" /FO CSV`);
    // The PID filter still returns the CSV header when nothing matches, so a
    // matching data row is the signal that the process is alive.
    return parseTasklistCsv(stdout).slice(1).some(row => row[1] === String(pid));
  } catch {
    return false;
  }
}

/** Kill a Windows process by PID using taskkill. */
export async function killProcess(
  pid: number,
  commandRunner: CommandRunner = runCommand
): Promise<void> {
  await commandRunner(`taskkill /F /PID ${pid}`);
}

function parseTasklistCsv(stdout: string): string[][] {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  // Windows tasklist quotes every field and may include commas in values like
  // memory usage, so a plain split(',') would corrupt columns after Mem Usage.
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}
