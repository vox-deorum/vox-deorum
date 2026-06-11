# Stage 2 — mcp-server: decision round-trip plumbing ✅ DONE

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

> **Status: implemented.** All work items landed; `tsc --noEmit` passes. What was built:
> - [`knowledge/schema/events/HumanDecision.ts`](../../../mcp-server/src/knowledge/schema/events/HumanDecision.ts) — permissive zod schema (required `PlayerID` + `Rationale`; everything else optional). [`events/index.ts`](../../../mcp-server/src/knowledge/schema/events/index.ts) regenerated.
> - [`server.ts`](../../../mcp-server/src/server.ts) — `"HumanDecision"` added to `eventsForNotification`; an always-on keepalive `setInterval` (`HEARTBEAT_INTERVAL_MS = 90_000`, comfortably under the 600 s body timeout) started in `initialize()`, `unref()`'d, and cleared on shutdown.
> - [`utils/lua/present-decision.ts`](../../../mcp-server/src/utils/lua/present-decision.ts) — `presentHumanDecision` `LuaFunction` firing `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`, with `optionsJson` passed through `sanitize()`.
> - [`tools/actions/present-decision.ts`](../../../mcp-server/src/tools/actions/present-decision.ts) — the outbound tool, registered in [`tools/index.ts`](../../../mcp-server/src/tools/index.ts).
>
> **Deviations from the original work items:**
> 1. **Notification payload forwarding is generic, not a `HumanDecision` special-case.** [`store.ts`](../../../mcp-server/src/knowledge/store.ts) now forwards the validated event `data` as `sendNotification`'s extra-params argument for *every* whitelisted event, not just `HumanDecision`. Simpler than the planned special-case and harmless: `sendNotificationTo` writes the canonical lowercase fields (`event`/`playerID`/`turn`/`latestID`) **before** spreading the payload, and the payload's capitalized keys (`PlayerID`/`Turn`/…) don't collide, so existing consumers are unaffected while the human's choices ride along on the `HumanDecision` notification.
> 2. **`present-decision` fetches its own options (the round-trip fix).** The original work item had the tool take `{PlayerID, Turn, Options}` and stringify a caller-supplied `OptionsReport`. That marshalled the report **out** of `get-options` and back **into** the server, degrading the strongly-typed `OptionsReport` to an opaque `z.record(z.string(), z.any())` at the tool boundary. The tool now takes `{PlayerID, Turn}` and calls the `get-options` tool itself in Flavor mode — keeping the strong type server-side end to end. Because the game is paused across a human decision and `get-options` reads cached knowledge, this is the same snapshot the strategist's context is built from (see revised work item 6).

## Objective

Both directions of the decision round-trip work at the mcp-server layer, tested together with the panel simulated:

- **(a) Inbound:** a `Game.BroadcastEvent("HumanDecision", {...})` (injected via the `lua-executor` tool) survives the store's schema gate and reaches vox-agents as a notification carrying the human's choices.
- **(b) Outbound:** vox-agents can push a turn's `OptionsReport` into the game for the panel.
- **(c) Liveness:** the SSE channel survives an unbounded human pause.

## Work items

1. **`mcp-server/src/knowledge/schema/events/HumanDecision.ts`** (new) — a permissive zod schema: `PlayerID` (number) and `Rationale` (string) required; everything else optional — `Turn`, `StatusQuo`, and the Flavor-mode decision fields (`GrandStrategy` / `Flavors` / `Technology` / `Policy` / `Persona` / `Relationships`). Human control runs in **Flavor mode only**, so there is no `Mode` field and none of the legacy Strategy-mode `EconomicStrategies` / `MilitaryStrategies` (note `GrandStrategy` is itself a Flavor-mode field). A numeric `PlayerID` is what routes the stored event onward to a notification; the store already applies `.passthrough()` when validating. **Convention:** filename = event type = export name (mirror `PlayerDoneTurn.ts`), then re-run `generate-index.js` in that folder — `index.ts` is auto-generated and never hand-edited.
2. **`mcp-server/src/knowledge/store.ts`** — in `handleGameEvent`, forward the validated event data as `sendNotification`'s extra-params argument so the human's choices ride the `HumanDecision` notification. *(As built, the final notification call passes `data` for every whitelisted event rather than special-casing `HumanDecision` — see Deviation 1.)*
3. **`mcp-server/src/server.ts`** — add `"HumanDecision"` to the `eventsForNotification` whitelist.
4. **`mcp-server/src/server.ts`** — start a **regular heartbeat timer** in `initialize()`: a `setInterval` (roughly 60–120 s) calling the existing `sendHeartbeat()`, cleared on server shutdown. This keeps the MCP client's 600-second undici body timeout from lapsing during a long human pause. Always on — the keepalive lives entirely server-side; no client-side ping loop.
5. **mcp-server Lua util** (new, beside `utils/lua/player-actions.ts`) — a `presentHumanDecision` `LuaFunction` with arguments `playerID`, `turn`, `optionsJson`, whose body fires `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`. The `OptionsReport` travels as a JSON **string argument** (never inline-interpolated into a script), passed through the same `sanitize()` used by `pushPlayerAction`.
6. **`mcp-server/src/tools/actions/present-decision.ts`** (new) — a tool taking `{PlayerID, Turn}` that **fetches the option landscape itself** — calling the `get-options` tool via `getTool("getOptions")` in **Flavor mode** (the only mode human control supports) — then JSON-stringifies the strongly-typed `OptionsReport` and calls the `presentHumanDecision` Lua function. Register it in `tools/index.ts` alongside the other action tools.

   **Why fetch server-side instead of taking `Options` as an argument:** the strategist's context is already built from `get-options`; passing that report back into the server as a tool argument would round-trip a large object across the MCP wire and lose its strong type at the tool boundary (it would have to be typed `z.any()`). Fetching here keeps the strong type intact and makes the tool independently testable — a test just calls `present-decision` with a `PlayerID` and asserts the fired payload, no fabricated `OptionsReport` needed. The game is paused across a human decision and `get-options` reads cached knowledge, so the panel sees the same snapshot the strategist's context was built from (spec §2's "exactly the option set the model would receive" still holds).

## Reuse

The `get-options` tool itself (invoked via `getTool("getOptions")`, the same intra-tool reuse pattern `get-options` uses for `getTechnology`/`getPolicy`); `sendNotification`'s extra-params spread and the `.passthrough()` client notification schema; the `LuaFunction` lazy-register/retry machinery in `mcp-server/src/bridge/lua-function.ts`; `pushPlayerAction`'s argument-passing and `sanitize` idiom; the existing `sendHeartbeat`.

## Verify (both directions, panel simulated)

- **Inbound:** with a session running, use `lua-executor` to fire `Game.BroadcastEvent("HumanDecision", {PlayerID=<id>, Turn=..., Rationale="test", StatusQuo=true})`; the vox-agents log shows the notification with `event:"HumanDecision"` and the choice fields intact.
- **Outbound:** temporarily add a `LuaEvents.VoxDeorumHumanDecision.Add(...)` print to `civ5-mod/Lua/VoxDeorumTest.lua`; call `present-decision` with the human seat's `PlayerID` (the tool fetches `get-options` itself); confirm the Flavor-mode options JSON arrives intact in `Lua.log` — a tech name with an apostrophe in the live data exercises the escaping path.
- **Heartbeat:** heartbeat log lines fire on the timer while the session idles.

## Done when

A synthetic in-game `HumanDecision` event arrives in vox-agents with its payload, a sample options report arrives in Lua intact, and the SSE channel stays up across a pause longer than 10 minutes.
