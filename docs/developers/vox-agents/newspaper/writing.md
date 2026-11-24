# News writing rules

Use this guide to write or revise `vox-agents/newspaper/templates/`. Check the trigger and the [facts and names you can print](editorial.md#placeholders-and-facts) before you draft. Each story reads in one column. A [two-column page](designs.md#rendering-constraints) puts two briefs side by side.

## Shape each body into paragraphs

A short brief with one focus can use one paragraph. Start a new paragraph when the scene, time, speaker, or focus changes. The three jobs below describe what the body needs to cover; they do not set a paragraph count and do not each get one paragraph.

Write the three sentences in the same paragraph, unless you *really* want to format them as different paragraphs.

1. **Report the news.** Say what happened and name who or what it happened to. Put the main facts first. A crier can call the city by name. A pamphlet can open with “At last!”
2. **Add a useful detail.** Explain what changed or show how people react. Use a scene or a quote if it tells readers something they need to know.
3. **Say what it means.** Follow up with a consequence, a judgment, a request, or a joke. Think about how it can be useful or meaningful to your readers: reminding them to care more about happiness, to prepare for defense if enemies are gathering, or to be aware of a potential cultural victory. Don't be prescriptive, write in a natural way that fits the genre.

## Use everyday words and simple grammar structures

- Put the subject and verb close together: “We lost the city” is easier to read than “The loss of the city was reported.”
- Use simple grammar structures. Write “Merchants brought grain from Memphis to Thebes” in place of “The grain that the merchants brought to Thebes came from Memphis.”
- Read the piece aloud; if you have to stop to work out who did what, rewrite the sentence.
- Avoid unnatural structures like "this is A. not B." or "this is A. A do not mean B."
- Avoid defensive writing, such as "The tally is not combat strength" - the reader knows about that.

## Use concrete names when available

While "War Declared On Us" sounds like a good *headline*, use concrete names of a civilization, city, religion, leader, or other subject in the story body (at least for the first mention). The readers need to understand where a news is happening. Write “peace with Rome” in place of “peace with a foreign power”, use the civilization name instead of "this nation", use "Our scholars" or "Roman scholars" instead of "The scholars".

- Use `{{terms.leader}}` for the reader's leader by name and `{{player.leader}}` for the leader of a player subject. List these in the template's `names` when they should be underlined.
- Use `{{city}}` for the main city. If it should be clickable, [inherit the city link](editorial.md#sharing-links).
- Use `{{terms.civilization}}` for the reader's country and `{{terms.civilizationAdjective}}` for its adjective, as in “Rome” and “Roman.”
- Use [civic terms](editorial.md#civic-vocabulary) for words that vary by government: “our `{{terms.civic.government}}`,” “the `{{terms.civic.leaderTitle}}`,” or “your `{{terms.civic.people}}`” (plural). Use `{{terms.civic.leaderAddress}}` as a full phrase when speaking to the leader. Keep names like the World Congress.
- Use [regional shortcuts](triggers/constants.md#regional-shortcuts) when writing for a group of civilizations.

## Write from inside the world

Choose the [voice, stance, and genre](editorial.md#variant-styles) before you draft. Decide how the piece sounds, what position it takes, and what job it does:

- Create a perspective for your story. For example, a military zone analysis can be an evaluation from the general staff, and a building's completion can be announced by the local mayor.
- While you should mainly use the player's record for game facts, you can invent a scene or quote to show how people react. A crowd can wave flags when a country gains its freedom, a resident can curse the government when things go south. 
- Do not invent stories that may confuse the player with gameplay mechanics, though. (For example, if there is no mention of a border toll, do not invent one.)

## Use relevant numbers in the game world

Following the same spirit, use relevant numbers that make sense in the game world, give appropriate units, and convert them to phrases when otherwise. For example:

- “We lead by 3 technologies” makes sense. Readers can understand what the count measures.
- Write “The city is badly damaged” in place of “The city has 100/300 HP.” Hit points do not make sense in the game world context.
- Name the placeholder after its unit. Use `{{dropPoints}}`, `{{unrestPoints}}`, and `{{nearestDistance}}`. 
- Names ending in `percentage` or containing `happiness` or `weariness` print `percent` automatically. For example, `{{percentage}}` prints `80 percent` when its value is 80.
- Names containing `population` print `million`, `points` print `point` or `points`, `turns` print `turn` or `turns`, and `distance` print `tile` or `tiles`.
- `{{period.from}}` and `{{period.to}}` print as `Turn X`. Write “by {{period.to}}” to get “by Turn 50”.
- Add `{{terms.civic.people}}` after population count, such as `Famine leaves {{faminePopulation}} {{terms.civic.people}} unhappy`.
- Print a count and its noun together with `{{count|power|powers}}`. It writes the singular after 1 and the plural otherwise.
- Use `regiment` for military units and `team` for civilian units.

## Examples

**Crier · Local · Notice.** Tell neighbors who needs help and what they can do.

> {{city}}, your neighbors are going hungry! Families near the well have nothing to cook tonight. If you have soup to spare, take a bowl to a neighbor.

**Press · Neutral · Report.** Describe the damage in words a resident would use.

> {{city}} is badly damaged. Families near the walls are carrying their bedding to the market hall. “We'll run out of room by nightfall,” says the caretaker.

**Pamphlet · Government-critical · Editorial.** Lead with the loss and let a local voice say what's at stake.

> {{terms.civilization}} lost {{city}} on our {{terms.civic.government}}'s watch. In neighboring towns, people are checking their gates and watchtowers. “Send us soldiers,” said a local councilman, “or we will have to swear loyalty to {{captor}} tomorrow.”

**Pamphlet · National · Editorial.** Speak to the leader in the mood of the crowd.

> At last, we are free of {{master}}! Out in the square, people are singing and waving the {{terms.civilizationAdjective}} flag. Come celebrate with your {{terms.civic.people}}, {{terms.civic.leaderAddress}}.

**Press · National · Editorial.** Give the leader a reason to act.

> {{terms.civilizationAdjective}} golden age has begun, but we are still at war with {{enemies}}. Across the nation, families line up at the post office for letters from the front. {{terms.civic.leaderAddress}}, open peace talks now, so our soldiers have a chance to come home.

**Press · Rationalist · Analysis.** In this case, branch out the same story into two versions depending on the situation:

Low unrest, when the facts also show a loss of religious benefits:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most cities. Across our towns, people of both faiths live together peacefully. We may have lost the blessings of {{founded}}, but {{terms.civic.government}} has good reason to keep the peace.

High unrest:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most cities. In many towns, followers of {{founded}} stuggle to keep their ancestral shrines. As distributes spread, the old faith could soon lose its place in {{terms.civilizationAdjective}} public life.

**Broadcast · National · Report.** Name the assembly and give a count its readers can use.

> The {{league}} will hear {{count}} proposals at its next session. Back home, a teacher has asked her class to vote on the same proposals. “My pupils have to say why they voted that way,” she says, “and I'd like to hear our delegates do the same.”

**Feed · Neutral · Joke.** State the result plainly so the joke can land.

> We came last out of {{count}} in the world' cultural standings. Everyone else has to look over their shoulder. Nobody can overtake us now!

## Before it goes to print

- Does the first sentence tell readers what happened?
- Did you use the names you know and pick civic terms where they fit?
- Are the sentences easy to follow? Does each paragraph keep one focus?
- Does every new paragraph start because the scene, time, speaker, or focus changed?
- Does the record back the claims? Do the numbers make sense in the story?
- Does the ending follow from the news and fit the genre?
- If this news comes up again, does the next version add something new?
