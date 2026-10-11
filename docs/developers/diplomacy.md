# Interactive diplomacy

Negotiating with an AI leader in stock Civilization V means arranging items on a trade screen and hoping the AI's valuation says yes. Interactive diplomacy replaces that with a conversation: the player talks to an LLM-voiced **diplomat**, the diplomat's **negotiator** decides what terms its civilization will accept, and the resulting deal is enacted by the game itself.

This page is for a contributor who needs to follow a proposal from an agent to the player's screen and back. The subsystem spans four components, so no component folder tells the whole story. Read [protocol.md](protocol.md) first if the layer boundaries are unfamiliar, and [architecture.md](architecture.md) for why those layers exist. Diplomacy rides on the transports described there and opens no private channel of its own.

| Component | Owns |
| --- | --- |
| `civ5-mod` | The in-game conversation panel and deal screen, and their transport drivers. |
| `civ5-dll` | The Lua bindings those surfaces cross the pipe with, plus `Deal:Enact` and `Player:SetPromise`. |
| `mcp-server` | The durable transcript store, the pinned deal contract, `inspect-deal`, and the transactional outcome tools. |
| `vox-agents` | The diplomat and negotiator agents, the term ledger, and the conversation-turn machinery both clients share. |

There are two clients, and both are thin. The in-game panel and the dashboard's chat and deal views render a conversation that vox-agents runs. `vox-agents/src/utils/diplomacy/deal/deal-actions.ts` exists so that accepting a deal means the same thing whichever screen asked for it.

## Opening a conversation

`civ5-mod/UI/VoxDeorumConverse.lua` adds a **Converse** button beside Discuss and Trade on the leaderhead screen. Pressing it shows the panel, and the panel's first presentation calls `VoxDeorumDiploTransport.EnsureRegistered()`.

That registration is the inbound half of the transport. It uses the DLL's `Game.RegisterFunction` binding (`civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaGame.cpp`, forwarding to `CvConnectionService`) to publish four Lua functions by name so the AI stack can call them later:

| Function | Carries |
| --- | --- |
| `VoxDeorumDiploBegin` | The start of a transcript reflush, plus whether the pair has an envoy and whether it is busy. |
| `VoxDeorumDiploMessages` | A batch of durable transcript rows, appended or prepended. |
| `VoxDeorumDiploStatus` | The agent's activity state: composing, reasoning, using a tool, idle, or error. |
| `VoxDeorumDiploDelta` | The reply text accumulated so far, throttled to about once a second. |

`civ5-mod/UI/VoxDeorumDiploTransport.lua` makes the only `Game.RegisterFunction` calls in the mod. The deal screen has its own driver but registers nothing: it resolves a pending action by watching the rows that arrive through these same functions.

From the dashboard, the same conversation opens through `POST /api/agents/chat` (`vox-agents/src/web/chat/factory.ts`). Threads are keyed by the ordered player pair, so both clients see one conversation.

## Crossing into the AI stack

Everything the game sends outward goes through one binding, `Game.BroadcastEvent(name, payload, true)`. The third argument makes the DLL stamp a turn-scoped event id, which the MCP server's id-based storage and resume logic require. Four event names make up the game-side vocabulary:

- `DiplomacyPanelOpened`: send me this conversation.
- `DiplomacyTranscriptRequest`: send me an older page, before this row id.
- `DiplomacyChatMessage`: the player said this.
- `DiplomacyDealAction`: propose, counter, accept, or reject.

From there each event follows the ordinary event path of [protocol.md](protocol.md): connection service, bridge, MCP server, then an MCP notification. The MCP server validates the wire shape against a schema in `mcp-server/src/knowledge/schema/events/`, stores the event, and forwards it. It does not act on it.

`vox-agents/src/utils/diplomacy/ingame/ingame-bridge.ts` is the listener that does. It deduplicates the pipe and SSE overlap by event id, then puts the work on one of two per-pair queues: an **action** queue for anything that mutates, and a **push** queue for the Lua calls heading back. A model run holds the thread lock for as long as it takes, so keeping the two separate is what stops a streaming callback from deadlocking against the run that produced it.

One quirk is worth knowing: while the leaderhead or trade scene is up, the engine stops ticking `CvGame::update`, so nothing drains the DLL's incoming queue. Both Lua screens call `Game.ProcessConnectionMessages()` from their per-frame update to drain it themselves.

## The diplomat answers

A chat message becomes a call to `runChatTurn` (`vox-agents/src/web/chat/turn.ts`), the same function the dashboard route calls. The voiced agent is a `Diplomat` (`vox-agents/src/envoy/agents/diplomat.ts`), a [live envoy](vox-agents/agents/envoys.md) restricted to diplomacy threads.

The diplomat never writes free text. It speaks through the `send-message` tool (`vox-agents/src/envoy/tools/send-message-tool.ts`), which appends the durable transcript row as part of delivering the line. A thread will not even open for an agent that could reply any other way. `close-conversation` stages a farewell that the turn commits last, and a closed conversation cannot be reopened until a later turn.

