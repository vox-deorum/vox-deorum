# Vox Deorum

Play Civilization V with AI-enhanced opponents powered by GPT, Claude, and other large language models. Built on [Community Patch + Vox Populi](https://github.com/LoneGazebo/Community-Patch-DLL).

**Version 0.10.0 - Beta**

![Replay](https://github.com/CIVITAS-John/vox-deorum-replay/blob/gh-pages/examples/replay-demo.gif)

Vox Deorum gives Civ V's AI civilizations a language model brain. They reason about strategy in natural language, adapt to what you do, and can speak for themselves — you can chat with any LLM-enhanced player in the game.

## Play

New here? Start with **[Getting Started](docs/players/getting-started.md)** — prerequisites, the installer, and your first launch. From there the [player guide](docs/README.md) covers playing, configuring your LLM provider, reviewing sessions with the replayer, and troubleshooting.

## Develop

Want to understand or change the code? Start with **[Architecture](docs/developers/architecture.md)** — the components, how data flows between them, and why each layer exists. The [developer guide](docs/README.md) continues into setup, the end-to-end protocol, testing, releasing, and a folder per component.

## Documentation

All documentation lives under **[docs/](docs/README.md)** — pick the player door or the developer door from the index. Working rules for contributors and agents are in [AGENTS.md](AGENTS.md).

## License

Author: John Chen (with assistance from Claude Code).
Assistant Professor, University of Arizona, College of Information Science

Different licenses are used for submodules:

- `civ5-dll` - GPL 3.0 (following the upstream license)
- `bridge-service`, `vox-agents`, `mcp-server`, `civ5-mod` - [CC BY-NC-SA 4.0](LICENSE.md)
