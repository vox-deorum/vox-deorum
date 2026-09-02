# Replay

A finished Civilization V game leaves a `.Civ5Replay` file when **Save Replays** is turned on in the game's options. The **Vox Deorum Replayer** is a browser-based tool for rewatching finished games, yours and the AI's alike. The Replayer reads [Community Patch and Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) game files. To watch a replay:

1. Open the Replayer at <https://vox-deorum.github.io/vox-deorum-replay/>.
2. [Find your replay file](#finding-your-replay-files).
3. [Load it](#loading-a-game).
4. [Play it back](#watching-a-game).

## Finding your replay files

On Windows you'll find them under your Documents folder:

```text
Documents\My Games\Sid Meier's Civilization 5\Replays\
```

## Loading a game

- **Drag and drop.** Drag a `.Civ5Replay` file straight onto the Replayer page.
- **Direct link.** Point the Replayer at a hosted file with a URL like `?file=<url>&turn=<number>`, handy for sharing a specific moment.

The Replayer ships with a few example replays of AI games, so you can see it in action before loading your own.

## Watching a game

| Control | Action |
| --- | --- |
| Space | Play and pause |
| Left/right arrows | Step one turn; up/down step ten |
| Number keys 1–5 | Change playback speed |
| +/- zoom | Move between the whole-map view and a closer look |

## Reviewing the AI's reasoning

Each AI civilization records the reasoning behind the decisions it acts on into the replay log as the game runs, and the Replayer shows them alongside the events (see [Playing](playing.md)).
