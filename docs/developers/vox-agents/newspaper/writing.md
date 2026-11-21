# News writing rules

Write for the player who lived through the game. The newspaper's first job is to entertain.

Use these rules when editing `vox-agents/newspaper/templates/`, and give them to any model doing the same work. Each example names its [voice, stance, and genre](editorial.md#variant-styles). Check the corresponding trigger for the [placeholders](editorial.md#placeholders-and-facts) a template can use. Rules are not absolute: also try to diversify your writing and reduce repetitive phrases or writing patterns.

## Entertain first

Every variant has to earn its place. Give the reader a scene, a voice, a joke, a sting, or one clean image. The event is the excuse; the writing is the product.

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

The last line of the [stock joke](../../../../vox-agents/newspaper/templates/politics.json) turns a bad result into a consolation.

## Hint at rules through consequences

Imagine freely what the news does to someone's work, supper, or plans. Invent plausible scenes, people, dialogue, and everyday consequences. Keep game outcomes, exact figures, dates, and official decisions grounded in the visible record. Let people in the story voice their own hopes and guesses.

A rule hint can come through an empty shelf, a longer queue, or a merchant changing course. Use it when it helps the story. If the hint needs an explanation, cut it.

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

The [trigger](../../../../vox-agents/newspaper/triggers/trade.json) establishes that the outgoing route count fell to zero. In the [stock obituary](../../../../vox-agents/newspaper/templates/trade.json), putting the weights away shows what the ending means to someone who worked the route.

## Write from inside the world

Write for people who live there. A crier can ask neighbors to share their bread, and an editorial can press the council for answers. Keep game strategy and instructions to the player out of the copy.

Give ordinary people room to react when it suits the genre. A curse can come naturally from a customer in an anecdote or a crier calling across a square.

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

The [stock editorial](../../../../vox-agents/newspaper/templates/diplomacy.json) makes a strong start, then slips into an ordered list of moves.

## Define things by what they are

A correction like “X is A, not B” can turn a story into a glossary entry. State the fact, show the effect, or let a person react. Keep contrasts that carry an argument, a joke, or a real disagreement.

**Voice:** `press` · **Stance:** `rationalist` · **Genre:** `analysis`

Write:

> The latest tally puts {{rival}}'s influence at {{percentage}} percent, enough to reach the Influential mark. On the high street, a music seller has moved their songbooks into the front window. A shop window can change in an afternoon; the next tally will tell us whether that influence is still growing.

Avoid:

> The Influential mark is a measurement, not a mood. It records a change in the balance of cultural influence, which now stands at {{percentage}} percent.

## Name the civilization

Use the supplied name on first useful mention, then shorten naturally. Where it reads better, use the catalogue's adjective for the reader's own civilization. Use the foreign civilization's name when you have no adjective. Save generic wording for a fallback variant when the name is unavailable.

**Voice:** `gazette` · **Stance:** `conciliatory` · **Genre:** `letter`

Write:

> Madam, since peace with {{settled}}, I have put aside a bolt of {{terms.civilizationAdjective}} cloth for the first of their merchants to come to my door. I hope he bargains hard; after so much talk of war, it would be a pleasure to quarrel over the price of cloth again.
>
> A dyer writing to the editor

Avoid:

> Madam, since peace with a foreign power, I have kept a bolt of our cloth for the first of their merchants to come to my door. I hope he bargains hard. It would be a pleasure to quarrel over cloth again.
>
> A dyer writing to the editor

## Editor checklist

Before a story prints, ask:

- Does the first sentence make me want the second?
- What does somebody in the world notice, want, or have to do differently?
- Can I trace claims about the game to visible evidence?
- Does the piece still work if the reader misses the rule hint?
- Does the piece sound like its credited voice, stance, and genre?
- Do names appear where they help, and is it clear who is being addressed?
- If the same news prints again, will the reader get a new angle?
