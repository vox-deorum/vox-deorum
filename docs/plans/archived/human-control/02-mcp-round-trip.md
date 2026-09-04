# Stage 2 — mcp-server: decision round-trip plumbing ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** All work items landed; `tsc --noEmit` passes. What was built:
> - [`knowledge/schema/events/HumanDecision.ts`](../../../mcp-server/src/knowledge/schema/events/HumanDecision.ts) — permissive zod schema (required `PlayerID` + `Rationale`; everything else optional). [`events/index.ts`](../../../mcp-server/src/knowledge/schema/events/index.ts) regenerated.
> - [`server.ts`](../../../mcp-server/src/server.ts) — `"HumanDecision"` added to `eventsForNotification`; notifications now keep routing metadata at top level and put forwarded event payloads inside a top-level `data` object; an always-on keepalive `setInterval` (`HEARTBEAT_INTERVAL_MS = 90_000`, comfortably under the 600 s body timeout) started in `initialize()`, `unref()`'d, and cleared on shutdown.
> - [`utils/lua/present-decision.ts`](../../../mcp-server/src/utils/lua/present-decision.ts) — `presentHumanDecision` `LuaFunction` firing `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`, with `optionsJson` passed through `sanitize()`.
> - [`tools/actions/present-decision.ts`](../../../mcp-server/src/tools/actions/present-decision.ts) — the outbound tool, registered in [`tools/index.ts`](../../../mcp-server/src/tools/index.ts).

## Objective

Both directions of the decision round-trip work at the mcp-server layer, tested together with the panel simulated:

- **(a) Inbound:** a `Game.BroadcastEvent("HumanDecision", {...})` (injected via the `lua-executor` tool) survives the store's schema gate and reaches vox-agents as a notification carrying the human's choices.
- **(b) Outbound:** vox-agents can ask mcp-server to fetch the turn's Flavor-mode `OptionsReport` and push it into the game for the panel.
- **(c) Liveness:** the SSE channel survives an unbounded human pause.

## Work items

1. **`mcp-server/src/knowledge/schema/events/HumanDecision.ts`** (new) — a permissive zod schema: `PlayerID` (number) and `Rationale` (string) required; everything else optional — `Turn`, `StatusQuo`, and the Flavor-mode decision fields (`GrandStrategy` / `Flavors` / `Technology` / `Policy` / `Persona` / `Relationships`). Human control runs in **Flavor mode only**, so there is no `Mode` field and none of the legacy Strategy-mode `EconomicStrategies` / `MilitaryStrategies` (note `GrandStrategy` is itself a Flavor-mode field). A numeric `PlayerID` is what routes the stored event onward to a notification; the store already applies `.passthrough()` when validating. **Convention:** filename = event type = export name (mirror `PlayerDoneTurn.ts`), then re-run `generate-index.js` in that folder — `index.ts` is auto-generated and never hand-edited.
2. **`mcp-server/src/knowledge/store.ts`** — in `handleGameEvent`, forward the validated event data as the payload argument to `sendNotification` for every whitelisted event. This keeps the human's choices on the `HumanDecision` notification without making `HumanDecision` a special case.
3. **`mcp-server/src/server.ts`** — add `"HumanDecision"` to the `eventsForNotification` whitelist and send event payloads under a top-level `data` object instead of spreading payload fields over the notification metadata.
4. **`mcp-server/src/server.ts`** — start a **regular heartbeat timer** in `initialize()`: a `setInterval` (roughly 60–120 s) calling the existing `sendHeartbeat()`, cleared on server shutdown. This keeps the MCP client's 600-second undici body timeout from lapsing during a long human pause. Always on — the keepalive lives entirely server-side; no client-side ping loop.
5. **mcp-server Lua util** (new, beside `utils/lua/player-actions.ts`) — a `presentHumanDecision` `LuaFunction` with arguments `playerID`, `turn`, `optionsJson`, whose body fires `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`. The `OptionsReport` travels as a JSON **string argument** (never inline-interpolated into a script), passed through the same `sanitize()` used by `pushPlayerAction`.
6. **`mcp-server/src/tools/actions/present-decision.ts`** (new) — a tool taking `{PlayerID, Turn}` that **fetches the option landscape itself** — calling the `get-options` tool via `getTool("getOptions")` in **Flavor mode** (the only mode human control supports) — then JSON-stringifies the strongly-typed `OptionsReport` and calls the `presentHumanDecision` Lua function. Register it in `tools/index.ts` alongside the other action tools.

   **Why fetch server-side instead of taking `Options` as an argument:** the strategist's context is already built from `get-options`; passing that report back into the server as a tool argument would round-trip a large object across the MCP wire and lose its strong type at the tool boundary (it would have to be typed `z.any()`). Fetching here keeps the strong type intact and makes the tool independently testable — a test just calls `present-decision` with a `PlayerID` and asserts the fired payload, no fabricated `OptionsReport` needed. The game is paused across a human decision and `get-options` reads cached knowledge, so the panel sees the same snapshot the strategist's context was built from (spec §2's "exactly the option set the model would receive" still holds).

## Reuse

The `get-options` tool itself (invoked via `getTool("getOptions")`, the same intra-tool reuse pattern `get-options` uses for `getTechnology`/`getPolicy`); `sendNotification`'s `data` payload object and the `.passthrough()` client notification schema; the `LuaFunction` lazy-register/retry machinery in `mcp-server/src/bridge/lua-function.ts`; `pushPlayerAction`'s argument-passing and `sanitize` idiom; the existing `sendHeartbeat`.

## Verify (both directions, panel simulated)

- **Inbound:** with a session running, use `lua-executor` to fire `Game.BroadcastEvent("HumanDecision", {PlayerID=<id>, Turn=..., Rationale="test", StatusQuo=true})`; the vox-agents log shows the notification with `event:"HumanDecision"` and the choice fields intact under `data`.
- **Outbound:** temporarily add a `LuaEvents.VoxDeorumHumanDecision.Add(...)` print to `civ5-mod/Lua/VoxDeorumTest.lua`; call `present-decision` with the human seat's `PlayerID` (the tool fetches `get-options` itself); confirm the Flavor-mode options JSON arrives intact in `Lua.log` — a tech name with an apostrophe in the live data exercises the escaping path.
- **Heartbeat:** heartbeat log lines fire on the timer while the session idles.

## Done when

A synthetic in-game `HumanDecision` event arrives in vox-agents with its payload, a sample options report arrives in Lua intact, and the SSE channel stays up across a pause longer than 10 minutes.
