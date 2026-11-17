# Plan 6: trigger rules

**Status: design documented; implementation not started.** The target behavior is described in the [trigger overview](../../../developers/vox-agents/newspaper/triggers/overview.md), [facts](../../../developers/vox-agents/newspaper/triggers/facts.md), [constants and shortcuts](../../../developers/vox-agents/newspaper/triggers/constants.md), [examples](../../../developers/vox-agents/newspaper/triggers/examples.md) and [war and peace](../../../developers/vox-agents/newspaper/triggers/war-and-peace.md) pages. This plan is for the developer who builds it. See the [roadmap](../implementation.md) for the other stages.

## Goal

Replace the 32 fixed detectors with rules. A trigger becomes a JavaScript expression over a fact model, so a story such as "a neighboring foreign city changed from puppet to occupied" is a catalogue entry. Code supplies facts, including distance and other inferred facts. Gameplay value comes first: facts are inferred freely from the MCP server databases.

## Decisions

| Area | Decision |
| --- | --- |
| Expression language | JavaScript, run in QuickJS, for every condition: triggers, templates, variants, weights, pages and designs |
| Engine | The QuickJS sandbox in `just-bash` (`js-exec`), already a dependency of `vox-agents` for the player workspace. The player workspace mounts folders that `js-exec` can read and write; the newspaper runner mounts none. Step 1 confirms it is fast enough; the fallback is a direct `quickjs-emscripten` dependency. |
| Existing catalogue | All current triggers and templates are dropped. The documented examples are re-added as the starting set. |
| War and peace | The inference code stays and produces `incident` and `pair` facts. Its triggers become ordinary rules. |
| Compatibility | None for old trigger IDs, the `op`/`field`/`value` conditions, `compositeOf`, or saved publication checkpoints. Start fresh runs. |

## Build order

| Step | Work | Done when |
| --- | --- | --- |
| 1. Expression runner | A shared runner in `editorial/shared/` that compiles catalogue expressions once and evaluates them against supplied objects in QuickJS. Evaluate a whole check in one sandbox call, since starting the sandbox per rule would be slow. Report syntax errors at catalogue load. | A test evaluates 200 expressions over 100 subjects in one call, and the measured time per check is recorded here. |
| 2. Evidence | In `mcp-server/src/newspaper/`: add the events and fields listed under [evidence the facts rely on](../../../developers/vox-agents/newspaper/triggers/facts.md#evidence-the-facts-rely-on), resolve unit and building types to names, and resolve city owners to players. Match `CityTrained` to `UnitCreated` by unit ID to learn the unit type. Make the `PlayerGoldenAge` schema accept the `Status` field the DLL sends and read a boolean `true` as starting. Let snapshot and event reads reach the longest trigger `window` or `long`, and include each subject's last row before that point. | Visibility tests cover each added event and field for a receiver with and without access. |
| 3. Fact model | Builders under `editorial/facts/` for `city`, `player`, `event` and the globals, with hex distance, snapshots (`before`, `previous`, `at`, `history`), hidden-fact handling and source references. | Tests cover each inferred fact with a present value, a hidden value and a first observation. |
| 4. Constants and shortcuts | `vox-agents/newspaper/constants.json`, its schema, overlay merging, game-speed scaling of spans, and `is.<name>` shortcuts. | A constant overridden in an overlay changes the outcome of a rule that uses it. |
| 5. Trigger evaluation | The new trigger schema, subject listing, ordered `when` evaluation, `values`, `importance`, `urgent`, `repeat` state, `group`, and the audit record. Remove `developments/` detectors and the detector dispatch. | The two owner examples, `neighbor-puppet-annexed` and `settler-departure`, fire on controlled evidence and stay silent when one `when` entry is false. |
| 6. War and peace facts | Reshape `diplomacy/` output into `incident` and `pair` facts and delete its trigger creation. The existing `resumed`, `observed` and `partial` stages become the flags of the same names, and the pair keeps its last wartime score as `lastWarScore`. | The documented incident and pair rules fire on the existing diplomacy test recordings. |
| 7. Templates and other conditions | Move template, variant, weight, page and design conditions to expressions. Templates name `triggers` and read `values`. Remove `shared/conditions.ts` and `compositeOf`. | The example templates publish, and a variant with a false `when` is never chosen. |
| 8. Starting catalogue | Add the triggers from the examples page with full templates. | Each starting trigger fires in a test with controlled evidence, and a fresh replay of the Netherlands recording publishes issues from the new catalogue. |
| 9. Reading | Read the replay with the owner and tune constants and importance. | The owner accepts the starting set as a base for writing more rules. |

## Open points

| Question | How to settle it |
| --- | --- |
| Is `js-exec` fast enough for one batched call per check? | Measure in step 1 with a realistic fact model. Switch to `quickjs-emscripten` when a check takes more than about a second. |
| How are facts passed into the sandbox? | Start with a JSON document plus a small bootstrap script that wraps it in accessor objects. Hidden facts need the accessor to stop the rule, so plain JSON alone is not enough. |
| Should recordings store map width for wrap-aware distance? | Add it to `GameMetadata` during step 2 when the change is small. Existing recordings keep unwrapped distance. |
| Which unit and building names go into the type lists? | Take them from the Netherlands recording's `UnitCreated` and `CityConstructed` events in step 4. |

## Verification

```sh
npm run build -w mcp-server
npm run test:mock -w mcp-server -- tests/newspaper
npm run test:mock -w vox-agents -- tests/mock/newspaper
npm run type-check -w vox-agents
npm run build:newspaper -w vox-agents
```

After step 8, generate a fresh replay with the [replay CLI](../../../developers/vox-agents/newspaper/replay.md#generate-examples-from-the-command-line) and confirm each example trigger appears in at least one audit, either firing or stopping at a named `when` entry.

When each step lands, remove the "target design" status line from the developer pages it completes and delete the finished row from this plan.
