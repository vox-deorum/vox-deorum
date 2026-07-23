# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers provider credentials, choosing a model, controlling cost, and running a local model for free.

**The short version:** open the **Config view** in the dashboard (the web page at `http://localhost:5555` that opens when you launch Vox Deorum), configure a provider, and pick a model. Most hosted providers need an API key. Codex uses your ChatGPT login instead.

## Provider, model, and API key

Three terms come up throughout this page:

- A **provider** is the LLM service you use, such as OpenAI, Anthropic, or Google.
- A **model** is the specific "brain" doing the thinking within that service, such as `openai/gpt-5-mini`.
- A **credential** lets Vox Deorum use the provider on your behalf. Most providers use an API key. Codex authenticates through ChatGPT.

## Setting provider credentials

The easiest place to manage API keys is the **Config view in the dashboard**. Paste your key into the matching field and save. Codex needs no key in the dashboard.

The installer also offers to set a key the first time you install. Either way, you can always return to the dashboard to add more keys or change them.

Keys are stored on your own machine and are sent only to the provider you are using.

## Choosing a provider

Vox Deorum is provider-agnostic. Use whichever LLM service you prefer, and mix several if you like. Supported options:

| Provider | What it is | Credential |
| --- | --- | --- |
| OpenAI | GPT models | <https://platform.openai.com/api-keys> |
| Anthropic | Claude models | <https://console.anthropic.com/account/keys> |
| Google AI | Gemini models | <https://aistudio.google.com/apikey> |
| OpenRouter | One account that resells many providers' models | <https://openrouter.ai/keys> |
| Codex (ChatGPT) | Codex models available to your ChatGPT account | ChatGPT device login on first use |
| Any OpenAI-compatible endpoint | Includes local models (see below) | n/a |

If you are just starting out and want the widest selection from one account, OpenRouter is the simplest. Otherwise, pick the provider whose models you want and add that key.

## Choosing a model

From the dashboard's **Config view** you can see the available models and pick which one the AI uses. The trade-off is always the same three-way balance:

| Model type | Strengths | Costs |
| --- | --- | --- |
| Smarter models | Sharper strategic play, better conversations | More per turn, a little slower |
| Smaller / faster models | Cheaper, quicker | Lower quality of play |
| Local models | Free to run, private | Limited by your own hardware |

You can assign different models to different jobs, and you can even hand different AI civilizations in the same game to different models. For example, give the main opponents a strong model and let minor ones run on something cheap.

A sensible starting point is a mid-tier model from your chosen provider. Move up or down once you have seen how it plays.

## Using Codex with ChatGPT

The default configuration includes common Codex models in the dashboard. You can also set the provider to `codex` and enter any other Codex model name available to your ChatGPT account.

The first Codex request runs the exact pinned `codex-openai-proxy@0.1.0-rc.3` package through `npx`. npm downloads the proxy and its bundled `@openai/codex@0.144.5` CLI if they are not already cached. Existing Codex authentication is reused. Otherwise, follow the device-login URL and instructions in the Vox Deorum logs. The proxy starts lazily, so using another provider does not download or launch it.

The optional lifecycle settings are `CODEX_PROXY_PORT`, `CODEX_PROXY_COMMAND`, `CODEX_PROXY_ROOT`, `CODEX_PROXY_REQUEST_TIMEOUT`, `CODEX_PROXY_TOOL_TIMEOUT`, and `CODEX_PROXY_STARTUP_TIMEOUT`. Blank values use defaults. A custom command is trusted operator configuration, and Vox Deorum appends the required `serve` arguments.

Proxy rc.3 supports automatic or disabled tool choice and requires continuation policy to remain unchanged. Vox Deorum maps agents that normally require a tool call to automatic tool choice for Codex. Codex command, file, web, MCP, and app activity appears in the dashboard as provider-executed tool progress. Vox Deorum does not dispatch that activity as game tools.

## Host tools

The model option is named `hostTools` and accepts a short list of meta-tools shared by every provider that can run local capabilities:

- `Read`: enable the provider's read-capable local environment (for Claude Code: Read, Glob, and Grep).
- `Write`: create and edit files inside a temporary game-and-player working directory. `Write` always implies `Read`.
- `Web`: search and fetch from the web without granting a Codex local execution environment.
- `['everything']`: all three.

Missing or empty means no host tools. Any other name, including old concrete tool names like `Glob` or `Bash`, fails fast with `Unsupported hostTools entries`.

Claude Code expands each meta-tool to its vetted non-shell tool set and retains an isolated temporary cwd even for Web-only access. Codex treats the capabilities differently:

- Missing, empty, or Web-only access uses `sandbox: "disabled"` with no `cwd` and no filesystem workspace. Web-only independently enables live search.
- Read uses a read-only sandbox in an isolated working directory.
- Write uses a workspace-write sandbox in that directory. Network remains off unless Web is also enabled.

Codex Read and Write enable Codex's local execution environment, including command execution within the selected sandbox. Only `sandbox: "disabled"` removes that environment. If a managed Codex policy restricts sandbox modes, it must still permit native read-only because rc.3 realizes disabled mode as read-only with an empty environment list.

The old `claudeCodeTools` name has been removed. A Claude Code model that still uses it fails with: `The \`claudeCodeTools\` option was renamed to \`hostTools\`. Update this model configuration.`

## Controlling cost

Every AI decision and every line of spokesperson dialogue is a call to the provider. **A game that uses a paid model costs money as you play.** A few ways to keep it in hand:

- Use a smaller or cheaper model for the AI players.
- Control fewer civilizations with the LLM, leaving the rest as ordinary game AI.
- Watch your usage and spending on your provider's own billing dashboard, and set spending limits there if it offers them.
- Run a **local model** and pay nothing per turn (see below).

## Running local models

If you would rather not pay per turn, or want to play fully offline, you can run a model on your own machine. Use a tool such as Ollama, LM Studio, or any server that exposes an **OpenAI-compatible endpoint**.

To set it up, point Vox Deorum at that endpoint in the dashboard's Config view (as an OpenAI-compatible provider), then select your local model the same way you would select any other.

Expect a trade-off. Local models are free and private, but a model small enough to run comfortably on a typical PC will not play as sharply as a large hosted one, and speed depends entirely on your hardware. For watching games or casual play this is often fine. For the strongest opponents, a hosted model still has the edge.

## If something doesn't work

Missing credentials, Codex login problems, and unreachable endpoints are the most common setup problems. See [Troubleshooting](troubleshooting.md) for the specific symptoms and fixes.
