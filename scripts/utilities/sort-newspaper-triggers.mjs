/** Sort stock trigger files by ID without changing the text of individual rules. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parseExpressionAt } from 'acorn';

const directory = new URL('../../vox-agents/newspaper/triggers/', import.meta.url);

/** Move each rule as a block, retaining the whitespace and commas between blocks. */
async function sortFile(file) {
  const path = new URL(file, directory);
  const source = await readFile(path, 'utf8');
  const rules = JSON.parse(source);
  if (!Array.isArray(rules) || rules.some(rule => typeof rule?.id !== 'string'))
    throw new Error(`${file} must contain an array of rules with string IDs.`);

  const order = rules.map(({ id }, index) => ({ id, index }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (order.every(({ index }, position) => index === position)) return;

  const { elements } = parseExpressionAt(source, 0, { ecmaVersion: 'latest' });
  let end = 0;
  let sorted = '';
  for (const [position, entry] of elements.entries()) {
    const rule = elements[order[position].index];
    sorted += source.slice(end, entry.start) + source.slice(rule.start, rule.end);
    end = entry.end;
  }
  await writeFile(path, sorted + source.slice(end), 'utf8');
}

const entries = await readdir(directory, { withFileTypes: true });
await Promise.all(entries.filter(file => file.isFile() && file.name.endsWith('.json'))
  .map(file => sortFile(file.name)));
