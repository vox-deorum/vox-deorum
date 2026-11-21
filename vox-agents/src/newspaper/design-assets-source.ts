/**
 * Node-only source of asset definitions authored on built-in newspaper designs.
 *
 * The reader build swaps this module for the Vite adapter under newspaper/src.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Read built-in design documents from the bundled catalogue in filename order. */
export function readBuiltInDesignDocuments(): unknown[] {
  const directory = fileURLToPath(new URL("../../newspaper/designs/", import.meta.url));
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => readDesignDocument(path.join(directory, name)));
}

/** Read one built-in design file and identify it in any error. */
function readDesignDocument(filename: string): unknown {
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read newspaper design file "${filename}".`, { cause });
  }
}
