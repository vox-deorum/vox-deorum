# Newspaper trigger examples

**Status: target design, documented ahead of the code.** [Plan 6](../../../../plans/newspaper/implementation/06-trigger-rules.md) lists the build order.

This page shows complete [trigger rules](overview.md) for developers who want a starting point for their own. Each example gives the story in one sentence, the trigger entry, and a sketch of a template that reports it. Every name used here is defined in [facts](facts.md) or [constants and shortcuts](constants.md).

| Example | Subject | Shows |
| --- | --- | --- |
| [A neighbor annexes its puppet](#a-neighbor-annexes-its-puppet) | `city` | Distance, a status change read from two snapshots |
| [A city shrinks after sending settlers](#a-city-shrinks-after-sending-settlers) | `city` | Combining a decline, a trained unit and a healthy yield |
| [A rival settles on our doorstep](#a-rival-settles-on-our-doorstep) | `event` | Event location, `urgent` |
| [A nearby capital falls to a third party](#a-nearby-capital-falls-to-a-third-party) | `event` | Event payload players |
| [Our city is besieged and starving](#our-city-is-besieged-and-starving) | `city` | Shortcuts |
| [An enemy finishes a wonder nearby](#an-enemy-finishes-a-wonder-nearby) | `city` | Completed buildings, owner relationship |
| [The capital is outgrown](#the-capital-is-outgrown) | `world` | Comparing many subjects, `rearm` |
| [A neighbor's army overtakes ours](#a-neighbors-army-overtakes-ours) | `player` | Comparing a player with the receiver over time |
| [Neighboring cities convert together](#neighboring-cities-convert-together) | `city` | `group` |
| [A city-state ally defects to a rival](#a-city-state-ally-defects-to-a-rival) | `event` | Players named by an event |
| [A new technology leader](#a-new-technology-leader) | `player` | `rank`, past rank |
| [A golden age begins in wartime](#a-golden-age-begins-in-wartime) | `event` | An event combined with the receiver's state |
| [Vassals follow their master to war](#vassals-follow-their-master-to-war) | `incident` | Incident participants |
| [Our war advantage stalls](#our-war-advantage-stalls) | `pair` | `history`, `held`, a span as `repeat` |

## How to read an example

| Row | Meaning |
| --- | --- |
| `when` | Every listed expression must be true, checked in order |
| `values` | Placeholders the template can use, written `{{name}}` |
| Template sketch | One headline. A real template adds body paragraphs, links and variants; see [editorial decisions](../editorial.md#catalogue-and-eligibility). |

Templates also receive the subject's name and ID without listing them: `{{city}}` and `{{owner}}` for a city, `{{player}}` for a player, the same names for an event that has a city or a player, and `{{fromTurn}}` and `{{toTurn}}` for the period.

## A neighbor annexes its puppet

A foreign city next to ours changed from a puppet to direct occupied rule.

| Field | Value |
| --- | --- |
| `id` | `neighbor-puppet-annexed` |
| `subject` | `city` |
| `window` | `recent` |
| `when` | `city.is.neighbor` |
| | `city.before.isPuppet` |
| | `!city.isPuppet && city.isOccupied` |
| | `city.before.owner.id == city.owner.id` |
| `values` | `distance`: `city.distance.own` |
| `importance` | `70 - 3 * distance`, so 58 at 4 tiles and 49 at 7 (`neighboring`) |
| Template sketch | "{{owner}} takes direct control of {{city}}" |

The last `when` entry leaves out a city whose owner at the start of the window differs from its owner now, which is a capture and a different story.

## A city shrinks after sending settlers

One of our cities lost population, trained a settler, and still has positive food.

| Field | Value |
| --- | --- |
| `id` | `settler-departure` |
| `subject` | `city` |
| `window` | `recent` |
| `when` | `city.own` |
| | `city.population < city.before.population` |
| | `city.trained.some(t => settlers.includes(t.unit))` |
| | `city.foodPerTurn > 0` |
| `values` | `lost`: `city.before.population - city.population` |
| `importance` | `30 + 10 * lost`, so 40 for one population and 50 for two |
| Template sketch | "Families leave {{city}} for new lands" |

## A rival settles on our doorstep

A major civilization that is no friend of ours founded a city right beside one of ours.

| Field | Value |
| --- | --- |
| `id` | `forward-settle` |
| `subject` | `event` |
| `event` | `PlayerCityFounded` |
| `when` | `event.player.is.rival` |
| | `event.distance.own <= adjacent` |
| `values` | `founder`: `event.player.name` |
| | `ours`: `event.city.nearestOwn.name` |
| | `distance`: `event.distance.own` |
| `importance` | `90 - 10 * distance`, so 70 at 2 tiles and 50 at 4 (`adjacent`) |
| `urgent` | `distance <= 2`, a city founded within 2 tiles of one of ours |
| Template sketch | "{{founder}} plants a city within sight of {{ours}}" |

The same founding may produce both `PlayerCityFounded` and `UnitCityFounded`. They are separate recorded events about one founding, so rules listening for both could publish two stories about it. This rule listens only for `PlayerCityFounded`.

## A nearby capital falls to a third party

A capital in our region was captured, and we were neither side.

| Field | Value |
| --- | --- |
| `id` | `nearby-capital-falls` |
| `subject` | `event` |
| `event` | `CityCaptureComplete` |
| `when` | `event.isCapital` |
| | `!event.oldOwner.self && !event.newOwner.self` |
| | `event.distance.own <= nearby` |
| `values` | `loser`: `event.oldOwner.name` |
| | `winner`: `event.newOwner.name` |
| `importance` | `75` |
| Template sketch | "{{city}}, capital of {{loser}}, falls to {{winner}}" |

## Our city is besieged and starving

One of our cities is damaged in wartime and its food reserve is running out.

| Field | Value |
| --- | --- |
| `id` | `besieged-and-starving` |
| `subject` | `city` |
| `when` | `city.own` |
| | `city.is.besieged` |
| | `city.is.starving` |
| `values` | `damage`: `(city.maxHitPoints - city.hitPoints) / city.maxHitPoints` |
| `importance` | `60 + 40 * damage`, so 70 at a quarter damage and 80 at half |
| `urgent` | `damage >= 0.5`, at least half of the city's hit points lost |
| Template sketch | "Hunger and enemy fire close in on {{city}}" |

With the default `repeat` of `rearm`, the city is reported once for as long as it stays both besieged and starving. It can be reported again after a check where one of the two no longer held.

## An enemy finishes a wonder nearby

A civilization at war with us completed a wonder in a city in our region.

| Field | Value |
| --- | --- |
| `id` | `enemy-wonder-nearby` |
| `subject` | `city` |
| `window` | `recent` |
| `when` | `city.owner.enemy` |
| | `city.distance.own <= nearby` |
| | `city.built.some(b => city.wonders.includes(b.building))` |
| `values` | `wonder`: `city.built.filter(b => city.wonders.includes(b.building))[0].building` |
| `importance` | `55` |
| Template sketch | "Even at war, {{owner}} raises {{wonder}} in {{city}}" |

## The capital is outgrown

Another of our cities now has more people than our capital.

| Field | Value |
| --- | --- |
| `id` | `capital-outgrown` |
| `subject` | `world` |
| `when` | `self.cities.some(c => c.population > self.capital.population)` |
| `values` | `largest`: `[...self.cities].sort((a, b) => b.population - a.population)[0].name` |
| | `capital`: `self.capital.name` |
| `importance` | `45` |
| Template sketch | "{{largest}} overtakes {{capital}} as our largest city" |

The rule states only the present situation. The default `repeat` of `rearm` turns it into a change: it fires at the first check where the rule is true and stays silent until a check where no city is larger than the capital.

## A neighbor's army overtakes ours

A major civilization next door now has a stronger military than ours, and it did not 20 turns ago.

| Field | Value |
| --- | --- |
| `id` | `neighbor-army-overtakes` |
| `subject` | `player` |
| `window` | `medium` |
| `when` | `player.major && player.is.neighbor` |
| | `player.militaryStrength > self.militaryStrength` |
| | `player.before.militaryStrength <= self.before.militaryStrength` |
| `values` | `ratio`: `player.militaryStrength / self.militaryStrength` |
| `importance` | `40 + 40 * (ratio - 1)`, so 50 at a ratio of 1.25 and 60 at 1.5 |
| Template sketch | "{{player}} now fields a stronger army than ours" |

A readable row includes recorded military strength for the receiver or for another player at full recorded access. It is hidden for other civilizations with only basic access, and the rule stops for those players, so the story appears only where the comparison is known. [Evidence the facts rely on](facts.md#evidence-the-facts-rely-on) describes the player projection.

## Neighboring cities convert together

Three or more foreign cities next to ours changed to the same majority religion in one period.

| Field | Value |
| --- | --- |
| `id` | `neighbors-convert` |
| `subject` | `city` |
| `window` | `recent` |
| `when` | `city.is.neighbor` |
| | `city.majorityReligion && changed(city, 'majorityReligion')` |
| `group` | `by`: `city.majorityReligion`, `min`: `3` |
| `values` | `religion`: `city.majorityReligion` |
| `importance` | `40 + 10 * count`, so 70 for three cities and 80 for four |
| Template sketch | "{{key}} sweeps through {{count}} cities on our border" |

## A city-state ally defects to a rival

A city-state in our region dropped us as its ally and took up with a rival.

| Field | Value |
| --- | --- |
| `id` | `city-state-ally-defects` |
| `subject` | `event` |
| `event` | `SetAlly` |
| `when` | `event.oldAllyPlayer.self` |
| | `event.newAllyPlayer.is.rival` |
| | `event.minorPlayer.distance <= nearby` |
| `values` | `cityState`: `event.minorPlayer.name` |
| | `rival`: `event.newAllyPlayer.name` |
| `importance` | `65` |
| Template sketch | "{{cityState}} abandons us for {{rival}}" |

When a city-state loses its ally without gaining a new one, `event.newAllyPlayer` is missing and the rule stops, which is the wanted result here.

## A new technology leader

A major civilization now leads in technologies and did not at the start of the window.

| Field | Value |
| --- | --- |
| `id` | `technology-leader-changes` |
| `subject` | `player` |
| `window` | `short` |
| `when` | `player.major` |
| | `player.rank('technologies') == 1` |
| | `player.before.rank('technologies') > 1` |
| `values` | `count`: `player.technologies` |
| `importance` | `player.self ? 70 : 50` |
| Template sketch | "{{player}} takes the lead in learning with {{count}} technologies" |

`rank` compares only the civilizations whose technology count the receiver can see, so the "leader" is the leader of the known world. Equal counts share rank 1, so a civilization that draws level with the old leader is reported as well.

## A golden age begins in wartime

Our golden age began in this reporting period, and we are at war at its end.

| Field | Value |
| --- | --- |
| `id` | `golden-age-in-wartime` |
| `subject` | `event` |
| `event` | `PlayerGoldenAge` |
| `when` | `event.starting` |
| | `event.player.self` |
| | `self.atWar` |
| `values` | `enemies`: `self.wars.map(p => p.name).join(', ')` |
| `importance` | `60` |
| Template sketch | "A golden age dawns despite the war with {{enemies}}" |

## Vassals follow their master to war

A war declaration pulled in at least one vassal on either side.

| Field | Value |
| --- | --- |
| `id` | `vassals-join-war` |
| `subject` | `incident` |
| `when` | `incident.kind == 'war'` |
| | `incident.participants.some(p => p.reason == 'vassal')` |
| `values` | `vassals`: `incident.participants.filter(p => p.reason == 'vassal').map(p => p.player.name).join(', ')` |
| | `initiator`: `incident.initiator.name` |
| | `target`: `incident.target.name` |
| `importance` | `incident.role == 'none' ? 45 : 80` |
| `urgent` | `incident.role == 'target'` |
| Template sketch | "{{vassals}} drawn into the war between {{initiator}} and {{target}}" |

## Our war advantage stalls

We led a war by at least 25 points at some time in the last 40 turns, and the score has barely moved for 10.

| Field | Value |
| --- | --- |
| `id` | `war-advantage-stalls` |
| `subject` | `pair` |
| `window` | `long` |
| `when` | `pair.involvesSelf && pair.atWar` |
| | `pair.history.some(s => s.warScore >= 25)` |
| | `held(pair, s => Math.abs(s.warScore - pair.warScore) <= 5, short)` |
| `values` | `opponent`: `pair.other.name` |
| | `score`: `pair.warScore` |
| `importance` | `50` |
| `repeat` | `medium` |
| Template sketch | "The war with {{opponent}} grinds to a standstill" |

With `repeat` set to `medium`, a stalemate can be reported again 20 Standard turns later, as long as the rule is still true then. The lead of 25 points must still fall inside the 40-turn window.
