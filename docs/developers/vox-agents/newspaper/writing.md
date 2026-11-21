# News writing rules

The newspaper turns a recorded Civilization V game into stories for the player who lived it. Its first job is to entertain. A reader who wanted a manual would open the civilopedia.

A story may hint at a rule, though the hint rides inside a story that already works without it. These rules cover the authored prose under `vox-agents/newspaper/templates/` and apply to any model asked to write or revise it. Show this page to a model before it edits templates.

## Entertain first

Every variant has to earn its place. Give the reader a scene, a voice, a joke, a sting, or one clean image. The event is the excuse; the writing is the product.

Write:

> The pie shop on the square sold out by noon, the first time since the war started. People smiled at strangers, and strangers smiled back.

Avoid:

> War weariness has fallen. The reduction improves production and happiness.

The state-change line tells us what the numbers did. The pie-shop line lets the reader feel the change in a street they can picture.

## Hint at rules through consequences

A rule hint is a detail a resident would notice. It arrives as an effect: an empty shelf, a longer queue, a merchant changing his route, a recruiting sergeant back on the square. It never explains the mechanic and never tells the reader what to do.

Write:

> The recruiting sergeants are back on the square, and the innkeeper has begun asking travelers for news of the front.

Avoid:

> Unhappiness is rising. Build coliseums or connect a new luxury resource.

The recruiting line lets a player who knows the game infer the pressure. The tooltip line explains the pressure and then prescribes a fix. If a hint needs a sentence of explanation, cut the hint.

## Write from inside the world

The narrator reports what happened. People inside the story may shout, preach, or plead, and an in-world speaker can give orders to other people in the world.

Write:

> The council has published no account of what went wrong. The next city down the road has begun counting its walls.

Avoid:

> Name the failure before the next city pays for it.

A crier can say "Keep the gates shut." The narrator cannot say "Name the failure." The difference is who is being spoken to. The banned line reads like a line of technical writing, a task from a design note handed to whoever runs the country. The rewrite lets the council's silence and the next city's fear do the accusing.

## Define things by what they are

The frame "X is A, not B" turns a story into a correction. It also invites a second clause that explains the first, which is the sound of technical writing. State the fact, show the effect, or let a person react.

Write:

> {{rival}}'s songs fill the taverns and its proverbs are on the lips of children. The count of its influence over us has reached 100 percent, and the palace has said nothing about whether the tide has crested.

Avoid:

> The Influential mark is a measurement, not a mood: it records that a rival's ideas now spread among us faster than our own can answer. The count over our nation stands at 100 percent. What the figure cannot say is whether the rise has finished, and the next count should be watched for the answer.

The rewrite carries the same three facts: the rival's culture is spreading, the count has reached its mark, and the trend may continue. The reader gets them through a street and a silence.

The ban covers the other shapes of the same move: "X is not B; it is A", "X is less a B than an A", and "A rather than B" used as a definition. Replace the contrast with a fact, an image, or a consequence.

## Name the civilization

Generic words like "rival", "foreign power" and "our nation" throw away the strongest word in the story. When the trigger supplies a civilization name, print the name. When the catalogue supplies an adjective, print the adjective.

Write a supplied name:

> The songs in the taverns are {{rival}}'s now, and {{rival}}'s proverbs are on the lips of children.

Write a supplied adjective:

> {{terms.civilizationAdjective}} songs fill the taverns, and {{terms.civilizationAdjective}} cloth hangs in every stall.

Avoid:

> Rival songs fill the taverns.

The catalogue supplies `{{terms.civilization}}` and `{{terms.civilizationAdjective}}` for the reader's own nation, so `{{terms.civilizationAdjective}} songs` beats "our songs". A foreign nation has a name from the trigger value, so `{{rival}}'s songs` beats "rival songs". Where no adjective is supplied for a foreign nation, use its name.

## Editor checklist

Before a story prints, ask:

- Does the first sentence make me want the second?
- Can a resident see, hear, smell, or touch something in this story?
- Is any sentence explaining a game rule?
- Does any sentence define something by what it is not?
- Does any narrator line give the reader an instruction?
- Does any generic word stand where a civilization name or adjective belongs?
- Would the story still work if the hinted rule were removed?
