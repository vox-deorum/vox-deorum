# Replay

Every Civilization V game you finish leaves behind a replay file, and Vox Deorum's games are no exception. The **Vox Deorum Replayer** is a web tool for rewatching those games — empires rising and falling, borders shifting over the centuries — so you can review how a match unfolded, your play and the AI's alike.

The Replayer is a separate, browser-based tool. There's nothing to install: you just open it in your web browser and load a replay file.

## Opening the Replayer

Go to the hosted viewer at **<https://civitas-john.github.io/vox-deorum-replay/>**.

It's built specifically for Community Patch / Vox Populi games — the same ruleset Vox Deorum uses — so your Vox Deorum games will load correctly. (Plain, unmodded Civ V replays may not.)

## Finding your replay files

Civilization V writes a `.Civ5Replay` file for each completed game. On Windows you'll find them under your Documents folder:

```
Documents\My Games\Sid Meier's Civilization 5\Replays\
```

## Loading a game

There are two ways to open a replay in the viewer:

- **Drag and drop** — drag a `.Civ5Replay` file straight onto the Replayer page.
- **Direct link** — point the viewer at a hosted file with a URL like `?file=<url>&turn=<number>`, which is handy for sharing a specific moment with someone else.

## Watching a game

Once a replay is loaded, you can play it back turn by turn and watch the map evolve:

- **Space** plays and pauses.
- **Arrow keys** step or scrub through the turns.
- **Number keys 1–5** change playback speed.
- **Zoom** lets you move between the whole-map view and a closer look.

The viewer ships with a few example replays of AI games if you'd like to see what it looks like before loading your own.

## Reviewing the AI's reasoning

The Replayer shows you *what* happened on the map. If you also want to know *why* the AI made its moves, remember that during the game each AI civilization records the reasoning behind its decisions into the replay log (see [Playing](playing.md)) — so reviewing a finished game gives you both the events and, in the log, the thinking behind them.
