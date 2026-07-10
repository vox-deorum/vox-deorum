# Archivist Episode Database Schema

## Overview

The archivist builds a DuckDB database of historical game episodes from archived games.
Each row is one **player-turn**: a snapshot of a single player's state at a single turn in a completed game.

## Source Databases

For each archived game (in `archive/{experiment}/`), three SQLite databases exist:

1. **Game DB** (`{gameId}_{timestamp}.db`) — MCP server knowledge store
2. **Telemetry DB** (`{gameId}-player-{playerId}.db`) — OpenTelemetry spans
3. **Telepathist DB** (`{gameId}-player-{playerId}.telepathist.db`) — LLM-generated summaries (built from telemetry DB if missing)

---

## DuckDB Schema

```sql
CREATE TABLE episodes (

  -- ══════════════════════════════════════════════════════════════════
  -- IDENTITY
  -- ══════════════════════════════════════════════════════════════════

  game_id         VARCHAR NOT NULL,   -- GameMetadata.Key='gameId' → Value
  turn            INTEGER NOT NULL,   -- PlayerSummaries.Turn
  player_id       INTEGER NOT NULL,   -- PlayerSummaries.Key (= PlayerID)
  civilization    VARCHAR NOT NULL,   -- PlayerInformations.Civilization WHERE Key=player_id
  is_winner       BOOLEAN NOT NULL,   -- GameMetadata.Key='victoryPlayerID' → Value == player_id

  -- ══════════════════════════════════════════════════════════════════
  -- BASIC GAME STATE
  -- ══════════════════════════════════════════════════════════════════

  -- Era as original text string from PlayerSummaries
  era             VARCHAR NOT NULL,   -- PlayerSummaries.Era (e.g. "Ancient Era", "Classical Era", ...)

  -- Latest grand strategy for this player at this turn
  grand_strategy  VARCHAR,            -- StrategyChanges.GrandStrategy
                                      --   WHERE Key=player_id AND IsLatest=1 AND Turn<=turn
                                      --   ORDER BY Turn DESC LIMIT 1

  -- ══════════════════════════════════════════════════════════════════
  -- DIPLOMATIC COUNTS
  -- Parsed from PlayerSummaries.Relationships JSON for this player_id.
  -- Relationships is Record<civName, string[]> for major civs.
  -- Each string[] entry contains status strings like:
  --   "War (Our Score: 45%; Our War Weariness: 12%)"
  --   "Defensive Pact"
  --   "Declaration of Friendship"
  --   "Denounced Them" / "Denounced By Them"
  --   "Peace Treaty (5 turns)"
  -- ══════════════════════════════════════════════════════════════════

  is_vassal         INTEGER NOT NULL DEFAULT 0,   -- whether this civ is a vassal of another ("Our Master")
  active_wars       INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "War" in relationship strings
  truces            INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "Peace Treaty" in relationship strings
  defensive_pacts   INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "Defensive Pact"
  friends           INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "Declaration of Friendship"
  denouncements     INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "Denounced Them" + "Denounced By Them"
  vassals           INTEGER NOT NULL DEFAULT 0,   -- count of major civs with "Our Vassal"
  war_weariness     REAL NOT NULL DEFAULT 0,      -- max war weariness % extracted from any "War (...War Weariness: X%)"

  -- ══════════════════════════════════════════════════════════════════
  -- RAW VALUES
  -- All from PlayerSummaries WHERE Key=player_id AND Turn=turn AND IsLatest=1
  -- unless otherwise noted
  -- ══════════════════════════════════════════════════════════════════

  score               INTEGER,    -- PlayerSummaries.Score
  cities              INTEGER,    -- PlayerSummaries.Cities
  population          INTEGER,    -- PlayerSummaries.Population
  gold_per_turn       REAL,       -- PlayerSummaries.GoldPerTurn
  culture_per_turn    REAL,       -- PlayerSummaries.CulturePerTurn
  tourism_per_turn    REAL,       -- PlayerSummaries.TourismPerTurn
  military_strength   REAL,       -- PlayerSummaries.MilitaryStrength
  technologies        INTEGER,    -- PlayerSummaries.Technologies
  votes               INTEGER,    -- PlayerSummaries.Votes
  happiness_percentage REAL,      -- PlayerSummaries.HappinessPercentage

  -- Production and food are per-city sums (not in PlayerSummaries directly)
  production_per_turn REAL,       -- SUM(CityInformations.ProductionPerTurn)
                                  --   WHERE Owner matches this player's civ name
                                  --   AND Turn=turn AND IsLatest=1
  food_per_turn       REAL,       -- SUM(CityInformations.FoodPerTurn) same filter

  -- Policy count: sum of all individual policies across branches
  policies            INTEGER,    -- PlayerSummaries.PolicyBranches JSON:
                                  --   Record<branchName, string[]>
                                  --   → sum of all array lengths

  -- Minor ally count
  minor_allies        INTEGER,    -- Count minor civs (IsMajor=0) in PlayerSummaries
                                  --   where that minor's MajorAlly matches this player's civ name

  -- ══════════════════════════════════════════════════════════════════
  -- VICTORY PROGRESS
  -- From VictoryProgress table (Key=0, IsLatest=1, Turn=turn)
  -- Each field is this player's progress percentage (0-100) or null
  -- if the victory type is unavailable/not yet unlocked.
  -- Player lookup: parse JSON column, use this player's civ name as key.
  -- ══════════════════════════════════════════════════════════════════

  domination_progress   REAL,   -- DominationVictory JSON → {CivName}.CapitalsPercentage (0-100)
                                --   null if DominationVictory is a string ("Not available")

  science_progress      REAL,   -- ScienceVictory JSON → {CivName}.PartsPercentage (0-100)
                                --   null if ScienceVictory is a string or not yet unlocked

  culture_progress      REAL,   -- CulturalVictory JSON → {CivName}.InfluentialCivs / CivsNeeded * 100
                                --   null if CulturalVictory is a string ("Not available")

  diplomatic_progress   REAL,   -- DiplomaticVictory JSON → {CivName}.VictoryPercentage (0-100)
                                --   null if DiplomaticVictory is a string or not yet unlocked

  -- Leader progress: the current contender's progress for each victory type.
  -- Useful for measuring how far behind the leader this player is.
  -- Extracted from the Contender's entry in the same JSON object.
  -- null if the victory type is unavailable or no contender exists.
  domination_leader_progress  REAL,  -- DominationVictory → Contender's CapitalsPercentage (0-100)
  science_leader_progress     REAL,  -- ScienceVictory → Contender's PartsPercentage (0-100)
  culture_leader_progress     REAL,  -- CulturalVictory → Contender's InfluentialCivs / CivsNeeded * 100
  diplomatic_leader_progress  REAL,  -- DiplomaticVictory → Contender's VictoryPercentage (0-100)

  -- ══════════════════════════════════════════════════════════════════
  -- ADJUSTED, SHARE & PER-POP VALUES
  --
  -- Shares (city-adjusted):
  --   Step 1: city_multiplier = MAX(1.05 * (cities - 1), 1.0)
  --           {metric}_adj = {metric}_per_turn / city_multiplier
  --   Step 2: {metric}_share = player_{metric}_adj / SUM(all_players_{metric}_adj)
  --   Step 3: shares scaled by knownMajors / totalMajors when only partial
  --           player data is visible (e.g. unmet civs not in PlayerSummaries)
  --   For non-per-turn fields (cities, population, votes, minor_allies):
  --           {metric}_share = player_value / SUM(all_players_value)  (then scaled)
  --
  -- Per-pop values (science, faith, production, food, culture, gold):
  --   raw = {metric}_per_turn / population
  --   Science/faith use PlayerSummary.SciencePerTurn/FaithPerTurn
  --   (not stored as raw columns since they're only visible to self)
  --   scaled = clamp(raw, 1, 20) / 20   → range [0, 1]
  -- ══════════════════════════════════════════════════════════════════

  culture_per_pop     REAL,       -- culture_per_turn / population (raw ratio)
  tourism_share       REAL,       -- tourism_adj / sum(all players' tourism_adj)
  gold_per_pop        REAL,       -- gold_per_turn / population (raw ratio)
  science_per_pop     REAL,       -- SciencePerTurn / population (raw ratio)
  faith_per_pop       REAL,       -- FaithPerTurn / population (raw ratio)
  production_per_pop  REAL,       -- production_per_turn / population (raw ratio)
  food_per_pop        REAL,       -- food_per_turn / population (raw ratio)
  military_share      REAL,       -- military_adj / sum(all players' military_adj)
  cities_share        REAL,       -- cities / sum(all players' cities)
  population_share    REAL,       -- population / sum(all players' population)
  votes_share         REAL,       -- votes / sum(all players' votes)  (null if no world congress)
  minor_allies_share  REAL,       -- minor_allies / sum(all players' minor_allies)

  -- ══════════════════════════════════════════════════════════════════
  -- GAP VALUES (relative to leader among all alive major players)
  -- ══════════════════════════════════════════════════════════════════

  technologies_gap    INTEGER,    -- player.technologies - MAX(all players' technologies)
                                  --   0 for leader, negative for others
  policies_gap        INTEGER,    -- player.policies - MAX(all players' policies)
                                  --   0 for leader, negative for others

  -- ══════════════════════════════════════════════════════════════════
  -- DERIVED PERCENTAGES
  -- ══════════════════════════════════════════════════════════════════

  religion_percentage REAL,       -- percentage of world cities following the religion

  -- Ideology metrics (from PolicyBranches JSON)
  -- Ideology branch is one of: Freedom, Order, Autocracy (or null if not yet chosen)
  ideology_allies     INTEGER NOT NULL DEFAULT 0,
                                        -- count of alive major players (including self) that share
                                        --   the same ideology branch; 0 if no ideology chosen
  ideology_share      REAL NOT NULL DEFAULT 0,
                                        -- ideology_allies / count(alive major players)
                                        --   0 if no ideology chosen

  supply_utilization  REAL,             -- military_units / military_supply (0-1 range)
                                        --   null if military_supply is 0 or unavailable

  -- ══════════════════════════════════════════════════════════════════
  -- VECTORS (stored as REAL[] arrays in DuckDB)
  -- ══════════════════════════════════════════════════════════════════

  -- Game-state vector (35 elements), normalized/scaled:
  --   [0]  era / 7 * 2                              (Ancient=0 .. Information=7, double weighted)
  --   --- Grand strategy one-hot (4 elements) ---
  --   [1]  conquest                             (0 or 1)
  --   [2]  culture                              (0 or 1)
  --   [3]  diplomacy (United Nations)           (0 or 1)
  --   [4]  science (Spaceship)                  (0 or 1)
  --   --- Shares (normalized: *majorCount, clamp [0.25,4.0] → [0,1]) ---
  --   [5]  tourism_share
  --   [6]  military_share
  --   [7]  cities_share
  --   [8]  population_share
  --   [9]  votes_share                          (0.5 if null)
  --   [10] minor_allies_share
  --   --- Per-pop metrics ---
  --   [11] science_per_pop                      (clamped [1,10] then normalized)
  --   [12] faith_per_pop                        (clamped [1,10] then normalized)
  --   [13] production_per_pop                   (clamped [1,10] then normalized)
  --   [14] food_per_pop                         (clamped [1,10] then normalized)
  --   [15] culture_per_pop                      (clamped [1,10] then normalized)
  --   [16] gold_per_pop                         (clamped [1,10] then normalized)
  --   --- Gaps ---
  --   [17] technologies_gap                     (bidirectional, gap/20+0.5)
  --   [18] policies_gap                         (bidirectional, gap/10+0.5)
  --   --- Percentages ---
  --   [19] happiness_percentage / 100           (clamped to [0, 1])
  --   [20] religion_percentage                  (clamped to [0, 1])
  --   [21] ideology_share                       (already 0-1; 0 if no ideology)
  --   [22] supply_utilization                   (clamped to [0, 1])
  --   --- Diplomatic ---
  --   [23] is_vassal                            (0 or 1)
  --   [24] vassals / 2                          (clamped to [0, 1])
  --   [25] war_weariness / 100                  (clamped to [0, 1])
  --   [26] active_wars / 3                      (clamped to [0, 1])
  --   [27] truces / 3                           (clamped to [0, 1])
  --   [28] friends / 3                          (clamped to [0, 1])
  --   [29] defensive_pacts / 3                  (clamped to [0, 1])
  --   [30] denouncements / 3                    (clamped to [0, 1])
  --   --- Victory gaps (leader - player, (gap+50)/100) ---
  --   [31] domination gap                       (clamped to [0, 1])
  --   [32] science gap                          (clamped to [0, 1])
  --   [33] culture gap                          (clamped to [0, 1])
  --   [34] diplomatic gap                       (clamped to [0, 1])
  game_state_vector   REAL[],

  -- Neighbor vector: 8 fixed slots, sorted by strength_ratio descending.
  -- Each slot = [strength_ratio, stance, tech_gap, policy_gap] = 4 features.
  -- Total: 8 * 4 = 32 elements. Empty slots filled with neutral values:
  --   [strength_ratio=0.2, stance=0.5, tech_gap=0.5, policy_gap=0.5]
  -- Only consider civilizations with Distance: Neighbors, OR Distance: Close + hostile or below.
  --
  -- Per-neighbor values come from comparing this player with each major civ
  -- neighbor (those present in PlayerSummaries.Relationships for this player):
  --
  --   strength_ratio:  neighbor.MilitaryStrength / player.MilitaryStrength
  --                    → clamp to [0, 5], then / 5 → range [0, 1]
  --   stance:          parsed from Relationships string array (see Neighbor Stance Priority):
  --                      war=4, denounced/master=3, neutral=2, dof/vassal=1, def_pact=0
  --                    → / 4 → range [0, 1]
  --   tech_gap:        neighbor.Technologies - player.Technologies
  --                    → / 10, clamp to [0, 1]
  --   policy_gap:      neighbor.policies - player.policies
  --                    → / 5, clamp to [0, 1]
  --
  -- Stance determination priority (from Relationships strings):
  --   contains "War"                        → 4 (war)
  --   contains "Denounced"                  → 3 (hostile)
  --   contains "Our Master"                 → 3 (hostile - they own us)
  --   contains "Declaration of Friendship"  → 1 (friendly)
  --   contains "Our Vassal"                 → 1 (friendly - we own them)
  --   contains "Defensive Pact"             → 0 (ally)
  --   else                                  → 2 (neutral)
  neighbor_vector     REAL[],

  -- ══════════════════════════════════════════════════════════════════
  -- TELEPATHIST SUMMARIES
  -- From {gameId}-player-{playerId}.telepathist.db
  -- Table: turn_summaries WHERE turn=turn
  -- ══════════════════════════════════════════════════════════════════

  situation_abstract  TEXT,        -- turn_summaries.situationAbstract  (2-3 sentence situation summary)
  decision_abstract   TEXT,        -- turn_summaries.decisionAbstract  (2-3 sentence decision summary)
  situation_abstract_embedding REAL[], -- embedding on the situation_abstract
  situation           TEXT,        -- turn_summaries.situation  (world state paragraph)
  decisions           TEXT,        -- turn_summaries.decisions  (strategic decisions made)

  -- ══════════════════════════════════════════════════════════════════
  -- LANDMARK FLAG
  -- Pre-selected by diversity-first batch process (selector.ts).
  -- Ensures a representative, non-redundant subset for retrieval.
  -- ~1 landmark per 10 turns per player.
  -- ══════════════════════════════════════════════════════════════════

  is_landmark         BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (game_id, turn, player_id)
);
```

