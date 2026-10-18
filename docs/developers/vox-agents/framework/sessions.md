# Sessions and process lifecycle

A **session** is a long-running job, such as playing one game from start to finish. Sessions are the outermost layer: a session creates contexts, contexts start runs, and runs call agents.

```
process
 └── session (one game)          VoxSession
      ├── Civilization V process  VoxCivilization
      └── one context per seat    VoxContext  ──►  runs  ──►  agents
```

This page covers sessions, how a session launches the game, the global registries, and shutdown.

## Sessions

`VoxSession` (`src/infra/vox-session.ts`) is the base class. The dashboard reports these states, defined by `SessionState` in `src/types/api.ts`:

| State      | Meaning                                          |
| ---------- | ------------------------------------------------ |
| starting   | Launching the game and preparing players.        |
| running    | Playing.                                         |
| recovering | Relaunching after a crash.                       |
| stopping   | Shutting down cleanly.                           |
| stopped    | Inactive or finished. This is the initial state. |
| error      | Failed, with an error message.                   |

Pausing is a separate flag: a paused session stays running, finishes work already in progress, and holds new work until resumed.

`StrategistSession` is the main implementation (see [Game session](../agents/strategists/game-session.md)). The implemented assemble stage of the [narrator pipeline](../platform/media.md#the-narrators-pipeline) is a session too.

## Launching the game

Sessions that start Civilization V do it through `VoxCivilization` (`src/infra/vox-civilization.ts`). It:

1. Generates the launch Lua from templates.
2. Prepares Civ's `config.ini`, including any fixed random seeds (see [Game session](../agents/strategists/game-session.md#repeating-games)).
3. Starts the game and attaches to its process.
4. Kills the process on shutdown.

The `useDX11` setting (on by default) launches the DirectX 11 build. If an install does not have it, the launch script falls back to the standard build. The manager watches for both process names and reports the one it attached to through `getGameExecutable`.

## Global registries

Three registries connect the parts of the process:

| Registry | Holds | Defined in |
| --- | --- | --- |
| `agentRegistry` | Every available agent. | `src/infra/agent-registry.ts` |
| `sessionRegistry` | Active sessions. Allows only one game session at a time. | `src/infra/session-registry.ts` |
| `contextRegistry` | Live contexts, so web routes can find them. | `src/infra/context-registry.ts` |

## Shutdown

`processManager` (`src/infra/process-manager.ts`) handles the stop signals (SIGINT, SIGTERM, SIGBREAK, SIGHUP) in one place. Each entry point and long-lived service registers a named shutdown hook, and hooks run in the order they were registered.

The strategist console registers three:

| Hook | Does |
| --- | --- |
| `terminal` | Restores the console. |
| `session` | Stops the running game session. Each context closes its own telemetry database as part of this. |
| `telemetry` | Flushes spans that have not been written yet. |
