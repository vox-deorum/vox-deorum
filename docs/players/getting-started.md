# Getting Started

Vox Deorum lets you play Civilization V against opponents run by large language models — GPT, Claude, Gemini, and others. The AI civilizations make their own strategic decisions and can talk to you in character. This page gets you from nothing to your first game.

## What you need

- **Windows 10 or 11.**
- **Civilization V**, ideally with both expansions (*Gods & Kings* and *Brave New World*). Vox Deorum is built on the Community Patch + Vox Populi overhaul and is only tested with the full game.
- **An API key from an LLM provider** — OpenAI, Anthropic, Google, OpenRouter, or any other supported service. This is what powers the AI players, and most providers charge for usage. You can also point Vox Deorum at a local model and pay nothing; see [Configuration](configuration.md).

You do **not** need to install Steam, Node.js, or the mod files by hand. The installer takes care of all of that.

## Install

1. **Download the installer** from the [releases page](https://github.com/CIVITAS-John/vox-deorum/releases). Grab the newest release.
2. **Run the installer.** The setup wizard does the heavy lifting:
   - Makes sure Steam is present (and installs it if it isn't).
   - Checks that Civilization V is installed. If it can't find it, it opens Steam so you can install the game, then asks you to run the installer again.
   - Installs the Vox Deorum game mods — the Community Patch, Vox Populi, the Vox Deorum mod itself, and the matching interface files.
   - Installs a bundled copy of Node.js, which the AI services run on, so you don't have to set anything up yourself.
   - Creates your settings file and opens it so you can paste in an API key.
3. **Add your API key.** When the installer opens the settings file (or later, from the dashboard described below), paste in the key for your provider and save. If you skip this now, you can do it any time — see [Configuration](configuration.md).

## First launch

Start Vox Deorum from the **Start Menu** entry named *Vox Deorum*, or by running `scripts\vox-deorum.cmd` in the install folder.

A console window opens and starts the three background services Vox Deorum needs, then opens its **dashboard** in your web browser (by default at `http://localhost:5555`). Leave the console window running — closing it shuts everything down, and there's a prompt in it for stopping cleanly when you're done.

From the dashboard:

1. Open the **Config** view and confirm your LLM API key is set. This is the same setting the installer asked about; you can add or change keys here without editing any files.
2. Open the **Session** view, pick a game configuration (which civilizations the AI controls, whether you play alongside it or just watch), and **start the game**. Vox Deorum launches Civilization V for you with all the right mods already enabled — you don't need to turn anything on in the game's own mod menu.
3. Civilization V opens into your game. Play as you normally would; the AI civilizations are now driven by the language model. When it's an AI's turn, it reads the situation and steers its empire on its own.

That's it — you're playing. From here:

- **[Playing](playing.md)** explains what the AI actually does each turn and how to chat with the AI civilizations' spokespersons.
- **[Configuration](configuration.md)** covers choosing providers and models, controlling cost, and running local models.
- **[Replay](replay.md)** shows how to rewatch a finished game.
- **[Troubleshooting](troubleshooting.md)** collects fixes for the most common snags.