---

## Game Outcomes Table

Stores per-game metadata for outcome capping and victory type reporting in retrieval.
Populated during Phase A from `GameMetadata` keys.

```sql
CREATE TABLE game_outcomes (
  game_id           VARCHAR NOT NULL PRIMARY KEY,  -- matches episodes.game_id
  winner_player_id  INTEGER NOT NULL,              -- GameMetadata.Key='victoryPlayerID' → Value (-1 if no winner)
  victory_type      VARCHAR,                       -- GameMetadata.Key='victoryType' → mapped via victoryTypeMap
                                                   --   'Time', 'Science', 'Domination', 'Cultural', 'Diplomatic', or null
  max_turn          INTEGER NOT NULL               -- MAX(turn) across all episodes for this game
);
```

## Data Flow

```
archive/{experiment}/
  ├── {gameId}_{ts}.db                    ──┐
  │   ├── GameMetadata                      │  identity, is_winner, experiment
  │   ├── PlayerInformations                │  civilization, isMajor lookup
  │   ├── PlayerSummaries (versioned)       │  all raw values, relationships, era
  │   ├── StrategyChanges (versioned)       │  grand_strategy
  │   ├── CityInformations (versioned)      │  production_per_turn, food_per_turn
  │   └── VictoryProgress (versioned)       │  victory progress & contender flags
  │                                         ├──→ extractor.ts ──→ transformer.ts ──→ writer.ts ──→ DuckDB
  ├── {gameId}-player-{pid}.db            ──┤
  │   └── spans                             │  (used by telepathist prep only)
  │                                         │
  └── {gameId}-player-{pid}.telepathist.db──┘
      ├── turn_summaries                       situationAbstract, decisionAbstract, situation, decisions
      └── phase_summaries                      (available but not stored in episodes)
```

