# Game setup wizard + session list redesign

> Design for a guided **game** setup flow, complementing the existing **model** setup wizard
> ([`SetupWizard.vue`](../../vox-agents/ui/src/components/config/SetupWizard.vue)), plus a rework of the
> session configuration list so a player can tell what each configuration does. Model resolution builds on
> the [two-tier model defaults plan](model-tiers.md) (`default` / `small` size aliases).

## Vocabulary

Two kinds of AI share the board, and the UI must never blur them:

- **Agentic AI** — a civilization steered by a language model through a strategist agent.
- **Vox Populi AI (VPAI)** — Civ V's own rule-based AI, which still handles units and cities everywhere.

Every count, badge, and sentence in this design says *agentic AI* when it means the former.

## Why

After the model wizard finishes, a first-time player lands on `/session` and sees a bare table of ~22
configuration files, most of them research artifacts (`gemma-4-standard-fixed-per-5`, `null-standard-fixed`,
`oss-120b-standard-fixed-per-5`…), described only by columns *Name / Type / Players / Map / Observe*. Clicking
**New Config** opens an editor written in engine vocabulary. Nothing in that screen tells the player:

- that **seat 0 is theirs** when *Observe* is off, and must be left out of `llmPlayers`;
- that the **highest configured seat number determines the requested civilization count** and therefore the
  map size (`computePlayerCount` = `max(seat)+1`; the launcher rounds an odd count up before creating slots).
  The wizard offers only even counts, so the civilization count and map-size preview agree. Wanting 8
  civilizations with 3 agentic ones means writing an entry at seat 7;
