/**
 * Start the real Bridge Service with deterministic raw Lua response behavior.
 * tests/real.setup.ts spawns this with the port, host, pipe ID, and event pipe settings.
 */

process.env.NODE_ENV ??= 'test';

/** Boot a mock DLL beneath the production bridge and serve hand-authored script results. */
async function main(): Promise<void> {
  const { createMockDLLServer } = await import('../../../bridge-service/tests/test-utils/mock-dll-server.js');
  const mockDLL = await createMockDLLServer({
    id: process.env.gamepipe_ID!,
    simulateDelay: false,
    autoEvents: false,
  });
  const scriptResults: Record<string, number> = {
    'return 2 + 3': 5,
    'return 10 * 5': 50,
    'return math.sqrt(16)': 4,
    'return 2^8': 256,
    'return (10 + 5) * 2': 30,
  };
  mockDLL.addLuaFunction('ExecuteScript', (script: string) => {
    if (script in scriptResults) return scriptResults[script];
    throw new Error('script is not included in the deterministic test fixture');
  });

  const { startServer } = await import('../../../bridge-service/src/index.js');
  await startServer();

  const shutdown = async () => {
    await mockDLL.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGBREAK', shutdown);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
