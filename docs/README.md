# Vox Deorum Documentation

Vox Deorum lets you play Civilization V against opponents powered by large language models. This is the documentation index. Pick the door that fits you.

## I want to play

Start with **[Getting Started](players/getting-started.md)** for prerequisites, the installer, and your first launch. From there:

- **[Playing](players/playing.md)** covers what the AI does, chatting with spokespersons, and what to expect in-game
- **[Configuration](players/configuration.md)** covers API keys, choosing LLM providers and models, and local models
- **[Replay](players/replay.md)** covers reviewing your finished games with the Vox Deorum Replayer
- **[Troubleshooting](players/troubleshooting.md)** covers common problems and fixes

## I want to develop

Start with **[Architecture](developers/architecture.md)**: the components, how data flows between them, and why each layer exists. From there:

- **[Setup](developers/setup.md)** covers building from source: toolchain, submodules, build and test commands
- **[Protocol](developers/protocol.md)** covers how messages flow end to end (DLL ↔ bridge ↔ MCP ↔ agents)
- **[Diplomacy](developers/diplomacy.md)** follows one interactive negotiation across every component
- **[Testing](developers/testing.md)** covers the test tiers, how to run and write tests, and the pre-submit checklist
- **[Operations](developers/operations.md)** covers the maintenance scripts, log locations, and debugging a running stack
- **[Releasing](developers/releasing.md)** covers versioning, release notes, and the installer workflow

Each component has its own folder under [developers/](developers/): the [civ5-dll](developers/civ5-dll/), the [civ5-mod](developers/civ5-mod/), the [bridge-service](developers/bridge-service/), the [mcp-server](developers/mcp-server/), and the [vox-agents](developers/vox-agents/).

## Release history

Changelogs for each release live in [versions/](versions/).
