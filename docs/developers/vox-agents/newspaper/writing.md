# News writing rules

The player lived through the game. Give them a paper their citizens would want to read.

Use this guide when you edit `vox-agents/newspaper/templates/`. Share it with any model drafting variants. Each example names its [voice, stance, and genre](editorial.md#variant-styles). Check the trigger and the [placeholder reference](editorial.md#placeholders-and-facts) before you draft. Use [regional shortcuts](triggers/constants.md#regional-shortcuts) when a variant is written for a group of civilizations.

Each story reads in one column. A [two-column page](designs.md#rendering-constraints) places two separate briefs side by side.

## Get to the action early

Keep the subject and verb close. If prepositional phrases pile up, cut the ones the reader can spare and let the strongest detail follow the action. When two clipped sentences split a thought, let one sentence carry the action and its consequence.

## Entertain first

Give readers a reason to linger over news they already know. A joke might take two lines; a grim story might need one image. Read the variants together. If every story opens at a market or ends on a quip, change the angle or the rhythm.

**Voice:** `tabloid` · **Stance:** `populist` · **Genre:** `anecdote`

Write:

> The war was still on, but the pie shop on the square sold out by noon. At the back of the line, a man stopped a woman on her way out and offered her a coin for half her slice. She took it. “Get your own damn fork,” she said.

Avoid:

> War weariness has fallen. The reduction improves production and happiness.

**Voice:** `feed` · **Stance:** `neutral` · **Genre:** `joke`

Write:

> The standings are out: last of {{count}}. One consolation. Nobody can overtake us from there.

Avoid:

> The standings are out, and we're last of {{count}}. We're now at the bottom of the table.

## Show what the news changes

Imagine whose workday, supper, or plans the news changes. Invent people and scenes freely; let people hope, guess, and get things wrong. Take game outcomes, figures, dates, and official decisions from the player's visible record.

An empty shelf or a merchant turning back can hint at a game rule. The story should still work if readers miss the hint.

**Voice:** `crier` · **Stance:** `local` · **Genre:** `notice`

Write:

> Hear it, Thebes! Some of your neighbors have cold hearths and empty pots. If your supper will stretch another ladleful, set a bowl by the door. A bowl by the door, neighbors!

Avoid:

> Famine is the main source of unhappiness in Thebes. Reassign citizens to food tiles.

**Voice:** `chronicle` · **Stance:** `traditional` · **Genre:** `obituary`

Write:

> Here ends the account of our last outgoing trade route. In the merchant's yard, the keeper of the scales wrapped the weights in wool and laid them in their chest.

Avoid:

> It was one road, and it carried everything we sent abroad. It ran through seasons of war and seasons of peace, and it ran until this one, when it ran no more.

The [`last-trade-route-ends` trigger](../../../../vox-agents/newspaper/triggers/trade.json) tells us the outgoing routes fell to zero. The [obituary](../../../../vox-agents/newspaper/templates/trade.json) supplies the keeper and the wool.

## Give the reader something to see

Find a detail that shows what the news changes for somebody: a charge circled on a bill, a queue spilling down the courthouse steps.

**Voice:** `press` · **Stance:** `national` · **Genre:** `analysis`

Write:

> {{city}} has added {{added}} works to its collection, bringing it to {{total}}. The neighboring town gallery has offered to send its wagon, with freshly made crates, for a winter loan. A loan on those terms could let small towns show works they can't afford to buy.

Avoid:

> A collection is a city's hold on the world's attention, and {{city}} has just strengthened its grip: {{added}} new works, {{total}} in all. Each one is a reason for a traveler to stop, and an answer to a rival's galleries. No treaty buys that kind of standing.

## Write from inside the world

Picture the neighbors who hear the crier, or the councilor opening the morning paper. A crier can ask for bread; an editorial can demand that the council explain a city's fall. Name who speaks, who acts, and who owes an answer. Write “our delegates” if “they” would leave readers guessing. Leave the next move to the player.

**Voice:** `pamphlet` · **Stance:** `government-critical` · **Genre:** `editorial`

Write:

> We lost {{cityName}} on the government's watch. In neighboring towns, people are checking their gates and watchtowers. “Dispatch your royal guards,” said a local councilman, “or we will have to swear loyalty to {{captor}} tomorrow.”

Avoid:

> We lost {{cityName}}. Name the failure before the next city pays for it.

**Voice:** `pamphlet` · **Stance:** `national` · **Genre:** `editorial`

Write:

> At last, we are free of {{master}}! Out in the square, people are singing and waving the {{terms.civilizationAdjective}} flag. {{terms.leader}}, come celebrate with your subjects.

Avoid:

> Nobody in the square needs telling what the end of the {{master}} vassalage means. But freedom is a running expense, not a festival. Before the old master's mood changes, the court should be found buying arms, courting allies and filling the grain stores, roughly in that order.

## Give each genre a job

An editorial takes a side on a public question. Give skeptical readers a reason to agree. If you call for action, name who can take it and say what they should do.

**Voice:** `press` · **Stance:** `national` · **Genre:** `editorial`

Write:

> Our golden age has begun, but we're still at war with {{enemies}}. At the post office, families are lining up for letters from the front. {{terms.leader}}, open peace talks and give those families a chance to welcome their soldiers home.

Avoid:

> Keep him a place to come back to. The country will have earned its golden age if the people who went out to fight can share in it when they come home.

Let the news raise a question. Why did this happen? Who might feel it next? Give readers your best answer and show your evidence. If the evidence covers only one street, keep the claim there.

**Voice:** `press` · **Stance:** `rationalist` · **Genre:** `analysis`

The same news can call for a different ending depending on the state of the empire. Here, the proposed split uses total religious unhappiness divided by total happiness.

Write when religious unrest is low:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most of its cities. In one town, people from both faiths are fixing the roof of the old shrine. The shrine could stay open even if fewer people come to pray, as long as its neighbors still help.

Write when religious unrest is high:

> {{terms.civilization}} founded {{founded}}, but {{majorityFaith}} is now the main faith in most of its cities. In one town, neighbors who used to look after the old shrine together are arguing over who should lead prayers there. If they stop working together, even people who kept the old faith could lose their place to pray.

Avoid:

> A national tally can show how widely each creed is kept. Follow the woman on her rounds, and you can learn how much of the old routine her neighbors still share.

## Let people speak

Invent quotes when they suit the piece. A shopkeeper hears what customers want; a witness saw the gates give way; a professor can spot what the figures leave out. Name each speaker or say what they do. Give them words they'd say aloud. A customer can swear. So can a crier. Whoever speaks, take official statements, decisions, and game facts from the record.

A report leads with the news. Someone who has to live with it can have the next word. An opinion piece can quote the person it means to answer.

**Voice:** `broadcast` · **Stance:** `national` · **Genre:** `report`

Write:

> At the World Congress, {{count}} proposals are on the agenda for the next session. Back home, one civics class is voting on the same proposals. “I ask the pupils why they voted that way,” their teacher says. “I'd like to put that question to our delegates.”

Avoid:

> At the World Congress, the next session is close. There are {{count}} proposals on the agenda, and our delegates still have a few doors to knock on. The country wants to know where they stand.

## Make contrasts count

When you write “X is A, not B,” ask who thought it was B. If nobody did, state the fact and move on. A contrast can make a joke land, sharpen an argument, or settle a dispute. Trust readers to spot a difference the details already show.

**Voice:** `press` · **Stance:** `rationalist` · **Genre:** `analysis`

Write:

> The latest tally puts {{rival}}'s influence at {{percentage}} percent, enough to reach the Influential mark. On the high street, a music seller has moved their songbooks into the front window. A shop window can change in an afternoon; the next tally will tell us whether that influence is still growing.

Avoid:

> The Influential mark is a measurement, not a mood. It records a change in the balance of cultural influence, which now stands at {{percentage}} percent.

## Name the civilization

Name a civilization as soon as it matters. Shorten later references where you can. For the reader's civilization, use `{{terms.civilizationAdjective}}` where it sounds natural. Use a foreign civilization's name if you lack its adjective. If you lack a name, “a foreign diplomat” may suffice. Mention the gap only if the uncertainty is itself news.

**Voice:** `gazette` · **Stance:** `conciliatory` · **Genre:** `letter`

Write:

> Madam, since peace with {{settled}}, I have put aside a bolt of {{terms.civilizationAdjective}} cloth for the first of their merchants to come to my door. I hope he bargains hard; after so much talk of war, it would be a pleasure to quarrel over the price of cloth again.
>
> A dyer writing to the editor

Avoid:

> Madam, since peace with a foreign power, I have kept a bolt of our cloth for the first of their merchants to come to my door. I hope he bargains hard. It would be a pleasure to quarrel over cloth again.
>
> A dyer writing to the editor

**Voice:** `general` · **Stance:** `neutral` · **Genre:** `report`

Write:

> A foreign diplomat has taken up a post in the capital. At the council hall, a merchant carrying a customs bill asked a clerk how to arrange a meeting. “My cloth has sat on their quay for a month,” she said. “They send me a bill every week, so I know it's still there.”

Avoid:

> A foreign diplomat has presented credentials at our capital, and our records do not say which power sent them. The channel between the two governments now runs direct, and the capital is full of the usual guesses.

## Before it goes to print

- Does the first sentence make me want the second?
- Whose day does the news change? How?
- Does the sentence reach its verb before the details pile up?
- What can the reader picture, and what does that detail tell them?
- Can I trace each game claim to a fact the player can see?
- Would I still enjoy the piece if I missed the hint?
- Do the voice, stance, and genre come through?
- Can I tell who speaks, who they mean, and who should hear them?
- What does each quote add?
- If the news comes round again, what will the next version add?
