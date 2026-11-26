# Newspaper trigger constants

Use a name from [`constants.json`](../../../../../vox-agents/newspaper/constants.json) when several rules share the same threshold or test. For example, a rule can use `city.is.neighbor` to check whether a foreign city sits within `neighboring` distance. To try 9 tiles in place of the default 7, put `{"distances":{"neighboring":9}}` in an overlay's `constants.json`.

| Group | Use in a rule or story |
| --- | --- |
| `distances`, `spans`, `sizes`, `shares` | Named numbers such as `neighboring` or `recent` |
| `types` | Named lists of recorded names, such as `settlers` |
| `tiers` | [Named base importance scores](overview.md#tiers-adjustments-and-stakes) |
| `stakes` | [Reusable point calculations](#stakes), such as `event.stake.building` |
| `shortcuts` | [Reusable fact tests](#shortcuts), such as `city.is.neighbor` |
| `terms` | Printable values, such as `{{terms.civilization}}` |

## Distance

Distance counts hex steps. With valid recorded map dimensions and wrap flags, it can take the shorter route across a map edge. Without valid geometry, it uses unwrapped distance. A missing plot can make a distance unavailable.

| Reading | Measures from |
| --- | --- |
| `city.distance.own`, `event.distance.own` | The city or event plot to the receiver's nearest city |
| `city.distance.capital` | The city to the receiver's capital |
| `player.distance` | The closest visible pair of cities, one from that player and one from the receiver |
| `distance(a, b)` | Two players, cities, plots or events with usable coordinates |

| Constant | Hex tiles |
| --- | --- |
| `adjacent` | 4 |
| `neighboring` | 7 |
| `nearby` | 15 |
| `regional` | 25 |

## Spans

Named spans are defined and saved in Standard turns. Expressions see the span multiplied by game speed and rounded to the nearest whole recorded turn, with a minimum of one. For example, `recent` is 5 recorded turns at Standard speed and 15 at Marathon speed.

| Constant | Standard turns |
| --- | --- |
| `recent` | 5 |
| `short` | 10 |
| `medium` | 20 |
| `long` | 40 |

Numeric `window` and `repeat` fields also use Standard turns. Inside an expression a bare number uses recorded turns, so `held(pair, test, 2)` means two recorded turns at any speed.

## Sizes and shares

| Group | Defaults |
| --- | --- |
| Population | `town` 5, `largeCity` 15, `metropolis` 25 |
| Fractions | `minority` 0.25, `majority` 0.5, `dominant` 0.75 |

## Type lists

Use list membership to check a category. For example, `settlers.includes(t.unit)` matches Settler, Pioneer and Colonist. Use `ideologies` to control which branches count toward `player.ideology`. The building stake uses the ordered `eras` list and `earlyBuildings`.

Names must match the text in the recording. If the recorded text uses a different language, adapt the affected lists.

## Shortcuts

A shortcut is an expression attached to the fact it reads. A historical fact uses the historical snapshot, so `city.before.is.conquered` tests the earlier occupation and puppet flags. Globals such as `cities` and `turn` still describe the current check. A shortcut is hidden if it needs an unavailable fact; use `city.is.knows('starving')` to test whether that shortcut can be evaluated.

| Shortcut | Test |
| --- | --- |
| `city.is.neighbor`, `city.is.nearby` | A foreign city within the corresponding distance |
| `city.is.frontier` | An own city within `neighboring` distance of a foreign city |
| `city.is.starving` | Losing food, with fewer than `recent` turns of reserves at the current rate |
| `city.is.besieged` | Damaged while its owner is at war |
| `city.is.conquered` | Occupied or a puppet |
| `city.is.followsAnotherReligion` | An own city whose named majority religion differs from our founded religion |
| `player.is.neighbor`, `player.is.nearby` | Another player within the corresponding distance |
| `player.is.rival` | Another major civilization that is neither our friend nor our ally |
| `player.is.alliedCityState`, `player.is.friendlyCityState` | Our city-state ally, or a city-state friend with a known alliance status who is not our ally |
| `player.is.hasFoundedReligion`, `player.is.hasMajorityReligion` | The corresponding religion name is readable and nonempty |
| `pair.is.foreignWar` | A war between two other major civilizations |
| `incident.is.incomingMajorDeclaration` | A direct declaration by an identified major civilization targeting the receiver |

At Standard speed, a city losing two food per turn with 10 stored is just outside `city.is.starving`: the reserve lasts exactly five turns. With nine stored it qualifies.

### Regional shortcuts

Use `"when": "self.is.mesoamerican"` on a variant written for Aztec and Maya readers. Leave a generic variant available to other readers. When a rule binds a player in the story, `player.is.eastAsian` checks that player's civilization. The same shortcuts work in weight adjustments.

The [stock lists](../../../../../vox-agents/newspaper/constants.json) cover every stock major civilization. For example, Indonesia, Polynesia, and Siam share `southeastAsianAndPacific`. Membership follows the recorded civilization name wherever it starts on the map. A civilization can belong to more than one group, and a shortcut is unavailable if it needs an identity the player cannot see.

To include a modded civilization, replace the whole membership list in an overlay's `constants.json`. This example keeps the two stock members and adds a civilization recorded as `The Zapotecs`:

```json
{"types":{"mesoamericanCivilizations":["The Aztecs","The Maya","The Zapotecs"]}}
```

## Stakes

A stake is a named expression that returns finite points from readable facts. A rule opts in by reading it in an [adjustment](overview.md#tiers-adjustments-and-stakes), for example `event.stake.building`. A subject has a `stake` view when the catalogue defines stakes for that subject type. Like shortcuts, stakes use the snapshot of the subject they are read from; globals still describe the current check.

| Stock stake | What changes the score |
| --- | --- |
| `player.stake.relation` | For another player, combines distance, war, friendship or a pact, a denouncement in either direction, and a vassal or master tie. Allied city-states get a bonus; other city-states get a penalty. The result stays between -15 and 20; the receiver scores 0. |
| `pair.stake.relation` | Uses the other player's relationship score if the receiver is in the pair; otherwise uses the higher of the two scores. |
| `player.stake.front` | For a known opponent at war with the receiver, weighs distance, the magnitude of the war score, and war weariness. A city-state front gets a penalty in place of distance points. |
| `player.stake.war` | For the receiver, adds the scores of known major fronts and 4 points for each major front after the first, within -10 to 20. Scores -10 when all known opponents are city-states. |
| `city.stake.place` | Adds 8 points for the receiver's capital and 4 for an own city at least `largeCity` in size. A foreign city uses the same distance scale as an event. |
| `event.stake.place` | Adds 8, 5 or 2 points at `adjacent`, `neighboring` or `nearby` distance from the receiver's nearest city. Beyond `regional`, subtracts 8; between `nearby` and `regional`, adds 0. Needs a readable distance. |
| `event.stake.building` | Adds 15 for a listed defense while at war, plus 5 if the city is on the frontier. Subtracts 15 for listed early buildings in the Industrial Era or later. |

A stake can handle missing inputs itself. For example, the relationship stake assigns 0 proximity points when distance is unavailable. If a stake directly reads a hidden fact, that read is hidden; `event.stake.knows('place')` checks whether the place calculation can read what it needs.

## Terms

Terms are expressions for printed text or finite numbers. The editor evaluates them once per check against the globals. Use `{{terms.<name>}}` in copy or a masthead; conditions read the underlying facts. The evidence for a term is attached to the copy or masthead that prints it.

The editor capitalizes a term, including civic vocabulary, when it opens a sentence or a text field. Elsewhere it keeps the term's original casing.

Stock identity terms are `civilization`, `civilizationAdjective`, and `leader`. For Sweden, the first two print Sweden and Swedish. The [probe overlay](../../../../../vox-agents/newspaper/probes/constants.json) adds terms for the capital's name, a phrase based on ideology, and the name of an overlord. A failed, hidden or nonprintable result leaves the term unavailable. Copy that needs it is ineligible; see [masthead rules](../editorial.md#masthead-rules) for title and label fallbacks.

Government, people, and leader titles use the separate [civic vocabulary](../editorial.md#civic-vocabulary). Change those phrases in `civic-terms.json` without writing a new expression or variant.

## Change or add a name

Edit the built-in file to change the default, or use an [overlay](overview.md#tune-with-an-overlay) to try a change for one replay. Constant groups, including tiers and terms, merge by name. A type list with the same name replaces the whole list. Shortcuts and stakes merge by subject and name.

New names must be valid JavaScript identifiers. Constants and terms cannot use reserved names such as `self` and `turn`. Trigger values may use `turn` as a print-only value. Shortcut and stake names must avoid fact-view methods such as `knows`. A threshold used in only one rule can stay in that rule.
