# Newspaper trigger examples

Start with the settler overlay to tune a score and revise a report. The stock rules below show patterns to borrow.

## A city shrinks after sending settlers

[`settler-departure`](overview.md#a-first-example) rates the story by how much population the city lost. To give the capital and large cities more weight, set `adjust` to `["city.stake.place", "10 * lost"]` for `settler-departure` in your overlay's `triggers/` folder. A capital shrinking from eight to six scores 73: 45 for the `routine` tier, 8 for the capital, and 20 for the population loss.

To edit the neutral report, save this as `<overlay>/templates/settler.json`:

```json
[
  {
    "id": "settler-departure-account",
    "variants": [
      {
        "id": "settler-departure-report",
        "headline": "Settlers ready in a smaller {{town}}",
        "body": ["{{town}} has trained a party of settlers. Its population has fallen, and it still has food to spare."]
      }
    ]
  }
]
```

Run a [fresh replay](../replay.md#iterate-on-a-rule-or-overlay) with the overlay. The report keeps its condition and city link. Check the audit to see the score and which variant printed.

## Cities and borders

Find the detailed expressions in the [city](../../../../../vox-agents/newspaper/triggers/cities.json), [religion](../../../../../vox-agents/newspaper/triggers/religion.json), [war](../../../../../vox-agents/newspaper/triggers/war.json) and [war fronts](../../../../../vox-agents/newspaper/triggers/war-fronts.json) rules.

| Rule | What to borrow |
| --- | --- |
| `neighbor-puppet-annexed` | Compare two snapshots of a foreign city within `neighboring`. Require the same owner to distinguish annexation from capture. |
| `forward-settle` | Use `PlayerCityFounded` to report a rival within `adjacent` distance. Require the rival and both city names, and mark the story urgent at two tiles or less. |
| `besieged-and-starving` | Combine the `besieged` and `starving` shortcuts for an own city. Half damage makes it urgent; default `rearm` waits for a check where the conditions are false. |
| `neighbors-convert` | Group neighboring foreign cities by their new majority religion. Require three matches in the `recent` window and raise the score as the group grows. |

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

## Congress

The [Congress rules](../../../../../vox-agents/newspaper/triggers/congress.json) and [templates](../../../../../vox-agents/newspaper/templates/congress.json) show two ways to cover the same institution. For an imminent session, check that `game.congress` is readable and available before comparing the expected session with next turn. For a result, match the permitted `ResolutionResult` event without needing a Congress snapshot. Its `resolutionType` can be a string or a number, so the templates offer a generic report as well as variants that require the name.

## Probe catalogue examples

From the repository root, add `--config vox-agents/newspaper/probes` to a fresh replay. The [probe rules](../../../../../vox-agents/newspaper/probes/triggers/probes.json) and [templates](../../../../../vox-agents/newspaper/probes/templates/probes.json) exercise authoring features with controlled facts.

### An opinion piece on city unhappiness

`probe-culture-opinion` matches an own city when boredom is its largest recorded unhappiness cause and is at least 2. The subheadline prints the value, the byline names a correspondent in the city, and the Opinion page collects the piece if it prints off the front page.

### A spy's view of a foreign city

`probe-spy-city-profile` needs both a recorded own spy in a foreign city and a positive boredom reading. The spy roster supplies presence; the cause requires city-screen detail through the 500-point access proxy. The story cites the city observation that supplied the cause. See [covert presence and roster points](facts.md#covert-presence-and-roster-points).

### An inbound diplomat

`probe-inbound-diplomat` reads the two rosters separately. The foreign diplomat must be recorded at our capital, and our diplomat must be recorded as absent from theirs. A hidden or ambiguous reading cannot qualify.

### A foreign policy briefing

`probe-foreign-policies` requires our diplomat abroad and readable policy names. It picks one branch from the latest tier with names, favoring ideologies. Turn and player ID break ties consistently. A specific adoption still needs a readable `PlayerAdoptPolicy` event.

### A retraction after a printed peace

`probe-retraction` uses `printed('probe-peace', pair)` to look up a peace report about the current war opponent. It checks that the lookup returned an article before testing whether it printed within `short` turns.

### A rare piece after a quiet spell

`probe-quiet-spell` requires a previous issue and a gap of at least `medium` turns. Its `chance: 0.25` lets later eligible checks try again after a failed draw. For a fixed milestone, `probe-hundredth-issue` tests for 99 issues already in print.
