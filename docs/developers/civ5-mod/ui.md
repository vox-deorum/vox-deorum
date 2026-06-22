# civ5-mod — In-Game UI

This page covers what Vox Deorum looks like from *inside* the game: how an AI player's reasoning surfaces on screen, and how an observer can tap that stream.

The mod is deliberately thin on UI. Most of the "interface" is the game's existing surfaces — the replay log and the top panel — being driven by decisions that arrive from outside. The one custom window it ships is the **human decision panel**, loaded only in [human-control mode](#the-human-decision-panel) so a person can take a strategist seat. The conversational, spokesperson-facing chat experience is produced by the agents, not the mod; this page describes the mod's side and points to where the rest lives.

## What a player sees

Two of the game's built-in surfaces carry Vox Deorum's presence in-game:

- **The replay log.** When the system pushes a strategic action into the game, it can also write that action's summary and rationale into the player's replay messages. Reviewing the game afterward, those entries read as a running account of *why* each AI made its moves — "what changed, and the rationale" — rather than the bare facts the stock replay records. This is the most durable in-game trace of agent reasoning.
- **The active-player top panel.** As decisions arrive, the top panel auto-switches to show the player whose rationale just landed, so attention follows whichever civilization the system is currently narrating. The mod observes that switch (`VD_TopPanelAutoSwitchedPlayer`) and forwards it to the capture pipeline so generated video can stay in sync with what is on screen. See [lua-hooks.md](lua-hooks.md) for the forwarding mechanics.

## Chat and spokespersons

The chat-with-a-spokesperson experience — talking to a civilization's envoy and getting answers in character — is **driven by the [vox-agents](../vox-agents/) framework, not by this mod.** The envoy and diplomat agents there generate the spokesperson's words; the strategist agents generate the per-turn decisions and rationale.

This mod's role is only to give those words a way into the game: the strategic decisions become in-game `LuaEvents` and replay entries through the observer path described in [lua-hooks.md](lua-hooks.md). When reading or changing the player-facing chat, keep the terminology aligned with the agents' own `envoy.md` and `ui.md` pages — the "spokesperson" is an agent concept that this layer renders the output of.

For the player's-eye view of holding those conversations and what to expect on screen, see the players' guide to [playing](../../players/playing.md).

## The human decision panel

In **human-control mode** — when a session assigns the [`human-strategist`](../vox-agents/strategist.md#human-control-mode) to a seat — the mod loads a custom in-game panel that lets a person occupy a strategist seat. The panel is `UI/VoxDeorumHumanPanel.lua` and `.xml`, with a small `VoxDeorumHumanTrigger` to surface it.

The game auto-plays every civ as in observe mode, but pauses at the human's decision turns until they submit. The panel is dormant otherwise: the addins are always present in the mod but stay hidden until a decision is due.

The panel holds **no game logic**. On each decision turn it is handed the turn's option landscape by the [`present-decision`](../mcp-server/tools.md) tool — the same `get-options` payload and descriptive text the LLM's context is built from — as a `VoxDeorumHumanDecision(playerID, turn, options)` LuaEvent. It renders exactly that: the valid grand strategy, flavors, research, policy, persona, and relationship options for the human's own civ, plus a single free-text rationale field.

When the human submits (or explicitly keeps the status quo), the panel measures wall-clock deliberation time and fires a fire-and-forget `Game.BroadcastEvent("HumanDecision", …)`. That carries the choices, the rationale, and the deliberation time back out through the existing DLL → bridge → MCP path to the waiting strategist. The panel also reports session state — whose turn the game is waiting on, that a decision is pending, the last decision, and submission confirmation.

### Fairness by omission

Human-control mode does not load the observer-facing UI (the AI Observer mod). So the replay overlays, rationale displays, and top-panel auto-switch that surface *other* players' reasoning in observe mode simply never render — the `VoxDeorumAction` / `VoxDeorumPlayerInfo` events still fire but reach no consumer.

The decision panel itself renders only the human civ's own data. The observer-UI override (`Game.SetObserverUIOverridePlayer`) pins the view to the human's civ rather than auto-switching to whoever just acted. The full design lives in `docs/plans/human-control/`.

## The observer API

Anything that wants to react to AI decisions in-game — a custom HUD, an analytics overlay, a debugging panel — does it by listening to the same two `LuaEvents` the mod's reference addin listens to:

- `VoxDeorumPlayerInfo` — which model/strategist is running a player.
- `VoxDeorumAction` — each strategic action, with its turn, type, summary, and rationale.

These are fire-and-forget: the game stores nothing, so an observer mod manages its own state and can reconstruct turn boundaries from the `turn` parameter changing. `Lua/VoxDeorumTest.lua` is the minimal worked example of consuming them.

The **exact** event contract — every parameter, the full list of action types, turn-tracking guidance, and a complete example observer mod — is reference material that stays with the component, in `../../../civ5-mod/docs/observer-api.md`. Consult that file when building against the API; this page only sketches the story. For debugging Lua at the C level while doing so, the mod also keeps `../../../civ5-mod/docs/lua-c-debug.md`.
