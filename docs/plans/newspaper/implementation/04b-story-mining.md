# Plan 4b: story mining through the archivist

**Status: draft.** Start from interesting stories and work backwards to triggers. [Plan 4c](04c-variant-drafting.md) writes variants for the stories accepted here using the tags from [Plan 4a](04a-styles.md).

## Goal and success criteria

Have LLMs read random moments from saved games as if they edited that civilization's paper, and collect every story they would run. Cluster the pitches, remove duplicates, and sort what remains into story types the catalogue can support.

This stream wants many ideas. A pitch that misreads the data is still useful if the story type is good, so nothing checks pitches against the evidence.

Done means:

- One [archivist](../../../developers/vox-agents/agents/archivist.md) command writes pitches from the saved games in `mcp-server/archive/`, and a second step clusters them and writes a sorted backlog.
- The owner has reviewed the backlog and marked the story types to build.
- Each accepted story type that existing facts can support has a trigger rule and a template stub in the catalogue. The others are listed with the fact they need.

```mermaid
flowchart LR
    A[Saved games] --> B[Archivist scanner: LLM-controlled players]
    B --> C[Random turns per player]
    C --> D[Reading material from telemetry]
    D --> E[Story scout, the run's model]
    E --> F[story_pitches table]
    F --> G[Cluster and sort]
    G --> H[Owner picks story types]
    H --> I[Trigger rules and template stubs]
```

## Current state

| Need | What exists | Source |
| --- | --- | --- |
| Find games and players | `scanArchive` lists each game's knowledge and telemetry databases and its LLM-controlled players. | `archivist/pipeline/scanner.ts` |
| What a civilization saw on a turn | `GetSituationTool` rebuilds the game state the LLM player was shown from telemetry, by category: players, victory progress, military, cities, events, and the strategist's options. | `telepathist/tools/get-situation.ts` |
| Era and civilization per turn | Phase A writes an episode row per player and turn, with no LLM. | `archivist/pipeline/extractor.ts`, `writer.ts` |
| Run with a chosen model | `-m` picks the model; each game is processed by one model. | `archivist/console.ts` |
| Embeddings and similarity | `generateEmbeddings` and `cosineSimilarity`. | `archivist/pipeline/embeddings.ts`, `archivist/utils/similarity.ts` |
| Story pitches and clustering | Nothing. | |

Paths are relative to `vox-agents/src/`. Only LLM-controlled players have telemetry, so only they are read. That is enough: the `self-play` folder alone holds 19 games with one LLM player each.

## Approach

Add a **stories mode** to the archivist (`--stories`). It runs Phase A as today, then a stories step in place of landmark selection, turn summaries and episode embeddings, none of which stories need. The strategist plays no part: stories read only the game state the player was shown. Each run uses one model, chosen with `-m`. Running again with another model adds that model's pitches beside the first.

| Alternative | Why this plan does not use it |
| --- | --- |
| Read landmark turns | Landmarks favor unusual game states. Random turns also cover ordinary ones, where everyday stories live. |
| Read turn summaries | They compress away the small details that odd and funny stories come from, and stories do not need them. |

## Steps

1. **Build the reading material.** Call `GetSituationTool` in detailed mode for the sampled turn with every category except the strategist's options. Stories take the game state at face value: no options, decisions or reasoning from the strategist.
2. **Sample.** For each player, pick `--story-turns` random turns (default 6) from a seeded generator (`--seed`), one from each equal slice of the player's recorded turns, so early and late play both appear.
3. **Ask for pitches.** Add a `story-scout` agent with a prompt in `prompts/`, registered in `agentRegistry`. It tells the model it edits this civilization's paper and asks for 5 to 10 stories of any kind it would want to run, including small, odd and funny ones. Each pitch has:

   | Field | Content |
   | --- | --- |
   | `subject` | City, civilization, pair of civilizations, event, or the whole world. |
   | `genre` | The kind of story. |
   | `stance` | The editorial position it takes. |
   | `voice` | How the story sounds. |
   | `pitch` | One or two sentences on the story and why a reader would care. |
   | `headline` | A working headline. |
   | `content` | A short draft in the chosen voice. |
   | `basis` | What in the reading material prompted it. |
   | `wants` | Anything the model wished it knew to write the story. This points at missing facts. |

