One more known issue: get-military-report.lua does not report strength = 0 units, eg nuke.

# Let strategists choose their ideology

Strategists cannot choose their civilization's first ideology today. The game's AI picks Freedom, Order, or Autocracy at the start of a turn, before the strategist sees the choice. This plan adds a pre-selection slot: the strategist picks an ideology ahead of time, and the game adopts that pick when ideologies unlock.

## Goal and success criteria

The change is done when all of the following hold:

1. From the Industrial era until the player adopts an ideology, `get-options` lists every ideology the player could adopt, labeled `<Name> (New Ideology)`.
2. `get-options` always tells the strategist where its ideology stands. An `Ideology` block shows the adopted ideology, the stored pick, and the reason given for the pick. After adoption, the strategist can see whether its pick was honored.
3. Calling `set-policy` with an ideology name stores it in a new slot. Picking an ideology never replaces or clears the queued next policy, including on the turn the ideology is adopted.
4. When `CvPolicyAI::DoChooseIdeology` runs, it adopts the stored ideology if it is still valid. Otherwise it falls back to the existing AI logic.
5. Players that never pre-select behave exactly as before. This includes the null strategist and players without Vox Deorum.

## Current state

- **When the ideology gets picked.** `CvPlayer::doTurnPostDiplomacy` calls `DoChooseIdeology` for AI players when `IsTimeToChooseIdeology()` is true and the player has no ideology. `DoChooseIdeology` applies its rules in this order:
  1. the vassal rule (take the master's ideology)
  2. the team-leader rule
  3. scoring for Freedom, Order, and Autocracy
  4. the optional Heritage override (`MOD_ISKA_HERITAGE`)
  5. an adoption tail: `SetPolicyBranchUnlocked`, `LogBranchChoice`, the GEorGM trait, and the `PlayerAdoptPolicyBranch` Lua hook
- **What happens right after adoption.** Adopting an ideology grants free tenets (`SetPolicyBranchUnlocked` calls `ChangeNumFreeTenets`). In the same step, `doTurnPostDiplomacy` calls `DoPolicyAI` right after `DoChooseIdeology`. `DoPolicyAI` keeps adopting while free tenets remain, and `ChooseNextPolicy` only weighs tenets while free tenets are pending. So the game AI picks the free tenets immediately, before the strategist sees the ideology's tenets.
- **How that step loses a queued policy.** `ChooseNextPolicy` takes the queued pick from `m_iNextPolicy` and clears the slot before checking it. With free tenets pending, `DoPolicyAI` calls it even when the player lacks the culture for a normal policy. A queued normal policy or branch then fails the cost check in `CanAdoptPolicy` or `CanUnlockPolicyBranch`, and the queued pick is lost without notice. If the player has enough culture, the queued pick is adopted with culture before the free tenets, which is fine.
- **Why the strategist misses the choice.** The strategist runs after `PlayerDoneTurn`, and the pick happens at the start of the next turn. Telemetry shows the gap. In game `ea6516f5`, player 1 saw no ideology among its options on turn 281. On turn 282 it already had Freedom and was only offered Freedom tenets.
- **Why the options list can't show ideologies.** `CvPolicyAI::ChooseNextPolicy` builds the options list, and it never includes ideology branches. `CvPlayerPolicies::CanUnlockPolicyBranch` returns false for `IsPurchaseByLevel` branches.
- **Why the existing slot can't hold an ideology.** `m_iNextPolicy` is a single slot that the next normal policy pick consumes. A forced ideology branch would fail validation there and be cleared silently.
- **What the strategist sees of its ideology today.** The player summary lists unlocked branches, ideologies included, but nothing marks which one is the ideology. `get-options` shows `Policy.Next` with the rationale stored in `PolicyChanges`, and nothing for ideologies.
- **Save format.** `CvPolicyAI::Serialize` has no versioning. `m_iNextPolicy` was added the same way.
- **Knowledge database.** There is one SQLite file per game, and resumed games reuse it. `mcp-server/src/knowledge/schema/setup.ts` creates tables with `ifNotExists` and has no column migrations.
- **Who reads the options list:**
  - `get-player-options.lua` collects the raw options.
  - `knowledge/getters/player-options.ts` maps IDs to names.
  - `tools/knowledge/get-options.ts` labels the entries.
  - `tools/actions/set-policy.ts` validates against `GetPossiblePolicies` and strips the suffix in parentheses.
  - `civ5-mod/UI/VoxDeorumHumanPanel.lua` parses the `(New Branch)` and `(Continuing X Branch)` suffixes.
  - `vox-agents/src/strategist/agents/null-strategist.ts` picks a random key from `Options.Policies` whenever no policy is queued.

## Approach

We add a second forced slot, `m_iNextIdeology`, to `CvPolicyAI`. The strategist fills it with `set-policy`, and `DoChooseIdeology` reads it right after the vassal rule.

**When the choice is open.** The choice is open while the player has no ideology, the current era is at least Industrial, and the player is not a vassal whose master already has an ideology. Every unlock trigger in Community Patch and Vox Populi (the era, the policy count, and factories) needs at least the Industrial era. So this window opens before the earliest possible unlock and closes when an ideology is adopted.

**Which rule wins:**

1. The vassal rule keeps top priority, because it is a game rule.
2. A valid pre-selection comes next. It overrides the team-leader rule, the scoring, and the Heritage override.
3. If the pre-selection is invalid at unlock time, the existing logic runs unchanged. Examples: `CanAdoptIdeology` returns false, or the conditions for Heritage no longer hold.

**Keeping the queued policy.** The two slots are independent, and the adoption turn must not empty the policy slot. While free tenets are pending, `ChooseNextPolicy` leaves a queued pick that is not a tenet in its slot and lets the AI pick the free tenet. Once the free tenets are spent, the queued pick is used as usual, on this turn if culture allows or on a later one.

**Tenets on the adoption turn.** The game AI picks the free tenets granted at adoption, in the same step. The strategist cannot pick them in advance, because tenets are not adoptable until their ideology is unlocked. From the next turn on, the strategist sees the ideology's tenets in `get-options` and picks further tenets with `set-policy`. The strategist prompt says this, so the model is not surprised by tenets it did not choose.

**What the strategist sees.** `get-options` gets a top-level `Ideology` block:

| Field | Meaning |
| --- | --- |
| `Current` | The adopted ideology, or `None` |
| `Chosen` | The stored pick, or `None` |
| `Rationale` | The reason given with the pick |

- Before adoption, `Chosen` reflects the DLL slot, so a pick that the game cleared does not linger.
- After adoption, `Chosen` stays, so a mismatch with `Current` shows that the pick could not be honored.
- `Rationale` is shown while `Current` is `None` or equals `Chosen`.
- The rationale is stored in a new `IdeologyChanges` mutable-knowledge table. Ideology picks never write `PolicyChanges`, so `Policy.Next` stays accurate.

**Alternatives we rejected:**

- **Delay the AI pick by one turn for LLM players.** The DLL has no "LLM-controlled" flag. It would also cost every LLM player a turn of tenet benefits.
- **Reuse `m_iNextPolicy`.** Normal policy picks during the window would consume or block it, and an ideology pick would replace the queued policy.
- **Let the strategist pre-select its first tenets.** Tenet options depend on the ideology and are not adoptable before it unlocks. This would need a third slot and its own validation for a one-time choice.

## Steps

### 1. DLL (`civ5-dll/CvGameCoreDLL_Expansion2/`)

Mark every edit outside `CvConnectionService` with `// Vox Deorum:`.

**1a. `CvPolicyAI.h` / `CvPolicyAI.cpp`**
- Add `int m_iNextIdeology`.
  - Initialize it to `-1` next to `m_iNextPolicy`.
  - Serialize it in `CvPolicyAI::Serialize` right after `m_iNextPolicy`.
- Add `SetNextIdeology(int)` and `GetNextIdeology()`, matching the accessors for the policy slot.
- Add `bool IsIdeologyChoiceValid(CvPlayer* pPlayer, PolicyBranchTypes eBranch)`. It returns true only when all of these hold:
  - the branch is `IsPurchaseByLevel` and not already unlocked
  - the player has no ideology
  - `CanAdoptIdeology(eBranch)` is true
  - for Heritage only: `MOD_ISKA_HERITAGE` is on, and the religion check from `DoChooseIdeology` passes
- Add `void GetPossibleIdeologies(CvPlayer* pPlayer, std::vector<PolicyBranchTypes>& out)`.
  - Return nothing if the player has an ideology, the current era is below `ERA_INDUSTRIAL`, or the player is a vassal whose master has an ideology.
  - Otherwise return every branch that passes `IsIdeologyChoiceValid`.

**1b. `CvPolicyAI::DoChooseIdeology`**
- Move the adoption tail into a private `AdoptIdeology(CvPlayer* pPlayer, PolicyBranchTypes eBranch)`. The tail is `SetPolicyBranchUnlocked`, `LogBranchChoice`, GEorGM, and the `PlayerAdoptPolicyBranch` hook. The scoring path calls this function at its end.
- Right after the vassal block:
  - Read `m_iNextIdeology`, then reset it to `-1`.
  - If `IsIdeologyChoiceValid` passes, call `AdoptIdeology` and return.

**1c. `CvPolicyAI::ChooseNextPolicy`**
- In the existing forced-pick block, before the slot is cleared: if `pPlayer->GetNumFreeTenets() > 0` and the queued pick is a branch or a policy with level 0, leave `m_iNextPolicy` unchanged and continue to the normal tenet choice.
- A queued tenet is still checked and used as before.

**1d. Lua bindings (`Lua/CvLuaPlayer.h` / `.cpp`)**
- Add `GetPossibleIdeologies()`, which returns a table of branch IDs.
- Add `SetNextIdeology(branchID)`, where `-1` clears the slot.
- Add `GetNextIdeology()`.
- Register all three next to `SetNextPolicy` and `GetNextPolicy`.

### 2. MCP server (`mcp-server/`)

**2a. `lua/get-player-options.lua`**
- Add `Ideologies = player:GetPossibleIdeologies()`, `NextIdeology = player:GetNextIdeology()`, and `Ideology = player:GetLateGamePolicyTree()`.

**2b. `src/knowledge/schema/timed.ts`, `base.ts`, and `setup.ts`**
- Add `Ideologies: JSONColumnType<string[]>`, `NextIdeology: string | null`, and `Ideology: string | null` to `PlayerOptions`. Add the three columns to the table creation.
- Add a small `addMissingColumns(db, table, columns)` step that reads `PRAGMA table_info` and runs `ALTER TABLE ... ADD COLUMN` for missing columns. This lets resumed games with an existing database keep working.
- Add an `IdeologyChanges` mutable-knowledge table with `Ideology` and `Rationale`, created like `PolicyChanges`. It is a new table, so `ifNotExists` covers resumed games.

**2c. `src/knowledge/getters/player-options.ts`**
- Map `Ideologies` with `convertToNames(..., "BranchType")`.
- Map `NextIdeology` and `Ideology` with `convertToName(..., "BranchType")`.

**2d. `src/tools/knowledge/get-options.ts`**
- Append one entry per ideology to `Options.Policies`:
  - key: `"<Name> (New Ideology)"`
  - value: the branch help from `formatPolicyHelp`
- Read `IdeologyChanges` next to `PolicyChanges`.
- Add the top-level `Ideology` block (`Current`, `Chosen`, `Rationale`) described in the approach. Show it once the choice window has opened or an ideology is adopted. Extend `outputSchema` to match.
- Leave `Policy.Next` and its rationale logic unchanged.

**2e. `src/tools/actions/set-policy.ts`**
- After resolving `branchID`, the Lua script checks whether the branch is in `GetPossibleIdeologies()`.
  - If so, it calls `SetNextIdeology(branchID)` and returns the previous ideology. The policy slot is not touched.
  - If not, the existing branch and policy path runs.
- `None` keeps its current meaning and clears only the normal slot. To change an ideology pick, the strategist picks another ideology.
- An ideology pick stores `{ Ideology, Rationale }` in `IdeologyChanges` instead of `PolicyChanges`. It calls `pushAction` with the summary "Ideology: <previous> → <new>" and the rationale.
- Update the tool description: an ideology pick is held separately from the next policy, and a strategist can queue one of each.

### 3. Vox Agents (`vox-agents/`)

**3a. `src/strategist/agents/null-strategist.ts`**
- Leave keys ending in `(New Ideology)` out of the random pick. The baseline keeps using the game AI's ideology choice, so past experiments stay comparable.

**3b. `src/strategist/agents/simple-strategist-base.ts`**
- Add one bullet after the `set-policy` line. It should say:
  - options marked "New Ideology" can be chosen ahead of time with `set-policy`, and the pick is adopted automatically when ideologies unlock
  - the pick does not replace the next policy, so the strategist can queue both
  - the free tenets granted on adoption are picked by the game; later tenets go through `set-policy`

### 4. Human-control panel (`civ5-mod/UI/VoxDeorumHumanPanel.lua`)

- Treat `(New Ideology)` like `(New Branch)` for grouping and icon lookup. If the texture table lacks icons for the ideology branches, fall back to the default branch art.
- Keep the staged ideology separate from the staged policy, so selecting one does not unselect the other. Mark the option matching `Ideology.Chosen` as the current ideology selection.
- On submission, send each staged choice in its own `set-policy` call.

### 5. Documentation

- `mcp-server/docs/influence/forced-choices.md`:
  - Add an "Ideology pre-selection" subsection under `set-policy`. Cover the slot, the window, the order in which the rules win, the fallback, and the free tenets the game picks on adoption.
  - Note that a queued policy survives the adoption turn.
  - Change the "Ideology picks" bullet to say tenets.
- `docs/developers/mcp-server/influence.md`: extend the "Forced choices" sentence to mention ideology pre-selection.

## Risks and open questions

- **Old saves will not load.** Adding a serialized field breaks loading saves made with the older DLL, as `m_iNextPolicy` did. Controlled games cannot be resumed across this DLL update.
- **The policy-slot change reaches other free tenets.** Step 1c also applies when free tenets come from sources other than adoption. That is the intended behavior there too: a queued policy waits instead of being lost.
- **The strategist does not pick its first tenets.** The game AI's free-tenet picks follow its own weighting, not the strategist's plan. We accept this for now; pre-selecting tenets is listed as a rejected alternative.
- **Team rules are overridden.** A pre-selection beats the team-leader heuristic, so a strategist can split a team's ideologies. We accept this because it is the strategist's call.
- **Experiment comparability.** LLM strategists will now choose ideologies, which shifts their results relative to earlier runs. The null baseline is unchanged (Step 3a).
- **The window can open early.** Players reach the Industrial era long before unlock under some settings. Showing ideologies early is harmless, but it adds a few hundred prompt tokens per turn. If that matters, narrow the window to "Industrial era and `IsTimeToChooseIdeology` within reach". There is no cheap predictor for that, so we start with the era rule.

## Verification

- Run `npm run build:all` and `npm run test:all` from the repository root.
- Add or extend Vitest coverage with controlled inputs:
  - `mcp-server/tests/mock/actions/set-policy.test.ts`:
    - An ideology name calls `SetNextIdeology`, writes `IdeologyChanges`, and leaves `PolicyChanges` alone.
    - An ideology outside the window is rejected.
    - A normal branch still uses `SetNextPolicy`.
  - `mcp-server/tests/mock/knowledge/getters/player-options.test.ts`: `Ideologies`, `NextIdeology`, and `Ideology` map to names.
  - A `get-options` test:
    - Ideology entries carry the `(New Ideology)` label.
    - Before adoption, `Ideology` shows `Current: None` with the chosen ideology and its rationale.
    - After adoption of the chosen ideology, the rationale stays.
    - After adoption of a different one, `Chosen` differs from `Current` and the rationale is dropped.
    - A queued policy and an ideology pick both appear.
  - A `setup.ts` test: opening a database created with the old `PlayerOptions` schema adds the three columns.
  - A null-strategist test: `(New Ideology)` keys are never picked.
- Build and deploy the DLL with `build-and-copy.bat`. In an Industrial-era save, use the Lua console or FireTuner:
  - `GetPossibleIdeologies()` lists the three ideologies.
  - After `SetNextIdeology(GameInfoTypes.POLICY_BRANCH_ORDER)`, ending turns until unlock adopts Order.
  - In the same step, the free tenets are adopted from Order.
  - With a normal policy queued through `SetNextPolicy` and too little culture to buy it, `GetNextPolicy()` still returns that policy after the adoption step.
  - The bridge log shows `PlayerAdoptPolicyBranch` for the adoption.
- After a real game, check telemetry with read-only queries:
  - `get-options` shows `(New Ideology)` entries before unlock, and the `Ideology` block after it.
  - A `set-policy` call with an ideology precedes the adoption.
  - The adoption event appears in a met civilization's `get-events`.

## Out of scope

- Ideology switching, which stays with `DoConsiderIdeologySwitch`.
- Choosing the free tenets granted on adoption. The game AI picks them in the same step; later tenets go through `set-policy`.
