# civ5-mod — In-Game UI

This page is about what Vox Deorum looks like from *inside* the game: how an AI player's reasoning surfaces on screen, and how an observer can tap that stream. The mod itself is deliberately thin on UI — it ships no custom windows — so most of the "interface" is the game's existing surfaces (the replay log, the top panel) being driven by decisions that arrive from outside. The conversational, spokesperson-facing chat experience is produced by the agents, not the mod; this page describes the mod's side of it and points to where the rest lives.

## What a player sees

Two of the game's built-in surfaces carry Vox Deorum's presence in-game:

- **The replay log.** When the system pushes a strategic action into the game, it can also write that action's summary and rationale into the player's replay messages. Reviewing the game afterward, those entries read as a running account of *why* each AI made its moves — "what changed, and the rationale" — rather than the bare facts the stock replay records. This is the most durable in-game trace of agent reasoning.

- **The active-player top panel.** As decisions arrive, the top panel auto-switches to show the player whose rationale just landed, so attention follows whichever civilization the system is currently narrating. The mod observes that switch (`VD_TopPanelAutoSwitchedPlayer`) and forwards it to the capture pipeline so generated video can stay in sync with what is on screen; see [lua-hooks.md](lua-hooks.md) for the forwarding mechanics.

## Chat and spokespersons

The chat-with-a-spokesperson experience — talking to a civilization's envoy and getting answers in character — is **driven by the [vox-agents](../vox-agents/) framework, not by this mod.** The envoy and diplomat agents there generate the spokesperson's words; the strategist agents generate the per-turn decisions and rationale. This mod's role is only to give those words a way into the game: the strategic decisions become in-game `LuaEvents` and replay entries through the observer path described in [lua-hooks.md](lua-hooks.md). When reading or changing the player-facing chat, keep the terminology aligned with the agents' own `envoy.md` and `ui.md` pages — the "spokesperson" is an agent concept that this layer renders the output of.

For the player's-eye view of holding those conversations and what to expect on screen, see the players' guide to [playing](../../players/playing.md).

## The observer API

Anything that wants to react to AI decisions in-game — a custom HUD, an analytics overlay, a debugging panel — does it by listening to the same two `LuaEvents` the mod's reference addin listens to: `VoxDeorumPlayerInfo` (which model/strategist is running a player) and `VoxDeorumAction` (each strategic action, with its turn, type, summary, and rationale). These are fire-and-forget: the game stores nothing, so an observer mod manages its own state and can reconstruct turn boundaries from the `turn` parameter changing. `Lua/VoxDeorumTest.lua` is the minimal worked example of consuming them.

The **exact** event contract — every parameter, the full list of action types, turn-tracking guidance, and a complete example observer mod — is reference material that stays with the component, in `../../../civ5-mod/docs/observer-api.md`. Consult that file when building against the API; this page only sketches the story. For debugging Lua at the C level while doing so, the mod also keeps `../../../civ5-mod/docs/lua_c_debug.md`.