The diplomat has no authority over terms. When talk turns to a deal, it hands off through `call-negotiator`.

## The negotiator decides terms

`Negotiator` (`vox-agents/src/envoy/agents/negotiator.ts`) is the sole decider of deal terms. It never reads the human's free text; the diplomat writes it a briefing. Its context is assembled from three things: the civilization's strategy and briefings, a fresh `inspect-deal` of what is tradable and what each item is worth, and whatever proposal is on the table.

It must finish by calling exactly one of `accept-deal`, `propose-deal`, or `reject-deal`, each returning an inward rationale plus one outward sentence for the diplomat to voice. Which negotiator runs is decided per seat by `resolve-negotiator.ts`, so a seat can configure its own.

The interesting part is how it authors terms. It does not emit structured items with player ids. It writes two lists of plain strings, `Give` and `Receive`, copied from a rendered menu. `vox-agents/src/envoy/ledger/` owns that surface:

- `give-receive-menu.ts` renders every legal term for each side, with advisory values and durations.
- `deal-ledger.ts` renders the deal currently on the table in the same first-person vocabulary.
- `ledger-grammar.ts` parses one authored string (`Gold 100`, `Iron 2`, `Third-Party Peace with Rome`) into a canonical label plus an optional name and quantity.
- `ledger-resolver.ts` turns parsed terms into directed, id-bearing items, gates them against the same tradable range the model was shown, and returns correctable errors with suggestions when an entry misses.

The labels the menu renders and the labels the grammar accepts come from the same tables, so the model is always copying something the parser recognizes.

## Back to the screen

Results travel back as ordinary Lua calls: `ingame-bridge.ts` calls the MCP `call-lua-function` tool with one of the four registered names. On the way out, transcript markdown is converted to Civ 5 markup (`vox-agents/src/utils/diplomacy/ingame/civ5-markup.ts`) and batches are trimmed to a wire budget, because the game cannot render markdown and the pipe has limits.

Separately, an outcome the player has not seen becomes a native game notification through `vox-agents/src/utils/diplomacy/ingame/notify.ts` and the `post-notification` tool. That rule is deliberately narrow: a turn that completed cleanly still notifies nothing unless it produced a new durable row.

## Enacting the deal

An accept from either client goes to `acceptDealAction`, which takes the thread lock and calls the MCP `enact-agent-deal` tool. That tool does everything in one serialized store transaction: confirm the proposal is still the current open one and aimed at the right recipient, run the enactment, and write the `deal-accept` and `deal-enacted` rows. Losing a race returns a structured conflict rather than an error, so callers can distinguish it from a real failure.

Enactment runs `mcp-server/lua/inspect-deal.lua` in enact mode. That script is not shipped with the mod: `mcp-server/src/bridge/lua-function.ts` reads it at first use, wraps it in a `Game.RegisterFunction("inspectDeal", ...)` registration, and pushes it into the running game, after which the MCP server calls it by name.

In enact mode the script validates every term, then calls `Deal:Enact` and `Player:SetPromise`, both Vox Deorum additions in `civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaDeal.cpp` and `CvLuaPlayer.cpp`. `Deal:Enact` is a thin wrapper over the game's `FinalizeMPDeal` with acceptance pre-decided and the human-to-human path forced, so the AI's political opinion is never consulted while structural legality still holds.

When the gamecore finalizes the deal, `CvGameDeals::ActivateDeal` fires a `DealMade` event back out through `CvConnectionService` (`civ5-dll/CvGameCoreDLL_Expansion2/CvDealClasses.cpp`). That event is stored in the knowledge store but not pushed as a notification; it is how the rest of the system later learns a deal exists, whoever made it.

Rejection is the mirror. `rejectDealAction` calls `reject-agent-deal`, which owns rejection idempotency and staleness in its own transaction and never touches game state. Either endpoint may reject; the proposer doing so is a retraction.

The DLL also offers `Game.CallExternal`, which lets game Lua invoke a registered external endpoint and block on the answer. Diplomacy deliberately does not use it: broadcast events plus registered push functions keep the game from ever blocking on a model run.

## The data model

**A transcript message** is one row in the `DiplomaticMessages` knowledge table (`mcp-server/src/knowledge/schema/timed.ts`). There is exactly one conversation per player pair, so a row is keyed by `Player1ID` and `Player2ID` (min and max, with `-1` reserved for an observer) rather than by a thread id. It carries a `SpeakerID`, a `MessageType`, free-text `Content`, a JSON `Payload`, and the game `Turn`.

The wire projection lives in `mcp-server/src/utils/transcript-schema.ts`, which also pins the seven message types: `text`, `close`, `deal-proposal`, `deal-counter`, `deal-accept`, `deal-reject`, and `deal-enacted`.

The store is append-only and carries no status column, which leads to the rule that governs the rest of the subsystem: **deal state is derived, never stored**. `vox-agents/src/utils/diplomacy/deal/deal-reduce.ts` reduces the ordered rows into the active proposal (the latest proposal or counter) and its status (`open`, `rejected`, `accepted`, `enacted`, or `none`), reading which later rows reference that proposal through `Payload.ProposalMessageID`. The in-game panel carries a small Lua port of that same reducer, which has to stay in step with it.

