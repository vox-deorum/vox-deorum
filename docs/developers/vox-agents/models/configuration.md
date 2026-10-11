# Model configuration

Vox Agents works with many LLM providers. You name models in `vox-agents/config.json`, assign them to agents, and the framework checks before a game starts that every assigned model can actually be reached. Each agent asks for its model through its `getModel()` hook, so different agents, or different players in one game, can use different models.

```
config.json "llms"           checked at session start            agent asks for a model
  default  -> openai/...  ──►  known alias? provider catalog?  ──►  getModel()
  diplomat -> codex/...        rules for known models
```

## Supported providers

| Provider | Credentials |
| --- | --- |
| OpenRouter, OpenAI, Anthropic, Google, AWS Bedrock, OpenAI-compatible endpoints | API keys in `.env` |
| Codex | The player's ChatGPT login, through a managed local proxy (see [Codex proxy](codex.md)) |
| Claude Code | The player's local Claude Code sign-in |

Provider-specific code lives in `src/utils/models/providers/`. Those files import shared types and each other, but never `models.ts`.

## The config file

`vox-agents/config.json` holds the runtime settings. It is gitignored, so a fresh checkout has none. The effective config is the built-in defaults in `src/utils/config/defaults.ts` with the local file layered on top.

| File | Role |
| --- | --- |
| `src/utils/config.ts` | Loads the config. |
| `src/utils/config/diff.ts` | Merges entries and computes the diff the dashboard's Config view shows. |

The `llms` block maps a name to a provider and model, for example `openai/gpt-5-mini`. Some names are special:

| Name | Meaning |
| --- | --- |
| `default` | The model any agent uses when it has no assignment of its own. |
| `embedder` | The embedding model. |
| `<agent>` | A model for one agent. |
| `small`, `large`, `<agent>.small`, `<agent>.large` | Models for the other tiers. See [Tiers and triage](tiers-and-triage.md). |
| `evaluator`, `<agent>.evaluator` | Models for triage. See [Evaluators](evaluators.md). |

The built-in registry contains only an openai-compatible `default` and `embedder`.

## How a model reference is checked

Before any agent work starts, every model a session will use is checked. This is done by `src/utils/models/resolution.ts`, with recommended settings from `src/utils/models/rules.ts`.

1. **A name in `llms`.** Used as written. Local entries always win.
2. **A `provider/model` ID not in `llms`.** Looked up in that provider's live model list. A match is configured in memory for the rest of the process, using the recommended settings for that model family. Matching is exact first, then case-insensitive.
3. **Anything else** is an error, so a typo fails right away instead of running on the default model.

When the lookup itself fails, or the provider has only a static list that does not contain the model, Vox Agents logs a warning and builds the config from the rules anyway. A live list that confirms the model is missing is an error.

Where each provider's list comes from:

| Provider | Model list |
| --- | --- |
| Codex | The managed proxy's authenticated live catalog. |
| Claude Code | The catalog the locally signed-in Claude Code runtime reports, through a small helper in `src/utils/models/providers/`. Cached for the life of the process, with one lookup at a time. |
| Others | The provider's own model list. |

Agent names are not model references. An agent with no `llms` entry runs on `default`, so the preflight check verifies the agent's entry when it exists and `default` when it does not.

The rules also scope prompt middleware to providers that serve open-weight models over an OpenAI-compatible API (openai-compatible, Chutes, Synthetic, OpenRouter).

## The Setup wizard

The dashboard's Setup wizard writes model settings for players:

| Choice | Saved as |
| --- | --- |
| Main AI | The `default` alias, with any recommended settings from the rules. |
| Judge AI (optional, off by default) | The shared `evaluator` alias. It is not recommended yet because triage is still being studied. |
| Quick AI and Deep AI (offered only with a judge) | The `small` and `large` aliases. Without a judge, or when a tier stays on the Main AI, these aliases are removed. |

The wizard reads live model lists for API-backed and local providers. AWS Bedrock is set up by hand on the Settings page.

Agents can always use any tier when a caller asks for one. Automatic triage also needs the `triage` setting (see [Tiers and triage](tiers-and-triage.md)).

## Host tools for CLI models

Codex and Claude Code are full coding agents that could normally touch the host machine. The shared `hostTools` model option controls what they may do. It allows nothing by default and accepts only one value, `Web`.

| | Claude Code | Codex |
| --- | --- | --- |
| `Web` turns on | Web fetch and web search | Live search |
| Always off | Working directory, file tools, shell. Any tool outside the allowed list is denied. | The sandbox stays disabled. |

`src/utils/models/providers/host-tools.ts` checks the option once. Any other entry, including the retired `Read`, `Write`, and `everything`, fails with an error naming `Web`. File access comes only from the per-seat [files setting](../workspace/files.md), which works the same on every provider.

## Updating the Claude Agent SDK

The root `package.json` pins the Claude Agent SDK so model discovery and `ai-sdk-provider-claude-code` use the same SDK version and bundled runtime.

To update it, stop Vox Agents and run from the repo root:

| Command | Effect |
| --- | --- |
| `npm run update:claude-agent-sdk` | Move to the latest release. |
| `npm run update:claude-agent-sdk -- <version>` | Move to a specific version. |

The script (`scripts/utilities/update-claude-agent-sdk.mjs`) updates the dependency, reinstalls, and prints each Claude Code model alias with the model it maps to, such as `opus => claude-opus-5-5`. If Claude Code is missing or not signed in, it prints a warning instead of the mapping, and the update still succeeds. Restart Vox Agents afterward.
