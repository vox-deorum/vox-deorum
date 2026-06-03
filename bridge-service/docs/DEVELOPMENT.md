# Development Guide

Guide for developing and debugging the Bridge Service.

## Quick Start

```bash
cd bridge-service
npm install          # Or from root: npm install (workspace)
npm run dev          # Development with auto-reload
npm test             # Run tests
npm run build        # Compile TypeScript
npm start            # Run production build
```

## Testing

### Running Tests

```bash
npm test                 # All tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
npx vitest run <file>    # Specific test
```

### Test Structure

- **Framework**: Vitest (not Jest)
- **Location**: `tests/**/*.test.ts` (organized by `connection/` and `routes/`)
- **Setup**: `tests/setup.ts` for global config
- **Mock DLL**: `tests/test-utils/mock-dll-server.ts` simulates game DLL
- **Test Utilities**: `tests/test-utils/` contains helpers, constants, and mock services

### Mock DLL Usage

```typescript
import { MockDLLServer } from './test-utils/mock-dll-server.js';

const mockDLL = new MockDLLServer({ pipeName: 'test-pipe', delay: 50 });
mockDLL.start();
mockDLL.addFunction('GetGameTurn', () => ({ turn: 100 }));
mockDLL.sendEvent('turnStart', { playerID: 0, turn: 100 });
mockDLL.stop();
```

## Debugging

### Enable Debug Logs

```bash
LOG_LEVEL=debug npm run dev
```

### Debug Named Pipes

**List pipes (PowerShell):**
```powershell
[System.IO.Directory]::GetFiles("\\\\.\\pipe\\")
```

**Monitor with pipelist:**
```bash
pipelist.exe | findstr vox-deorum
```

### Debug IPC Messages

```
[bridge:dll] → {"type":"lua_call","function":"GetGameTurn","args":[],"id":"uuid"}
[bridge:dll] ← {"type":"lua_response","id":"uuid","success":true,"result":100}
```

### Monitor SSE

```bash
curl http://127.0.0.1:5000/stats  # Check connection count
curl -N http://127.0.0.1:5000/events  # Monitor events
```

### Troubleshooting

See [ERROR-HANDLING.md](ERROR-HANDLING.md) for complete troubleshooting guide.

**Quick checks:**
- DLL connection: `curl http://127.0.0.1:5000/health`
- Available functions: `curl http://127.0.0.1:5000/lua/functions`
- Simple test: `curl -X POST http://127.0.0.1:5000/lua/call -H "Content-Type: application/json" -d '{"function":"GetGameTurn","args":[]}'`

## Code Style

### TypeScript

- Strict mode enabled
- ESM modules ("type": "module")
- **Always use `.js` extensions in imports** (even for `.ts` files)
- No `any`/`unknown` unless absolutely necessary

### Imports

```typescript
// Correct (ESM with .js extension)
import { config } from './utils/config.js';
```

### Logging

**Always use Winston logger:**

```typescript
import { createLogger } from './utils/logger.js';
const logger = createLogger('component-name');

logger.info('Connected to DLL');
logger.error('Connection failed:', error);
logger.debug('Message sent:', message);
```

### Error Handling

Use standardized response helpers:

```typescript
import { respondSuccess, respondError } from './types/api.js';
import { handleAPIError } from './utils/api.js';

router.post('/lua/call', async (req, res) => {
  await handleAPIError(res, '/lua/call', async () => {
    const result = await luaManager.callFunction(req.body);
    return result;
  });
});
```

### Singletons

Export service instances, not classes:

```typescript
class DLLConnector extends EventEmitter { }
export const dllConnector = new DLLConnector();
```

## Adding Features

### New Endpoint

1. Define route in `src/routes/`
2. Wrap with `handleAPIError`
3. Use standard response format
4. Add tests
5. Document in [API-REFERENCE.md](API-REFERENCE.md)

### New Service

1. Create file in `src/services/`
2. Extend EventEmitter
3. Export singleton instance
4. Implement `initialize()` and `shutdown()`
5. Register with BridgeService
6. Add tests

### New Message Type

1. Define type in `src/types/`
2. Update connector to handle message
3. Add tests
4. Document in [MESSAGE-TYPES.md](MESSAGE-TYPES.md)

## Project Structure

```
bridge-service/
├── src/
│   ├── routes/          # API endpoints (lua, external, events)
│   ├── services/        # Core services (dll-connector, lua-manager, etc.)
│   ├── types/           # TypeScript interfaces
│   └── utils/           # Helpers & config
├── tests/
│   ├── connection/      # DLL connection tests (lifecycle, reconnection, etc.)
│   ├── routes/          # HTTP endpoint tests (lua, external, sse, stats)
│   └── test-utils/      # Mock DLL server, helpers, constants
├── docs/                # Documentation
├── examples/            # Example client code
└── config.json          # Runtime configuration
```

## Performance

### Node.js Inspector

```bash
node --inspect dist/index.js
# Open chrome://inspect
```

### Load Testing

```bash
npm install -g autocannon
autocannon -c 100 -d 30 http://127.0.0.1:5000/health
```

## Contributing

1. Follow code style in [AGENTS.md](../AGENTS.md)
2. Add tests for new features
3. Update documentation
4. Ensure tests pass: `npm test`
5. Build successfully: `npm run build`