## Querying Versioned Data (MutableKnowledge)

MutableKnowledge tables (PlayerSummaries, StrategyChanges, CityInformations) store
multiple versions per turn. Each row has:
- `Key` — entity ID (PlayerID or CityID)
- `Turn` — game turn number
- `Version` — incrementing version within a turn
- `IsLatest` — 1 if this is the most recent version for this Key+Turn

To get the canonical snapshot for a player at a turn:
```sql
SELECT * FROM PlayerSummaries
WHERE Key = :playerId AND Turn = :turn AND IsLatest = 1
```

To get all alive major players at a turn (for computing shares):
```sql
SELECT ps.* FROM PlayerSummaries ps
JOIN PlayerInformations pi ON pi.Key = ps.Key
WHERE ps.Turn = :turn AND ps.IsLatest = 1 AND pi.IsMajor = 1
```

## Era Mapping (for game_state_vector only)

The `era` column stores the original string. For the vector, map to integer:

```
"Ancient Era"      → 0
"Classical Era"    → 1
"Medieval Era"     → 2
"Renaissance Era"  → 3
"Industrial Era"   → 4
"Modern Era"       → 5
"Atomic Era"       → 6
"Information Era"  → 7
```

## Grand Strategy Mapping (for game_state_vector only)

The `grand_strategy` column stores the original string. For the vector, one-hot encoded as 4 binary variables:

