# News writing rules

The player lived through the game. Give them a paper their citizens would want to read.

Use this guide when editing `vox-agents/newspaper/templates/`, and give it to any model writing variants. Each example names its [voice, stance, and genre](editorial.md#variant-styles). Check the trigger for the [placeholders](editorial.md#placeholders-and-facts) it supplies.

## Entertain first

Give the reader a reason to linger over news they already know. A joke can do it in two lines; a grim story might need just one image. Read variants side by side. If every story opens at a market or ends on a quip, change the angle or the rhythm.

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

Imagine what the news does to somebody's work, supper, or plans. Invent the people and scenes freely; let them hope, guess, and get things wrong. Take outcomes, figures, dates, and official decisions from the game record the player can see.

An empty shelf or a merchant turning back can hint at a game rule. Let the story work even for readers who miss the hint.

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

The [trade trigger](../../../../vox-agents/newspaper/triggers/trade.json) tells us the outgoing routes have ended. The person putting away the weights is the [obituary writer's invention](../../../../vox-agents/newspaper/templates/trade.json).

## Write from inside the world

Picture the neighbors close enough to hear the crier or the councilor opening the morning paper. A crier can ask for bread; an editorial can demand an account of a city's fall. Name who speaks, who acts, and who owes an answer. Use “our delegates” where “they” would leave readers guessing. Leave the player's next move to the player.

**Voice:** `pamphlet` · **Stance:** `government-critical` · **Genre:** `editorial`

Write:

> Councilors, tell the next town how we lost {{cityName}}. People there are checking their gate bolts by lamplight, and they want to know whether ours held.

Avoid:

> We lost {{cityName}}. Name the failure before the next city pays for it.

**Voice:** `pamphlet` · **Stance:** `national` · **Genre:** `editorial`

Write:

> People, our word is ours again. If the council sends another envoy to {{master}}, let it read his instructions in the square. We have a right to hear what will be said in our name.

Avoid:

> Nobody in the square needs telling what the end of the {{master}} vassalage means. But freedom is a running expense, not a festival. Before the old master's mood changes, the court should be found buying arms, courting allies and filling the grain stores, roughly in that order.

## Give each genre a job

An editorial takes a side on a public question. Give a skeptical reader a reason to agree. When the paper calls for action, name who can act and say what you want them to do.

**Voice:** `press` · **Stance:** `national` · **Genre:** `editorial`

Write:

> Our golden age has begun with the army still in the field. The council should open talks with {{enemies}} while we can afford to turn down a bad offer. If another campaign drains the treasury, the other side can name its price.

Avoid:

> Keep him a place to come back to. The country will have earned its golden age if the people who went out to fight can share in it when they come home.

Analysis starts with a question raised by the news. Why did this happen? Who might feel it next? Give readers your best answer and show what led you there. If the evidence reaches only as far as one street, keep the claim there.

**Voice:** `press` · **Stance:** `rationalist` · **Genre:** `analysis`

Write:

> {{majorityFaith}} has a majority in most of our cities. In the lane behind the dye works, some of its worshippers still bring oil to the shrine of {{founded}} and help patch its roof. Those families could keep the shrine open even if its congregation dwindles.

Avoid:

> A national tally can show how widely each creed is kept. Follow the woman on her rounds, and you can learn how much of the old routine her neighbors still share.

## Let people speak

Invent quotes when they suit the piece. A shopkeeper hears what customers ask for; a witness saw the gates give way; a professor can argue that the figures leave something out. Give each speaker a name or a role, and words they would say out loud. A customer can swear. So can a crier. Keep official statements, decisions, and game facts tied to the record, whoever is speaking.

In a report, lead with the news. Then give someone who has to live with it a word. An opinion piece can quote the person it means to answer.

**Voice:** `broadcast` · **Stance:** `national` · **Genre:** `report`

Write:

> At the World Congress, {{count}} proposals are on the agenda for the next session. Back home, one civics class is voting on the same proposals. “I ask the pupils why they voted that way,” their teacher says. “I'd like to put that question to our delegates.”

Avoid:

> At the World Congress, the next session is close. There are {{count}} proposals on the agenda, and our delegates still have a few doors to knock on. The country wants to know where they stand.

## Make contrasts count

When a sentence says “X is A, not B,” ask who thought it was B. If nobody did, state the fact and move on. A contrast can make the joke, sharpen an argument, or settle a dispute. If the details already show the difference, give readers room to see it.

**Voice:** `press` · **Stance:** `rationalist` · **Genre:** `analysis`

Write:

> The latest tally puts {{rival}}'s influence at {{percentage}} percent, enough to reach the Influential mark. On the high street, a music seller has moved their songbooks into the front window. A shop window can change in an afternoon; the next tally will tell us whether that influence is still growing.

Avoid:

> The Influential mark is a measurement, not a mood. It records a change in the balance of cultural influence, which now stands at {{percentage}} percent.

## Name the civilization

Name a civilization when it first matters to the story. After that, a shorter reference will usually do. Use the catalogue's adjective for the reader's own civilization where it sounds natural. If you have no adjective for a foreign civilization, write the sentence around its name. Save “a foreign power” for a fallback with no name to print.

**Voice:** `gazette` · **Stance:** `conciliatory` · **Genre:** `letter`

Write:

> Madam, since peace with {{settled}}, I have put aside a bolt of {{terms.civilizationAdjective}} cloth for the first of their merchants to come to my door. I hope he bargains hard; after so much talk of war, it would be a pleasure to quarrel over the price of cloth again.
>
> A dyer writing to the editor

Avoid:

> Madam, since peace with a foreign power, I have kept a bolt of our cloth for the first of their merchants to come to my door. I hope he bargains hard. It would be a pleasure to quarrel over cloth again.
>
> A dyer writing to the editor

## Before it goes to print

- Does the first sentence make me want the second?
- Whose day changes because of this news? How?
- Can I trace each claim about the game to a fact the player can see?
- Would I still enjoy the piece if I missed the hint about the rules?
- Do the voice, stance, and genre come through on the page?
- Is it clear who is speaking, who they mean, and who they want to hear them?
- What does each quote add?
- If the news comes round again, what will the next version give the reader?
