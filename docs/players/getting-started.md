# Getting Started

Vox Deorum lets you play Civilization V against opponents run by large language models such as GPT, Claude, and Gemini. The AI civilizations make their own strategic decisions and can talk to you in character. This page gets you from nothing to your first game.

The path is short: install, add an API key, and launch. You do **not** need to install Steam, Node.js, or the mod files by hand. The installer takes care of all of that.

## What you need

| Requirement | Details |
| --- | --- |
| Windows | Windows 10 or 11. |
| Civilization V | Ideally with both expansions, *Gods & Kings* and *Brave New World*. Vox Deorum is built on the Community Patch and Vox Populi overhaul and is only tested with the full game. |
| An LLM API key | A key from OpenAI, Anthropic, Google, OpenRouter, or another supported service. This powers the AI players, and most providers charge for usage. You can instead point Vox Deorum at a free local model; see [Configuration](configuration.md). |

## Install

1. **Download the installer.** Grab the newest release from the [releases page](https://github.com/CIVITAS-John/vox-deorum/releases).
2. **Run the installer.** The setup wizard does the heavy lifting:
   - Makes sure Steam is present, and installs it if it isn't.
   - Checks that Civilization V is installed. If it can't find the game, it opens Steam so you can install it, then asks you to run the installer again.
   - Installs the Vox Deorum game mods: the Community Patch, Vox Populi, the Vox Deorum mod itself, and the matching interface files.
   - Installs a bundled copy of Node.js, which the AI services run on, so you don't have to set anything up yourself.
   - Creates your settings file and opens it so you can paste in an API key.
3. **Add your API key.** When the installer opens the settings file, paste in the key for your provider and save. If you skip this now, you can add it any time from the dashboard described below. See [Configuration](configuration.md) for where to get a key.

## First launch

Start Vox Deorum from the **Start Menu** entry named *Vox Deorum*, or by running `scripts\vox-deorum.cmd` in the install folder.

A console window opens and starts the three background services Vox Deorum needs, then opens its **dashboard** in your web browser (by default at `http://localhost:5555`).

**Leave the console window running.** Closing it shuts everything down. When you are done, follow the prompt in the console to stop cleanly.

From the dashboard:

1. Open the **Config** view and confirm your LLM API key is set. This is the same setting the installer asked about; you can add or change keys here without editing any files.
2. Open the **Session** view and pick a game configuration: which civilizations the AI controls, and whether you play alongside it or just watch. Then **start the game**. Vox Deorum launches Civilization V with all the right mods already enabled, so you don't need to turn anything on in the game's own mod menu.
3. Civilization V opens into your game. Play as you normally would. The AI civilizations are now driven by the language model, and when it is an AI's turn it reads the situation and steers its empire on its own.

That's it. You are playing. From here:

- **[Playing](playing.md)** explains what the AI does each turn and how to chat with the AI civilizations' spokespersons.
- **[Configuration](configuration.md)** covers choosing providers and models, controlling cost, and running local models.
- **[Replay](replay.md)** shows how to rewatch a finished game.
- **[Troubleshooting](troubleshooting.md)** collects fixes for the most common snags.
