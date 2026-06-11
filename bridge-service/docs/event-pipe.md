# Event Pipe Documentation

The Event Pipe provides a one-to-many broadcasting mechanism for game events via named pipes (Windows). This allows external processes to receive real-time game events without using HTTP/SSE connections.

## Configuration

Add the following to your `config.json`:

```json
{
  "eventpipe": {
    "enabled": true,
    "name": "vox-deorum-events"
  }
}
```

Or use environment variables:
- `EVENTPIPE_ENABLED=true`
- `EVENTPIPE_NAME=vox-deorum-events`

## Connection Details

- Pipe path: `\\.\pipe\tmp-app.{name}` (e.g., `\\.\pipe\tmp-app.vox-deorum-events`)
- Note: node-ipc automatically adds `tmp-app.` prefix to the configured pipe name


## Protocol

- **Transport**: Named pipe (Windows) using node-ipc with raw buffer mode
- **Format**: JSON messages delimited by `!@#$%^!` (same as DLL connector)
- **Direction**: One-way (server to clients, broadcast only)
- **Batching**: Events are batched for performance (50ms timeout or 100 events max)

## Batching

Events are automatically batched for performance optimization:
- **Timeout**: Events are flushed every 50ms
- **Size limit**: Batches are sent immediately when reaching 100 events
- **Critical events**: Some events (like dll_status) trigger immediate flush
- **Format**: Multiple JSON objects joined with `!@#$%^!` delimiter in a single message
- **Benefits**: Reduces IPC overhead, improves throughput for high-frequency events

## Event Format

Each event is a JSON object with the following structure:

```typescript
interface GameEvent {
  type: string;           // Event type (e.g., "PlayerDoTurn", "dll_status")
  id?: string;            // Optional unique event ID
  payload?: any;          // Event-specific data
  extraPayload?: any;     // Additional event data
  visibility?: number[];  // Optional player visibility restrictions
}
```

## Special Events

### Connection Event
Sent immediately when a client connects:
```json
{
  "type": "connected",
  "timestamp": "2025-09-30T15:30:00.000Z",
  "message": "Connected to event pipe"
}
```

### Disconnection Event
Sent before server shutdown:
```json
{
  "type": "disconnecting",
  "timestamp": "2025-09-30T15:30:00.000Z",
  "message": "Server shutting down"
}
```

### DLL Status Events
```json
{
  "type": "dll_status",
  "payload": { "connected": true }
}
```

## Example Clients

### Complete Example

See [examples/event-pipe-client.js](../examples/event-pipe-client.js) for a complete working Node.js client implementation using node-ipc with raw buffer support.

The example includes:
- Proper connection handling with error recovery
- Message buffering and delimiter splitting
- Event statistics tracking
- Graceful shutdown handling

### Basic Connection Pattern

**Using node-ipc (Recommended):**

```javascript
const ipc = require('node-ipc');

ipc.config.rawBuffer = true;  // Important: match server configuration
ipc.config.encoding = 'utf8';

let messageBuffer = '';

ipc.connectTo('vox-deorum-events', () => {
  ipc.of['vox-deorum-events'].on('data', (data) => {
    // Buffer incoming data and split by delimiter
    messageBuffer += data.toString();
    const messages = messageBuffer.split('!@#$%^!');
    messageBuffer = messages.pop() || '';

    // Process each complete message
    messages.forEach(message => {
      if (message.trim()) {
        const event = JSON.parse(message.trim());
        // Handle event
      }
    });
  });
});
```

**Alternative:** Raw sockets (`net.createConnection`) work similarly with the same buffering logic.

**Key Points:**
- Always use `rawBuffer: true` for node-ipc
- Buffer data and split by `!@#$%^!` delimiter
- Parse each complete message as JSON
- Handle partial messages (keep incomplete part in buffer)

## Monitoring

Check the event pipe status via the service stats endpoint:

```bash
curl http://localhost:5000/stats
```

Response includes:
```json
{
  "eventPipe": {
    "enabled": true,
    "clients": 3,
    "pipeName": "vox-deorum-events"
  }
}
```