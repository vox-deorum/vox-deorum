# Vox Agents: Overview

Vox Agents is the part of Vox Deorum where language models play Civilization V. It is a TypeScript framework that runs LLM agents, gives them the game as tools, and turns their answers into in-game decisions and conversations.

```
Vox Agents  ──(MCP tools)──►  MCP Server  ──►  Bridge  ──►  DLL  ──►  Civilization V
    │
    └──►  LLM providers (OpenAI, Anthropic, Codex, Claude Code, ...)
```

Vox Agents never talks to the game directly. It is an MCP client of the [MCP server](../mcp-server/overview.md): it calls tools to read the game and act on it, and it listens for notifications such as "a player finished a turn". The full message path is in [protocol.md](../protocol.md) and the component map is in [architecture.md](../architecture.md).

## What it does

| Job | Who does it | Read more |
| --- | --- | --- |
| Play a civilization, turn by turn | Strategists | [Strategists](agents/strategists/overview.md) |
| Chat with the player in character, and negotiate deals | Envoys (spokesperson, diplomat, negotiator) | [Envoys](agents/envoys.md) |
| Summarize the game, assess reports, look up rules | Support agents (briefers, analysts, librarians) | [Support agents](agents/support-agents.md) |
| Explain a finished game | Telepathist | [Telepathist](agents/telepathist.md) |
| Replay past turns with a changed prompt or model | Oracle | [Oracle](agents/oracle.md) |
| Turn finished games into searchable experience | Archivist | [Archivist](agents/archivist.md) |

## How the docs are organized

| Folder | What it covers |
| --- | --- |
| [framework/](framework/) | The core that every agent runs on: the agent base class, runs, sessions, how a model request is built, and context compaction. |
| [models/](models/) | Choosing and configuring models: the model registry, tiers and triage, provider middleware, evaluators, and the Codex proxy. |
| [workspace/](workspace/) | The optional per-seat file workspace: the `bash` tool, its folders, and the store that keeps records and notes. |
| [agents/](agents/) | Each agent family. Strategists have their own subfolder. |
| [platform/](platform/) | What surrounds the agents: the web dashboard, tracing and logs, and video capture. |

A good reading order for a new developer:

1. [Agents](framework/agent-framework.md) and [Runs](framework/runs.md), to learn how one agent call works.
2. [Strategists](agents/strategists/overview.md), the agents that play the game.
3. [Model configuration](models/configuration.md), to run with your own models.
4. [Observability](platform/observability.md), to see what an agent actually did.

## Source layout

Paths in these pages are relative to `vox-agents/` unless they say otherwise.

| Folder | Holds |
| --- | --- |
| `src/infra/` | The framework core: agent base class, context, runs, sessions, registries, game launch. |
| `src/strategist/` | Strategist sessions, players, pacing, and strategist agents. |
| `src/envoy/`, `src/briefer/`, `src/analyst/`, `src/librarian/` | The other live agent families. |
| `src/telepathist/`, `src/oracle/`, `src/archivist/`, `src/narrators/` | Post-game tools. |
| `src/knowledge/` | Game-state sections, seat records, and the per-game reference. |
| `src/utils/models/` | Model registry, providers, and middleware. |
| `src/utils/workspace/` | The per-seat file workspace. |
| `src/web/` and `ui/` | The dashboard backend and the Vue app. |
| `prompts/` | System prompt templates. |
| `configs/` | Session configurations. |

Other references:

- `vox-agents/docs/api/` holds the generated TypeDoc reference.
- `vox-agents/AGENTS.md` holds contributor conventions (imports, logging, tests).
- [setup.md](../setup.md) and [testing.md](../testing.md) cover building and testing.
