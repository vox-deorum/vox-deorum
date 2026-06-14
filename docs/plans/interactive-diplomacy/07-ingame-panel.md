# Stage 7 — In-game diplomacy panel (later phase — thin stub)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).
>
> **Status: later phase, not elaborated.** This stub records the intended shape; it is fleshed out into a full staged plan only when v1 (stages 1–6) is done and a panel build is scheduled. Everything before this is Web-first by design (specs §9).

## Objective

Add an **in-game diplomacy panel** so a human can hold the same conversation + deal-negotiation flow inside Civ V that the Web delivers in v1, reusing the same agents, mcp-server tools, deal system, and durable transcript (no real-time Web⇄game sync — they share storage and infrastructure, specs §6, Out of scope).

## Work items (sketch)

- A new mod UI addon under `civ5-mod/UI/`, modeled on the human-control panel (`civ5-mod/UI/VoxDeorumHumanPanel.lua` / `.xml`): a dormant addin that listens for a `LuaEvents` trigger and emits `Game.BroadcastEvent` on submit, registered via an `InGameUIAddin` entry in `VoxDeorum.modinfo` (run `update_md5.py`).
- **Reuse the game's own diplomatic trade screen** in-game where feasible (the base-game / EUI trade screen is *not* vendored in this repo, so the panel is a new addon, not a fork), surfacing the same per-term legality + estimates as the Web screen.
- mcp-server-side: present an incoming conversation/proposal into the panel (a `present-*` Lua function in the `present-decision.ts` idiom) and route the human's reply/deal back through `append-message` / `enact-agent-deal`.
- Live LLM response delivery needs a separate in-game pathway. `append-message` is archival only; it does not stream or push LLM replies into Civ V. The panel must receive responses through a dedicated presentation/notification bridge while still writing the durable transcript through the same store.
- Mirror the human-control watch-items: SSE liveness across the pause, `lua_call` arg-buffer size for the deal payload, graceful degradation on a deserialize failure.

## Verify

A human playing in-game can open the diplomacy panel against an LLM civ, converse, negotiate a deal mirroring the trade screen, and have an accepted deal enacted through the same stage-6 entrypoint — with the transcript shared with the Web.
