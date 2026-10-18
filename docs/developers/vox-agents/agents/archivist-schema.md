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

`src/archivist/pipeline/extractor.ts` reads the raw state. `transformer.ts` and the helpers under `src/archivist/utils/` compute the following values.

| Fields | Interpretation |
| --- | --- |
| Identity and raw state | Game, player, civilization, turn, eventual winner, era, grand strategy, diplomatic counts, yields, cities, population, military, technologies, policies, and votes. |
| `tourism_share`, `military_share` | City-adjusted shares, scaled by the number of known major players. |
| `cities_share`, `population_share`, `votes_share`, `minor_allies_share` | Raw shares, scaled by the number of known major players. For all share fields, 1 means an average player's share. |
| `*_per_pop` | The corresponding yield divided by population. Science and faith come from the player summary even though their raw yields have no episode column. |
| `technologies_gap`, `policies_gap` | Best other major player's count minus this player's count. Negative means leading, positive means behind, and missing comparison data yields zero. |
| `supply_utilization` | Military units divided by military supply, or null when the inputs are missing or supply is not positive. |
| `religion_percentage` | Fraction of recorded cities following the player's founded religion, or zero without one. |
| `ideology_allies`, `ideology_share` | Known major players sharing the player's ideology, including the player, and their fraction of known majors. Both are zero without an ideology. |
| `*_progress`, `*_leader_progress` | Victory progress on a 0 to 100 scale, or null when unavailable. |
| Summary fields | `situation_abstract`, `decision_abstract`, full `situation` and `decisions`, and an optional `situation_abstract_embedding`. |

Shares can exceed 1. The religion and ideology fractions use a 0 to 1 scale; victory progress and war weariness use percentage values. Preserve those distinctions when building queries or displaying results.

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
