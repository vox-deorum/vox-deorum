# Playing

In a Vox Deorum game, a language model decides how each AI civilization plays. This AI is the **strategist**: it decides how to play by thinking about its situation. You can run several AI civilizations at once, play alongside them, or watch an all-AI game; that choice happens when you start the game (see [Getting Started](getting-started.md)).

## What the AI does

Each time the strategist decides, it looks at the whole board: its cities and military, the other players, the victory race, and recent events. It then sets a direction: which victory to chase, what to research, which social policies to pursue, and how to feel about its neighbors.

- **The AI makes the big decisions.** It plays at the level of "turn toward a science victory and make peace with my eastern neighbor." Civ V's built-in AI handles individual unit moves and city management.
- **You can pace the decisions.** The AI can decide every few turns and hold its course in between, or reconsider early when something important happens: war or peace, a finished technology, an adopted policy or ideology, or a notable message from a diplomat.
- **The AI explains its reasoning.** When it changes course, it records why in plain language. The reasons land in the game's replay log, and you can review the full reasoning with the [Replayer](replay.md).

## Seeing the reasoning

- **The replay log** carries a short summary of each decision alongside the reasoning behind it, reading as a running account when you review the game.
- **In a watched game, the top panel** follows whichever civilization just acted, so your attention tracks whoever is making a move.

## Chatting with spokespersons

Each AI civilization can field a **spokesperson**, who talks in character. Ask what it thinks of you, how it sees the world, what it intends. A civilization may field a **diplomat**, who also takes note: what you say can reach the leader and color how it treats you later. The spokesperson conveys positions; the diplomat brings concrete proposals to the game's own deal screen for you to accept or decline.

**Talk to a spokesperson to learn about a civilization; talk to a diplomat and the civilization may learn about you.**

Conversations live in threads that persist as the game goes on. Each message is stamped with its turn, so the spokesperson keeps track of time with you: it knows which turn it is and how the game has moved on since you last spoke. Replies stream in as the model writes them.

## What to expect

The AI makes its own choices and can surprise you: change course, hold a grudge, pursue an unexpected victory. Reaching the model takes a moment, and turn decisions and replies carry a short wait; faster or local models shorten it, and a stronger model plays sharper. See [Configuration](configuration.md).

If the AI seems stuck, a turn hangs, or chat doesn't respond, see [Troubleshooting](troubleshooting.md).