**A deal** is the `Payload.Deal` of a proposal or counter row, pinned by `mcp-server/src/utils/deal-schema.ts` and its zod-free vocabulary half `deal-metadata.ts` (the split exists so the browser bundle can import the tables without zod). A deal holds two kinds of terms:

- **Trade items** map onto the game's `TradeableItems` enum: gold, gold per turn, resources, cities, techs, maps, embassies, open borders, the pacts and treaties, third-party peace and war, vote commitments, and vassalage. Each item is directed, giving from `fromPlayerID` to `toPlayerID`.
- **Promises** are a Vox Deorum addition with no enum entry, applied at enactment through `Player:SetPromise`. Only the five the tactical AI actually honors are authorable: military, expansion, border, no digging, and cooperative war.

Durations and display names are never author-supplied. They are stamped server-side from a fresh inspection before the row is archived, so a stored deal renders correctly without a live game. `symmetrizeDeal` completes a mutual agreement listed on one side onto both.

When the two civs are at war, every deal between them is a peace deal: `appendDealProposal` (`vox-agents/src/utils/diplomacy/deal/deal.ts`) adds a Peace Treaty on both sides when the author left one out, then re-inspects so the treaty's legality and value are real. While the game's war lock lasts, that inspection reports the treaty illegal with a locked-into-war reason, so the whole proposal is refused before anything is archived.

A proposal row also carries `Value1` and `Value2`: per-item snapshots of what each item was worth to each ordered player at proposal time. These are advisory: the game's own trade valuation gates nothing on the agent path.

**An inspection** is the read-only view of live game state. `inspect-deal` (`mcp-server/src/tools/knowledge/inspect-deal.ts`) returns the full tradable range for each side, per-term legality with reasons, both-direction value estimates, and per-promise agreeability factors, all computed on a scratch deal that is never activated. Nothing about it is stored; it is fetched fresh wherever it is needed.

**A ledger term** is the negotiator's plain-string view of all of the above. It exists only inside `vox-agents/src/envoy/ledger/`; nothing durable ever holds one.

## Where the seams are

**Adding a trade item type** touches the contract, the game bridge, and every renderer:

1. `mcp-server/src/utils/deal-metadata.ts`: the `TRADE_ITEM_TYPES` entry, plus the duration table, the agreement metadata, and the targeted or symmetric sets where they apply.
2. `mcp-server/lua/inspect-deal.lua`: the mapping to `TradeableItems`, the tradable-range probe, and the enact-mode constructor call.
3. `mcp-server/src/utils/deal-format.ts`: the friendly label agents and prompts read.
4. `vox-agents/src/envoy/ledger/ledger-grammar.ts` and `ledger-resolver.ts`: the authored label and how it resolves to a directed item, plus `give-receive-menu.ts` if it needs its own menu category.
5. `civ5-mod/UI/VoxDeorumDealScreen.lua` and `VoxDeorumDealUtils.lua`: building and reading the native deal object, and validating the wire payload.
6. `vox-agents/ui/src/utils/deal/`: the dashboard editor's catalog and renderer.

Drift-guard tests in `vox-agents/tests/mock/envoy/ledger/` assert that the ledger labels still match the canonical metadata tables, so a mismatch between steps 1 and 4 fails the suite rather than surfacing as an unparseable term at runtime.

**Adding a conversation action** driven from the game is shorter:

1. Broadcast a new event name from the mod's transport driver, always with the id flag set, and add a matching schema under `mcp-server/src/knowledge/schema/events/` plus an entry in the server's notification list.
2. Accept it in `ingame-bridge.ts`: extend the supported-event check, parse its payload, and route it to the action queue if it mutates or the push queue if it only reads.
3. If it produces something durable, give it a `MessageType` in `transcript-schema.ts` and decide which tool may write it. `append-message` is archival only and refuses the three terminal deal outcomes. Those belong to `enact-agent-deal` and `reject-agent-deal`, which is what keeps proposal state decided in one transaction instead of by a racing caller.

If the action must answer the game, prefer an existing registered push function. A new one means another `Game.RegisterFunction` call in `VoxDeorumDiploTransport.lua`.

## Where the per-component detail lives

- [vox-agents/agents/envoys.md](vox-agents/agents/envoys.md) for envoys, threads, and how a chat reaches an agent.
- [mcp-server/tools.md](mcp-server/tools.md) for how MCP tools are organized and built, and [mcp-server/knowledge.md](mcp-server/knowledge.md) for the store the transcript lives in.
- [civ5-mod/diplomacy-panel.md](civ5-mod/diplomacy-panel.md) and [civ5-mod/deal-screen.md](civ5-mod/deal-screen.md) for the in-game surfaces.

Implementation sequencing and the original specifications stay in `docs/plans/interactive-diplomacy/`.
