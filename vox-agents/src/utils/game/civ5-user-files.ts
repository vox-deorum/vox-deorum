import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type DocumentsPathResolver = () => Promise<string>;

/** Ask Windows for the real Documents folder, including OneDrive redirection. */
export async function getWindowsDocumentsPath(): Promise<string> {
  const { stdout } = await execAsync(
    'powershell -Command "[Environment]::GetFolderPath(\'MyDocuments\')"'
  );
  return stdout.trim();
}

/** Resolve a file inside Civ V's per-user configuration directory. */
export async function getCiv5UserFilePath(
  filename: string,
  resolveDocumentsPath: DocumentsPathResolver = getWindowsDocumentsPath
): Promise<string> {
  let documentsPath: string;
  try {
    documentsPath = await resolveDocumentsPath();
  } catch {
    documentsPath = join(homedir(), 'Documents');
  }

  return join(
    documentsPath,
    'My Games',
    "Sid Meier's Civilization 5",
    filename
  );
}
