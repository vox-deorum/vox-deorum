# Stage 7.03: civ5-dll + mcp-server + vox-agents: transport plumbing

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). No visible UI change: this stage makes the two directions of the pinned contracts real and proves them with probes, so stage 04 is pure wiring.

## Objective

Stand up the transport under the contracts pinned in specs: the four game events flowing game → mcp-server → vox-agents, the four push functions flowing back through a generic Lua-call passthrough, correct size behavior in both directions, and the read-only reflush/paging path: verified end to end with a temporary probe handler and no panel involvement.

## Work items

1. **`civ5-dll/CvGameCoreDLL_Expansion2/CvConnectionService.cpp`: buffer/pool fixes.** (a) `BroadcastEventFromLua`: `DynamicJsonDocument message(2048)` → `65536` (line 2192; optionally the twins at 1820/2180 for symmetry): chat text and serialized deals overflow 2 KB today and ArduinoJson **silently drops members**. (b) The lua-call `argsDoc(65536)` (line 957) → `262144`, and check `doc.overflowed()` after deserialization/serialization on that path, failing the call with an explicit error instead of invoking Lua with dropped members: the capacity is a node pool, not a byte count, and nested transcript rows cost far more pool than wire. DLL rebuild; no save-format change.

2. **`mcp-server/src/tools/general/call-lua-function.ts`: the generic passthrough.** A thin tool `{ Name, Args[] }` → `bridgeManager.callLuaFunction(Name, Args)`, sibling of `lua-executor.ts`; register in `tools/index.ts`. This is the **only** new mcp-server surface for pushes: all push logic stays in vox-agents, and the mod owns the receiving functions (specs: transport stays transparent).

3. **`mcp-server/src/knowledge/schema/events/` + `mcp-server/src/server.ts`: event admission.** Four schemas modeled on `HumanDecision.ts` (numeric `PlayerID` required, `.passthrough()`): `DiplomacyPanelOpened.ts`, `DiplomacyChatMessage.ts`, `DiplomacyDealAction.ts`, `DiplomacyTranscriptRequest.ts`; register in the events index; add the four names to `eventsForNotification` (`server.ts:203`). Without both, events are dropped at the store gate or never forwarded.

4. **`civ5-mod/UI/VoxDeorumDiploPanel.lua`: push-function registration.** Register the four push functions (`VoxDeorumDiploBegin`/`Messages`/`Status`/`Delta`) via `Game.RegisterFunction`; each body fires the same-named `LuaEvents` and returns true. Add the panel-side row dedupe by transcript `ID`. (The functions land in the panel file now so stage 04's wiring is Lua-side trivial; a temporary probe listener printing payloads to `Lua.log` serves this stage's verify.)

5. **Paginated transcript read (shared extension).** No pagination exists anywhere today: the Web loads full history. Add optional `BeforeID` / `Limit` to the `read-transcript` tool and the `getDiplomaticMessages` getter (`mcp-server/src/tools/knowledge/read-transcript.ts`, `src/knowledge/getters/diplomatic-messages.ts`), returning the newest `Limit` rows (below `BeforeID` when paging) and enough to compute `hasMore`; add a `readTranscriptPage` wrapper beside `readTranscript` in `vox-agents/src/utils/diplomacy/transcript.ts`. Backward-compatible: no params = full history, existing callers unchanged.

6. **`vox-agents/src/envoy/ingame-bridge.ts`: the bridge skeleton.** A new module owned by `StrategistSession` (instantiated beside `humanDecisionBus`; new cases in the `mcpClient.onNotification` switch, `strategist-session.ts:188-230`). This stage implements:
   - **Three per-pair queues with separate ownership.** A refresh FIFO serializes read-only `PanelOpened` and transcript-page requests. An action FIFO serializes mutating chat and deal events. A push FIFO orders every Lua call back to the game. Refresh work can run while an action is active, so reopening can report `Begin.busy` immediately. The push FIFO can also run during an action, so stage 04 can stream without waiting for `runChatTurn` to finish. Deduplicate inbound events by generated event ID because pipe and SSE delivery can overlap.
   - **`DiplomacyPanelOpened` on the refresh FIFO:** call `readTranscriptPage`, never `openDiplomacyChat`, because opening compacts and rehydrates the live cache. Queue `Begin{hasEnvoy, busy, hasMore}` and ordered `Messages{append}` batches through the push FIFO. Pack batches to the approximate 32 KB wire budget. Read `hasEnvoy` from the live seat assignment and `busy` from item 7.
   - **`DiplomacyTranscriptRequest` on the refresh FIFO:** call `readTranscriptPage(BeforeID)`, then queue `Messages{prepend, hasMore}` through the push FIFO.
   - **`DiplomacyChatMessage` on the action FIFO:** use a temporary probe handler that appends through the transcript utilities and queues the committed row as `Messages{append}`. Mark it for deletion in stage 04. `runChatTurn` commits internally, so retaining the probe append would duplicate the message.
   - **Delimiter sanitization** (`!@#$%^!` stripped) on all pushed `Content`.
   - **`DiplomacyDealAction` on the action FIFO:** queue an error `Status` ("not wired yet") through the push FIFO. Stage 04 replaces this stub.

7. **`vox-agents/src/utils/diplomacy/chat-turn-commit.ts`: export `isThreadBusy(threadId)`.** The in-flight set is private; the only current way to observe it is acquiring the lock. A read-only accessor feeds `Begin.busy` (shared extension: the Web could use it too).

## Reuse

The `HumanDecision` event pipeline end to end (schema → whitelist → `onNotification`: the model for item 3 and the switch cases); `bridgeManager.callLuaFunction` and the `ConvertJsonToLuaValue` structured-args path (the `presentHumanDecision` mechanism); `lua-executor.ts` as the tool template; `readTranscript`/transcript utils (`transcript.ts`) extended, not bypassed; `Game.RegisterFunction` (`CvLuaGame.cpp`, exposed to all game Lua).

## Verify

With the game, bridge-service, mcp-server, and a vox-agents interactive session running, and a prior **Web** conversation seeded for the pair:

1. Fire a synthetic `DiplomacyPanelOpened` from `lua-executor` → the probe prints `Begin` + `Messages` batches in `Lua.log` containing the Web-seeded rows (shared-storage proof), with correct `hasMore`; a synthetic `DiplomacyTranscriptRequest` pages older rows.
2. A `DiplomacyChatMessage` > 2 KB arrives intact at the bridge (broadcast bump verified); the same message appears via the probe echo and afterwards in the Web chat view (same store).
3. A >100-message transcript reflushes as multiple ordered `append` batches, each under the wire budget; an artificially oversized single push fails loudly with the `overflowed()` error, not silently.
4. Text containing `!@#$%^!` survives both directions sanitized (typed into the event via `lua-executor`; embedded in a seeded transcript row).
5. Duplicate delivery: re-emitting the same generated event ID is ignored. Two rapid `PanelOpened` events produce ordered reflushes on the refresh and push FIFOs, including while a chat event occupies the action FIFO.
6. Restart the bridge-service mid-session: the mod-registered push functions are still callable afterwards (or the fallback re-registration hook fires): resolving the specs open risk.

## Done when

Every pinned contract crosses the wire correctly in both directions under probe, sizes and duplicates behave as specified, and the read-only reflush/paging path serves real transcripts: leaving stage 04 nothing but connecting real handlers to real UI.
