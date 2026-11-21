# Newspaper trigger examples

Every stock trigger has a story template, including the Congress rules. Start with the settler overlay to change one report, or use the examples below to find a stock rule to adapt.

## A city shrinks after sending settlers

The stock [`settler-departure` rule](overview.md#a-first-example) supplies `lost`, the decrease in population. In [`settler-departure-account`](../../../../../vox-agents/newspaper/templates/cities.json), negative local happiness at the cutoff makes the strained report eligible and positive happiness makes the hopeful report eligible. Zero, null or unreadable happiness makes the neutral report eligible. An unconditional tabloid anecdote can also compete; it uses `{{lost}}` in its copy.

Save this as `<overlay>/templates/settler.json`:

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

Run a [fresh replay](../replay.md#iterate-on-a-rule-or-overlay) with that overlay. The neutral report keeps its condition and city link, so `{{town}}` still links to the city. The other variants stay eligible under their original conditions. Check the audit if the edited report does not print.

## Cities and borders

Find the detailed expressions in the [city](../../../../../vox-agents/newspaper/triggers/cities.json), [religion](../../../../../vox-agents/newspaper/triggers/religion.json) and [war](../../../../../vox-agents/newspaper/triggers/war.json) rules.

| Rule | What to borrow |
| --- | --- |
| `neighbor-puppet-annexed` | Compare two snapshots of a foreign city within `neighboring`. Require the same owner to distinguish annexation from capture. |
| `forward-settle` | Use `PlayerCityFounded` to report a rival within `adjacent` distance. Require the rival and both city names, and mark the story urgent at two tiles or less. |
| `besieged-and-starving` | Combine the `besieged` and `starving` shortcuts for an own city. Half damage makes it urgent; default `rearm` waits for a check where the conditions are false. |
| `neighbors-convert` | Group by majority religion when at least three foreign cities within `neighboring` gain the same majority religion in the `recent` window. |

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
