# Vox Deorum Documentation

Vox Deorum lets you play Civilization V against opponents powered by large language models. This is the documentation index — pick the door that fits you.

## I want to play

Start with **[Getting Started](players/getting-started.md)**: prerequisites, the installer, and your first launch. From there:

- **[Playing](players/playing.md)** — what the AI does, chatting with spokespersons, and what to expect in-game
- **[Configuration](players/configuration.md)** — API keys, choosing LLM providers and models, local models
- **[Replay](players/replay.md)** — reviewing your sessions with the Vox Deorum Replayer
- **[Troubleshooting](players/troubleshooting.md)** — common problems and fixes

## I want to develop

Start with **[Architecture](developers/architecture.md)**: the components, how data flows between them, and why each layer exists. From there:

- **[Setup](developers/setup.md)** — building from source: toolchain, submodules, build and test commands
- **[Protocol](developers/protocol.md)** — how messages flow end to end (DLL ↔ bridge ↔ MCP ↔ agents)
- **[Testing](developers/testing.md)** — test philosophy and how to run and write tests
- **[Releasing](developers/releasing.md)** — versioning, release notes, installer packaging

Each component has its own folder under [developers/](developers/): the [civ5-dll](developers/civ5-dll/), the [civ5-mod](developers/civ5-mod/), the [bridge-service](developers/bridge-service/), the [mcp-server](developers/mcp-server/), and the [vox-agents](developers/vox-agents/).

## Release history

Changelogs for each release live in [versions/](versions/).
