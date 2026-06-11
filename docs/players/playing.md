# Playing

Once a game is running, the AI civilizations are no longer the stock Civilization V opponents — each one you've put under Vox Deorum's control is being steered by a language model. This page describes what that feels like in practice: what the AI does, how to talk to it, and what to expect.

## What the AI does

A normal Civ V opponent follows fixed rules. A Vox Deorum opponent **thinks about its situation each turn and decides how to play.** Periodically — and immediately when something important happens, like a war declaration or a finished wonder — the AI for each language-model civilization looks at the whole board: its cities and military, the other players, how the victory race is going, and recent events. It then sets a direction for its empire: which victory to chase, what to research, which social policies to pursue, how to feel about its neighbors.

A few things are worth knowing about how this steering works:

- **The AI guides, it doesn't micromanage.** It decides the *strategy*; the game's built-in tactical AI still moves the individual units and runs the cities. So the AI plays at the level of a human thinking "I should turn toward a science victory and make peace with my eastern neighbor," not "move this archer one tile."
- **It doesn't decide every single turn.** Decisions are paced out — the AI commits to a course and holds it for a while, reconsidering on a schedule or whenever events demand it. On the turns in between, it's deliberately staying the course rather than ignoring you.
- **Every decision has a reason.** When the AI changes direction, it records *why* in plain language. You'll see those rationales in the game (below), and you can review the full reasoning afterward in [Replay](replay.md).

You can have the AI run several civilizations at once, play alongside it as a normal human player, or simply watch a game where every major civilization is AI-driven — that's set by the configuration you pick when you start the game.

## Seeing the AI's reasoning in-game

Vox Deorum adds almost no new windows to the game; instead it speaks through surfaces Civ V already has.

- **The replay log.** As the AI makes its moves, it writes a short summary and the reasoning behind each one into the player's replay messages. Reviewing the game later, these read as a running account of *why* each civilization did what it did, not just the bare facts the game normally records.
- **The top panel.** As decisions land, the game's top panel follows along, switching to show whichever civilization just acted, so your attention tracks whoever is currently making a move.

## Chatting with spokespersons

Each AI civilization can field a **spokesperson** — a representative you can talk to, in character, from inside the game. Open a civilization's chat and ask it questions: what it thinks of you, how it sees the world, what its intentions are. It answers in the voice of its leader, warmly if you're allies, guardedly or with a sneer if you're rivals.

Two things to keep in mind:

- **A spokesperson conveys positions; it can't make deals.** It speaks for its civilization but has no authority to actually agree to anything. Real agreements still happen through the game's normal diplomacy screen. Think of it as talking *to* the nation, not negotiating a binding treaty.
- **Some conversations go both ways.** A plain spokesperson just talks — what you say stays between you and it. But a civilization may instead put forward a **diplomat**, who plays the same conversational role *and quietly takes note*: something you reveal in conversation — a threat, an offer, a careless admission — can make its way back to that civilization's leader and color how it treats you later. The simple rule: **talk to a spokesperson to learn about a civilization; talk to a diplomat and the civilization may learn about you.**

Conversations live in threads that persist as the game goes on, and the spokesperson is aware of time passing — it knows which turn it is and that turns have gone by since you last spoke. The words come from the language model in real time, so replies stream in as they're written.

## What to expect

- **The AI is genuinely making its own choices.** It can surprise you — change course, hold a grudge, pursue an unexpected victory. That unpredictability is the point.
- **Responses take a moment.** Both the AI's turn decisions and a spokesperson's replies involve a call to the language model, so there's a short wait. Faster or local models reduce it; see [Configuration](configuration.md).
- **Quality depends on the model.** A stronger model plays a sharper game and holds a better conversation than a small or local one. You choose the trade-off between quality, speed, and cost.

If the AI seems stuck, a turn hangs, or chat doesn't respond, see [Troubleshooting](troubleshooting.md).
