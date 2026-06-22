# Testing

Vox Deorum's three TypeScript services are tested with **[Vitest](https://vitest.dev)** — every one of them, never Jest.

The guiding idea: a test should exercise a component **the way the real stack uses it**. That means going through the MCP client, through the bridge's HTTP API, through both transports — not reaching past the seams to call internals directly.

The DLL and the mod, being C++ and in-game Lua, are verified by running the game rather than by a unit harness. This page covers the Node.js side, where the automated suites live. For how to build and run the stack the tests sometimes drive, see [setup.md](setup.md).

## Running the tests

From the repo root, `npm run test:all` runs every workspace's suite. Each service also has its own scripts; the common ones are the same everywhere:

| Command | What it does |
|---|---|
| `npm test` | Run the suite once. |
| `npm run test:watch` | Re-run on change. |
| `npm run test:coverage` | Run with a coverage report. |

The interesting differences are in *what each service's default run includes*, because each has tests that need real external things.

### Bridge service — mock vs. real DLL

The bridge talks to a named pipe, so its tests can run against either a **mock DLL server** that implements the full IPC protocol or the **real** game. The `USE_MOCK` environment variable chooses the mode:

- `npm test` (`USE_MOCK=true`, the default) runs with mocks, so the suite is fast and needs no game.
- `npm run test:real` (`USE_MOCK=false`) exercises the bridge against an actual DLL.

The mock implements the whole protocol — registering Lua functions dynamically, simulating game events, with adjustable response delays — so integration paths are covered without a running game.

### MCP server — both transports

The MCP server supports stdio and HTTP transports, and the rule is that tests must pass on **both**. The `TEST_TRANSPORT` environment variable selects which (HTTP is the default; `npm run test:stdio` forces stdio).

Tools are tested **through an MCP client**, not by invoking their methods directly. The test setup exports an `mcpClient` that connects to the server over the chosen transport, so a tool test validates input handling, errors, and output exactly as an agent would experience them. There is also a faster `npm run test:unit` for the pure-logic pieces.

### Vox agents — unit, game, and OBS pathways

The agent framework has tests at very different costs, split into pathways so the cheap ones run by default and the expensive ones are opt-in:

| Pathway | Command | Notes |
|---|---|---|
| **Unit** | `npm test` (alias `npm run test:unit`) | Pure functions and utilities, no external dependencies, fast. The default. |
| **Telepathist** | — | Runs against recorded telemetry database records, with no live game or LLM; skips itself if the database is absent. |
| **Game** | `npm run test:game` | Actually launches CivilizationV.exe, so it needs Windows and Civ V. Runs sequentially (single fork) with long timeouts, gated behind a guard. **Excluded** from the default suite. |
| **OBS** | `npm run test:obs` | Needs OBS Studio running with its WebSocket server; skips gracefully if OBS is unreachable. **Excluded** from the default suite. |

Because the game and OBS suites are environment-heavy and slow, the convention is firm: **don't touch the OBS tests unless you're changing OBS code, and don't touch the game tests unless you're changing the game-launch/process code.**

## Conventions for writing tests

These hold across all three services:

- Test files live in each service's `tests/` directory with a `.test.ts` extension, and **mirror the source structure** so a module and its test are easy to pair.
- Global setup lives in `tests/setup.ts` — the mock server, the MCP client, or whatever the suite shares.
- Use nested `describe` blocks and the `"should …"` naming convention for test names.
- Test through the public seam — the MCP client, the HTTP endpoint, the mock DLL — rather than calling internals. This survives refactors and catches the bugs an agent would actually hit.
- Production code uses the Winston logger only; `console.log/error/warn` is acceptable **in tests** but never in shipped code.

Each component's `AGENTS.md` carries the binding, directory-specific rules. Read it before writing tests in that workspace.

## What isn't unit-tested

The C++ DLL and the in-game Lua mod aren't covered by these suites.

- The **DLL** is verified by building it (CI compiles it under both MSVC and clang — see [setup.md](setup.md)) and by running the game with the debug build attached. The connection service is exercised end to end whenever the stack runs against a real game.
- The **mod** is validated in-game: enabling it, generating a world, and confirming the events and UI hooks fire.

The mock-DLL path in the bridge tests is what lets the Node.js side cover the IPC contract without all of that.
