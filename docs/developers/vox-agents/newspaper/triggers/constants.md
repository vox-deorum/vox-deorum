# Newspaper trigger constants and shortcuts

**Status: target design, documented ahead of the code.** [Plan 6](../../../../plans/newspaper/implementation/06-trigger-rules.md) lists the build order.

**Constants** give names to the numbers that [trigger rules](overview.md) compare against, such as `neighboring` for 7 tiles. **Shortcuts** give names to small expressions that many rules share, such as `city.is.neighbor`. This page is for developers writing or tuning rules. Both live in `vox-agents/newspaper/constants.json`, and changing one there changes every rule that uses it.

| Kind | Used as | Example |
| --- | --- | --- |
| Constant | A plain name inside any expression | `city.distance.own <= neighboring` |
| Type list | A plain name holding a list of unit or building names | `settlers.includes(t.unit)` |
| Shortcut | `<subject>.is.<name>` | `city.is.neighbor` |

## Distance

Distance is measured in hex tiles between two map positions, using the stored `x` and `y` of cities and event plots. Adjacent tiles are 1 apart. The game stores positions in offset rows, so the builder converts them to hex coordinates before counting steps, the same way the game's own plot distance does.

| Reading | Meaning |
| --- | --- |
| `city.distance.own` | From a city to the receiver's nearest city |
| `city.distance.capital` | From a city to the receiver's capital |
| `player.distance` | Between the closest pair of cities, one of the player's and one of the receiver's |
| `event.distance.own` | From an event's plot to the receiver's nearest city |
| `distance(a, b)` | Between any two cities, plots or events |

The recordings do not store map width, so distances do not wrap around the map edge. Two cities on opposite edges of a wrapping map read as far apart. Recording the width in `GameMetadata` would remove this limit.

| Constant | Default, in tiles | Meaning | Example on the map |
| --- | --- | --- | --- |
| `adjacent` | 4 | Borders nearly touch | A city founded right beside ours |
| `neighboring` | 7 | A next-door city | The closest city of the civilization we share a border with |
| `nearby` | 15 | Within the same region | A capital two or three cities away |
| `regional` | 25 | The same part of the continent | A war we would hear about but not feel |

## Spans

Spans measure time in **Standard turns**, the turn count at Standard game speed. Each span is multiplied by the game-speed multiplier and rounded to a whole number of recorded turns, at least 1, before a rule sees it. `turn - city.captured.turn <= recent` therefore works at any speed. On Marathon, where one Standard turn spans 3 recorded turns, `recent` is 15 recorded turns. A bare number inside an expression, such as the `2` in `held(pair, test, 2)`, is always recorded turns.

| Constant | Default, in Standard turns | Use for |
| --- | --- | --- |
| `recent` | 5 | One reporting period at the default frequency |
| `short` | 10 | A trend that needs confirming |
| `medium` | 20 | A follow-up interval, or a lasting situation |
| `long` | 40 | An era-scale comparison |

A trigger's `window` and `repeat` accept these names or a bare number of Standard turns.

## Sizes and shares

| Constant | Default | Meaning |
| --- | --- | --- |
| `town` | 5 population | Below this, a city is a small settlement |
| `largeCity` | 15 population | A major city |
| `metropolis` | 25 population | One of the great cities of the game |
| `minority` | 0.25 | A quarter share |
| `majority` | 0.5 | Half |
| `dominant` | 0.75 | Three quarters |

## Type lists

Type lists hold the recorded names of units and buildings, so a rule can ask about a category.

| List | Contains | Example |
| --- | --- | --- |
| `settlers` | Settler, Pioneer, Colonist | `city.trained.some(t => settlers.includes(t.unit))` |
| `workers` | Worker, Work Boat | `city.trained.some(t => workers.includes(t.unit))` |
| `missionaries` | Missionary, Inquisitor, Great Prophet | `city.trained.some(t => missionaries.includes(t.unit))` |
| `greatPeople` | The Great Person unit names | `greatPeople.includes(event.unit)` on a `GreatPersonExpended` event |
| `defenses` | Walls, Castle, Arsenal, Military Base | `city.built.some(b => defenses.includes(b.building))` |

Names must match the recording's text. Recordings store localized names, so a catalogue for another language needs its own lists.

## Shortcuts

A shortcut is a named expression for one subject. It reads like a fact and can use constants, facts and other shortcuts.

| Shortcut | Expression | Meaning |
| --- | --- | --- |
| `city.is.neighbor` | `city.foreign && city.distance.own <= neighboring` | A foreign city next door |
| `city.is.nearby` | `city.foreign && city.distance.own <= nearby` | A foreign city in our region |
| `city.is.frontier` | `city.own && cities.some(c => c.foreign && distance(c, city) <= neighboring)` | One of our cities with a foreign city next door |
| `city.is.starving` | `city.foodPerTurn < 0 && city.foodStored < -city.foodPerTurn * recent` | Losing food, with a reserve that runs out in fewer than `recent` turns |
| `city.is.besieged` | `city.owner.atWar && city.hitPoints < city.maxHitPoints` | Damaged while its owner is at war |
| `city.is.conquered` | `city.isOccupied \|\| city.isPuppet` | Held after a capture |
| `player.is.neighbor` | `!player.self && player.distance <= neighboring` | A civilization or city-state next door |
| `player.is.nearby` | `!player.self && player.distance <= nearby` | A civilization or city-state in our region |
| `player.is.rival` | `player.major && !player.self && !player.friend && !player.ally` | A major civilization we have no friendship or pact with |
| `pair.is.foreignWar` | `pair.atWar && !pair.involvesSelf && pair.majors` | A war between two other major civilizations |

A worked check of `city.is.starving`, with `recent` at 5 turns on Standard speed:

| City | `foodPerTurn` | `foodStored` | Reserve needed: `-foodPerTurn × 5 (recent)` | Result |
| --- | --- | --- | --- | --- |
| Growing | 3 | 20 | Not computed, food is positive | false |
| Slow loss, deep reserve | -2 | 30 | 10 | false, since 30 is above 10 |
| Fast loss, thin reserve | -4 | 12 | 20 | true, since 12 is below 20 |
| Reserve lasts exactly 5 turns | -2 | 10 | 10 | false, since 10 is not below 10 |

A shortcut that reads a [hidden fact](facts.md#hidden-and-missing-facts) is hidden too. `city.is.starving` therefore applies to the receiver's own cities and to foreign cities it has full insight into.

## Change or add a name

| Goal | Edit |
| --- | --- |
| Make "neighboring" wider for one experiment | An overlay `constants.json` with `neighboring: 9`. See [tuning with an overlay](overview.md#tune-with-an-overlay). |
| Change a default for everyone | The built-in `vox-agents/newspaper/constants.json` and the table on this page |
| Add a constant or type list | A new name in its group. Names must be valid JavaScript identifiers and must not collide with a global such as `self` or `turn`. |
| Add a shortcut | A new name under its subject with its expression. Catalogue loading validates it like any rule. |

Add a name when at least two rules share the idea. A threshold used by one rule reads more clearly inside that rule.