```
[1] "Conquest"         → [1, 0, 0, 0]
[2] "Culture"          → [0, 1, 0, 0]
[3] "United Nations"   → [0, 0, 1, 0]
[4] "Spaceship"        → [0, 0, 0, 1]
null / unknown         → [0, 0, 0, 0]
```

## Neighbor Stance Priority

When a player's Relationships entry for a neighbor contains multiple status strings,
use the highest-priority match:

| Priority | Match string                    | Stance value | Normalized (/4) |
|----------|---------------------------------|--------------|------------------|
| 1 (high) | `"War"`                         | 4            | 1.0              |
| 2        | `"Denounced"`                   | 3            | 0.75             |
| 3        | `"Our Master"` (is their vassal)| 3            | 0.75             |
| 4 (low)  | (default / neutral / guarded)   | 2            | 0.5              |
| 5        | `"Declaration of Friendship"`   | 1            | 0.25             |
| 6        | `"Our Vassal"`                  | 1            | 0.25             |
| 7        | `"Defensive Pact"`              | 0            | 0.0              |

Neutral fill value for empty neighbor slots: **0.5** (stance=2/4).

## Computing Religion Percentage

`religion_percentage` measures how many world cities follow this player's founded religion.
Requires city-level data from `CityInformations`:

1. Look up this player's `FoundedReligion` from `PlayerSummaries` (null if none founded → 0)
2. Query all `CityInformations` at this turn (`IsLatest=1`) for all alive players (major + minor)
3. Count cities where `MajorityReligion` matches this player's `FoundedReligion`
4. `religion_percentage = matching_cities / total_cities` (0–1 range)

