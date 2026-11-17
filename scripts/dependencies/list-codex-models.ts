import { discoverModels } from '../../vox-agents/src/agents/models/discovery.js';
import { codexProxyManager } from '../../vox-agents/src/agents/models/providers/codex-proxy.js';
import { errorMessage } from '../../vox-agents/src/utils/errors.js';

try {
  const models = await discoverModels('codex');
  if (models.length === 0) throw new Error('The Codex proxy returned no models.');
  process.stdout.write(`Codex proxy models:\n${models.map(({ name }) => `  ${name}`).join('\n')}\n`);
} catch (error) {
  process.stderr.write(`Could not list Codex models: ${errorMessage(error)}\n`);
  process.exitCode = 1;
} finally {
  await codexProxyManager.shutdown();
}
