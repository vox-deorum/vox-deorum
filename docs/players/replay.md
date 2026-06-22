# Replay

Every Civilization V game you finish leaves behind a replay file, and Vox Deorum's games are no exception. The **Vox Deorum Replayer** is a web tool for rewatching those games, with empires rising and falling and borders shifting over the centuries, so you can review how a match unfolded, your play and the AI's alike.

The Replayer is a separate, browser-based tool. There is nothing to install. You open it in your web browser and load a replay file:

1. Open the hosted viewer at <https://civitas-john.github.io/vox-deorum-replay/>.
2. Load one of your `.Civ5Replay` files (see [Finding your replay files](#finding-your-replay-files)).
3. Play it back with the keyboard (see [Watching a game](#watching-a-game)).

## Opening the Replayer

Go to the hosted viewer at **<https://civitas-john.github.io/vox-deorum-replay/>**.

It is built specifically for Community Patch and Vox Populi games, the same ruleset Vox Deorum uses, so your Vox Deorum games load correctly. Plain, unmodded Civ V replays may not.

## Finding your replay files

Civilization V writes a `.Civ5Replay` file for each completed game. On Windows you'll find them under your Documents folder:

```text
Documents\My Games\Sid Meier's Civilization 5\Replays\
```

## Loading a game

There are two ways to open a replay in the viewer:

- **Drag and drop.** Drag a `.Civ5Replay` file straight onto the Replayer page.
- **Direct link.** Point the viewer at a hosted file with a URL like `?file=<url>&turn=<number>`. This is handy for sharing a specific moment with someone else.

The viewer ships with a few example replays of AI games if you'd like to see what it looks like before loading your own.

## Watching a game

Once a replay is loaded, you can play it back turn by turn and watch the map evolve:

| Control | Action |
| --- | --- |
| Space | Play and pause |
| Arrow keys | Step or scrub through the turns |
| Number keys 1–5 | Change playback speed |
| Zoom | Move between the whole-map view and a closer look |

## Reviewing the AI's reasoning

The Replayer shows you *what* happened on the map. If you also want to know *why* the AI made its moves, remember that during the game each AI civilization records the reasoning behind its decisions into the replay log (see [Playing](playing.md)). Reviewing a finished game therefore gives you both the events and, in the log, the thinking behind them.