If the player has not founded a religion, `religion_percentage = 0`.

## Computing Ideology Share

`ideology_share` measures the proportion of major civs sharing this player's ideology.
Ideology is determined from the `PolicyBranches` JSON in `PlayerSummaries`:

1. Parse `PolicyBranches` (Record<branchName, string[]>) for this player
2. Identify if any branch key is `"Freedom"`, `"Order"`, or `"Autocracy"` → that is the player's ideology
3. If no ideology chosen → `ideology_allies = 0`, `ideology_share = 0`
4. Otherwise, check all alive major players' `PolicyBranches` for the same ideology branch
5. `ideology_allies` = count of players (including self) with the same ideology
6. `ideology_share = ideology_allies / count(alive major players)`

## Computing Minor Ally Counts

`minor_allies` counts the number of city-states allied to this player.
Requires cross-referencing player summaries:

1. Identify all minor civs: `PlayerInformations` where `IsMajor = 0`
2. For each minor civ, get their `PlayerSummaries` at this turn (`IsLatest=1`)
3. Check if `MajorAlly` matches this player's civilization short description
4. `minor_allies` = count of matching minor civs

**Cache optimization**: Build a lookup map of `{ civName → player_id }` for all major players,
and a list of `{ minor_id, MajorAlly }` per turn. Reuse across all players in the same turn
to avoid redundant queries.

