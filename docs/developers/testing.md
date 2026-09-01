# Testing

Vox Deorum has four automated test suites, all on **[Vitest](https://vitest.dev)** and never Jest: one for each of the three TypeScript services, plus one for the Vue web UI that ships inside `vox-agents/ui`.

The guiding idea is that a test should exercise a component **the way the real stack uses it**: through the MCP client, through the bridge's HTTP API, through both transports, rather than reaching past the seams to call internals directly.

The DLL and the mod, being C++ and in-game Lua, are verified by building and by running the game rather than by a unit harness. This page covers the Node.js side. For how to build and run the stack the tests sometimes drive, see [setup.md](setup.md).

## Nothing is enforced for you

The repository has two GitHub Actions workflows: `.github/workflows/release.yml` and `generate-docs.yml`. **Neither runs tests**, and there is no workflow that reacts to a pull request. Nothing blocks a merge if the suites fail.

That makes the pre-submit routine below a matter of discipline rather than automation. Run it by hand before you push.

## Running the tests

From the repo root, `npm run test:all` runs every workspace's suite and then the UI suite (`npm run test -ws && npm --prefix vox-agents/ui run test`). The UI sits outside the npm workspaces, which is why it needs that second command.

Each service also has its own scripts, and the common ones are the same everywhere:

| Command | What it does |
|---|---|
| `npm test` | Run the suite once. |
| `npm run test:watch` | Re-run on change. |
| `npm run test:coverage` | Run with a coverage report. |

The interesting differences are in what each suite's default run includes, because some tests need real external resources.

### Bridge service: mock vs. real DLL

The bridge talks to a named pipe, so its tests can run against either a **mock DLL server** that implements the full IPC protocol or the **real** game. The `USE_MOCK` environment variable chooses the mode:

- `npm test` (`USE_MOCK=true`, the default) runs with mocks, so the suite is fast and needs no game.
- `npm run test:real` (`USE_MOCK=false`) targets `bridge-service/tests/real/` against a live Civilization V DLL. It is live-only by design.

The mock implements the whole protocol, including registering Lua functions dynamically and simulating game events with adjustable response delays, so integration paths are covered without a running game.

### MCP server: both transports

The MCP server supports stdio and HTTP transports, and the rule is that tests must pass on **both**. The `TEST_TRANSPORT` environment variable selects which; HTTP is the default and `npm run test:stdio` forces stdio.

The default `npm test` and `npm run test:mock` run the in-process mock tier. Tool tests go through an MCP client rather than invoking tool methods directly, so they validate input handling, errors, and output exactly as an agent would experience them.

`npm run test:real` runs `mcp-server/tests/real/`, booting the real MCP server against the real bridge service in mock-DLL mode through `tests/real.setup.ts`. That stack needs no copy of Civilization V, but the existing real-tier tests were written for a live game and still need adaptation before the tier passes reliably.

### Vox agents: four tiers

`vox-agents/vitest.config.ts` picks a tier from `TEST_TIER` (or from `USE_MOCK=false`) and includes only `tests/<tier>/**`:

| Tier | Command | Notes |
|---|---|---|
| **Mock** | `npm test` or `npm run test:mock` | The default in-process tier in `tests/mock/**`, with the MCP client replaced at the client seam. Telepathist coverage lives under `tests/mock/telepathist` and skips when recorded telemetry is unavailable. |
| **Real** | `npm run test:real` | **Not wired yet.** `tests/real/` does not exist, and the script runs with `--passWithNoTests`, so it is a clean no-op. The tier is reserved for a future out-of-process run against a real MCP server over a mock-DLL bridge. |
| **Game** | `npm run test:game` | The live Civilization V tier in `tests/live/game/**`. It needs Windows and Civ V, runs sequentially with long timeouts, and is excluded from the default suite. |
| **OBS** | `npm run test:obs` | The live OBS tier in `tests/live/obs/**`. It needs OBS Studio with its WebSocket server, and is excluded from the default suite. |

Because the game and OBS suites are environment-heavy and slow, the convention is firm: **don't touch the OBS tests unless you're changing OBS code, and don't touch the game tests unless you're changing the game-launch or process code.**

### Vox agents UI: a suite of its own

`vox-agents/ui` is a separate Vue project with its own `vitest.config.ts`, running in a jsdom environment with shared setup in `tests/setup.ts`. It has roughly 26 test files, all under `tests/mock/**`, organized to mirror the app: API clients, stores, composables, views, and components for chat, deals, logging, sessions, and telemetry.

Its scripts are `npm test`, `npm run test:watch`, and `npm run test:coverage`, run from `vox-agents/ui`. Remember that root `test:all` already includes it. See [vox-agents/ui.md](vox-agents/ui.md).

## Before you submit

Nothing checks this for you, so run it yourself:

1. `npm run build:all` from the repo root. This also builds `vox-agents/ui`, since the vox-agents build recurses into it.
2. `npm run test:all` from the repo root, covering all four suites.
3. `npm run lint:all` from the repo root. Each of `bridge-service`, `mcp-server`, and `vox-agents` defines its own `lint` script over `src`. The UI has no lint script; use its `type-check` instead.
4. **For C++ changes only:** build the DLL under both MSVC and clang and confirm no new warnings. That mirrors the submodule's own CI in `civ5-dll/.github/workflows/build_vp.yml`, which compiles the gamecore both ways. `civ5-dll/.github/workflows/cppcheck.yml` adds a static-analysis pass, triggered manually. If a DLL CI run fails, those two files are where to look.

Each workspace also has a `type-check` script if you want the TypeScript check without a full build.

## Conventions for writing tests

These hold across all four suites:

- Test files live in the project's `tests/` directory with a `.test.ts` extension, and **mirror the source structure** so a module and its test are easy to pair.
- Shared setup lives in `tests/setup.ts`: the mock server, the MCP client, or whatever the suite has in common.
- Use nested `describe` blocks and the `"should …"` naming convention for test names.
- Test through the public seam (the MCP client, the HTTP endpoint, the mock DLL) rather than calling internals. This survives refactors and catches the bugs an agent would actually hit.
- Production code uses the Winston logger only. `console.log/error/warn` is acceptable **in tests** but never in shipped code.

Each component's `AGENTS.md` carries the binding, directory-specific rules. Read it before writing tests in that workspace.

## What isn't unit-tested

The C++ DLL and the in-game Lua mod aren't covered by these suites.

- The **DLL** is verified by compiling it and by running the game with the debug build attached. Its connection service is exercised end to end whenever the stack runs against a real game.
- The **mod** is validated in-game: enabling it, generating a world, and confirming the events and UI hooks fire.

The mock-DLL path in the bridge tests is what lets the Node.js side cover the IPC contract without any of that.
