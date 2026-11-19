# Newspaper trigger constants and shortcuts

The built-in `vox-agents/newspaper/constants.json` supplies the names used by the stock catalogue and merges with overlays. Pair shortcuts are available to both stock and overlay rules.

**Constants** give names to the numbers that [trigger rules](overview.md) compare against, such as `neighboring` for 7 tiles. **Shortcuts** give names to small expressions that many rules share, such as `city.is.neighbor`. This page is for developers writing or tuning rules. Both live in `vox-agents/newspaper/constants.json`, and changing one there changes every rule that uses it.

| Group | Holds | Used as | Example |
| --- | --- | --- | --- |
| `distances` | Distances in hex tiles | A plain name | `neighboring` |
| `spans` | Spans in Standard turns | A plain name, scaled to recorded turns | `recent` |
| `sizes` | Population counts | A plain name | `largeCity` |
| `shares` | Fractions from 0 to 1 | A plain name | `majority` |
| `types` | Lists of recorded names | A plain name holding a list | `settlers` |
| `shortcuts` | Expressions grouped by subject | `<subject>.is.<name>` | `city.is.neighbor` |

## Distance

Distance counts hex steps between recorded plots. Adjacent tiles are 1 apart. For a player, `distance` uses its cities visible at the cutoff and takes the shortest reading across those cities. If either side has no usable plot, the distance is unavailable. With valid recorded map dimensions and wrap flags, the count follows the shortest permitted route across map edges.

| Reading | Meaning |
| --- | --- |
| `city.distance.own` | From a city to the receiver's nearest city |
| `city.distance.capital` | From a city to the receiver's capital |
| `player.distance` | Between the closest pair of cities, one of the player's and one of the receiver's |
| `event.distance.own` | From an event's plot to the receiver's nearest city |
| `distance(a, b)` | Between any two players, cities, plots or events with usable coordinates |

Recordings without valid geometry, including older ones that predate it, use unwrapped distance. Two cities on opposite edges of a wrapping map then read as far apart.

| Constant | Default, in tiles | Meaning | Example on the map |
| --- | --- | --- | --- |
| `adjacent` | 4 | Borders nearly touch | A city founded right beside ours |
| `neighboring` | 7 | A next-door city | The closest city of the civilization we share a border with |
| `nearby` | 15 | Within the same region | A capital two or three cities away |
| `regional` | 25 | The same part of the continent | A war we would hear about but not feel |

## Spans

Spans measure time in **Standard turns**, the turn count at Standard game speed. The `spans` group stores each span in Standard turns, and saved replay configuration keeps that form. Before a rule sees a span, it is multiplied by the game-speed multiplier and rounded to the nearest whole recorded turn, with a minimum of 1. `turn - city.captured.turn <= recent` therefore works at any speed. On Marathon, where one Standard turn spans 3 recorded turns, `recent` is 15 recorded turns. A bare number inside an expression, such as the `2` in `held(pair, test, 2)`, is always recorded turns.

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

Type lists group recorded names so rules can check a category. The `ideologies` list also determines which branches count toward `player.ideology`.

| List | Contains | Example |
| --- | --- | --- |
| `settlers` | Settler, Pioneer, Colonist | `city.trained.some(t => settlers.includes(t.unit))` |
| `workers` | Worker, Work Boat | `city.trained.some(t => workers.includes(t.unit))` |
| `missionaries` | Missionary, Inquisitor, Great Prophet | `city.trained.some(t => missionaries.includes(t.unit))` |
| `greatPeople` | The Great Person unit names | `greatPeople.includes(event.unit)` on a `GreatPersonExpended` event |
| `defenses` | Walls, Castle, Arsenal, Military Base, and unique replacements | `city.built.some(b => defenses.includes(b.building))` |
| `ideologies` | Order, Freedom, Autocracy | `ideologies.includes(event.branch)` on a `PlayerAdoptPolicyBranch` event |

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

The `pair.is.foreignWar` source is authored in the built-in file and reads pair facts in pair rules.

A worked check of `city.is.starving`, with `recent` at 5 turns on Standard speed:

| City | `foodPerTurn` | `foodStored` | Reserve needed: `-foodPerTurn × 5 (recent)` | Result |
| --- | --- | --- | --- | --- |
| Growing | 3 | 20 | Not computed, food is positive | false |
| Slow loss, deep reserve | -2 | 30 | 10 | false, since 30 is above 10 |
| Fast loss, thin reserve | -4 | 12 | 20 | true, since 12 is below 20 |
| Reserve lasts exactly 5 turns | -2 | 10 | 10 | false, since 10 is not below 10 |

A shortcut that reads a [hidden fact](facts.md#hidden-and-missing-facts) is hidden too. Use `city.is.knows('starving')` to check whether the receiver can evaluate it for that city.

Shortcuts follow the subject they are read on: `city.before.is.conquered` tests the earlier city flags, and `city.owner.is.rival` tests the city's linked owner. Globals such as `cities` and `turn` still describe the current check. A historical shortcut can use only the facts available on that snapshot. For example, `city.before.is.frontier` is hidden because `city.own` is available only at the cutoff.

## Change or add a name

| Goal | Edit |
| --- | --- |
| Make "neighboring" wider for one experiment | An overlay `constants.json` with `{"distances":{"neighboring":9}}`. See [tuning with an overlay](overview.md#tune-with-an-overlay). |
| Change a default for everyone | The built-in `vox-agents/newspaper/constants.json` and the table on this page |
| Replace a type list | A name under `types`. The new list replaces the built-in list of that name rather than extending it. |
| Override one shortcut | A subject and name under `shortcuts`. Only that source changes. |
| Add a constant or type list | A new name in its group. Names must be valid JavaScript identifiers and must not collide with a global such as `self` or `turn`. |
| Add a shortcut | A new name under its subject with its expression. Catalogue loading validates it like any rule. |

Add a name when at least two rules share the idea. A threshold used by one rule reads more clearly inside that rule.
