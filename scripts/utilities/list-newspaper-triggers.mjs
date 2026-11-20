/** Print the stock trigger IDs in catalogue order without loading the editor. */
import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../../vox-agents/newspaper/triggers/', import.meta.url);
const entries = await readdir(directory, { withFileTypes: true });
const files = entries.filter(file => file.isFile() && file.name.endsWith('.json')).map(file => file.name).sort();
const triggers = await Promise.all(files.map(async file =>
  JSON.parse(await readFile(new URL(file, directory), 'utf8'))
));

process.stdout.write(triggers.flat().map(trigger => trigger.id + '\n').join(''));