- that seats present in `llmPlayers` as `none-strategist` still play as VPAI but **become conversable** — a
  diplomacy chat requires an active seat context
  ([`factory.ts:129-133`](../../vox-agents/src/web/chat/factory.ts#L129-L133)), so unlisted civilizations
  cannot answer you;
- what `simple-strategist` vs `simple-strategist-staffed` costs or plays like;
- which model any of it uses.

So the wizard is not sugar. It encodes four non-obvious rules that currently live only in the shipped example
files.

## Principles

1. **One question per screen, in player language.** "How many civilizations?", never "llmPlayers", "autoPlay",
   or "seat index".
2. **The wizard is a generator, not a parallel system.** It writes an ordinary config file that the existing
   `ConfigDialog` can still edit, and hands off to the existing start dialog. No new config format, no new
   launch path.
3. **Decide for the player where there is a right answer.** Every seat is attended by Vox Deorum; the choice
   is not offered, it is explained.
4. **Show derived consequences live.** Civilization count → map size; seat list; relative cost.
5. **Never invent state.** "Updated 2 days ago" (file mtime), not "last played" — we do not track play history.

---

## The wizard — four steps

Entered from: the model wizard's completion redirect (`/session?setup=game`), the list's **Setup Wizard**
button, and the empty-state call to action.

### Step 1 — Your role

```
┌─ Set up a game ─────────────────────────────────────────────────────────┐
│  1. Your role  ·  2. The world  ·  3. The minds  ·  4. Confirm          │
│                                                                         │
│  Step 1 of 4 · How do you want to play?                                 │
│  Vox Deorum can run the rival civilizations, or the whole game.         │
│                                                                         │
│  ( ) Play the game yourself                              [recommended]  │
│      You take one civilization, exactly as in normal Civ V. The rival   │
│      civilizations are run by agentic AI.                               │
│                                                                         │
│  ( ) Watch AI self-play                                                 │
│      The game plays itself, with agentic AI and/or Vox Populi AI.       │
│                                                                         │
│  ( ) Direct a civilization like an agent                    [advanced]  │
│      You set the strategy each decision turn and Civ V handles the      │
│      units and cities. i.e. you compete as if an agent.                 │
│                                                                         │
│                                    [ Cancel ]              [ Next → ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

| Choice | Writes |
| --- | --- |
| Play the game yourself | `autoPlay: false`; seat 0 omitted from `llmPlayers` (Civ V's human slot) |
| Watch the agentic AI play | `autoPlay: true`; agentic seats start at 0 |
| Direct a civilization | `autoPlay: true` + one `human-strategist` seat (`mode: "Flavor"`) — the shape of [`human-standard-fixed-per-5.json`](../../vox-agents/configs/human-standard-fixed-per-5.json) |

### Step 2 — The world

```
│  Step 2 of 4 · Who is in the game?                                      │
│                                                                         │
│  Civilizations in the game                                              │
│    2 ─────────●──────────── 12  [step 2] 8 civilizations · Standard map │
│                                                                         │
│  How many of them are agentic AI?                                       │
│    1 ────●───────────────── 7           3 of the 7 rivals               │
│                                                                         │
│  ┌ Seats ────────────────────────────────────────────────────────────┐  │
│  │  Seat 0      You                                                  │  │
│  │  Seat 1-3    Agentic AI rival                                     │  │
│  │  Seat 4-7    Vox Populi AI                                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│                                                                         │
│                        [ ← Back ]   [ Cancel ]             [ Next → ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

The map-size readout comes from the same thresholds the launcher uses
([`vox-civilization.ts:126-133`](../../vox-agents/src/infra/vox-civilization.ts#L126-L133)), so what the
player is promised is what Civ V is told.

The civilization-count slider has a minimum of 2, a maximum of 12, and a step of 2, so it offers only even
values.

**Seat generation** (the rules the wizard exists to hide):

```
C = civilizations (2, 4, 6, 8, 10, or 12), L = agentic AI count
firstAgenticSeat = role === 'play' ? 1 : 0      // seat 0 is the human's in play mode

seats[firstAgenticSeat … firstAgenticSeat+L-1] = { strategist: style, pacing }
if role === 'direct'  seats[C-1] = { strategist: 'human-strategist', mode: 'Flavor', pacing }
every remaining seat in [firstAgenticSeat … C-1] = { strategist: 'none-strategist' }
```

Every seat is always populated, with no opt-out. That anchors the invariant `max(seat) === C-1`: because `C`
is even, `computePlayerCount` yields exactly `C`, the map size matches the preview, and every civilization is
conversable.

### Step 3 — The minds

```
│  Step 3 of 4 · How do the agentic AI civilizations think?               │
│                                                                         │
│  Style                                                                  │
│   (•) Simple LLM Strategist                                             │
│       Reads the board and sets a direction each decision turn.          │
│   ( ) Staffed LLM Strategist                                            │
│       Military, economic and diplomatic advisers report in parallel     │
│       on the routine model, briefing the strategist on the main one.    │
│                                                                         │
│  Pace    Re-think every [ 5 ] turns, reacting to [ Important events ▾ ] │
│                                                                         │
│  Model   [ My default — gpt-5-mini                                   ▾ ]│
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ i  3 agentic AI civilizations deciding every 5 turns is roughly     │ │
│  │    180 decisions across a full game, plus one call for every reply  │ │
│  │    you get in conversation.                                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│                        [ ← Back ]   [ Cancel ]             [ Next → ]   │
```

**Each strategist declares whether the wizard offers it.** The registry holds seven strategists, several of
which are baselines (`null-strategist`) or need extra infrastructure (`simple-strategist-learned` wants a
recorded episode database), so the wizard must show a subset — but that subset belongs to the agents, not to a
list in the UI. A new opt-in property on `VoxAgent`, beside the existing `diplomacyOnly`:

```ts
/** Whether the game setup wizard offers this agent as a choice. Opt-in. */
public offeredInSetup: boolean = false;
```

`SimpleStrategist` and `SimpleStrategistStaffed` override it to `true`; everything else inherits `false` and
stays available in the advanced editor. It rides through `AgentInfo` and `GET /api/agents`, so the wizard
filters on `offeredInSetup` and renders whatever comes back in registry order. Offering a new style is then a
one-line change in the agent that owns it, with no UI edit at all.

Labels come from each agent's `displayName` (`"Simple LLM Strategist"`, `"Vox Populi AI"`…), which already
exists on the classes but is not returned by `GET /api/agents` today. The list carries no cost multipliers
and no recommendation badge — the first offered style is simply preselected. What actually distinguishes the
staffed style is in its description: its advisers run on the routine (`small`) model and brief a strategist
thinking on the main (`default`) one, per the [two-tier model defaults plan](model-tiers.md).

**Pace is one line: a number and a dropdown.** It writes `pacing: { everyTurns, interruption }` on every
generated agentic seat. The interruption options come from `GET /api/agents/pacing-interruptions` — the same
registry-backed list the advanced editor already loads — labelled by the registry's own `label`, defaulting to
*Important events* when the registry offers it and *None* otherwise.

**Model is a dropdown over every model the configured providers can reach**, discovered live rather than
limited to what is already written into `config.llms`. A player who signed in with one provider during model
setup should be able to pick any of that provider's models here without a detour through Settings.

A new `GET /api/config/models` walks the *configured* providers and merges their catalogues, grouped by
provider, with the resolved main (`default`) model pinned to the top as "My default":

```
Model   [ My default — gpt-5-mini                                     ▾ ]
        ┌──────────────────────────────────────────────────────────────┐
        │  My default — gpt-5-mini                                     │
        │ ─ OpenAI ────────────────────────────────────────────────────│
        │  gpt-5-mini          gpt-5          gpt-5-nano   …           │
        │ ─ OpenRouter ────────────────────────────────────────────────│
        │  anthropic/claude-sonnet-5          deepseek/deepseek-v3  …  │
        └──────────────────────────────────────────────────────────────┘
```

- *Configured* means every credential in `providerCredentials[provider].required` is present in the
  environment, **or** the provider is already named by a `config.llms` entry — the second clause covers
  `codex`, `claude-code`, and `aws`, which declare no required keys and would otherwise always look configured.
- The route reuses `discoverModels(provider, {})`; `getCredential` already falls back to `process.env`
  ([`discovery.ts:37-40`](../../vox-agents/src/utils/models/discovery.ts#L37-L40)), so no credential ever
  crosses to the browser. A provider that fails discovery is dropped from the list, not fatal, and named in
  the response so the wizard can say "OpenRouter didn't answer".
- The list is fetched when step 3 opens, behind a spinner. If discovery fully fails, it falls back only to
  literal object model definitions in global `config.llms` whose `options.embeddingSize` is unset. It excludes
  every string alias or mapping, including `default`, `small`, `embedder`, `summarizer`, and agent mappings.

Choosing "My default" writes no `llms` at all. Choosing a specific model writes `llms: { default: "<id>" }`
on each agentic seat — the seat's main model. `VoxAgent.getModel` selects the model reference before calling
the existing `getModelConfig`, preserving its recursive alias and model-ID resolution. Its selection order is
the two-tier chain from the [two-tier model defaults plan](model-tiers.md): per-seat agent entry, then the
size alias matching the agent's declared `modelSize`, per seat then globally, with small-size agents falling
back to `default` only when `small` is defined nowhere. A seat `default` therefore drives the seat's
reasoning-heavy agents — the strategist and its diplomacy voices — while small-size agents such as the
staffed advisers keep the global routine model unless the seat pins them explicitly. Preflight uses the
same `selectModelReference` implementation, shared through `resolution.ts`.

The selected provider-qualified ID is stored only as `PlayerConfig.llms.default`; the session wizard never
changes Settings or writes a new global `config.llms` definition. `PlayerConfig.llms` remains optional, so an
existing seat without it continues to use the global chain: agent mapping, then size alias (`small` falling
back to `default`). `StrategistSession`
preflight calls `ensureModelsResolved` before launch. A catalogue hit registers the model in memory with its
recommended options for that run, a reachable catalogue miss rejects the ID, and a discovery failure falls
back to the existing supported-ID synthesis. No global definition is required.

### Step 4 — Confirm

A review screen only. No game-mode choice here — saving hands off to the existing start dialog.

```
│  Step 4 of 4 · Confirm                                                  │
│                                                                         │
│  Name         [ my-first-game                                       ]   │
│  Description  [ Three agentic rivals on a standard map.             ]   │
│                                                                         │
│  ┌ What this game will be ────────────────────────────────────────────┐ │
│  │  You play 1 of 8 civilizations. 3 rivals are agentic AI and        │ │
│  │  re-think every 5 turns, or sooner when something important        │ │
│  │  happens.                                                          │ │
│  │                                                                    │ │
│  │   Seat │ Plays as       │ Style    │ Thinks with                   │ │
│  │   ─────┼────────────────┼──────────┼─────────────                  │ │
│  │    0   │ You            │ —        │ —                             │ │
│  │   1-3  │ Agentic AI     │ Simple   │ gpt-5-mini                    │ │
│  │   4-7  │ Vox Populi AI  │ —        │ —                             │ │
│  │                                                     [ View file ▾ ]│ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│      [ ← Back ]   [ Save only ]                     [ Save & Play ▸ ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

The seat table is the same `describeConfig` rendering the list's expander uses. The wizard gives every agentic
seat the same style and model, so its rows always collapse into ranges — but the component handles per-seat
variation, so a config later hand-tuned to one model per rival still reviews correctly here after a round-trip
through the advanced editor.

**Save & Play** writes the config (`POST /api/session/save`), closes the wizard, and opens the existing
[`GameModeDialog`](../../vox-agents/ui/src/components/session/GameModeDialog.vue) on the new config — the same
*Start New Game / Load Last Save / Manual Start* screen every other launch goes through, and now the only
place that choice is made at all. **Save only** stops after the save and highlights the new row in the list.
`View file` discloses the generated JSON for players who want to learn the format.

---

## Session list redesign

### Today

```
Name                              │ Type       │ Players │ Map      │ Observe │ Actions
gemma-4-standard-fixed-per-5      │ Strategist │ 1 / 8   │ Standard │    ✓    │ ▶ ✎ ⧉ 🗑
```

*Type* is always "Strategist". *Observe* is an unlabelled check mark. *Players* `1 / 8` is unexplained. There
is no search, no ordering, no description, and research configs sit beside player configs.

### Proposed

Still a column table — the same `.data-table` skeleton, just with columns that mean something. Prose stays out
of the rows and lives in the expander.

```
┌ Game Configurations ────────────────────────────────────────────────────────────────┐
│ [ 🔍 Search…        ]  Sort: Recent ▾     [ Setup Wizard ]  [ + New Configuration ] │
├────────────────────────────┬────────┬──────┬──────────┬─────────────┬──────┬────────┤
│ Name                       │ Mode   │ Civs │ Map      │ Agentic AI  │ Pace │ Actions│
├────────────────────────────┼────────┼──────┼──────────┼─────────────┼──────┼────────┤
│ ▸ my-first-game            │ Play   │   8  │ Standard │ 3 × Simple  │ 5t   │ ▶   ⋯  │
│ ▸ watch-the-world          │ Watch  │   6  │ Small    │ 6 × Simple  │ 1t   │ ▶   ⋯  │
│ ▾ mixed-table              │ Play   │   8  │ Standard │ 3 × mixed   │ 5t   │ ▶   ⋯  │
│   ┌──────────────────────────────────────────────────────────────────────────────┐  │
│   │ Three rivals on different models, to see which plays the sharpest.           │  │
│   │                                                                              │  │
│   │  Seat │ Plays as        │ Style         │ Thinks with                        │  │
│   │  ─────┼─────────────────┼───────────────┼───────────────────                 │  │
│   │   0   │ You             │ —             │ —                                  │  │
│   │   1   │ Agentic AI      │ Simple        │ gpt-5-mini                         │  │
│   │   2   │ Agentic AI      │ Staffed       │ claude-sonnet-5                    │  │
│   │   3   │ Agentic AI      │ Simple        │ deepseek-v3                        │  │
│   │  4-7  │ Vox Populi AI   │ —             │ —                                  │  │
│   │                                                                              │  │
│   │ fixed seeds · rotating seats · updated 12 days ago                           │  │
│   └──────────────────────────────────────────────────────────────────────────────┘  │
│ ▸ observe-simple-strategist│ Watch ×3│  8  │ Standard │ 1 × Simple  │ 1t   │ ▶   ⋯  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

`5t` reads "every 5 turns, and on important events" in its tooltip; `1t` is every turn. `Watch ×3` carries the
repetition count. The **Agentic AI** cell collapses to `3 × Simple` only when every agentic seat shares a
style; otherwise it reads `3 × mixed` and the expander tells the real story.

**The expander is a per-seat table, because seats genuinely differ.** A config can give every seat its own
strategist *and* its own model (`llms` is per-`PlayerConfig`), so a single "gpt-5-mini" line under the row
would be a lie for any hand-tuned or research config. Identical adjacent seats collapse into a range (`4-7`)
only when style *and* model match. It renders from the same `describeConfig` the wizard's confirm step uses.

Empty state (fresh install, no user configs):

```
        ┌───────────────────────────────────────────────┐
        │                                               │
        │      No game configurations yet               │
        │                                               │
        │            [ Set up a game ]                  │
        │                                               │
        └───────────────────────────────────────────────┘
```

Changes:

1. **One row per config, columns that answer a question.** *Type* (always "Strategist") and the unlabelled
   *Observe* check mark are gone. *Players* `1 / 8` splits into **Civs** (the total, matching what Civ V is
   told) and **Agentic AI** (`3 × Simple` — how many, and what style), and **Mode** replaces the check mark
   with the role the player actually has: `Play` / `Watch` / `Direct`.
2. **Pace as a compact cell**, `5t` / `1t`, with the full phrasing in the tooltip.
3. **Expandable row** carries everything that would otherwise crowd the table: the description or generated
   sentence, the per-seat table (style *and* model, since both vary per seat), flags, and file date. It is
   read-only — every action lives in the row's Actions column, never inside the expander.
4. **Play keeps going through `GameModeDialog`,** which is now the *only* place a start mode is chosen — see
   [Dropping stored start modes](#dropping-stored-start-modes).
5. **Search + sort** (Recent / Name), debounced 300 ms per the UI guide.
6. **Declutter by directory, not by heuristic.** Move the research configurations to `configs/experiments/`
   — `GET /api/session/configs` only reads top-level `.json`, a convention `configs/colm/` already
   establishes. The top level keeps a handful of curated, described starters. A checkbox below the list can
   opt into showing the experiments folder later; it is not needed for the first pass.
7. **`⋯` menu** holds Edit / Duplicate / View file / Delete, so destructive actions stop sitting one mis-click
   from Play — and so there is exactly one place to look for an action.

---

## Dropping stored start modes

`gameMode` (`start` / `load` / `wait`) is stored in every config file *and* asked again at launch, and the
launch answer silently overwrites the file's — [`SessionView.vue`](../../vox-agents/ui/src/views/SessionView.vue)
already starts sessions with `{ ...config, gameMode: mode }`. So the stored value has no effect through the
dashboard, yet it is the field most likely to be misread as "this configuration is a saved game". It is a
launch-time decision wearing a configuration's clothes, and it goes.

- `SessionConfig.gameMode` becomes **optional and launch-time only** — documented as supplied per run, not
  persisted.
- `POST /api/session/start` takes `{ config, gameMode }` and sets it on the runtime config; `StrategistSession`
  and the loop are untouched, since they already read `config.gameMode` at run time.
- `POST /api/session/save` strips `gameMode` before writing, so saved files stop carrying it.
- A `gameMode` still present in an older file is **ignored, with a one-time warning** naming the file. Honoring
  it would preserve exactly the confusion being removed; warning keeps the change discoverable for anyone whose
  research config said `wait`.
- The console keeps `--load` / `--wait`, now the sole source of the value there, defaulting to `start`.
- `ConfigDialog`'s new-config template drops its `gameMode: 'wait'` default. The dialog never showed the field,
  so nothing disappears from the UI.

The net effect: **one question, asked once, in the start dialog.**

---

## Implementation

### Backend

| File | Change |
| --- | --- |
| [`src/types/config.ts`](../../vox-agents/src/types/config.ts) | `SessionConfig.description?: string`; `gameMode` becomes optional and launch-time only |
| [`src/strategist/console.ts`](../../vox-agents/src/strategist/console.ts) | `--load` / `--wait` become the sole source of `gameMode`, defaulting to `start`; warn once when a loaded file still carries one |
| [`src/infra/vox-agent.ts`](../../vox-agents/src/infra/vox-agent.ts) | optional `displayName?: string` on the base class (`Strategist` already declares it abstract); `offeredInSetup = false` beside `diplomacyOnly`; select the model reference through the two-tier chain (per-seat agent entry, then size alias, per seat then globally, `small` falling back to `default` — introduced by the [two-tier model defaults plan](model-tiers.md)), then pass it to the existing `getModelConfig` |
| [`src/utils/models/resolution.ts`](../../vox-agents/src/utils/models/resolution.ts) | preflight shares `selectModelReference` (defined here, re-exported by `models.ts`); retain the existing provider-qualified ID verification and in-memory registration in `ensureModelsResolved` |
| [`src/strategist/agents/simple-strategist.ts`](../../vox-agents/src/strategist/agents/simple-strategist.ts), [`simple-strategist-staffed.ts`](../../vox-agents/src/strategist/agents/simple-strategist-staffed.ts) | `offeredInSetup = true` |
| [`src/types/api.ts`](../../vox-agents/src/types/api.ts) | `AgentInfo.displayName?` + `offeredInSetup?`; `StartSessionRequest.gameMode`; `SessionConfigsResponse` entries gain `filename` and `updatedAt`, plus a sanitized `globalLlms` map with no API keys; `DiscoveredModel` entries gain their `provider` for grouping |
| [`src/web/chat/discovery.ts`](../../vox-agents/src/web/chat/discovery.ts) | return `displayName` and `offeredInSetup` in `/api/agents` |
| [`src/web/routes/config.ts`](../../vox-agents/src/web/routes/config.ts) | new `GET /api/config/models` — merge `discoverModels` across configured providers (all required env credentials present, or the provider is named by a `config.llms` entry), dropping and reporting failures; on complete discovery failure, return only non-embedding literal object model definitions from global `config.llms`, never aliases or mappings |
| [`src/web/routes/session.ts`](../../vox-agents/src/web/routes/session.ts) | return `filename` + mtime, sorted newest first, and the sanitized global `llms` map needed to describe effective models; `/start` takes `gameMode` from the request; `/save` strips `gameMode` before writing |
| `vox-agents/configs/` | move research configs to `configs/experiments/`; add `description` to the retained starters |

### Frontend

| File | Change |
| --- | --- |
| `ui/src/utils/session-summary.ts` *(new)* | pure module: `buildSeats(answers)`, `describeConfig(config, agents, globalLlms)` → `{ role, civCount, mapSize, agenticCount, styleLabel, paceLabel, sentence, seatRows }`, where `seatRows` carries each seat's role, style, and the strategist's effective model. It resolves references with the same precedence and follows aliases, then collapses adjacent identical seats into ranges. Single source for the wizard's confirm step, the list columns and expander, and the tests |
| `ui/src/components/session/GameSetupWizard.vue` *(new)* | the four-step dialog; its civilization-count slider has minimum 2, maximum 12, and step 2; receives the agent list and global LLM mappings from its host, filters styles to `offeredInSetup`, and loads `/api/agents/pacing-interruptions` and `/api/config/models` for the interruption and model dropdowns; reuses the `setup-wizard-*` classes already in `styles/config.css`; emits the saved config so the host can open `GameModeDialog`. A selected provider-qualified model is written only to each agentic seat's `llms.default` |
| [`SessionConfigList.vue`](../../vox-agents/ui/src/components/session/SessionConfigList.vue) | accept the agent list and global LLM mappings used by `describeConfig`; add the new columns (Mode / Civs / Map / Agentic AI / Pace), expander row, search/sort, `⋯` menu, and empty state |
| [`SessionView.vue`](../../vox-agents/ui/src/views/SessionView.vue) | host the wizard; open it on `?setup=game`; load `/api/agents` once and pass it with `globalLlms` from `GET /api/session/configs` to the list and wizard, without calling `GET /api/config` because that response includes API keys; chain wizard save → `GameModeDialog` → `startSession(config, gameMode)` instead of splicing `gameMode` into the config |
| `ui/src/api/client.ts` | preserve `globalLlms` in the typed session-config response and add the typed `GET /api/config/models` call used by the game wizard |
| [`config/SetupWizard.vue`](../../vox-agents/ui/src/components/config/SetupWizard.vue) | final redirect `/session` → `/session?setup=game`, chaining model setup into game setup |
| [`ConfigDialog.vue`](../../vox-agents/ui/src/components/session/ConfigDialog.vue) | add the Description field; drop `gameMode` from the new-config template; remains the advanced editor |

### Tests

- `ui/tests/mock/utils/session-summary.test.ts` — seat generation per role using only 2, 4, 6, 8, 10, and 12
  civilizations, the `max(seat) === C-1` invariant, full-seat population, column cells and sentence rendering,
  effective strategist-model precedence and alias resolution, and `seatRows` against a mixed config: differing
  per-seat styles and effective models must not collapse, matching ones must.
- `ui/tests/mock/components/session/GameSetupWizard.test.ts` — step navigation, the civilization-count slider's
  2 to 12 range and step of 2, the config generated for each role, styles filtered to `offeredInSetup`, the
  interruption and model dropdowns ("My default" → no `llms`, explicit choice → `llms: { default }` only),
  Save-only vs Save & Play (save then hand off to the start dialog).
- Update `SessionConfigList.test.ts`, `ConfigView.test.ts`, and `router/index.test.ts` for `?setup=game`.
- Model-resolution tests: `VoxAgent.getModel` and preflight select through the shared two-tier chain
  (per-seat agent entry, then size alias, per seat then globally, `small` falling back to `default`), while
  `getModelConfig` continues recursive alias and model-ID resolution; `ensureModelsResolved` registers a selected provider-qualified model only in memory
  and preflight rejects reachable catalogue misses while preserving supported-ID synthesis when discovery
  fails.
- `tests/mock/web/routes/routes.test.ts` — new configs payload fields, including the sanitized `globalLlms`
  map; agent `displayName` / `offeredInSetup`; `GET /api/config/models` (which providers count as configured,
  that one provider's failure does not sink the merged list, and complete failure returns only non-embedding
  literal object model definitions, never string aliases or mappings); and `gameMode`: `/save` strips it,
  `/start` takes it from the request, a file that still carries one is ignored.

### Verification

`npm run type-check` in `vox-agents/ui`, both vitest suites, then a manual first-run pass: delete `config.json`
and `.env`, launch, walk model setup → game setup → start dialog, and confirm Civ V opens with the selected
even civilization count and promised map size.

## Open questions

1. **Moving research configs.** Any personal scripts passing `--config gemma-4-standard-fixed-per-5.json`
   would need the `experiments/` prefix.
2. **Per-seat models.** The wizard sets one model for all agentic civilizations, though the list and confirm
   panel render per-seat styles and models correctly. Mixed-model games remain a hand-edit; a per-seat picker
   in the advanced editor would be a natural follow-up.
3. **Ignoring a stored `gameMode`.** Research configs that relied on `"gameMode": "wait"` will now start a new
   game unless `--wait` is passed. The warning names the file, but it is a behavior change for existing
   command lines.
