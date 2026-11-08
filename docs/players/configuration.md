# Configuration

Choose an AI service and model, then adjust for the kind of game and cost you want. The dashboard's Setup wizard handles the connection; you can change it later in Settings.

## Choosing a provider

A **provider** is the service running the AI. A **model** is the AI you choose from that service.

| Connection | What you need |
| --- | --- |
| OpenAI, Anthropic, Google, or another hosted provider | An API key and usage credit with that provider. |
| Codex through ChatGPT | Your ChatGPT sign-in. |
| Claude Code | Your local Claude Code sign-in. |
| A local model | A model server running on your computer. See [Running local models](#running-local-models). |

You can mix providers and models in one game. If you already use one of these services, start there.

<a id="using-codex-with-chatgpt"></a>

## Connecting a provider

Follow the Setup wizard to connect your account and choose a model. API keys stay on your machine and are sent to the provider you choose. ChatGPT and Claude Code connections use sign-in instead of an API key. For sign-in problems, see [Troubleshooting](troubleshooting.md).

## Choosing a model

Start with one model as your **Main AI**. Larger models generally make better decisions but cost more and take longer. Smaller models are useful for cheaper, faster games.

The optional **Judge AI** routes work between a Quick AI and a Deep AI. Leave it off for your first game. You can experiment with it or assign different models to individual jobs later.

## Controlling cost

Paid models charge as the AI makes decisions and replies to conversations. To spend less:

- Choose a cheaper model.
- Give fewer civilizations to the LLM and leave the rest to the built-in AI.
- Space strategic decisions farther apart.
- Set a spending limit with your provider if it offers one.

Local models have no per-turn API charge, but their speed and quality depend on your hardware.

## File workspace

File access lets an AI civilization keep notes between turns and consult its past reports. It is off by default and can increase model usage.

To enable it, set `"files": "write"` in your game configuration. Game notes rewind when you load an earlier save. Shared notes carry across games and do not rewind, so avoid sharing them between opponents unless you want them to exchange information.

You can export notes and records from the telemetry page. For shared folders and other advanced settings, see [Seat files](../developers/vox-agents/workspace/files.md).

## Custom prompts

You can change the AI's instructions by copying the prompts you want to edit from `vox-agents/prompts/` into your own folder, keeping their names and subfolders. Set `"prompts": "my-prompts"` in your game configuration to use a folder named `vox-agents/my-prompts/`. Prompts you do not copy keep their built-in text.

Keep the template placeholders and decision instructions intact, and start a new session after editing. See [Prompt templates](../developers/vox-agents/framework/prompts.md) for the template rules.

## Response timeouts

If a slow model repeatedly times out, try a faster model or increase the [response timeouts](../developers/vox-agents/models/configuration.md#response-timeouts).

## Game settings

Leave DirectX 11 enabled unless it causes problems on your computer. It is the version used for development, recording, and livestreaming.

## Running local models

Run a model with [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), or another server compatible with OpenAI's API. Connect to its address through Setup. This avoids per-turn API costs and can keep the AI's requests on your computer, but larger models need more capable hardware.
