import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const schemaDirectory = fileURLToPath(new URL('../../src/knowledge/schema/events/', import.meta.url));

/** Discover event schemas recursively, preserving the alphabetical event-name order. */
export function eventSchemaFiles() {
  const files = [];

  /** Collect schema paths relative to the event schema directory. */
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.name.endsWith('.ts') && entry.name !== 'index.ts') {
        files.push(path.relative(schemaDirectory, absolutePath).split(path.sep).join('/'));
      }
    }
  }

  visit(schemaDirectory);
  return files.sort((left, right) => {
    const leftName = path.basename(left);
    const rightName = path.basename(right);
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
}
