# Getting Started

Vox Deorum lets you play Civilization V (Civ V) against opponents run by large language models (LLMs) such as GPT, Claude, and Gemini. The AI civilizations make their own strategic decisions and can talk to you in character. This page walks you through installing Vox Deorum and starting your first game.

## What you need

| Requirement | Details |
| --- | --- |
| Windows | Windows 10 or 11. |
| [Civilization V](https://store.steampowered.com/app/8930/) | Already installed through Steam. Ideally with both expansions, *Gods & Kings* and *Brave New World*. Vox Deorum is built on the [Community Patch and Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL) overhaul, and we build and test against the full game. |
| A way to connect to an LLM | An API key, a ChatGPT account for Codex, a local Claude Code sign-in, or a local model server. Most hosted providers charge for usage. See [Configuration](configuration.md). |

## Install

1. **Download the installer** from the [releases page](https://github.com/CIVITAS-John/vox-deorum/releases).
2. **Run the installer.** It finds your Steam and Civ V folders, then installs everything Vox Deorum needs: the game mods (Community Patch, Vox Populi, the Vox Deorum mod, and matching interface files) and a bundled Node.js runtime for the AI services.
3. **Confirm the Civ V folder.** The installer asks you to confirm the folder, pre-fills it when the search finds it, and continues once you choose a valid one. The typical location is `Steam\steamapps\common\Sid Meier's Civilization V`. Can't find Civ V? See [Troubleshooting](troubleshooting.md).

## First launch

Start Vox Deorum from the **Start Menu** entry named *Vox Deorum*, or run `scripts\vox-deorum.cmd` in the install folder. A **console window** starts the background services and opens the dashboard in your browser at `http://localhost:5555`. Keep the console window open while you play, and use its prompt to stop cleanly when you finish.

On a fresh install, the dashboard opens the four-step **Setup** wizard. Choose how you want to connect, enter an API key or complete a sign-in, then pick a model and save. The wizard checks the connection and lists the models you can use. Provider-specific details live on the [Configuration](configuration.md) page.

On the **Play** page, choose your role: play yourself, watch an AI self-play game, or direct a civilization. Choose how many civilizations the AI runs, pick a strategist, pacing, and model, then start. The wizard auto-assigns the AI to the rival seats, and the game picks each slot's civilization itself. Vox Deorum launches Civ V with the mods already enabled, and the LLM drives the AI civilizations.

You can revisit providers, models, and cost on the **Settings** page later ([Configuration](configuration.md)).

From here:

- **[Playing](playing.md)** explains what the AI does each turn and how to chat with the AI civilizations' spokespersons.
- **[Configuration](configuration.md)** covers choosing providers and models, controlling cost, and running local models.
- **[Replay](replay.md)** shows how to rewatch a finished game.
- **[Troubleshooting](troubleshooting.md)** collects fixes for the most common snags.
