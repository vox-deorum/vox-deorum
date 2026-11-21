# Newspaper trigger facts

The **receiver** is the player the newspaper is written for. [Trigger rules](overview.md) read facts allowed by that player's recorded access. Stored facts come from recorded rows. Inferred facts combine those rows, such as a city's distance from the receiver or its former owner. [Stock examples](examples.md) show both in use.

| Subject | One per |
| --- | --- |
| [`city`](#city) | City visible at the cutoff |
| [`player`](#player) | Known major or city-state at the cutoff |
| [`event`](#event) | Permitted event in the reporting period |
| [`pair`](#pair) | Two visible players with a known war or peace observation |
| [`incident`](#incident) | Inferred declaration, settlement or observed war opening |

Stock [stakes](constants.md#stakes) are available on city, player, pair and event facts. A rule can also read a stake through a linked subject, such as `pair.other.stake.front` when the receiver is in the pair.

## Naming

| Rule | Example |
| --- | --- |
| A stored column keeps its name in camelCase. | `FoodPerTurn` becomes `city.foodPerTurn` |
| A yes-or-no column is true or false. | `city.isPuppet` |
| A stored value that is empty reads as `null`, which is different from [hidden](#hidden-and-missing-facts). | `city.majorityReligion` is `null` for a city with no majority religion |
| A list column is a JavaScript array. | `city.wonders.includes('Petra')` |
| A fact that names another subject returns that subject. | `city.owner.era`, `player.capital.population` |
| Names recorded as text stay as recorded. | `player.era == 'Medieval Era'` |

## Globals

Every expression can read these, whatever its subject.

| Name | Contains |
| --- | --- |
| `self` | The receiver, as a `player` |
| `players` | Every known player, including `self` |
| `cities` | Every city the receiver can see |
| `events` | Every permitted event in the trigger's window, oldest first |
| `turn` | The cutoff turn of this check |
| `game` | `speed` (the recorded game speed name), `speedMultiplier`, `mapSize`, `startEra`, `maxTurns`, and `congress` when league observations exist |
| `press` | Publication memory: `issues` (published issue count) and `lastIssueTurn` (turn of the latest issue, or `null`) |
| `printed(ruleId, subject?)` | `{turn, count}` for published articles a rule supported, or `null` when none. The optional `subject` limits the count to one city, player or pair. See [publication memory](overview.md#publication-memory). |
| `distance(a, b)` | Hex distance between players, cities, plots or events. See [distance](constants.md#distance). |

The **reporting period** runs from the turn after the last published edition through the cutoff. Before the first edition, it starts at the first replay turn. A trigger's **window** defaults to that period. A custom `window` changes historical comparisons and lists such as the global `events`; the subjects of event and incident rules still come from the reporting period.

## City

`city` is one row of `CityInformations` at the cutoff turn, plus inferred facts.

### Stored city facts

| Access | Facts |
| --- | --- |
| Basic (any city the receiver can see) | `id`, `name`, `x`, `y`, `population`, `majorityReligion`, `defenseStrength`, `hitPoints`, `maxHitPoints`, `isCapital`, `isPuppet`, `isOccupied`, `isCoastal`, `wonders`, `razingTurns`, `resistanceTurns` |
| Detailed (recorded full access to a team city or [spy insight](#covert-presence-and-roster-points)) | `foodStored`, `foodPerTurn`, `productionStored`, `productionPerTurn`, `currentProduction`, `productionTurnsLeft`, `goldPerTurn`, `sciencePerTurn`, `culturePerTurn`, `faithPerTurn`, `tourismPerTurn`, `happinessDelta`, `unhappiness`, `buildingCount`, `importantBuildings`, `greatWorkCount` |

`city.happinessDelta` is net local happiness: negative is unhappy, positive is a surplus. `city.unhappiness` breaks local unhappiness into causes. An empty `UnhappinessSources` object sets all causes to 0; missing or malformed data leaves the breakdown hidden. The strategist's city report gives only net happiness.

| Key | Cause |
| --- | --- |
| `culture` | Boredom from culture |
| `gold` | Poverty from gold |
| `science` | Illiteracy from science |
| `distress` | Distress from food |
| `religion` | Religious unrest |
| `isolation` | Isolation |
| `famine` | Famine |
| `pillaged` | Pillaged tiles |
| `buildings` | Buildings |
| `specialists` | Specialists |
| `top` | The name of the largest recorded positive cause, or `null` if there is none |

The causes omit occupation and empire-wide unhappiness. Population caps and special handling for resistance, razing and puppets can also make them differ from net happiness. `top` breaks ties in table order.

`player.complaintShare(causes)` gives the share of visible cities whose leading cause is on the list. It counts only cities with a readable, non-null `unhappiness.top` and returns 0 when there are none or the city list is unavailable.

### Inferred city facts

| Fact | Meaning | Inferred from |
| --- | --- | --- |
| `owner` | The owning `player` | The [recorded owner match](#evidence-the-facts-rely-on) |
| `own` | The receiver owns it | `owner` is `self` |
| `foreign` | Someone else owns it | `owner` is another player |
| `distance.own` | Hex distance to the nearest city of the receiver; 0 for the receiver's own cities | City coordinates |
| `distance.capital` | Hex distance to the receiver's capital | City coordinates and `self.capital` |
| `nearestOwn` | The receiver's `city` closest to this one | City coordinates |
| `founded` | Recorded founding turn, or an estimate from first sighting | A `PlayerCityFounded` or `UnitCityFounded` event at its plot; otherwise the first observation after the recording began, when the city's history is continuous |
| `captured` | The latest capture: `turn`, plus `from` and `by` (players) and `conquest` when known | `CityCaptureComplete` and `CityFlipped` within this city's history |
| `formerOwner` | The `player` who owned it before the current owner | `captured.from`; otherwise the most recent different owner in the same city's continuous observations |
| `trained` | Units completed inside the window, with `turn` and, when known, `unit` (type), `withGold`, `withFaith` and `port` | `CityTrained` and the [unit creation match](#evidence-the-facts-rely-on) |
| `built` | Buildings and wonders completed inside the window, each with `turn` and `building` | `CityConstructed` events and additions to `wonders` |
| `conversions` | Religion changes inside the window, each with `turn` and `religion` | `CityConvertsReligion` events at its plot and changes to `majorityReligion` |
| `events` | Every permitted event inside the window that names this city or its plot | Event city IDs and coordinates |
| `ourSpyPresent` | The receiver's spy is stationed in this city | The receiver's `PlayerSummaries.Spies` roster, matched by location to a unique recorded city and owner. A readable roster that shows no spy gives `false`; missing or ambiguous evidence is hidden. |
| `is.<name>` | A [shortcut](constants.md#shortcuts), such as `city.is.neighbor` | The catalogue |

The `neighbor-puppet-annexed` rule infers annexation from `city.before.isPuppet && !city.isPuppet && city.isOccupied` and an unchanged owner.

For the receiver's own training events, `port` gives the city name when both purchase flags are explicitly false and the creation predates training on the same turn. The launch probe also limits eligible unit types. See [the ship launch replay](../replay.md#replaying-front-reports-and-ship-launches) for an example.

## Player

`player` joins a player's identity from `PlayerInformations` with its `PlayerSummaries` row at the cutoff turn.

### Stored player facts

| Group | Facts |
| --- | --- |
| Identity | `id` (the player ID), `name` (from `Civilization`), `leader`, `teamId`, `major` (from `IsMajor`), `cityState` (the opposite of `major`), `human` (from `IsHuman`) |
| Standing | `score`, `era`, `votes`, `technologies` (count), `currentResearch`, `policyBranches`, `nextPolicyTurns` |
| Size | `cityCount`, `population`, `territory` |
| Economy | `gold`, `goldPerTurn`, `happinessPercentage`, `goldenAge`, `resources`, `outgoingTradeRoutes`, `incomingTradeRoutes` |
| Output | `sciencePerTurn`, `culturePerTurn`, `faithPerTurn`, `tourismPerTurn` |
| Military | `militaryUnits`, `militarySupply`, `militaryStrength` |
| Religion | `foundedReligion`, `majorityReligion` |
| Diplomacy | `diplomaticDeals` and the projected `majorAlly` and `relationships` |

The stored `Cities` column becomes `cityCount`; `player.cities` lists visible cities. The receiver's own votes, resources, unit count, supply and deals require full access. Foreign summaries expose fewer fields; `militaryStrength` needs full access or the receiver's own summary. City-states can have identity, ally, city count, population, gold, income, technologies, resources and relationships. A readable summary can make an identity visible even with no readable national values.

`self.happinessPercentage` measures national happiness on a 0 to 100 scale. At 50, happy and unhappy citizens are in balance.

### Tactical observations

`self.tacticalZones` uses the receiver's latest cutoff row per zone: `zoneID`, `city` if a readable city matches, `domain`, `posture` and `units` counted by known civilization, known city-state or barbarians and by unit type. Zone zero holds unassigned units and is omitted. No eligible rows leaves the fact hidden. Only the seat itself can read its zones.

A posture such as `Withdraw` comes from the receiver AI. Only occupied zones are recorded, so the last sighting of the turn can outlast the units and a missing zone leaves their movement unknown. Sea zones can include land units. `previousPosture` uses the row for the same visible city and zone at the reporting boundary when available.

`city.tacticalZones()` matches the cutoff city name and absolute zone ID, so it can find both land and sea zones. It returns an empty list if no known zone matches, or `undefined` when the city identity or cutoff zones are unavailable.

### Quest deadlines and cultural influence

On a city-state, `player.questDeadlines` estimates expiry from English countdowns in the receiver's tooltip. `player.questObservationTurn` dates the tooltip. Ambiguous copies of the active player's tooltip are omitted. These dates support reminders; the offer date and reason for disappearance remain unknown.

On a known foreign major, `player.culturalInfluenceChanges` reads dated `VictoryProgress` observations. `outgoing` measures our influence over them and `incoming` measures theirs over us. The ratio compares tourism with the target's culture. Either direction can be unknown.

### Inferred player facts

| Fact | Meaning | Inferred from |
| --- | --- | --- |
| `self` | This player is the receiver | Identity |
| `cities` | The player's cities that the receiver can see | `city.owner` |
| `capital` | The player's capital `city` | The city with `isCapital` among `cities` |
| `distance` | Smallest hex distance between any city of this player and any city of the receiver; 0 for the receiver | City coordinates |
| `outgoingTradeRouteCount` | Number of route records at this snapshot. An empty map gives 0; a missing or malformed map is hidden. | `outgoingTradeRoutes` |
| `ideology` | The player's ideology name, or `null` when the record shows no matching branch. Hidden when branch data is unavailable. | Keys of `policyBranches` and the catalogue's `ideologies` list |
| `atWar` | In at least one known war | `relationships` |
| `wars` | The players it is known to be at war with | `relationships` |
| `enemy` | At war with the receiver | `relationships` |
| `friend` | Declared friendship with the receiver | `relationships` |
| `ally` | Defensive pact with the receiver, or a city-state allied to the receiver | `relationships`, `majorAlly` |
| `vassal`, `master` | The receiver's vassal, or the receiver's master | `relationships` |
| `relation(other)` | The relationship with any other player: `war`, `friend`, `pact`, `vassalOf`, `masterOf`, `warScore`, `denouncedThem`, `denouncedByThem`, `openBordersTo`, `openBordersFrom`, `proximity`, `warWeariness`, `influence`, `protected` | `relationships`, through the helpers in `mcp-server/src/diplomacy/relationships.ts` |
| `rank(field)` | Position among known majors with a visible number on that date. Equal numbers share a position. If only our score is visible, it ranks 1 in a comparison of one. | The named fact across `players` |
| `events` | Every permitted event inside the window that names this player or its team | Event player and team IDs |
| `ourDiplomatThere` | The receiver has a diplomat posted to this foreign major's capital | The receiver's spy roster, counting diplomats and vassal diplomats schmoozing at the recorded capital. A readable roster that shows none gives `false`; missing or ambiguous evidence is hidden. |
| `theirDiplomatHere` | This foreign major has a diplomat at the receiver's capital | That player's spy roster, read separately from our own. A readable roster that shows none gives `false`; missing or ambiguous evidence is hidden. |
| `is.<name>` | A [shortcut](constants.md#shortcuts), such as `player.is.rival` | The catalogue |

The two diplomat facts apply to known foreign majors. Policy and deal insight comes from the receiver's outgoing diplomat.

### Relationship direction and access

Each `relationships` entry shows what its own summary recorded. `relation(other)` combines the newest observations of the two players. If neither has an entry or a recorded gap, its basic flags read `false`, which leaves peace unconfirmed. An unreadable or conflicting war report hides the war flag and score.

| Fields | Direction and access |
| --- | --- |
| `denouncedThem`, `denouncedByThem` | The subject denounced the other player, or the reverse. A positive reading wins a same-turn disagreement. A negative reading needs the denouncing player's full major entry. |
| `openBordersTo`, `openBordersFrom` | The subject granted borders to the other player, or the reverse. Each needs the grantor's own entry; a negative reading requires full major access. |
| `proximity` | The recorded label, such as `Close`, preferring the subject's entry if both are current. |
| `warWeariness` | The subject's own reading on a 0 to 100 scale. Requires full access to a major at war with another major. |
| `influence`, `protected` | A major's signed influence over a city-state and whether it protects it. Either side can supply the reading. |

For example, `relation(other).knows('openBordersFrom')` checks whether the reverse grant is readable.

### Policy names

Both helpers return `true` on an exact match and cite the national row, or return `undefined` when the name cannot be established. Basic access supplies branch counts; full access or [diplomat insight](#covert-presence-and-roster-points) can reveal policy names.

| Helper | What matches |
| --- | --- |
| `player.hasBranch('Fealty')` | A readable branch key, including one with only a policy count. |
| `player.hasPolicy('Secularism')` | A recorded policy name. A branch count alone cannot establish a policy name. |

### Technology milestones

`self.hasTechnology('Printing Press')` looks up the receiving team's latest change for that recorded display name through the cutoff, even before the trigger window. It returns `true` for a gain from research, grants or theft, or `false` for a loss, and cites the event. Rivals, earlier snapshots and unlogged technologies, including some starting technologies, give `undefined`. Use an era fallback if needed.

### Covert presence and roster points

Spy rosters match roles and locations. A nonnegative network balance also identifies intelligence gathering or schmoozing across game languages. A clear miss or empty roster establishes absence. Missing rosters, ambiguous matches or unrecognized states without a balance leave presence unknown.

| Insight | Points and station |
| --- | --- |
| Another major's city detail through a spy | 500 current points at the city at both observation and cutoff. |
| Foreign policy names through a diplomat | 200 points at the foreign capital. |
| Foreign deal terms through diplomats | 800 points at each foreign party's capital. |

Current facts use the cutoff roster; events use the latest roster from an earlier turn. Spending points can reduce the recorded balance while the game still grants its bonus, so a story can be withheld.

## Congress

`game.congress` describes the World Congress or United Nations from the newest recorded diplomatic victory observation. It is absent when the recording has no usable observation, for example when diplomatic victory was disabled. Recorded vote outcomes remain available through `ResolutionResult` events.

| Fact | Meaning |
| --- | --- |
| `available` | The league exists in the newest observation. An observation with `available` false reads as a known empty agenda. |
| `observedTurn` | Recorded turn of the newest observation. It can be before the cutoff. |
| `league` | Recorded league name, when present. |
| `votingNow` | True only when the newest observation is at the cutoff and records a vote in progress. An older record never claims current voting. |
| `expectedSessionTurn` | Estimated next session turn from the newest recorded countdown. Omitted when that date has passed or the observation has no countdown. |
| `diplomaticVictoryVotesNeeded` | Votes needed for diplomatic victory. |
| `proposals` | Current proposals. Each has `name` and `isEnact`, plus `proposer` and `description` when recorded. |
| `activeResolutions` | Current resolutions. Each has `name`, plus `description` and `enactedTurn` when recorded. |
| `newProposals` | Proposals first seen in this reporting period. Each has the proposal fields plus `observedTurn`. |

`newProposals` compares proposal direction and name with the last known agenda, even across gaps. With no earlier agenda, every proposal in the first one is new. `observedTurn` approximates when it appeared and cites the `VictoryProgress` rows. For the outcome of a proposal that leaves the agenda, read a `ResolutionResult` event.

`activeResolution(prefix)` returns the first active resolution whose name starts with the prefix, or `undefined` when there is no readable match. Use it as a condition or read its name with optional chaining.

## Event

`event` is one permitted row of `GameEvents`.

| Fact | Meaning |
| --- | --- |
| `type` | The recorded event type, such as `CityCaptureComplete` |
| `id` | The recorded event's row ID |
| `turn` | The recorded turn, or the receiver's next turn for a delayed defender report. The source citation keeps the original date. |
| Payload fields | Each permitted field in camelCase. An ID may also offer a link: `oldOwnerId` comes with `oldOwner` when the player can be resolved. |
| Recorded names | `tech`, `policy`, `branch`, `oldBranch`, `newBranch`, `religion`, `unit` and `building` hold the names as recorded. A numeric ID alone does not supply a name. |
| `person`, `kind` | A named great person's own name and what happened: `born`, `expended` (used for an action) or `died` |
| `player` | The main acting player, or the only linked member of an acting team |
| `players` | Linked members of an acting team (`teamId`), known at the event date and the cutoff |
| `city` | The cutoff city that matches the event's city ID or plot and ownership evidence |
| `plot` | `x` and `y`, when the event has a location |
| `distance.own` | Hex distance from `plot` to the receiver's nearest city at the cutoff |

A player ID of -1 means "nobody" and provides no player link. [Event policy](#evidence-the-facts-rely-on) controls which IDs and names can reach rules.

| Event | Names offered |
| --- | --- |
| `CityCaptureComplete` | `oldOwner`, `newOwner`, `isCapital`, `isConquest`, `city` |
| `PlayerCityFounded` | `player`, `plot`, `city` (the city now at that plot) |
| `SetAlly` | `minorPlayer`, `oldAllyPlayer`, `newAllyPlayer` |
| `PlayerGoldenAge` | `player`, `starting`. With a recognized flag, a positive award or extension reads `true`, as does a start flag without a numeric change. An end flag with zero change reads `false`; other cases leave it hidden. |
| `TeamTechResearched` | `teamId`, `players`, `player` for a single linked member, `tech`. A witnessed event also carries `changeAmount`; a negative value means the team lost the technology. A gain can come from research, a grant or theft. |
| `EspionageResult` | `perspective` (`source` or `target`), `spyResult`, `cityName` when recorded, and links to the parties when their identity is available. The source may also get an inferred `tech` name. |
| `ElectionResultSuccess`, `ElectionResultFailure` | `player`, signed `influenceChange`, and `cityState` when the capital's label resolves. Failure applies only to a player with a recorded spy in the election. |
| `PlayerAdoptPolicyBranch` | `player`, `branch` |
| `UnitCreated` | `player`, `unit`, `plot`. A named great person adds `person` and `kind: 'born'`. Unwitnessed births supply only the owner and name. |
| `GreatPersonExpended` | `player`, `unit`, `plot`. A named great person adds `person` and `kind: 'expended'`. |
| `UnitPrekill` | `player` (the owner), `unit`, `plot`, `person`, `kind: 'died'` and `attackingPlayer` when the final removal records a known attacker |
| `ResolutionResult` | Public vote outcome: `isEnact` (true for enactment, false for repeal), `passed`, `resolutionType` (recorded name or numeric type), and the raw `decision`. The `proposerName` and `proposerPlayerId` are available when recorded. `player` links to a proposer with the usual dated contact. |

The defender can report a detected operation from its next recorded turn if it still appears to hold the city. `Identified` and `Killed` can reveal the source. `Detected` and `KilledNotIdentified` keep it anonymous; `Undetected` gives no defender report. The recording leaves notification delivery unknown.

The spy's owner can infer a technology name when exactly one named gain by its team follows in the next ten event IDs that turn and only one operation matches that gain. A killed spy can still have completed the operation. A gain could also come from research or a grant, so use wording such as "may have obtained." For an example, see [the private espionage replay](../replay.md#replaying-private-espionage-reports).

## Pair

`pair` uses the lower player ID as `a`. Both players must be visible at the cutoff and have at least one known war or peace observation. A later gap can leave the current state hidden.

| Fact | Meaning |
| --- | --- |
| `a`, `b` | The two players |
| `id` | Both player IDs in order, for example `2/7` |
| `involvesSelf` | The receiver is one of them |
| `other` | The player who is not the receiver, when `involvesSelf` |
| `majors` | Both are major civilizations |
| `atWar` | They are observed at war |
| `warScore` | Recorded score from -100 to 100 for two majors at war. Requires a reading from the receiver when `involvesSelf`, or from `a` otherwise. |
| `warTurns` | Recorded turns since the war was first observed; 0 when at peace |
| `peaceTurns` | Recorded turns of peace anchored by a known settlement or an observed change from war to peace. An initially peaceful relationship has no anchor. |
| `lastWarScore` | While at peace, the last recorded score of the war that ended, when known |
| `friends`, `pact` | Declared friendship, defensive pact |
| `is.<name>` | A [shortcut](constants.md#shortcuts), such as `pair.is.foreignWar` |

## Incident

`incident` describes a war or peace development inferred from visible evidence. [War and peace](war-and-peace.md) explains how the editor groups it and judges what the records support.

| Fact | Meaning |
| --- | --- |
| `kind` | `war` or `peace` |
| `id` | The inferred incident's identifier, shared by stories about that declaration or settlement |
| `turn` | The turn of the calls or relationship observation |
| `initiator`, `target` | The players of the likely first call, when the direction is known |
| `pair` | The pair's state at the incident turn, when available |
| `participants` | Visible majors linked to the calls, each with `player`, `side` (`initiator` or `target`) and `reason` (`root`, `pact`, `vassal`, `master`, `cityStateAlly`, `inherited`) |
| `cityStates` | Visible city-states involved |
| `cityStateParticipants` | Visible city-states with an inferred `player`, `side`, and `reason` |
| `hostileCityStateAllies` | City-state participants that joined the attacker when we were the target |
| `directDeclaration` | A native war root recorded as an attack with no inferred inherited war |
| `earlierWarOpponents` | Visible opponents whose current war with us was recorded before this incoming declaration, each as a `player` reference |
| `role` | The receiver's part when known: `initiator`, `target`, `joined` or `none` |
| `reason` | Why the receiver takes part, when known, using the participant vocabulary |
| `resumed` | For war: the two had fought before and were known to be at peace |
| `observed` | For war: the opening or a city-state joining was seen in relationship snapshots without a matching declaration. The direction and roles may be hidden. |
| `partial` | For peace: one of the two settling players still has another recent war open |
| `concessions` | For peace: the kinds of visible concessions, empty when none are visible |
| `capitulation` | For peace: a new capitulated vassal relationship followed |

## Reading the past

`city`, `player` and `pair` offer the same accessors. `city` is used below.

| Accessor | Reads | Example |
| --- | --- | --- |
| `city.population` | The value at the cutoff turn | `city.population >= largeCity` |
| `city.before` | The snapshot at the start of the trigger's `window` | `city.population < city.before.population` |
| `city.previous` | The snapshot at the reporting boundary, just before the first turn covered | `!city.previous.isOccupied` |
| `city.at(span)` | The snapshot that many recorded turns ago, up to `long` | `city.at(long).owner.id != city.owner.id` |
| `city.history` | Distinct readable observations inside the window, oldest first | `city.history.some(s => s.foodPerTurn < 0)` |

A dated city or player snapshot uses the latest readable row at or before that date, subject to gaps and city lifetime. It keeps stored facts and dated helpers such as `city.owner`, `player.rank(field)` and `player.relation(other)`. Use these accessors on the cutoff subject.

For a pair, `before`, `previous` and `at(span)` can read past flags and durations across a transition. Earlier war scores from a different phase or across a recorded gap are hidden. `pair.history` includes only the current phase and a late start can leave the start date or earlier scores outside loaded history. See the [worked score example](war-and-peace.md#pair-facts-in-rules).

| Helper | Meaning | Example |
| --- | --- | --- |
| `held(subject, test, span)` | The test held on each of the last `span` turns. Pairs also check the starting boundary and need an actual sample in the current phase on every checked turn. A gap returns `false`; a span starting outside loaded history is hidden. | `held(city, s => s.foodPerTurn < 0, short)` |
| `crossed(now, before, boundary)` | The value rose from below the boundary to it or above | `crossed(city.population, city.before.population, metropolis)` |
| `dropped(now, before, boundary)` | The value fell from the boundary or above to below it | `dropped(player.happinessPercentage, player.before.happinessPercentage, 50)` |
| `pct(now, before)` | Relative change, where 0.25 is a 25% rise. A zero baseline is unknown. | `pct(player.sciencePerTurn, player.before.sciencePerTurn) >= 0.25` |
| `changed(subject, field)` | The fact differs from its value in `before` | `changed(city, 'majorityReligion')` |

Pass an already scaled [named span](constants.md#spans) or a count of recorded turns to `at` and `held`. Lists support standard JavaScript methods such as `some`, `filter` and `map`. Sort a copy to keep the original list intact.

## Hidden and missing facts

Use `subject.knows(field)` before reading a fact that may be hidden. For example, `city.knows('foodPerTurn') && city.foodPerTurn > 0` tests food only for cities with the required access. A player unknown on the requested turn has no readable relationship fact for that turn.

A hidden read in a condition, value, tier, or urgency expression stops the rule for that subject or group and names the fact in the audit. In an `adjust` expression, a hidden read contributes 0 points and the other adjustments still run. See [stakes](constants.md#stakes) for checking a shared calculation's inputs.

The first sighting gives a baseline for later comparisons. If the receiver first saw a rival city on turn 8, `city.before` is unavailable for any earlier date. `city.founded` may estimate turn 8 if the loaded history reaches the recording's start and the observation begins after that start. For a story about a witnessed founding, require a founding event.

## Evidence the facts rely on

MCP's `newspaper/queries.ts` returns cutoff snapshots, optional comparison snapshots, tactical observations, diplomacy and events after `previousCheckTurn` through the cutoff. With `historyFromTurn`, it also returns a readable baseline at the earlier of that turn and `previousCheckTurn`, then final observations per subject and turn, gaps and permitted events. Use `-1` to include turn 0. A witnessed capture or raze can end a city observation even if a party's identity is hidden. Missing coordinates or tied timestamps can leave stale snapshots and raise lifecycle limitations.

`newspaperEventConfigs` in `mcp-server/src/newspaper/projection.ts` lists eligible event types and fields. Most events require recorded visibility and contact with the named players or all members of a named team. The barbarian slot is treated as known for witnessed events. Contact uses the latest summary available as of the event turn. A missing refresh at the end of a round can hide a meeting that turn; future contact never grants access retroactively.

| Policy | What reaches the editor |
| --- | --- |
| Receiver involved | War and peace calls and some other events can reach the receiver despite an unknown party if it or its team took part. Dated contact controls which IDs and names a rule sees; one known member can establish a team ID. |
| World news | Technology gains and named great person births can appear without a witness if the receiving player knows the owner or the whole team. Only the owner or team ID and recorded name are supplied. |
| Private and public reports | Espionage reports go to the spy's owner and can reach the defender; elections report only to the affected player. Congress vote outcomes are public. |
| Policy adoption | Requires full access to the player or 200 diplomat points from a roster before the event turn. |
| Deal terms | Text and structured terms share one access gate: contact with parties and named players or teams, plus participation in the deal or 800 diplomat points with each foreign party. |
| Embedded labels | Recorded player and city labels require dated contact with the corresponding player or city owner. Liberation keeps the city ID; its owner and city label are unavailable. |

For example, unwitnessed world news can report that Hypatia appeared in Persia with no city or unit type. Great person uses and deaths require recorded visibility. A death uses the final removal and is suppressed by a use that turn. Same-turn conversions, including gifts, supply no birth or death story. Named stories need a recorded personal name, which the strategist's `get-events` omits.

| Join | Required evidence |
| --- | --- |
| City owner | A unique civilization match for a major or the barbarian slot. For the shared `City-States` label, use a readable founding or capture at the plot, or a unique name match when there is no ownership boundary. Ambiguity leaves the owner hidden. |
| Event position | A unique earlier readable city row matching city ID and owner, with no intervening change. Trade routes keep separate endpoints; `CapitalChanged` locates the new capital. |
| Trained unit | A unique visible same-turn `UnitCreated` with matching player and unit IDs and a recorded type name. A launch can use the unique creation that came before training. |

Facts cite the recorded source and any `relatedSources` used in joins. A player's static name cites the national row that made the player visible. A public game setting has no dated source; map dimensions and wrapping stay private. Use [Inspect cutoff](../replay.md#read-replay-diagnostics) to see the source rows and lifecycle limitations behind a replay.

## Add a fact

1. Check that the evidence exists in MCP's projection. When it does not, extend `newspaperEventConfigs` or the city and player field lists, and add a visibility test under `mcp-server/tests/newspaper/`.
2. Add the fact to the builder for its subject under `vox-agents/src/newspaper/editorial/facts/`. Keep the original source rows attached, so the audit and the reader's source inspection still work.
3. Decide what "hidden" means for it and return hidden when the inputs are missing.
4. Add a row to the table on this page with its meaning and what it is inferred from.
5. Add a focused test under `vox-agents/tests/mock/newspaper/editorial/facts/` with a present value, a hidden value and a first observation.
