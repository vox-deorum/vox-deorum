# News writing rules

Use this guide to write or revise `vox-agents/newspaper/templates/`. Check the trigger and the [facts and names you can print](editorial.md#placeholders-and-facts) before you draft. Each story reads in one column. A [two-column page](designs.md#rendering-constraints) puts two briefs side by side.

## Each story body should be about three sentences

1. **Report the news.** Say what happened and name who or what it happened to. Put the main facts first. A crier can call the city by name. A pamphlet can open with “At last!”
2. **Add one useful detail.** Explain what changed or show how people react. Use a scene or a quote if it tells readers something they need to know.
3. **Say what it means.** Follow up with a consequence, a judgment, a request, or a joke. The last sentence should add something the first two set up.

## Use everyday words and simple grammar structures

- Put the subject and verb close together: “We lost the city” is easier to read than “The loss of the city was reported.”
- Use simple grammar structures. Write “Merchants brought grain from Memphis to Thebes” in place of “The grain that the merchants brought to Thebes came from Memphis.”
- Read the piece aloud; if you have to stop to work out who did what, rewrite the sentence.

## Use concrete names when available

At least for the first mention, use concrete names of a civilization, city, religion, leader, or other subject in the story. Write “peace with Rome” in place of “peace with a foreign power”.

- Use `{{terms.leader}}` for the reader's leader by name and `{{player.leader}}` for the leader of a player subject. List these in the template's `names` when they should be underlined.
- Use `{{terms.civilization}}` for the reader's country and `{{terms.civilizationAdjective}}` for its adjective, as in “Rome” and “Roman.”
- Use [civic terms](editorial.md#civic-vocabulary) for words that vary by government: “our `{{terms.civic.government}}`,” “the `{{terms.civic.leaderTitle}}`,” or “your `{{terms.civic.people}}`” (plural). Use `{{terms.civic.leaderAddress}}` as a full phrase when speaking to the leader. Keep names like the World Congress.
- If you don't know the name, use a plain description such as “a foreign diplomat.”
- Use [regional shortcuts](triggers/constants.md#regional-shortcuts) when writing for a group of civilizations.

## Write from inside the world

Use the player's record for game facts and official decisions. You can invent a scene to show how people react. A crowd can wave flags when a country gains its freedom. Report a new border toll only if the game records one. If you quote someone, name them or say what they do.

Choose the [voice, stance, and genre](editorial.md#variant-styles) before you draft. Decide how the piece sounds, what position it takes, and what job it does. A report tells readers what happened. An analysis explains why it matters. An editorial makes a case. A notice can tell people what to do. A joke sets up a punch line. Use an exclamation mark when it fits the voice and the news.

## Use relevant numbers in the game world

Following the same spirit, use relevant numbers that make sense in the game world, give appropriate units, and convert them to phrases when otherwise. For example:

- “We lead by 3 technologies” makes sense. Readers can understand what the count measures.
- Write “The city is badly damaged” in place of “The city has 100/300 HP.” Hit points do not make sense in the game world context.

## Examples

**Crier · Local · Notice.** Tell neighbors who needs help and what they can do.

> {{city}}, some of your neighbors are going hungry! Families near the well have nothing to cook tonight. If you have soup to spare, take a bowl to a neighbor.

**Pamphlet · Government-critical · Editorial.** Lead with the loss and let a local voice say what's at stake.

> We lost {{cityName}} on our {{terms.civic.government}}'s watch. In neighboring towns, people are checking their gates and watchtowers. “Send us soldiers,” said a local councilman, “or we will have to swear loyalty to {{captor}} tomorrow.”

**Pamphlet · National · Editorial.** Speak to the leader in the mood of the crowd.

> At last, we are free of {{master}}! Out in the square, people are singing and waving the {{terms.civilizationAdjective}} flag. Come celebrate with your {{terms.civic.people}}, {{terms.civic.leaderAddress}}.

**Press · National · Editorial.** Give the leader a reason to act.

> Our golden age has begun, but we're still at war with {{enemies}}. Families still line up at the post office for letters from the front. {{terms.civic.leaderAddress}}, open peace talks so our soldiers have a chance to come home.

**Press · Rationalist · Analysis.** Keep the same lead. Let religious unrest shape the next two sentences. To judge unrest, divide total religious unhappiness by total happiness if both figures are known and total happiness is above zero. Check separately whether the country lost any benefits from the old faith.

Low unrest, when the facts also show a loss of religious benefits:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most of our cities. Across our towns, people of both faiths live together peacefully. We have lost the blessings of {{founded}}, so our {{terms.civic.government}} has good reason to keep the peace.

High unrest:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most of our cities. In one town, neighbors from both faiths argue over who should lead prayers at the old shrine. If these disputes spread, people may keep the old faith at home and have fewer places to practice it in public.

**Broadcast · National · Report.** Give the count and let someone react to the news.

> The World Congress will hear {{count}} proposals at its next session. Back home, one civics class is voting on the same proposals. “My pupils have to explain their votes,” their teacher says, “and our delegates should do the same.”

**Feed · Neutral · Joke.** State the result plainly so the joke can land.

> We came last out of {{count}} in the world standings. Everyone else has to look over their shoulder. Nobody can overtake us now.

## Before it goes to print

- Does the first sentence tell readers what happened?
- Did you use the names you know and pick civic terms where they fit?
- Are the sentences easy to follow? Does the second add a fact or detail?
- Does the record back the claims? Do the numbers make sense in the story?
- Does the ending follow from the news and fit the genre?
- If this news comes up again, does the next version add something new?
