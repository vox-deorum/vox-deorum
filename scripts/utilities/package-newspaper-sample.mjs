/** Package the default runtime sample from its single existing developer fixture source. */
import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL('../../vox-agents/newspaper/fixtures/victorian-ordinary.json', import.meta.url),
  new URL('../../vox-agents/dist-newspaper/sample.json', import.meta.url),
);
