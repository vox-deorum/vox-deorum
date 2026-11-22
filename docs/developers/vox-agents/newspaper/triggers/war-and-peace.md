# War and peace coverage

Use an [incident](facts.md#incident) for a declaration or settlement and the parties it drew in. Use a [pair](facts.md#pair) to follow two players over time. The stock rules `vassals-join-war` and `war-advantage-stalls` show each approach. Battle reports and city captures use event or city rules.

## From observations to one incident

The inference reads native `DeclareWar` and `MakePeace` calls in recorded order and uses permitted relationship snapshots to interpret them. The first unmatched call with a distinct, resolvable origin and target supplies a likely root. Later calls of the same kind can join it that turn when a fresh pact, vassal tie or city-state alliance connects the sides. A turn, initiator or enemy shared by unrelated calls is insufficient.

For example, if Shaka declares on Brazil and India follows its defensive pact with Brazil, the calls can become one incident. Recursive calls may repeat Shaka as the origin or even name his own team as the target. The inference can use those calls to group responses and look to relationship observations to establish additional opponent pairs.

## Incident facts in rules

A rule with `subject: incident` can report a pact drawing in the receiver with `incident.kind === 'war' && incident.knows('role') && incident.role === 'joined' && incident.reason === 'pact'`. A story can name visible participants with `incident.participants.filter(p => p.player.knows('name')).map(p => p.player.name).join(', ')`. All rules for an incident share a conflict key, so selection can publish at most one account per issue. A declaration targeting the receiver can use `urgent` to qualify for the breaking front page.

## Combining declaration reports

Each independent declaration keeps its incident. An incoming war story can name the visible city-states that joined the attacker. A city-state that declares independently gets its own incident.

When the paper is due to report **War on N fronts**, that story can absorb selected declarations by major civs still at war with the reader. It identifies the new attackers and separates the other active fronts. If that overview is unavailable, three or more distinct major civs declaring on the same turn can share a breaking headline. One or two declarations can still run separately, with each attacker's allies reported in the same story. The rules count distinct major declarers and can name their shared city-state allies once.

The editor [combines reports](../editorial.md#combining-stories) when enough articles still remain to fill the front. A combined report uses one slot and keeps the original sources. The CLI audit shows which candidates merged into it.

## When a city changes hands again

The paper combines capture reports involving the receiver when the events can be linked to the same city at the cutoff. The combined report counts the gains and losses it covers and identifies the holder in the latest readable report when known. A lone capture still has its own story.

## Pair facts in rules

To report an advantage in the receiver's war, use a `short` window with `pair.involvesSelf && pair.atWar`, `crossed(pair.warScore, pair.before.warScore, 25)` and `held(pair, s => s.warScore >= 25, 2)`. At turn 100 on Standard speed, `before` is turn 90. The last condition checks turns 98 through 100, inclusive.

| Turn 90 | Turns 98, 99, 100 | Result |
| --- | --- | --- |
| 10 | 27, 27, 30 | Fires: the score crossed 25 and stayed there for the confirmation span. |
| 10 | 18, 18, 30 | Waits: the score crossed 25 but only on the last turn. |
| 40 | 42, 42, 45 | Silent: the score was already above 25 at the baseline. |
| Hidden | 27, 27, 30 | Stops: the rule has no score to compare. |

War score is the balance of damage between two major civilizations. It has its own scale and applies to one pair, separate from national score. See [reading the past](facts.md#reading-the-past) for how gaps and phase changes affect comparisons.

## Reuse relationship helpers

Use the parser and relationship checks in `mcp-server/src/diplomacy/relationships.ts` when adding facts. Projection resolves relationship labels to unique, visible identities at the observation date. See [relationship direction and access](facts.md#relationship-direction-and-access) for what `player.relation(other)` can establish and [pair facts](facts.md#pair) for the separate pair timeline.

## How sure the facts are

| What the evidence supports | What to say in a story |
| --- | --- |
| A call records an origin and target team, but can omit the actual acting pair and the cause. The aggressor flag cannot prove who chose war. An attack redirected from a vassal records the master as the target. | Treat the root and obligations as inferred. The original vassal target may be unknown. |
| Snapshots can reveal a war opening without a declaration. | `incident.observed` can support a report that fighting was seen. Check availability before naming the attacker or assigning a role. |
| A visible deal on the same turn and after the peace calls can support concessions if it contains a matching peace term. A prior relationship and fresh evidence of a new capitulated tie can establish capitulation. | Name the visible kinds of concessions. The call establishes no proposer or winner; a readable `incident.pair.lastWarScore` describes the last recorded balance. |
| One party to a settlement has another recent known war open. City-state war lists can be incomplete. | `incident.partial` supports saying that another front is open. The war may be unrelated. |

## Where to work

| Source | Responsibility |
| --- | --- |
| `mcp-server/src/newspaper/projection.ts` | Visibility, identity matching and permitted relationship fields |
| `editorial/diplomacy/diplomacy-facts.ts` | Dated relationship lookup, pair identity and game speed |
| `editorial/diplomacy/diplomacy-incidents.ts` | Root calls, obligations and settlement context |
| `editorial/diplomacy/pair-history.ts` | Dated pair states, score history and continuity |
| `editorial/diplomacy/war-peace.ts` | Incidents, snapshot-only openings and the inference audit |
| `editorial/facts/diplomacy.ts` | Fields exposed to triggers |
| `contracts/diplomacy.ts` | Pair memory and inference audit contracts |

The relative paths start in `vox-agents/src/newspaper/`. For another story angle, add a [trigger and template](overview.md). For a new fact, extend the inference and update the [fact reference](facts.md). Test independent wars, recursive calls, gaps and skipped checks with the [CLI replay audit](../replay.md#generate-examples-from-the-command-line).

Publication saves the pair memory and advances the reporting boundary. A skipped check keeps both at the previous publication, so the next check can rebuild history across the open reporting period and consider the earlier incident again.
