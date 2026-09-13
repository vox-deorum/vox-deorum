# Candidate upstream contributions

This is a draft selection plan for extracting focused Vox Populi PRs from the current Vox Deorum DLL. Start with the small fixes, then choose the APIs and larger features worth maintaining upstream. Each entry describes selected hunks, not an entire file patch.

The inventory comes from the 107-file export at `temp/upstream-review/review-WHrsFj/`: DLL commit `aaf1e6229fba34d2259e46b629dd8941680b5688`, compared with merged upstream commit `76a576152f00a8780ced6c6721d3cd46c51d151b` (5.2.7). Candidate checks also used the newer **local** `upstream/master`, `3bf725e4f804698aa5da085cbe1a3537fca8e4a7`. Remote PR status and changes beyond that cached ref have not been checked.

All file paths below are relative to `civ5-dll/`. For compactness, **core files** means `CvGameCoreDLL_Expansion2/`, and **Lua files** means `CvGameCoreDLL_Expansion2/Lua/`. Patch numbers refer to that export's `patches/` directory.

## Small fixes to extract first

### 1. Include prior damage in tactical attack-cache comparisons

Fix the premature semicolon in `AttackKey::operator==` so previous attacker, defender, and city damage participate in equality. These fields already participate in hashing; cache comparisons must distinguish different combat states.

**Related files:** core `CvTacticalAI.h`. **Patch:** `0058`.

### 2. Show war duration for the hovered civilization

Use `playerID` in the notification panel's war-weariness tooltip. The current upstream call uses the undefined `g_iAIPlayer`, so it queries the wrong opponent. Extract this small correction from the observer-interface changes.

**Related files:** `(3a) VP - EUI Compatibility Files/LUA/NotificationPanel.lua`. **Patch:** `0007`.

### 3. Correct remaining turns on incoming trade routes

Make `GetTradeRoutesToYou().TurnsLeft` return completion turn minus current turn, matching outgoing trade routes. Active incoming routes currently expose a negative countdown.

**Related files:** Lua `CvLuaPlayer.cpp`. **Patch:** `0073`.

### 4. Report election influence losses without requiring a spy

Separate the losing-spy event path from influence losses suffered by a player without a spy. Use the actual spy ID for the former and `-1` for the latter, avoiding the invalid spy lookup and assertion. Preserve the `MOD_EVENTS_ESPIONAGE` guard for both paths; the exported no-spy call currently lacks it. Confirm the intended event coverage before extraction.

**Related files:** core `CvMinorCivAI.cpp`, in `DoElection`. **Patch:** `0045`.

### 5. Keep observer unit flags visible during combat

Skip combat-animation flag hiding for observers in both `RunCombatSim` and `EndCombatSim`. Reproduce the observer display problem and verify that human-player animations retain their existing behavior.

**Related files:** `(3a) VP - EUI Compatibility Files/LUA/UnitFlagManager.lua`. **Patch:** `0009`.

### 6. Suppress defeated-leader interruptions during autoplay

Skip `DoKilledByPlayer` in `CheckForMurder` while AI autoplay is active. This keeps automated games moving when a civilization is eliminated. Reproduce the interruption and confirm normal human games still show the defeated leader.

**Related files:** core `CvPlayer.cpp`. **Patch:** `0047`.

## Additive APIs and UI improvements

These candidates need an upstream use case and an API review, but can be separated from external control and save-format changes.

### 7. Expose map identity and original random seeds to in-game Lua

Add `Game.GetMapScriptName` and `Game.GetRandomSeeds` for reproducibility reports and debugging. Return the original pregame seed inputs, without advancing or exposing mutable RNG state. Document both methods in LuaCATS.

**Related files:** Lua `CvLuaGame.cpp`, `CvLuaGame.h`; `LuaCATS/Game.d.lua`. **Patches:** `0071`, `0072`, `0100`.

### 8. Expose cooperative-war target eligibility to Lua

Wrap the existing `IsValidCoopWarTarget` check so a mod can inspect a target independently of the friendship requirement used when requesting a cooperative war. Preserve the distinction between request and execution checks. This does not include the promise-writing API.

**Related files:** Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`; core `CvDiplomacyAI.cpp`, `CvDiplomacyAI.h` for the existing native contract. **Patches:** `0073`, `0074`.

### 9. Expose deal valuation and complete-deal validation to Lua

Let trade interfaces inspect each participant's item valuation and validate a complete scratch deal using existing native rules. Extract the bindings with normal upstream semantics, including the existing feature guard on complete-deal validation. Deal enactment and human-to-human overrides belong to candidate 23.

**Related files:** Lua `CvLuaDeal.cpp`, `CvLuaDeal.h`; core `CvDealAI.cpp`, `CvDealAI.h`, `CvDealClasses.cpp`, `CvDealClasses.h` for the native contracts. **Patches:** `0069`, `0070`.

### 10. Expose tactical-zone information to Lua

Provide a player's tactical-zone count and zone details, plus the zone containing a unit from an optional player's perspective. Useful for AI diagnostics and overlays. Specify cache freshness and validate player and zone inputs without importing RL snapshot accessors.

**Related files:** Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`, `CvLuaUnit.cpp`, `CvLuaUnit.h`; core `CvTacticalAnalysisMap.cpp`, `CvTacticalAnalysisMap.h` for existing zone access. **Patches:** `0073`, `0074`, `0076`, `0077`.

