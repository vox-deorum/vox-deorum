# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers providers, credentials, models, cost, and running a model locally for free.

**The short version:** follow the four-step **Setup** wizard in the dashboard (`http://localhost:5555`, opened automatically when you launch Vox Deorum). Choose how to connect, provide a key or sign in, validate the connection, and choose a model. Most hosted providers need an API key. Codex uses your ChatGPT login instead.

## Provider, model, and API key

Three terms come up throughout this page:

- A **provider** is the LLM service you use, such as OpenAI, Anthropic, or Google.
- A **model** is the specific "brain" doing the thinking within that service, such as `openai/gpt-5-mini`.
- A **credential** lets Vox Deorum use the provider on your behalf. Most providers use an API key. Codex authenticates through ChatGPT.

## Choosing a provider

Vox Deorum works with any of these providers, and you can mix several in one game:

| Provider | What it is | Credential |
| --- | --- | --- |
| OpenAI | GPT models | <https://platform.openai.com/api-keys> |
| Anthropic | Claude models | <https://console.anthropic.com/settings/keys> |
| Claude Code | Claude models through a bundled Anthropic coding runtime; relevant only if you already use Claude Code | Your local Claude Code sign-in, no key needed in the dashboard |
| Google AI | Gemini models | <https://aistudio.google.com/apikey> |
| AWS Bedrock | Claude and other models hosted on AWS; configured manually in Settings rather than through the Setup wizard | Your AWS credentials; see AWS's [Bedrock setup guide](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api.html) |
| OpenRouter | One account that resells many providers' models | <https://openrouter.ai/keys> |
| Chutes.ai | A marketplace reselling open-source models | <https://chutes.ai/> |
| Synthetic.new | A marketplace reselling open-source models | <https://synthetic.new/> |
| Codex (ChatGPT) | Codex models available to your ChatGPT account | ChatGPT device login on first use |
| Any OpenAI-compatible endpoint, meaning a web address you supply | Includes local models, [see below](#running-local-models) | An API key only if your endpoint requires one |

If you're just starting out and want the widest selection from one account, OpenRouter is simplest. Otherwise, pick the provider whose models you want.

## Connecting a provider

On a fresh install, Vox Deorum opens the Setup wizard automatically. It asks how you want to connect and collects the needed key or account sign-in. API-backed providers and local servers validate the connection by fetching their current model lists. Codex uses bundled choices and validates your ChatGPT account through its proxy. Claude Code lists the models your local Claude Code sign-in provides. Authentication, network, and provider errors are shown in the wizard so you can correct the problem before continuing. Keys stay on your own machine and go only to the provider you're using.

Codex completes ChatGPT device login inside the dashboard. Vox Deorum's bundled Claude Code runtime uses the Claude Code sign-in stored on your computer. For a local OpenAI-compatible provider, the wizard checks the server address you supply. AWS Bedrock remains an advanced setup that you configure manually on the Settings page.

The Settings page is also the advanced editor for credentials, providers, and model options. Its **Setup wizard** button lets you repeat the guided flow at any time. See [Getting Started](getting-started.md#first-launch) for where setup fits into the first launch.

## Choosing a model

After connecting, the Setup wizard lists models. API-backed providers and local servers report their current lists, Codex reads its current list through the authenticated managed proxy, and Claude Code lists what your local sign-in provides. The choice always comes down to the same three-way trade-off:

| Model type | Strengths | Costs |
| --- | --- | --- |
| Smarter models | Sharper strategic play, better conversations | More per turn, a little slower |
| Smaller / faster models | Cheaper, quicker | Lower quality of play |
| Local models | Free to run, private | Limited by your own hardware |

When you save, the wizard silently applies the recommended settings Vox Deorum knows for that model. The full built-in model list remains available in Settings, which also lets you assign different models to different jobs. In a model assignment, **More** opens discovery. Additions remain unsaved until you choose **Save All**. Use the Setup wizard before signing in to a new Codex account. Per-civilization models are possible too, say a strong model for the main opponents and something cheap for the minor ones, but those mean editing the game configuration file by hand; see the [developer overview](../developers/vox-agents/overview.md#models-and-configuration) if you want to go that deep.

A mid-tier model from your chosen provider is a sensible starting point. Move up or down once you've seen how it plays.

## Controlling cost

Every AI decision and every spokesperson reply is a call to the provider. **A game that uses a paid model costs money as you play.** A few ways to keep it down:

- Use a smaller or cheaper model for the AI players.
- Control fewer civilizations with the LLM; leave the rest to Civ V's built-in AI.
- Watch usage and spending on your provider's own billing page, and set limits if it offers them.
- Run a local model and pay nothing per turn; see [Running local models](#running-local-models).

## Running local models

If you'd rather not pay per turn, or want to play fully offline, run a model on your own machine with a tool such as [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai), or any other server that exposes an OpenAI-compatible endpoint. Choose the local option in the Setup wizard and enter that endpoint. Vox Deorum checks the server, fetches its models, and lets you select one. You can edit the endpoint later in Settings.

Expect a trade-off: local models are free and private, but one small enough to run comfortably on a typical PC won't play as sharply as a large hosted model, and speed depends on your hardware. That's fine for casual play; for the strongest opponents, a hosted model still has the edge.

## Using Codex with ChatGPT

Common Codex models are already listed on the Settings page, and you can also set the provider to `codex` with any model name your ChatGPT account has access to. The Setup wizard validates the ChatGPT account through the Codex proxy. The first time you use it, Codex sets itself up in the background, which can take a little longer than usual.

Vox Deorum reuses an existing ChatGPT login when it can. Otherwise the Setup wizard opens or links the device-login page, displays the verification URL and user code in the dashboard, and waits for authentication before validating the account through the proxy. The verification URL can also appear in the logs, but the one-time user code is never written there. If the browser doesn't open, use the link shown in the wizard; restarting Vox Deorum tries the login again.

If ChatGPT reports a temporary Codex usage limit during play, Vox Deorum waits until the reported reset time and retries the interrupted attempt automatically. Canceling the active run also cancels that wait.

Codex's own web, file, and command activity shows up in the dashboard as progress, but it's not a move in the game.

Advanced setups can let a CLI-backed model read or write files or reach the web during its turn, controlled by the `hostTools` option on a model's configuration entry; the full policy is in the [developer overview](../developers/vox-agents/overview.md#models-and-configuration).

Login trouble? See [Troubleshooting](troubleshooting.md#codex-login-doesnt-start-or-finish). For how Codex works under the hood, see the [developer guide](../developers/vox-agents/codex.md).

## If something doesn't work

Invalid credentials, Codex login trouble, and unreachable providers or local endpoints are the most common setup problems. See [Troubleshooting](troubleshooting.md) for the specific symptoms and fixes.
