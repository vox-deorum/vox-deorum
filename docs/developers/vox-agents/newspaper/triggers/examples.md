# Newspaper trigger examples

The stock catalogue supplies [trigger rules](overview.md) and story templates. Some rules, including the Congress rules, have no template yet and wait for one that names them. Use these examples to find a rule to adapt. The JSON files contain the full conditions and copy; [facts](facts.md) and [constants and shortcuts](constants.md) explain the names they use.

A trigger tests the evidence and supplies values such as `lost`. A template chooses how to tell the story. An ungrouped rule's non-null scalar values and visible subject names can appear as placeholders such as `{{city}}`. A grouped rule supplies `{{key}}` and `{{count}}` for prose and keeps individual results in `matches` for conditions. See [authoring choices](../editorial.md#authoring-choices).

## Cities and borders

These examples pair [city templates](../../../../../vox-agents/newspaper/templates/cities.json) with rules from [cities](../../../../../vox-agents/newspaper/triggers/cities.json), [war](../../../../../vox-agents/newspaper/triggers/war.json), and [religion](../../../../../vox-agents/newspaper/triggers/religion.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `neighbor-puppet-annexed` | A foreign city within `neighboring` distance ceases to be a puppet and is now occupied. | Compare the occupation flags across two snapshots. Require the same owner to leave captures out of the story. |
| `building-completed`, `building-purchased` and their `foreign-` counterparts | A witnessed event records the construction or purchase of an ordinary building at home or in a nearby foreign city. | Confirm the building in the city's readable building list and use the event's purchase flags to tell construction from gold or faith spending. Wonders and defenses have their own rules. |
| `building-investment-made` | One of our cities invests in a named building class. | Use `CityInvestedBuilding` with an active investment. The game can record an investment before the city begins producing the building. |
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

These examples pair [national templates](../../../../../vox-agents/newspaper/templates/nation.json) with rules from [cities](../../../../../vox-agents/newspaper/triggers/cities.json), [war](../../../../../vox-agents/newspaper/triggers/war.json), [science](../../../../../vox-agents/newspaper/triggers/science.json), and [politics](../../../../../vox-agents/newspaper/triggers/politics.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `capital-outgrown` | Another of our cities is now larger than the capital. | A `world` rule compares visible city populations. It reports the first check where the capital is outgrown and stays quiet until no city is larger. If several other cities share the largest population, the story names them together. |
| `neighbor-army-overtakes` | A neighboring major now outranks us in military strength and did not at the start of the `medium` window. | Both militaries need readable strength at both dates. The importance calculation handles a measured strength of zero without dividing by it. |
| `technology-leader-changes` | A major now ranks first in technologies, up from a lower rank at the start of the `short` window. | Use the dated ranks among majors with readable counts. Equal counts share the lead. The receiver's story can appear under At Home; another nation's story can appear under Beyond Our Borders. |
| `golden-age-in-wartime` | A `PlayerGoldenAge` event records an award or start for the receiver, and the receiver is at war at the cutoff. | The event can include an extension. Combine the event with the cutoff war state, and use the cutoff national happiness to set the tone. |

The `golden-age-in-wartime-account` template uses `self.happinessPercentage`, the receiver's recorded national happiness on the Vox Populi 0–100 scale. The editorial cutoffs use the default threshold for very unhappy nations and the midpoint of the scale. Below 35, the critical headline reads “A Golden Age, yet little cheer at home.” Above 50, the supportive headline reads “A Golden Age gives a country at war cause for cheer.” Values from 35 through 50, null and unreadable values use the neutral “A Golden Age at home, with war still on.” [Facts](facts.md#player) describes the scale and access.

## Foreign affairs and war

These examples pair [foreign templates](../../../../../vox-agents/newspaper/templates/foreign.json) with rules from [war](../../../../../vox-agents/newspaper/triggers/war.json), [culture](../../../../../vox-agents/newspaper/triggers/culture.json), and [city-states](../../../../../vox-agents/newspaper/triggers/city-states.json).

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `nearby-capital-falls` | A `CityCaptureComplete` event records the conquest of a nearby capital by a third party. | Check the capital and conquest flags and both owners. The template has separate coverage for an unnamed capital. |
| `enemy-wonder-nearby` | An enemy finishes a wonder in a city within `nearby` during the `recent` window. | Match the city's completed buildings to its recorded wonders. |
| `city-state-ally-defects` | A nearby city-state switches its alliance from us to a rival. | Check both allies named by `SetAlly`. Losing an ally without a replacement does not qualify. |
| `city-state-ally-lost` | Our city-state ally becomes unallied. | Check the explicit no-ally ID in `SetAlly`; a hidden new ally is not enough. |
| `friendly-city-state-attacked`, `friendly-city-state-captured` | A city-state that was our friend is attacked or conquered. | Use the relationship just before the event. These rules have lower importance than the corresponding rules for allies. |
| `city-state-quest-deadline-approaching`, `city-state-timed-quest-observed` | The reader's city-state tooltip shows a timed quest nearly due or a deadline absent from the previous observation. | Report the estimated turns left from a fresh quest reading. The end of a countdown does not establish whether the quest succeeded. |
| `city-state-quest-countdown-disappeared` | A fresh city-state tooltip no longer lists a previously recorded deadline that's still in the future. | Compare readable countdowns from both observations. A changed estimate or missing countdown does not establish the quest's identity or outcome. |
| [`vassals-join-war`](#vassals-follow-their-master-to-war) | A declaration of war brings in vassals on either side. | Read the participants of a war incident and select those that joined as vassals. |
| `war-advantage-stalls` | Our war score reached at least 25 in the `long` window and stayed within five points of its current value for `short`. | Read the history of a pair's current war. `held` requires a continuous record. While the conditions hold, `repeat: medium` permits a follow-up after 20 Standard turns. |

The culture rules track influence in both directions. Gaining or losing Influential status takes priority over a trend change in the same direction. A drop from Dominant to Influential still meets that threshold. See [quest deadlines and cultural influence](facts.md#quest-deadlines-and-cultural-influence).

The zone rules compare two observations of the same city and domain from the receiver's tactical map. For example, a home zone can switch from Hedgehog to Counterattack, and a zone around an enemy city can switch from Withdraw to Attrition or Exploit Flanks. These are changes in the receiver's tactical assessment. See [tactical observations](facts.md#tactical-observations).

### Vassals follow their master to war

`vassals-join-war` uses [incident facts](facts.md#incident) to report the declaration and name the vassals together. It counts a war involving the receiver as more important than a foreign war, and marks the story urgent if the receiver was the target. See [War and peace](war-and-peace.md) for how the incident identifies participants and their reasons for joining.

## Congress

The [Congress rules](../../../../../vox-agents/newspaper/triggers/congress.json) are stock triggers without story templates. Add a template that names one of them when you want to print the story. Rules about the current agenda start with `game.knows('congress')` and `game.congress.available === true`, then read the [Congress facts](facts.md#congress). The passed and defeated rules instead read a `ResolutionResult` event and need no Congress snapshot.

| Rule | What makes news | Authoring pattern |
| --- | --- | --- |
| `congress-session-imminent` | A session is expected next turn. | Check `game.congress.knows('expectedSessionTurn')` and `game.congress.expectedSessionTurn === turn + 1`. |
| `congress-voting-opens` | Voting is open now. | Require `game.congress.votingNow === true`. |
| `congress-new-proposals` | The agenda gained a proposal. | Read `game.congress.newProposals`; rank our own proposal higher with the `ours` value. |
| `sanction-repeal-proposed`, `travel-ban-repeal-proposed` | A new proposal would lift an existing sanction or travel ban. | Read `isEnact === false` on the proposal. Passed and defeated votes already cover both enactment and repeal. |
| `congress-resolution-passed` | A `ResolutionResult` event records a passed vote. | Use the event's `passed`, `isEnact`, `resolutionType` and `proposerName`. `event.player` is the proposer when that player is visible. |
| `congress-resolution-defeated` | A `ResolutionResult` event records a failed vote. | Match the passed rule with `event.passed === false`. |
| `congress-sanctions-on-us` | An active resolution sanctions our civilization. | The resolution name starts with `Sanction` and includes our civilization name. |
| `congress-world-ideology` | An active resolution imposes a world ideology. | The resolution name starts with `World Ideology`; the `ours` value checks whether it names our ideology. |
| `congress-world-religion` | An active resolution imposes a world religion. | The resolution name starts with `World Religion`; the `ours` value checks our founded or majority religion. |
| `congress-world-project` | The league starts a project such as the World's Fair or Global Wargames. | Match a known project name in the active resolutions or the current proposals. |

`ResolutionResult` records `resolutionType` as the recorded type, which may be a string name or a number, and can name the proposer in `proposerName`. Use a resolution name as prose only when `resolutionType` is a string; otherwise keep the type for conditions.

## Probe catalogue examples

Load the [probe overlay](../../../../../vox-agents/newspaper/probes/) with `--config vox-agents/newspaper/probes`. The entries are in [probe rules](../../../../../vox-agents/newspaper/probes/triggers/probes.json) and [probe templates](../../../../../vox-agents/newspaper/probes/templates/probes.json).

### An opinion piece on city unhappiness

`probe-culture-opinion` fires for one of our cities when boredom is its largest recorded [unhappiness cause](facts.md#city) and reads at least 2. The subheadline prints the reading as `{{culture}}`, and the byline credits a correspondent in `{{city}}`. The Opinion page appears when at least one story tagged `opinion` falls outside the front page.

### A spy's view of a foreign city

`probe-spy-city-profile` requires `city.foreign`, `city.ourSpyPresent` and a positive boredom reading from the city's [unhappiness causes](facts.md#city). Presence is matched from the spy roster, while the cause reading appears only when projection grants city-screen detail through the 500-point proxy. A recalled spy or a city without a readable roster leaves the story out. The story cites the city observation that supplied the cause reading.

### An inbound diplomat

`probe-inbound-diplomat` fires for a foreign major when `player.theirDiplomatHere == true` and `player.ourDiplomatThere == false`. The two facts come from different rosters. A missing or ambiguous roster leaves the fact hidden, so an unobserved visit cannot produce the story. The explicit `false` is what distinguishes an empty post from an unobserved one.

### A foreign policy briefing

`probe-foreign-policies` requires `player.ourDiplomatThere == true` and readable policy names. It covers one branch from the latest tier with names, preferring an ideology if one is available. When there are several branches in the tier, the turn and player ID select one consistently in replay. Basic access shows only branch counts. Reporting a specific policy adoption still needs a readable `PlayerAdoptPolicy` event.

### A retraction after a printed peace

`probe-peace` reports when the receiver is at peace with another player. If war breaks out, `probe-retraction` looks up the last report with `printed('probe-peace', pair)` and checks that it was published within `short` turns. The guard checks for a result before reading its turn, so a peace story that never made it into print cannot trigger the follow-up.

### A rare piece after a quiet spell

`probe-quiet-spell` requires a previous issue and a gap of at least `medium` turns. It subtracts `press.lastIssueTurn` from the cutoff and uses `chance: 0.25` to pass only some eligible checks. A failed draw records `chance` in the audit without spending the repeat, so a later quiet check can try again. For a fixed milestone, `probe-hundredth-issue` fires when `press.issues == 99`.