### 11. Let Lua add replay messages

Expose `Player:AddReplayMessage` so scenarios and mod events can appear in the replay timeline using the game's existing replay-message storage.

**Related files:** Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`. **Patches:** `0073`, `0074`.

### 12. Add a tile-theft event for purchases and culture bombs

Expose the plot coordinates and previous and new owners before a foreign tile changes hands through purchase or a culture bomb. Replace the IPC gate with the appropriate upstream event option and document the before-transfer timing.

**Related files:** core `CustomMods.h`, `CvCity.cpp`, `CvUnit.cpp`; `(1) Community Patch/Database Changes/NewCustomModOptions.xml` if a new event option is needed. **Patches:** `0013`, `0017`, `0066`.

### 13. Notify Lua when a team wins the game

Extract the `PlayerVictory` hook from `CvGame::setWinner` so scenarios can react to a victory. The current payload names the winning team's leader and victory type. Agree on team-versus-player identity, event timing, and coverage before standardizing it; exclude the IPC gate and capture shutdown.

**Related files:** core `CvGame.cpp`; core `CustomMods.h` and `(1) Community Patch/Database Changes/NewCustomModOptions.xml` if standardized through the event-option system. **Patch:** `0037`.

### 14. Name cooperative-war partners in diplomacy tooltips

Show the partners alongside the countdown for a preparing cooperative war. Keep the argument change and localized text together, and preserve the existing rules governing when the information is visible. Leave unrelated debug-label edits out of this PR.

**Related files:** Lua `CvLuaPlayer.cpp`; `(1) Community Patch/Database Changes/Text/en_US/UI/CoreNewUIText.xml`. **Patches:** `0003`, `0073`.

### 15. Expose economic and military strategy prerequisites

Share prerequisite checks between native strategy selection and Lua inspection: civilization restrictions, required and obsolete technologies, and first eligible turn. Return all eligible strategies. Exclude the VD blacklist and ten-turn delay for externally disabled strategies, and keep prerequisite eligibility distinct from the AI deciding to activate a strategy.

**Related files:** core `CvEconomicAI.cpp`, `CvEconomicAI.h`, `CvMilitaryAI.cpp`, `CvMilitaryAI.h`; Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`. **Patches:** `0033`, `0034`, `0043`, `0044`, `0073`, `0074`.

### 16. Expose ranked settlement candidates

Generalize `GetBestSettlePlot` into a shared search that can return several scored candidates, with an optional limit, and expose the results to Lua. Preserve the existing single-result selection. Prefer structured coordinates and scores over the current wrapper's English descriptions; check search cost and what information each player may inspect.

**Related files:** core `CvPlayer.cpp`, `CvPlayer.h`; Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`. **Patches:** `0047`, `0048`, `0073`, `0074`.

## Larger candidates needing design review

### 17. Make observer displays consistently follow the selected civilization

Synchronize fog when the observer override changes; use the followed team's resource discoveries; refresh resource graphics after its technology changes; and align diplomacy tooltips and civilization lists with that perspective. Keep chat, notifications, and network actions attached to the real active player. Review these as a coordinated feature, with ordinary observers, pinned observers, and normal human games covered.

**Related files:** core `CvGame.cpp`, `CvPlot.cpp`, `CvTeam.cpp`; `(1) Community Patch/Core Files/Overrides/Includes/InfoTooltipInclude.lua`; `(2) Vox Populi/LUA/DiploList.lua`; `(3a) VP - EUI Compatibility Files/LUA/DiploCorner.lua`, `EUI_tooltip_library.lua`, `NotificationPanel.lua`. **Patches:** `0001`, `0004`–`0007`, `0037`, `0050`, `0061`.

### 18. Preview research options after an assumed technology

Expose candidate research choices and support checking prerequisites as if one technology were already known. Separate candidate collection from recommendation logging and cached-vector mutation. The current `GetPossibleTechs` calls the recommendation path; exclude forced research state and its serialization.

**Related files:** core `CvTechAI.cpp`, `CvTechAI.h`, `CvTechClasses.cpp`, `CvTechClasses.h`; Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`. **Patches:** `0062`–`0065`, `0073`, `0074`.

### 19. Preview policy choices without selecting a policy