## Computing Victory Progress

`domination_progress`, `science_progress`, `culture_progress`, and `diplomatic_progress`
measure how close this player is to each victory condition. Extracted from the `VictoryProgress`
table (Key=0, global knowledge visible to all players):

1. Query `VictoryProgress WHERE Key = 0 AND Turn = :turn AND IsLatest = 1`
2. For each victory type column (`DominationVictory`, `ScienceVictory`, `CulturalVictory`, `DiplomaticVictory`):
   - Parse JSON. If the value is a string (e.g. `"Not available"`, `"Unlocked in..."`),
     set progress to `null` and contender to `0` for all players
   - If parsed as an object, look up this player's civilization name as a key
3. Extract per-player progress:
   - **Domination**: `{CivName}.CapitalsPercentage` (0-100)
   - **Science**: `{CivName}.PartsPercentage` (0-100)
   - **Culture**: `{CivName}.InfluentialCivs / CivsNeeded * 100` (0-100)
   - **Diplomatic**: `{CivName}.VictoryPercentage` (0-100)
4. Extract leader progress: look up the `Contender` field value as a civ name key
   in the same parsed object, then extract the same percentage field as above.
   If `Contender` is null or the contender's civ name is not in the object, set to `null`.

If a player's civ name is not present as a key in the parsed object (e.g. dead or not
participating), set their progress to `null`.

**Cache optimization**: Parse the VictoryProgress row once per turn, then look up each
player's civ name. Reuse across all players in the same turn.

## Pipeline Modules

| Module              | Responsibility                                                    |
|---------------------|-------------------------------------------------------------------|
| `index.ts`          | CLI entry point, orchestrates pipeline                            |
| `scanner.ts`        | Discovers archive entries (game DBs + telemetry DBs)              |
| `telepathist-prep.ts` | Ensures telepathist DBs exist, calls preparation if needed      |
| `extractor.ts`      | Reads game DB + telepathist DB, produces raw episode records      |
| `transformer.ts`    | Computes adjusted values, shares, gaps, vectors                   |
| `embeddings.ts`     | Generates situation abstract embeddings via AI SDK                |
| `writer.ts`         | Kysely/DuckDB output (episodes + game_outcomes tables)            |
| `similarity.ts`     | Composite similarity: TypeScript (batch) + SQL builder (retrieval)|
| `selector.ts`       | Diversity-first landmark pre-selection (uses TS similarity)       |
| `reader.ts`         | Read-only DuckDB retrieval pipeline (uses SQL similarity)         |
| `query-types.ts`    | Retrieval query, result & outcome interfaces                      |

