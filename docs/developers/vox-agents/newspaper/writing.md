# News writing rules

Use this guide to write or revise a [stock variant](editorial.md#catalogue-and-eligibility). The Writing Desk also includes it in the writer model's prompt for each request.

## Use placeholders

Use only the [placeholders listed for your task](editorial.md#placeholders-and-facts). An unknown placeholder makes the story unprintable.

A placeholder prints its own unit, so write it alone: `on {{turn}}`, not `on turn {{turn}}`. `{{turnsLeft}}` prints `3 turns`, and `{{distance}}` prints `4 tiles`. Add a noun to a plain count with `{{count|regiment|regiments}}`.

## Shape each body into paragraphs

Use one `body` entry per paragraph. Keep a short brief with one focus together. Start a new paragraph when a change of scene, time, speaker, or focus makes the story easier to follow.

Cover these jobs in whatever paragraphs fit:

1. **Report the news.** Say what happened and name who or what it happened to. Put the main facts first. A crier can call the city by name. A pamphlet can open with “At last!”
2. **Add a useful detail.** Explain what changed or show how people react. A scene or a quote can carry this if it tells readers something they need to know.
3. **Say what it means.** Follow with a consequence, judgment, request, or joke. Help readers see why happiness, defense, or a potential cultural victory matters, without prescribing a choice. Let the genre set the tone.

## Use everyday words and simple grammar structures

Put the subject and verb close together: “Merchants brought grain from Memphis to Thebes.” Read the piece aloud. If you have to stop to work out who did what, rewrite the sentence. State what the facts show in plain words.

## Use concrete names when available

At first mention, name the city, civilization, leader, or religion if it is available. Write “peace with Rome” or “Roman scholars.” Keep official names such as World Congress.

When available, use [civic terms](editorial.md#civic-vocabulary) for government, people, and titles. Use the people term as a plural and the form of address as a complete phrase.

## Write from inside the world

Write in the variant's [voice, stance, and genre](editorial.md#variant-styles). They set how the piece sounds, what position it takes, and what job it does.

- Give the story a perspective. A military zone analysis can come from the general staff; a completed building can be announced by the local mayor.
- Use the player's record for game facts. You may invent a scene or quote to show how people react: a crowd can wave flags when a country gains its freedom, a resident can curse the government when things go wrong. A quote is optional; add one only when it helps.
- Protect the factual substance. Do not invent events, causes, or mechanics that the facts do not support. If no border toll is mentioned, do not add one.

## Use relevant numbers in the game world

Choose wording readers can picture, and turn a figure into words when a raw unit would break the scene.

- “We lead by 3 technologies” works because readers understand what the count measures.
- Write “The city is badly damaged” in place of “The city has 100/300 HP.” Hit points have no place in the world.
- Use `regiment` for military units and `team` for civilian units.

## Examples

Labels give the voice, stance, and genre. Some placeholders come from a particular rule; use only those available for your task.

**Crier · Local · Notice.** Tell neighbors who needs help and what they can do.

> {{city}}, your neighbors are going hungry! Families near the well have nothing to cook tonight. If you have soup to spare, take a bowl to a neighbor.

**Press · Neutral · Report.** Describe the damage in words a resident would use.

> {{city}} is badly damaged. Families near the walls are carrying their bedding to the market hall. “We'll run out of room by nightfall,” says the caretaker.

**Pamphlet · Government-critical · Editorial.** Lead with the loss and let a local voice say what's at stake.

> {{terms.civilization}} lost {{city}} on our {{terms.civic.government}}'s watch. In neighboring towns, people are checking their gates and watchtowers. “Send us soldiers,” said a local councilman, “or we will have to swear loyalty to {{captor}} tomorrow.”

**Pamphlet · National · Editorial.** Speak to the leader in the mood of the crowd.

> At last, we are free of {{master}}! Out in the square, people are singing and waving the {{terms.civilizationAdjective}} flag. Come celebrate with your {{terms.civic.people}}, {{terms.civic.leaderAddress}}.

**Press · National · Editorial.** Give the leader a reason to act.

> A {{terms.civilizationAdjective}} golden age has begun, but we are still at war with {{enemies}}. Across the nation, families line up at the post office for letters from the front. {{terms.civic.leaderAddress}}, open peace talks now, so our soldiers have a chance to come home.

**Press · Rationalist · Analysis.** Branch the same story into two versions to match the situation.

Low unrest, when the facts also show a loss of religious benefits:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most cities. Across our towns, people of both faiths live together peacefully. We may have lost the blessings of {{founded}}, but {{terms.civic.government}} has good reason to keep the peace.

High unrest:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most cities. In many towns, followers of {{founded}} struggle to keep their ancestral shrines. As discontent spreads, the old faith could soon lose its place in {{terms.civilizationAdjective}} public life.

**Broadcast · National · Report.** Name the assembly and give a count its readers can use.

> The {{league}} will hear {{count}} proposals at its next session. Back home, a teacher has asked her class to vote on the same proposals. “My pupils have to say why they voted that way,” she says, “and I'd like to hear our delegates do the same.”

**Feed · Neutral · Joke.** State the result plainly so the joke can land.

> We placed last out of {{count}} in the world's cultural standings. Everyone else has to look over their shoulder. Nobody can overtake us now!

## Before it goes to print

- Does the first sentence tell readers what happened?
- Did you use concrete names and pick civic terms where they fit?
- Do the facts and numbers support the claims?
- Does the ending follow from the news and fit the genre?
