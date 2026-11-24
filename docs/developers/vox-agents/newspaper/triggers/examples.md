# Newspaper trigger examples

Use the settler overlay to change a story's score and wording. The stock rules below show other patterns to borrow.

## A city shrinks after sending settlers

[`settler-departure`](overview.md#a-first-example) rates the story by how much population the city lost. To give the capital and large cities more weight, set `adjust` to `["city.stake.place", "10 * lost"]` for `settler-departure` in your overlay's `triggers/` folder. A capital shrinking from eight to six scores 73: 45 for the `routine` tier, 8 for the capital, and 20 for the population loss.

To edit the neutral report, save this as `<overlay>/templates/cities-settlement.json`:

```json
[
  {
    "id": "settler-departure-account",
    "variants": [
      {
        "id": "settler-departure-report",
        "headline": "Settler party prepares to leave {{city}}",
        "body": ["{{city}} has trained a party of settlers. Its population has fallen, and it still has food to spare."]
      }
    ]
  }
]
```

Run a [fresh replay](../replay.md#iterate-on-a-rule-or-overlay) with the overlay. The overlay keeps the report's condition and city link. In the audit, check the adjusted score and the selected variant.

## Cities and borders

Domestic and foreign rules share the topical `cities-*.json` files in [triggers/](../../../../../vox-agents/newspaper/triggers/). Many foreign stories share [foreign-cities.json](../../../../../vox-agents/newspaper/templates/foreign-cities.json). Use [city facts](facts.md#city) to distinguish basic snapshots, detailed readings, and linked events. Population rankings such as `capital-outgrown` use own cities.

| Rule | What to borrow |
| --- | --- |
| `city-puppet-annexed`, `neighbor-puppet-annexed` | Compare two snapshots of an own city or a foreign city within `neighboring`. The city goes from puppet to occupied under the same owner. |
| `city-courthouse-completed`, `foreign-city-courthouse-completed` | Use a witnessed Courthouse or Satrap's Court completion or purchase in an occupied, non-puppet city. This ends the occupation unhappiness penalty; the game's occupation flag can remain set. |
| `city-celebration-begins`, `foreign-city-celebration-begins` | Use the witnessed `CityBeginsWLTKD` event and a readable city linked to its owner. A nearby foreign celebration also needs a matching player and city owner. |
| `forward-settle` | Use `PlayerCityFounded` or `UnitCityFounded`, and prefer `PlayerCityFounded` when both report the same settlement. The rule covers rival settlements within `adjacent` of our nearest city, so `foreign-city-founded` leaves them alone. Urgency stays at two tiles or less. |
| `foreign-city-founded` | Report any other eligible local founding within `nearby` (15 tiles). Require a readable city name and owner, and skip a `UnitCityFounded` duplicate of a `PlayerCityFounded` event. |
| `foreign-building-investment-made` | Require the witnessed `CityInvestedBuilding` event for a nearby foreign city with a readable name. Name the building and owner, and suppress the report for a later completion or purchase with the same recorded building name in the reporting window. |
| `foreign-city-growth-milestone`, `foreign-city-defense-completed` | Read growth from same-owner population snapshots and defenses from a witnessed `CityConstructed` completion, including a purchase. |
| `besieged-and-starving` | Combine the `besieged` and `starving` shortcuts for an own city. Half damage makes it urgent; default `rearm` waits for a check where the conditions are false. |
| `neighbors-convert` | Group neighboring foreign cities by their new majority religion. Require three matches in the `recent` window and raise the score as the group grows. |
| `foreign-city-hardship`, `foreign-city-raises-settlers` | Hardship runs at any distance with a readable leading cause (`famine` or `pillaged`) or the `starving` shortcut. Settler training needs the linked event, a population drop, and positive `foodPerTurn`. |
| `foreign-city-flips`, `foreign-city-liberated`, `foreign-occupied-city-resists` | Report ownership changes from `CityFlipped` and `PlayerLiberated`. When a same-turn capture covers the same transfer, let `nearby-city-captured` print one account instead. Resistance needs occupied status and positive `resistanceTurns`. |
| `foreign-city-takes-heavy-damage` | Compare nearby non-enemy cities' hit points before and after they cross half damage. The war variant needs a known war involving the owner; damage alone supports the neutral report. |

## National affairs

| Rule | What to borrow |
| --- | --- |
| `capital-outgrown` | A world rule compares the population of the capital with other own cities. It can name several cities tied for largest. |
| `technology-leader-changes` | Compare ranks at the cutoff and at the start of the `short` window. The highest readable research count can have several leaders. See the [science triggers](../../../../../vox-agents/newspaper/triggers/science.json). |

## Foreign affairs and war

| Rule | What to borrow |
| --- | --- |
| `city-state-ally-defects`, `city-state-ally-lost` | Separate a nearby city-state switching from us to a rival from a city-state becoming unallied. The latter requires the explicit no-ally ID in `SetAlly`. See the [city-state triggers](../../../../../vox-agents/newspaper/triggers/city-states.json). |
| `city-state-quest-countdown-disappeared` | Compare two readable quest observations. If a deadline still in the future disappears, report the observation without treating it as an outcome. See [quest facts](facts.md#quest-deadlines-and-cultural-influence). |
| `war-advantage-stalls` | Look for a score of at least 25 in the `long` window, then use `held` to require a continuous stretch of `short` turns within five points of the current score. `repeat: medium` allows a follow-up after 20 Standard turns. |
| `war-turns-against-us` | Use `pair.other.stake.front` to weigh the opponent's proximity, the war score, and war weariness. |

### A nearby offensive outranks a distant one

In [`enemy-front-posture-offensive`](../../../../../vox-agents/newspaper/triggers/war-fronts.json), find the latest shift to an offensive posture during the reporting period and check that the city belonged to a wartime opponent when it happened. Give the shift the `notable` tier and use [`city.stake.place`](constants.md#stakes). It scores 65 at a city six tiles from our nearest city and 52 at 100 tiles.

`active-war-zone-analysis` can cover a front even when its posture has not changed. It needs at least two observed units on each side in the same zone, excluding settlers, workers, religious units, and great people. It leaves 20 Standard turns between published updates at the same city. Use the counts to describe the sighting; fighting strength also depends on factors such as position and support.

### Vassals follow their master to war

`vassals-join-war` names the participants whose reason for joining is inferred as `vassal`. It rates a war involving the receiver above a foreign war and marks it urgent when the receiver is the target. See [war and peace inference](war-and-peace.md).

## Agreements and great people

| Pattern | What to borrow |
| --- | --- |
| [Completed agreements](../../../../../vox-agents/newspaper/triggers/agreements.json) | Use the receiver's recorded contributions and receipts. Commerce in both directions is a trade; in one direction it is a gift. Maps, technologies, embassies, and research agreements have their own angles. |
| `comprehensive-agreement` | Combine distinct commitments such as a map and a technology. A payment for a map can stay part of the purchase. Use a single report when linked observations describe the same clause. A separate deal with the same partner can still qualify. |
| [Named great people](../../../../../vox-agents/newspaper/triggers/culture.json) | Unwitnessed news can name Hypatia and Persia. A story about her use or death needs a witnessed event. The death is based on a final removal without a same-turn use. A same-turn conversion, including a gift, supplies neither birth nor death. |

See [event facts](facts.md#event) for the fields that supply this copy.

## Congress

The [Congress rules](../../../../../vox-agents/newspaper/triggers/congress.json) and [templates](../../../../../vox-agents/newspaper/templates/congress.json) cover upcoming sessions, new motions, and vote results. For an imminent session, check that `game.congress` is available before comparing the expected session with next turn. For a new motion, select from `game.congress.newProposals` entries with a recorded proposer. For a result, require both the resolution and proposer names on the public `ResolutionResult` event. The trigger checks the proposer so every variant can name them.

## Probe catalogue examples

From the repository root, add `--config vox-agents/newspaper/probes` to a fresh replay. The [probe rules](../../../../../vox-agents/newspaper/probes/triggers/probes.json) and [templates](../../../../../vox-agents/newspaper/probes/templates/probes.json) exercise authoring features with controlled facts.

### An opinion piece on city unhappiness

`probe-culture-opinion` matches an own city when boredom is its largest recorded unhappiness cause and is at least 2. The subheadline prints the value, the byline names a correspondent in the city, and the Opinion page collects the piece if it prints off the front page.

### A spy's view of a foreign city

`probe-spy-city-profile` needs both a recorded own spy in a foreign city and a positive boredom reading. The spy roster supplies presence; the cause requires city-screen detail through the 500-point access proxy. The story cites the city observation that supplied the cause. See [covert presence and roster points](facts.md#covert-presence-and-roster-points).

### An inbound diplomat

`probe-inbound-diplomat` reads the two rosters separately. The foreign diplomat must be recorded at our capital, and our diplomat must be recorded as absent from theirs. A hidden or ambiguous reading cannot qualify.

### A foreign policy briefing

`probe-foreign-policies` requires our diplomat abroad and readable policy names. It picks one branch from the latest tier with names, favoring ideologies. Turn and player ID pick one deterministically when several qualify. A specific adoption still needs a readable `PlayerAdoptPolicy` event.

### A retraction after a printed peace

`probe-retraction` uses `printed('probe-peace', pair)` to look up a peace report about the current war opponent. It checks that the lookup returned an article before testing whether it printed within `short` turns.

### A rare piece after a quiet spell

`probe-quiet-spell` requires a previous issue and a gap of at least `medium` turns. Its `chance: 0.25` lets later eligible checks try again after a failed draw. For a fixed milestone, `probe-hundredth-issue` tests for 99 issues already in print.