## Similarity Computation

Two pathways for computing composite similarity, sharing the same formula and weight presets:

**Formula**: `w_gs * cos(game_state_vector) + w_nb * cos(neighbor_vector) + w_em * cos(situation_abstract_embedding)`

### Pathway 1: In-House TypeScript
Used by `selector.ts` during batch landmark selection. Vectors are already in memory — no DB round-trips needed.

### Pathway 2: DuckDB SQL
Used by `reader.ts` during runtime retrieval. Scoring happens inside SQL queries using `list_cosine_similarity()`.

### Weight Presets

| Preset                       | game_state | neighbor | embedding | Usage                     |
|------------------------------|------------|----------|-----------|---------------------------|
| `retrievalWeights`           | 0.4        | 0.3      | 0.3       | Runtime with situation abstract |
| `retrievalNoEmbeddingWeights`| 0.6        | 0.4      | 0         | Runtime without abstract       |

`compositeSimilarity()` auto-selects weights based on embedding availability.
The selector uses `compositeSimilarity()` with default weights (no embeddings present),
which resolves to `retrievalNoEmbeddingWeights` (0.6/0.4/0) for landmark selection.

## Retrieval Pipeline

At runtime, `reader.ts` executes a 3-stage pipeline:

```
Stage 1: Score (SQL) → Stage 2: Fetch Outcomes (SQL) → Stage 3: Diversity Select (TS)
```

### Stage 1: Two-Pass Composite Score

**Pass 1 — Fuzzy Pre-Filter** (cheap scalar comparisons, no vectors):
Scores landmarks using attribute bonuses only, takes top 200 into a CTE.
All proximity-scored attributes use the same decay formula: `bonus * max(0, 1 - 0.5 * |stored - query|)` (exact=full, ±1=half, ±2+=zero).

| Attribute | Weight | Type |
|-----------|--------|------|
| Era | 8 | Proximity (ordinal distance) |
| Civilization | 5 | Exact match |
| Grand strategy | 3 | Exact match |
| Active wars | 3 | Proximity |
| Friends | 2 | Proximity |
| Defensive pacts | 2 | Proximity |
| Truces | 2 | Proximity |
| Denouncements | 2 | Proximity |
| **Max sum** | **27** | |

**Pass 2 — Vector Similarity** (on candidates only):
Ranks candidates by vector similarity alone (game_state_vector, neighbor_vector, optional embedding). Fuzzy score is not carried forward — it serves only as the pre-filter. Orders by similarity score, limits to `candidateLimit`.

Note: `fetchCandidates` also joins `game_outcomes` via `LEFT JOIN` to include `victory_type` in the result set.

### Stage 2: Fetch Outcomes
Self-joins episodes at future horizons for the same `(game_id, player_id)`.
Horizon turns are capped at the game's max turn via `LEAST(e.turn + horizon, g.max_turn)` using `game_outcomes`.
A `WHERE f.turn > e.turn` guard prevents self-joining when a landmark is at the final turn.
When multiple horizons resolve to the same capped turn, deduplication via `ROW_NUMBER()` keeps only the smallest horizon.
Computes share deltas as formatted strings (`+3%`, `-1%`). Horizon=20 omits decisions.
Not stored — computed dynamically at query time.

### Stage 3: Diversity Select
Greedy MMR in TypeScript (`lambda=0.7`) to select the final diverse result set.
Pairwise similarity computed entirely in TypeScript using `compositeSimilarity()`.

1. Pick top-scored candidate
2. For each remaining: `mmr = 0.7 * normalizedScore - 0.3 * max_sim_to_selected`
3. Pick highest MMR, repeat until `resultLimit`
