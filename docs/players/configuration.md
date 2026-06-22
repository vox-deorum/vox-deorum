# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers setting up an API key, choosing a provider and model, controlling cost, and running a local model for free.

**The short version:** open the **Config view** in the dashboard (the web page at `http://localhost:5555` that opens when you launch Vox Deorum), paste in an API key for one provider, and pick a model. That is enough to start playing. The rest of this page explains your options.

## Provider, model, and API key

Three terms come up throughout this page:

- A **provider** is the LLM service you use, such as OpenAI, Anthropic, or Google.
- A **model** is the specific "brain" doing the thinking within that service, such as `openai/gpt-5-mini`.
- An **API key** is the credential that lets Vox Deorum talk to a provider on your behalf. You need at least one.

## Setting your API key

The easiest place to manage keys is the **Config view in the dashboard**. Paste your key into the matching field and save. There are no files to edit by hand.

The installer also offers to set a key the first time you install. Either way, you can always return to the dashboard to add more keys or change them.

Keys are stored on your own machine and are sent only to the provider you are using.

## Choosing a provider

Vox Deorum is provider-agnostic. Use whichever LLM service you prefer, and mix several if you like. Supported options:

| Provider | What it is | Where to get a key |
| --- | --- | --- |
| OpenAI | GPT models | <https://platform.openai.com/api-keys> |
| Anthropic | Claude models | <https://console.anthropic.com/account/keys> |
| Google AI | Gemini models | <https://aistudio.google.com/apikey> |
| OpenRouter | One account that resells many providers' models | <https://openrouter.ai/keys> |
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

Missing or malformed keys and unreachable endpoints are the most common setup problems. See [Troubleshooting](troubleshooting.md) for the specific symptoms and fixes.
