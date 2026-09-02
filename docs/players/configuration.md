# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers providers, credentials, models, cost, and running a model locally for free.

**The short version:** follow the four-step **Setup** wizard in the dashboard (`http://localhost:5555`, opened automatically when you launch Vox Deorum): choose how to connect, provide a key or sign in, validate the connection, and choose a model. Most hosted providers need an API key, and Codex uses your ChatGPT login.

## Provider, model, and credential

A **provider** is the LLM service you use, such as OpenAI, Anthropic, or Google. A **model** is the specific "brain" doing the thinking within that service, such as `openai/gpt-5-mini`. A **credential** lets Vox Deorum use the provider on your behalf; most providers use an API key, and Codex authenticates through ChatGPT.

## Choosing a provider

Vox Deorum works with any of these providers, and you can mix several in one game. OpenRouter is the simplest way to get the widest selection from one account:

| Provider | What it is | Credential |
| --- | --- | --- |
| OpenAI | GPT models | <https://platform.openai.com/api-keys> |
| Anthropic | Claude | <https://console.anthropic.com/settings/keys> |
| Claude Code | Claude through the bundled coding runtime, for existing Claude Code users | Your local Claude Code sign-in |
| Google AI | Gemini | <https://aistudio.google.com/apikey> |
| AWS Bedrock | Claude and other models hosted on AWS; set up manually on the Settings page | Your own AWS credentials; see AWS's [Bedrock setup guide](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api.html) |
| OpenRouter | One account reselling many providers' models | <https://openrouter.ai/keys> |
| Chutes.ai | Marketplace for open-source models | <https://chutes.ai/> |
| Synthetic.new | Marketplace for open-source models | <https://synthetic.new/> |
| Codex (ChatGPT) | Codex models available to your ChatGPT account | ChatGPT sign-in |
| Any server that speaks OpenAI's format | You provide its address and an API key if needed; includes [local models](#running-local-models) | An API key |

## Connecting a provider

The Setup wizard connects you with the API service, authenticates for you, and lists available models. Keys stay on your machine and go to the provider you chose. You can use your Claude subscription through connecting with Claude Code, or ChatGPT subscription through Codex. For Codex-related questions, see [Troubleshooting](troubleshooting.md#codex-login-doesnt-start-or-finish).


Advanced setups can let a CLI-backed model read or write files or reach the web during its turn. Enabled agents are told which capabilities they have, and file access gives agents for the same civilization a shared temporary workspace for notes. Read access can consult its create-once guide, while Write access can maintain the notes and guide. These files generally survive turns and restarts until temporary storage is cleaned, but they are not archival and do not follow a switch between Codex and Claude Code. See the [developer overview](../developers/vox-agents/overview.md#models-and-configuration) for the full policy.

## Choosing a model

The wizard lists the models available through whatever you connected:

| Model type | Strengths | Costs |
| --- | --- | --- |
| Smarter models | Sharper strategic play, better conversations | More per turn, a little slower |
| Smaller / faster models | Cheaper, quicker | Lower quality of play |
| Local models | Free to run, private | Limited by your own hardware |

Save, and the wizard applies the recommended settings for that model. Settings lets you assign different models to different jobs; in a model assignment, **More** opens discovery and additions stay unsaved until you choose **Save All**. To give each civilization its own model, edit the game configuration file by hand; see the [developer overview](../developers/vox-agents/overview.md#models-and-configuration). A mid-tier model from your chosen provider is a sensible starting point; move up or down once you've seen it play.

## Controlling cost

Each decision the AI makes and each spokesperson reply goes through the provider; a paid model costs money as you play. A few ways to keep it down:

- Use a smaller or cheaper model for the AI players.
- Control fewer civilizations with the LLM; leave the rest to Civ V's built-in AI.
- Watch usage on your provider's billing page and set limits if it offers them.
- Run a local model and pay nothing per turn; see [Running local models](#running-local-models).

## Running local models

To play fully offline or without per-turn costs, run a model on your own machine with [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), or any server that speaks OpenAI's format. Choose the local option in the Setup wizard and enter the server's address; Vox Deorum checks the server, lists its models, and lets you pick one. The address stays editable in Settings. Local models run free and offline, and your hardware sets their speed and skill. A hosted model still plays the sharpest games.
