# Newspaper trigger examples

The stock catalogue pairs 14 [trigger rules](overview.md) with story templates. Use these examples to find a rule to adapt. The JSON files contain the full conditions and copy; [facts](facts.md) and [constants and shortcuts](constants.md) explain the names they use.

A trigger tests the evidence and supplies values such as `lost`. A template chooses how to tell the story. An ungrouped rule's non-null scalar values and visible subject names can appear as placeholders such as `{{city}}`. A grouped rule supplies `{{key}}` and `{{count}}` for prose and keeps individual results in `matches` for conditions. See [authoring choices](../editorial.md#authoring-choices).

## Cities and borders

[City rules](../../../../../vox-agents/newspaper/triggers/cities.json) and [city templates](../../../../../vox-agents/newspaper/templates/cities.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `neighbor-puppet-annexed` | A foreign city within `neighboring` distance ceases to be a puppet and is now occupied. | Compare the occupation flags across two snapshots. Require the same owner to leave captures out of the story. |
| [`settler-departure`](#a-city-shrinks-after-sending-settlers) | One of our cities shrinks, trains a settler in the `recent` window, and still has positive food income. | Use events and snapshots together. The local happiness at the cutoff shapes the story's tone. |
| `forward-settle` | A rival founds within `adjacent` distance of our cities, with urgent coverage at two tiles or less. | Listen to `PlayerCityFounded` alone to avoid reporting the same founding from the unit event. Name the nearest city of ours when the join is readable; otherwise leave the nearby city unnamed. |
| `besieged-and-starving` | One of our cities is damaged in wartime and is using up its food reserves. At the current rate it has less than `recent` turns of food left. | Use the `besieged` and `starving` shortcuts. At half damage or more the story is urgent. The default `rearm` waits for a check where the conditions no longer hold before the story can run again. |
| `neighbors-convert` | At least three foreign cities within `neighboring` distance gain the same majority religion in the `recent` window. | Group the changed cities by majority religion. The headline can name the faith and the size of the group. |

### A city shrinks after sending settlers

The rule exposes `lost`, the decrease in population points. The stock `settler-departure-account` template reads `city.happinessDelta` at the cutoff: current net local happiness, the balance of happiness and unhappiness in that city. A negative value favors the strained headline “Settlers ready, spirits low in Tours”; a positive value favors “Good cheer in Tours as settlers prepare to go.” Zero, null or an unreadable value gives the neutral “Settlers ready as Tours grows smaller.”

Save the following as `<overlay>/templates/settler.json` and select the overlay with CLI `--config` or browser `editorialConfigDirectory`. The loader matches the stock template and variant by ID and updates only the neutral copy. The stock condition and city link carry over, so `{{town}}` still links to the city and the other two tones still publish when eligible.

```json
[
  {
    "id": "settler-departure-account",
    "variants": [
      {
        "id": "settler-departure-report",
        "headline": "Settlers ready in a smaller {{town}}",
        "body": [
          "{{town}} has trained a party of settlers. The city has fewer people than before, and still brings in more food than it uses."
        ]
      }
    ]
  }
]
```

## National affairs

[National rules](../../../../../vox-agents/newspaper/triggers/nation.json) and [national templates](../../../../../vox-agents/newspaper/templates/nation.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `capital-outgrown` | Another of our cities is now larger than the capital. | A `world` rule compares visible city populations. It reports the first check where the capital is outgrown and stays quiet until no city is larger. If several other cities share the largest population, the story names them together. |
| `neighbor-army-overtakes` | A neighboring major now outranks us in military strength and did not at the start of the `medium` window. | Both militaries need readable strength at both dates. The importance calculation handles a measured strength of zero without dividing by it. |
| `technology-leader-changes` | A major now ranks first in technologies, up from a lower rank at the start of the `short` window. | Use the dated ranks among majors with readable counts. Equal counts share the lead. The receiver's story can appear under At Home; another nation's story can appear under Beyond Our Borders. |
| `golden-age-in-wartime` | A `PlayerGoldenAge` event records an award or start for the receiver, and the receiver is at war at the cutoff. | The event can include an extension. Combine the event with the cutoff war state, and use the cutoff national happiness to set the tone. |

The `golden-age-in-wartime-account` template uses `self.happinessPercentage`, the receiver's recorded national happiness on the Vox Populi 0–100 scale. The editorial cutoffs use the default threshold for very unhappy nations and the midpoint of the scale. Below 35, the critical headline reads “A Golden Age, yet little cheer at home.” Above 50, the supportive headline reads “A Golden Age gives a country at war cause for cheer.” Values from 35 through 50, null and unreadable values use the neutral “A Golden Age at home, with war still on.” [Facts](facts.md#player) describes the scale and access.

## Foreign affairs and war

[Foreign rules](../../../../../vox-agents/newspaper/triggers/foreign.json) and [foreign templates](../../../../../vox-agents/newspaper/templates/foreign.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `nearby-capital-falls` | A `CityCaptureComplete` event records the conquest of a nearby capital by a third party. | Check the capital and conquest flags and both owners. The template has separate coverage for an unnamed capital. |
| `enemy-wonder-nearby` | An enemy finishes a wonder in a city within `nearby` during the `recent` window. | Match the city's completed buildings to its recorded wonders. |
| `city-state-ally-defects` | A nearby city-state switches its alliance from us to a rival. | Check both allies named by `SetAlly`. Losing an ally without a replacement does not qualify. |
| [`vassals-join-war`](#vassals-follow-their-master-to-war) | A declaration of war brings in vassals on either side. | Read the participants of a war incident and select those that joined as vassals. |
| `war-advantage-stalls` | Our war score reached at least 25 in the `long` window and stayed within five points of its current value for `short`. | Read the history of a pair's current war. `held` requires a continuous record. While the conditions hold, `repeat: medium` permits a follow-up after 20 Standard turns. |

### Vassals follow their master to war

`vassals-join-war` uses [incident facts](facts.md#incident) to report the declaration and name the vassals together. It counts a war involving the receiver as more important than a foreign war, and marks the story urgent if the receiver was the target. See [War and peace](war-and-peace.md) for how the incident identifies participants and their reasons for joining.

## Probe catalogue examples

Load the [probe overlay](../../../../../vox-agents/newspaper/probes/) with `--config vox-agents/newspaper/probes`. The entries are in [probe rules](../../../../../vox-agents/newspaper/probes/triggers/probes.json) and [probe templates](../../../../../vox-agents/newspaper/probes/templates/probes.json).

### An opinion piece on city unhappiness

`probe-culture-opinion` fires for one of our cities when boredom is its largest recorded [unhappiness cause](facts.md#city) and reads at least 2. The subheadline prints the reading as `{{culture}}`, and the byline credits a correspondent in `{{city}}`. The Opinion page appears when at least one story tagged `opinion` falls outside the front page.

### A retraction after a printed peace

`probe-peace` reports when the receiver is at peace with another player. If war breaks out, `probe-retraction` looks up the last report with `printed('probe-peace', pair)` and checks that it was published within `short` turns. The guard checks for a result before reading its turn, so a peace story that never made it into print cannot trigger the follow-up.

### A rare piece after a quiet spell

`probe-quiet-spell` requires a previous issue and a gap of at least `medium` turns. It subtracts `press.lastIssueTurn` from the cutoff and uses `chance: 0.25` to pass only some eligible checks. A failed draw records `chance` in the audit without spending the repeat, so a later quiet check can try again. For a fixed milestone, `probe-hundredth-issue` fires when `press.issues == 99`.
