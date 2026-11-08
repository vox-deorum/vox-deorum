# Archivist episode database

The [Archivist](archivist.md) stores player-turn snapshots in DuckDB for similarity search. This reference explains how to interpret the stored values. Paths below are relative to `vox-agents/`.

## Tables and sources

| Table | Key | Contents |
| --- | --- | --- |
| `episodes` | `game_id`, `turn`, `player_id` | Identity, raw state, derived metrics, feature vectors, summaries, and the `is_landmark` flag. |
| `game_outcomes` | `game_id` | `winner_player_id`, `victory_type`, and `max_turn`. |

`src/archivist/pipeline/writer.ts` defines the SQL columns and types. `src/archivist/types.ts` defines their TypeScript counterparts; the database uses snake_case and TypeScript uses camelCase.

The scanner accepts a flat archive or experiment subfolders. Each eligible player needs a game knowledge database and a telemetry database. A telepathist database may already exist or be generated during summary preparation. The extractor reads the latest version of each turn's knowledge rows and any available turn summaries. Missing source metrics and summaries can remain null.

## Metrics

`src/archivist/pipeline/extractor.ts` reads the raw state. `transformer.ts` and the helpers under `src/archivist/utils/` compute the derived values.

### Shares

**Known major players** are major civilizations with both a player summary and player information in the turn context, including the player being measured. Share fields divide the player's value by the known players' total, then multiply by the number of known majors. A stored value of **1** means an average share, values below 1 mean less, and values above 1 mean more. Shares can exceed 1.

| Field                | Value used for the share                   |
| -------------------- | ------------------------------------------ |
| `tourism_share`      | Tourism per turn, adjusted for city count  |
| `military_share`     | Military strength, adjusted for city count |
| `cities_share`       | City count                                 |
| `population_share`   | Population                                 |
| `votes_share`        | Votes                                      |
| `minor_allies_share` | Allied minor civilizations                 |

For **city-adjusted shares**, each player's value is first divided by `max(1.05 × (cities − 1), 1)`. The share then uses those adjusted values and the same known-major scaling. Missing comparison values are omitted; missing inputs for the measured player or a nonpositive total yield null.

### Other fields and scales

| Fields | Interpretation |
| --- | --- |
| Identity and raw state | Game, player, civilization, turn, eventual winner, era, grand strategy, diplomatic counts, yields, cities, population, military, technologies, policies, and votes. |
| `*_per_pop` | The corresponding yield divided by population, or null for missing inputs or zero population. Science and faith come from the player summary even though their raw yields have no episode column. |
| `technologies_gap`, `policies_gap` | Best other major player's count minus this player's count. Negative means leading, positive means behind, and missing comparison data yields zero. |
| `supply_utilization` | Military units divided by military supply, or null when the inputs are missing or supply is not positive. |
| `religion_percentage` | Fraction of recorded cities following the player's founded religion, or zero without one. |
| `ideology_allies` | Count of known major players sharing the player's ideology, including the player; zero without an ideology. |
| `ideology_share` | Fraction of known majors sharing the player's ideology, on a 0 to 1 scale; zero without an ideology. |
| `*_progress`, `*_leader_progress` | Victory progress on a 0 to 100 scale, or null when unavailable. |
| `war_weariness` | War weariness as a percentage value. |
| Summary fields | `situation_abstract`, `decision_abstract`, full `situation` and `decisions`, and an optional `situation_abstract_embedding`. |

Keep the units distinct in queries and displays: religion and ideology use 0 to 1 fractions, victory progress and war weariness use percentages, and scaled shares use 1 for an average share.

## Feature vectors

`src/archivist/utils/vectors.ts` defines the vector layout and normalization.

| Vector | Size | Contents |
| --- | --- | --- |
| `game_state_vector` | 35 | Era, grand strategy, shares, yields per population, technology and policy gaps, happiness, religion, ideology, supply, diplomacy, and victory gaps. |
| `neighbor_vector` | 32 | Eight slots of four values: relative military strength, stance, technology gap, and policy gap. Only major civilizations marked Neighbors or Close qualify, ordered by distance and then descending strength. Empty slots use neutral padding. |

Era occupies a 0 to 2 range in the game-state vector. Grand strategy uses four one-hot entries: Conquest, Culture, United Nations, and Spaceship. Other features have their own clamping and missing-value rules in `vectors.ts`; the stored metrics retain their original scales.

## Similarity and outcomes

The TypeScript and SQL scoring helpers in `src/archivist/utils/similarity.ts` combine cosine similarities with weights from `types.ts`:

| Available input        | Game state | Neighbors | Text embedding |
| ---------------------- | ---------- | --------- | -------------- |
| Situation embedding    | 0.4        | 0.3       | 0.3            |
| No situation embedding | 0.6        | 0.4       | 0              |

Outcomes are computed at query time by `src/archivist/retrieval/reader.ts`. The input and output contracts are in `src/archivist/query-types.ts`. See [Archivist](archivist.md#retrieval) for the retrieval sequence and its defaults.
