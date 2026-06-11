# Stage 2 — mcp-server: decision round-trip plumbing

> Part of the human-control plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Both directions of the decision round-trip work at the mcp-server layer, tested together with the panel simulated:

- **(a) Inbound:** a `Game.BroadcastEvent("HumanDecision", {...})` (injected via the `lua-executor` tool) survives the store's schema gate and reaches vox-agents as a notification carrying the human's choices.
- **(b) Outbound:** vox-agents can push a turn's `OptionsReport` into the game for the panel.
- **(c) Liveness:** the SSE channel survives an unbounded human pause.

## Work items

1. **`mcp-server/src/knowledge/schema/events/HumanDecision.ts`** (new) — a permissive zod schema: `PlayerID` (number) and `Rationale` (string) required; everything else optional — `Turn`, `StatusQuo`, and the Flavor-mode decision fields (`GrandStrategy` / `Flavors` / `Technology` / `Policy` / `Persona` / `Relationships`). Human control runs in **Flavor mode only**, so there is no `Mode` field and none of the legacy Strategy-mode `EconomicStrategies` / `MilitaryStrategies` (note `GrandStrategy` is itself a Flavor-mode field). A numeric `PlayerID` is what routes the stored event onward to a notification; the store already applies `.passthrough()` when validating. **Convention:** filename = event type = export name (mirror `PlayerDoneTurn.ts`), then re-run `generate-index.js` in that folder — `index.ts` is auto-generated and never hand-edited.
2. **`mcp-server/src/knowledge/store.ts`** — in `handleGameEvent`, special-case `HumanDecision` at the final notification call so the validated event data is forwarded as `sendNotification`'s extra-params argument (the generic path sends only type/player/turn/id). Leave all other event types on the generic call.
3. **`mcp-server/src/server.ts`** — add `"HumanDecision"` to the `eventsForNotification` whitelist.
4. **`mcp-server/src/server.ts`** — start a **regular heartbeat timer** in `initialize()`: a `setInterval` (roughly 60–120 s) calling the existing `sendHeartbeat()`, cleared on server shutdown. This keeps the MCP client's 600-second undici body timeout from lapsing during a long human pause. Always on — the keepalive lives entirely server-side; no client-side ping loop.
5. **mcp-server Lua util** (new, beside `utils/lua/player-actions.ts`) — a `presentHumanDecision` `LuaFunction` with arguments `playerID`, `turn`, `optionsJson`, whose body fires `LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)`. The `OptionsReport` travels as a JSON **string argument** (never inline-interpolated into a script), passed through the same `sanitize()` used by `pushPlayerAction`.
6. **`mcp-server/src/tools/actions/present-decision.ts`** (new) — a tool taking `{PlayerID, Turn, Options}` that JSON-stringifies `Options` (the Flavor-mode `OptionsReport`) and calls the `presentHumanDecision` Lua function. Register it in `tools/index.ts` alongside the other action tools.

## Reuse

`sendNotification`'s extra-params spread and the `.passthrough()` client notification schema; the `LuaFunction` lazy-register/retry machinery in `mcp-server/src/bridge/lua-function.ts`; `pushPlayerAction`'s argument-passing and `sanitize` idiom; the existing `sendHeartbeat`.

## Verify (both directions, panel simulated)

- **Inbound:** with a session running, use `lua-executor` to fire `Game.BroadcastEvent("HumanDecision", {PlayerID=<id>, Turn=..., Rationale="test", StatusQuo=true})`; the vox-agents log shows the notification with `event:"HumanDecision"` and the choice fields intact.
- **Outbound:** temporarily add a `LuaEvents.VoxDeorumHumanDecision.Add(...)` print to `civ5-mod/Lua/VoxDeorumTest.lua`; call `present-decision` with a sample `OptionsReport`; confirm the JSON arrives intact in `Lua.log` — include a tech name with an apostrophe to exercise escaping.
- **Heartbeat:** heartbeat log lines fire on the timer while the session idles.

## Done when

A synthetic in-game `HumanDecision` event arrives in vox-agents with its payload, a sample options report arrives in Lua intact, and the SSE channel stays up across a pause longer than 10 minutes.
