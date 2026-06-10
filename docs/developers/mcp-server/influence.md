# mcp-server — Tactical AI Influence

Most of the MCP server's tools observe the game. A handful change it — and the most interesting of those don't move units directly, they *steer the game's own AI*. The question this page answers is the one a developer keeps coming back to: when an agent calls one of these tools, which in-game AI decisions actually shift, and can a civilization the agent doesn't control feel the effect? The deep analysis — the per-tool impact tables, the auto-activation thresholds, the formulas — is kept as reference under `mcp-server/docs/influence/` and `mcp-server/docs/flavors/`; this page is the map to it.

## Why steering, not commanding

Vox Deorum doesn't replace Civilization V's AI with a language model — it nudges it. The game already has a rich tactical and strategic AI; the agent influences that AI's preferences and then lets the game act on them. This keeps the agent operating at the altitude a strategist actually works at ("favor expansion, prepare for war with this neighbor") rather than micromanaging every unit, and it means the steering propagates through all the systems the game's AI already wires together — city specialization, tech and policy choice, diplomacy, military production — instead of just one.

The cost is indirection: a tool sets a preference, and the effect shows up later, through the game's own update cycles, sometimes immediately and sometimes only on the next reevaluation. The reference tables exist to pin down exactly that propagation for each tool.

## The kinds of steering

The steering tools fall into a few families, each reaching the AI a different way.

- **Flavors and strategies.** `set-flavors`, `unset-flavors`, `set-strategy`, and `keep-status-quo` work through the game's flavor system — the weights the AI uses to value cities, tech, policies, wonders, and military production. Setting a flavor broadcasts to every subsystem that consumes it; setting a strategy applies flavor deltas plus a few hard-coded effects (yield targets, victory pursuit, production weights). These are the broadest-reaching tools, and they expire on their own after roughly ten turns unless refreshed. The full per-flavor subsystem matrix, the activation thresholds, and the one flavor that leaks across civilizations are in [`docs/influence/flavors.md`](../../../mcp-server/docs/influence/flavors.md).

- **Diplomacy.** `set-persona` rewrites a leader's personality fields, and `set-relationship` adjusts diplomatic modifiers toward another civilization. Persona changes are mostly felt by the civ itself (and estimated by others), while a relationship change can cascade through the whole opinion system — coop war, deals, voting, trade, settlement, and tactical decisions. The three-audience visibility picture (self, teammates, non-teammates) is detailed in [`docs/influence/diplomacy.md`](../../../mcp-server/docs/influence/diplomacy.md).

- **Forced choices.** `set-research` and `set-policy` override the AI's next technology or next policy pick. These are one-shot: they force the very next choice and then the AI resumes deciding for itself. The mechanics are in [`docs/influence/forced-choices.md`](../../../mcp-server/docs/influence/forced-choices.md).

- **Pacing and escape hatches.** `pause-game` and `resume-game` block or release a single named player's turn (see [bridge.md](bridge.md)). `lua-executor` runs arbitrary Lua in the game — the universal escape hatch, and therefore a trust boundary. And a couple of tools (`relay-message`, `set-metadata`) touch only the knowledge store and never reach the DLL at all, so they are visible to language-model agents but invisible to the game's AI.

## Cross-civilization reach

The subtle question is leakage: when an agent steers the civilization it speaks for, how much do *other* civilizations notice? The general answer is "less than you'd fear, by design." A foreign AI reads another leader's persona mostly through estimate helpers rather than the real values, and reads cross-civ opinion only through cached accessors rather than the raw modifier arrays. This deliberately localizes most steering to the targeted civ while still allowing the genuine cascades (the opinion system, the single nuke-related flavor) to propagate where the game intends them to. Which tool leaks where is exactly what the impact tables enumerate.

## The invariants the analysis rests on

The reference analysis is only valid while a set of structural assumptions hold — for example, that every mutating tool's schema carries an explicit, clamped `PlayerID`; that batched Lua scripts touch a single player rather than iterating all of them; that the Vox Deorum setters don't fire game-event hooks; and that the bridge runs on localhost without auth, which is what makes `lua-executor` and the global pause acceptable. These invariants are written out in `mcp-server/docs/TACTICAL_AI_INFLUENCE.md`; if a change to the server or the DLL violates one, the downstream impact claims need revisiting, and that file is where to check.

## Where the details live

This page is the conceptual map. The exact reference — impact matrix, per-tool propagation, per-flavor subsystem tables, thresholds, formulas, and invariants — stays inside the component:

- `mcp-server/docs/TACTICAL_AI_INFLUENCE.md` — the impact matrix and the invariants.
- `mcp-server/docs/influence/` — the per-family deep dives (flavors, diplomacy, forced choices).
- `mcp-server/docs/flavors/` — one file per flavor, naming the subsystems it steers.
- `mcp-server/docs/diplomacy/` — diplomacy mechanics (deal impossibility, war planning) the relationship tools interact with.

The tools themselves are described in [tools.md](tools.md) and listed with their parameters in `mcp-server/docs/TOOLS.md`.