4. **Store pitches.** Add a `story_pitches` table to the episode database, keyed by game, player, turn and model, with the civilization, era, pitch fields and an embedding of headline plus pitch. A rerun skips samples that already have rows for the run's model, so an interrupted run resumes; `--force` redoes them. Pitches can be browsed in the DuckDB UI the archivist already opens.
5. **Cluster and sort.** A separate step reads every model's pitches from the table. Group greedily: a pitch joins the first cluster whose center is at least 0.8 similar (a starting value, tuned by reading the output), otherwise it starts a new one. Write `clusters.md` to `.tmp/newspaper-mining/` with each cluster's size, how many models and eras produced it, and three sample pitches. Size and spread show which ideas are common and which are one model's quirk; both kinds are worth reading.

   Then a stronger model (`--sort-model`) reads each cluster with the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md), the [facts reference](../../../developers/vox-agents/newspaper/triggers/facts.md) and the current catalogue IDs, names the story type and puts it in one bucket:

   | Bucket | Meaning | Next step |
   | --- | --- | --- |
   | Covered | A stock template already tells this story. | Note any new angle for Plan 4c. |
   | New angle | An existing rule fires; a new template is enough. | Template stub. |
   | New rule | Existing facts can express the trigger. | Rule and template stub. |
   | Needs a fact | The story needs something the fact model lacks. | List the fact and where it would come from. |
   | Style idea | The pitch is about tone or format. | Pass to the owner with the drafting notes. |
   | Drop | Not a newspaper story, or impossible to observe. | None. |

   Write `backlog.md` beside `clusters.md` as one table sorted by cluster size. Expect mistakes in bucketing; the owner's review corrects them.
6. **Owner picks.** The owner marks story types to build and can merge or rename them. List the existing probe stories from `vox-agents/newspaper/probes/` in the same backlog, so the owner decides in one pass which of them become stock stories.
7. **Work backwards to triggers.** For each accepted story type in the "new angle" and "new rule" buckets, add the trigger rule and a template stub to the catalogue: the angle in one sentence, the named values the prose may use, tags, and one neutral report variant. Follow the [rule authoring guide](../../../developers/vox-agents/newspaper/triggers/overview.md) and check each rule in replay against the recording the mined pitch came from. Record "needs a fact" story types in the roadmap as follow-up work. Plan 4c takes the stubs from here.

## Risks and open questions

- **Cost.** Samples ≈ games × LLM players × story turns, per model. Run one game first to measure tokens per sample before the full archive.
- **Reading material size.** A late-game turn can be large. On context overflow, skip the sample and log it, as turn summaries already do.
- **Sameness.** Models may converge on war and wonders. If clusters are narrow, add prompt variants that ask for a section, such as city life or trade.
- **Which models.** The owner picks one per run. Any model reference the Vox Agents configuration accepts will work.
- **Embedder.** Pitch embeddings need the configured `embedder` model. Without one, pitches are stored without embeddings and clustering waits until they are added.

## Verification

- Mock tests under `tests/mock/archivist/`: the same seed gives the same turns; pitches round-trip through `story_pitches` and a rerun skips them; a second model's pitches sit beside the first's; controlled vectors cluster as expected; an archivist run without `--stories` is unchanged.
- Run `npm run build -w vox-agents` and `npm run test:mock -w vox-agents -- tests/mock/archivist`.
- Run stories mode on one `self-play` game and read the pitches, clusters and backlog by hand.

## Out of scope

Checking pitches for accuracy, writing finished prose (Plan 4c), players without telemetry, and new facts that need recording changes.
