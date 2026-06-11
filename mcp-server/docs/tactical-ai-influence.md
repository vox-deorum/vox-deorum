# Tactical AI Influence

How MCP tools reach the Civilization V tactical AI. This doc answers: **which in-game AI decisions does each tool actually shift, and can a non-LLM civ feel the effect?**

For tool schemas and arguments, see [tools.md](tools.md). For the knowledge persistence layer, see [knowledge.md](knowledge.md). For per-flavor deep dives, see [flavors/](flavors/).

---

## Impact matrix

| Tool | AI subsystems steered | Propagation | Cross-civ cascade |
|---|---|---|---|
| `set-flavors` / `unset-flavors` | `CvFlavorManager` broadcasts to all `CvFlavorRecipient`s — cities, tech, policy, wonder, grand strategy, economic, military AI | Immediate `FlavorUpdate` callback; queues rebuild next turn; auto-expire ~10 turns | `FLAVOR_USE_NUKE` only |
| `set-strategy` | Flavor deltas via `SetUsingStrategy` + hard-coded: `CvCitySpecializationAI` (yield targets), `CvDiplomacyAI` (victory pursuit), `CvMilitaryAI` (production weights) | Immediate; city spec rebuilds next DoTurn; override-protected ~10 turns | None |
| `keep-status-quo` | Re-applies current strategy or flavor values | Refreshes override timer only | Same as whichever mode |
| `set-persona` | `CvDiplomacyAI` (26 personality fields) | Immediate write; most behavior shifts on next diplomacy reevaluation | Teammates see live estimates; non-teammates usually see XML/default estimates |
| `set-research` | `CvTechAI::m_iNextResearch` | Next `ChooseNextTech`; one-shot | None |
| `set-policy` | `CvPolicyAI::m_iNextPolicy` | Next `ChooseNextPolicy` when slot opens; one-shot | None |
| `set-relationship` | Raw `ScenarioModifier1/2` plus the broader opinion cascade across diplomacy, coop war, deals, voting, trade, settlement, and tactical systems | Immediate raw write; direct peace and coop-war desire logic can react immediately; cached opinion updates on next `DoUpdateOpinions` when diplo modifiers are active and not in network MP | **Yes** — via `GetCachedOpinionWeight` / `GetCivOpinion` |
| `pause-game` / `resume-game` | `CvConnectionService::m_pausedPlayers` | Next `ProcessMessages` check | None (blocks named player only) |
| `lua-executor` | Anything (`luaL_dostring`) | Immediate | Script-dependent (trust boundary) |
| `relay-message` / `set-metadata` | Knowledge store only; never reaches DLL | n/a | LLM agents only; invisible to VPAI |

---

## Detailed documentation

- **[Flavor influence](influence/flavors.md)** — how `set-flavors`, `unset-flavors`, `set-strategy`, and `keep-status-quo` steer AI through the flavor system. Includes the per-flavor subsystem matrix, auto-activation thresholds, hard-coded strategy effects, dynamic wartime modifiers, and the `FLAVOR_USE_NUKE` cross-civ leak.

- **[Diplomatic influence](influence/diplomacy.md)** — how `set-persona` mutates personality fields and `set-relationship` cascades through the opinion system. Includes the three-audience visibility table.

- **[Forced choices](influence/forced-choices.md)** — how `set-research` and `set-policy` override the AI's normal tech and policy selection (one-shot forcing).

---

## Invariants

The analysis in the sub-documents relies on these being true. If any is violated, the downstream impact claims may need revisiting.

1. **Every mutating tool's Zod schema has an explicit `PlayerID`** clamped to `[0, MaxMajorCivs-1]`.
2. **Every batched Lua script indexes `Players[playerID]` exactly once**; never iterates `Players[*]`.
3. **No Vox Deorum setter fires `GAMEEVENTINVOKE_HOOK`** — verified for `SetCustomFlavors`, `SetGrandStrategy`, `SetNextResearch`, `SetNextPolicy`, `SetPersona`, `SetScenarioModifier1/2`.
4. **Foreign civs usually perceive another leader's persona through `Estimate*` helpers** — teammates get live values, while non-teammates usually get XML/default estimates. This scopes `set-persona`'s cross-civ reach.
5. **Foreign `CvDiplomacyAI` reads cross-civ opinion only via `GetCachedOpinionWeight` / `GetCivOpinion`**, never the raw modifier arrays. This localizes `set-relationship`'s breakdown while allowing the numeric cascade when `GetDiploModifiers` is included in opinion refresh.
6. **`FLAVOR_USE_NUKE` is the only flavor read cross-civ.** If another flavor gains a cross-civ consumer, update [influence/flavors.md](influence/flavors.md).
7. **The bridge service runs on localhost only** with no auth. Trust boundaries (`lua-executor`, global `/external/pause`) depend on this.