Expose adoptable policies and branches, optionally ignoring affordability, through a dedicated query. The current wrapper calls `ChooseNextPolicy`, which can consume a forced choice and performs selection work. Separate that path before offering a query API, preserve branch restrictions, and exclude forced-policy serialization.

**Related files:** core `CvPolicyAI.cpp`, `CvPolicyAI.h`, `CvPolicyClasses.cpp`, `CvPolicyClasses.h`; Lua `CvLuaPlayer.cpp`, `CvLuaPlayer.h`. **Patches:** `0051`–`0054`, `0073`, `0074`.

### 20. Preserve XML flavor differences in production scoring

Apply square-root scaling to each incoming flavor weight before multiplying it by XML flavor values, replacing the later scaling of the combined score. This changes building, unit, project, and process priorities, so treat it as an AI balance proposal. Review zero-weight handling and candidate 21 together; exclude custom settler-flavor overrides.

**Related files:** core `CvBuildingProductionAI.cpp`, `CvUnitProductionAI.cpp`, `CvProjectProductionAI.cpp`, `CvProcessProductionAI.cpp`. **Patches:** `0016`, `0055`, `0056`, `0068`.

### 21. Prevent negative accumulated selection weights

Clamp the result of `CvWeightedVector::IncreaseWeight` to zero. Audit callers before proposing a global change: some use signed adjustments, and clamping after each update can make the result depend on update order. This patch does not address integer overflow.

**Related files:** `CvGameCoreDLLUtil/include/CvWeightedVector.h`; the production consumers listed in candidate 20. **Patch:** `0011`.

### 22. Add turn-completion scheduling information for Lua consumers

Consider exposing the next eligible player with a turn-completion event. The VD patch appends the next living slot to `PlayerDoneTurn`; that scan is not necessarily the next actual actor in simultaneous or team turns. Agree on the event contract and compatibility before extraction.

**Related files:** core `CustomMods.h`, `CvPlayer.cpp`. **Patches:** `0013`, `0047`.

### 23. Support scenario-controlled deals through an explicit API

Consider a generalized option for scenarios to construct and finalize deals using human-to-human rules while retaining structural legality checks. This spans item legality, valuation cache keys, finalization, and Lua bindings. It needs a concrete upstream use case and a narrower interface before extraction; the VD trade editor and external acceptance path are not a ready PR.

**Related files:** core `CvDealAI.cpp`, `CvDealAI.h`, `CvDealClasses.cpp`, `CvDealClasses.h`; Lua `CvLuaDeal.cpp`, `CvLuaDeal.h`, `CvLuaPlayer.cpp`; `(3a) VP - EUI Compatibility Files/LUA/TradeLogic.lua` as the current consumer. **Patches:** `0027`–`0030`, `0069`, `0070`, `0073`, `0008`.

## Already covered or held out

| Change | Disposition |
| --- | --- |
| Declaration-of-friendship fall-through into gold checks, in `CvDealClasses.cpp` (`0029`) | The cached upstream case already has the required `break`. Do not open another PR for it. The separate unmet-team check needs a reproducible use case. |
| Connection service, schemas, ArduinoJson, compatibility headers, event forwarding, and message pumping | Keep in VD. Extracted APIs must work without them. |
| `VoxDeorumRL/`, capture callbacks, and native cache/promotion accessors introduced only for capture | Keep in VD unless a separate upstream consumer justifies a focused API. This includes the city ranged-strength helper, which also overlaps newer upstream religion changes. |
| Custom flavor persistence, forced policy/research state, scenario modifiers, promise writes, and custom diplomacy notifications | Hold out of this extraction plan. They need separate feature proposals and, where applicable, save-format design. |
| Assertion suppression, replacement of `PRECONDITION`, reduced release optimization, fork release automation, and local deployment scripts | Keep out of gameplay/API PRs. The export reflects VD operational choices, not demonstrated upstream fixes. |

## Extraction order and checks

1. Start with **1–4**; reproduce **5–6** before promoting them to the same batch. Each should be a separate small PR.
2. Select the useful API candidates from **7–16**. Keep independent interfaces separate; merge only shared prerequisites that make the review smaller.
3. Discuss **17–23** before implementation. They include behavior changes or API redesign rather than simple patch extraction.
4. For each selected candidate, refresh upstream, check for equivalent code and open PRs, extract only the named behavior, and follow the [upstream contribution workflow](../developers/civ5-dll/upstream-contributions.md). Preserve existing defaults and save layout.

Verification should match the candidate: cache-key comparisons for 1, UI and event reproductions for 2–6 and 12–14, Lua smoke checks and unchanged game state for query APIs, observer perspective checks for 17, and representative AI games for 20–21. Build the extracted DLL and check both compiler paths before publishing. This draft records candidates; it does not claim that the exported implementations are ready to submit.
