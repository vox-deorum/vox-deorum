# Getting Started

Vox Deorum lets you play Civilization V (Civ V) against opponents run by large language models (LLMs) such as GPT, Claude, and Gemini. The AI civilizations make their own strategic decisions and can talk to you in character. This page walks you through installing Vox Deorum and starting your first game.

The path is short: install, then launch. Civ V must already be installed through Steam; the installer handles the mods and other dependencies for you.

## What you need

| Requirement | Details |
| --- | --- |
| Windows | Windows 10 or 11. |
| [Civilization V](https://store.steampowered.com/app/8930/) | Already installed through Steam. Ideally with both expansions, *Gods & Kings* and *Brave New World*. Vox Deorum is built on the [Community Patch and Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) overhaul and is only tested with the full game. |
| A way to connect to an LLM | This can be an API key, a ChatGPT account for Codex, a local Claude Code sign-in, or a local model server. Most hosted providers charge for usage. See [Configuration](configuration.md). |

## Install

1. **Download the installer.** Grab the newest release from the [releases page](https://github.com/CIVITAS-John/vox-deorum/releases).
2. **Run the installer.** It looks for your Steam and Civ V folders on its own, then installs everything Vox Deorum needs:
   - The Vox Deorum game mods: the Community Patch, Vox Populi, the Vox Deorum mod itself, and the matching interface files.
   - A bundled copy of Node.js for the AI services to run on, so you don't have to set it up yourself.

   It asks you to confirm the Civ V folder, pre-filled if the search succeeded, and won't continue until you choose a valid one. The typical location is `Steam\steamapps\common\Sid Meier's Civilization V`.

You'll connect a model at first launch (see below).

## First launch

Start Vox Deorum from the **Start Menu** entry named *Vox Deorum*, or by running `scripts\vox-deorum.cmd` in the install folder.

A console window opens and starts the background services, then brings up the dashboard in your web browser (by default at `http://localhost:5555`).

**Leave the console window running.** Closing it shuts everything down. When you are done, follow the prompt in the console to stop cleanly.

From the dashboard:

1. On a fresh install, the dashboard redirects you to the four-step **Setup** wizard. Choose how you want to connect, enter an API key or complete an account sign-in, then choose a model and save. API-backed providers and local servers fetch their current model lists. Codex reads its current choices through the authenticated managed proxy. Claude Code uses bundled choices and does not verify the local sign-in when it lists them. Codex sign-in is handled in the dashboard, which shows the device link and user code. The one-time user code is never written to the logs. Local setup checks the server address you provide. AWS Bedrock is configured through the advanced Settings page instead.
2. After setup, continue to the **Play** page and set up your game: assign the AI to numbered player slots (the game picks each slot's civilization), choose whether you play alongside it or just watch, then start the game. Vox Deorum launches Civ V with the mods already enabled, so you don't need to touch the game's own mod menu.
3. Civ V opens into your game. Play as you normally would: an LLM now drives the AI civilizations, and they steer their empires on their own each turn.

The wizard saves recommended settings for the selected model automatically. You can change the detailed configuration later on the **Settings** page, or use its **Setup wizard** button to run the guided flow again.

That's it. You are playing. From here:

- **[Playing](playing.md)** explains what the AI does each turn and how to chat with the AI civilizations' spokespersons.
- **[Configuration](configuration.md)** covers choosing providers and models, controlling cost, and running local models.
- **[Replay](replay.md)** shows how to rewatch a finished game.
- **[Troubleshooting](troubleshooting.md)** collects fixes for the most common snags.
