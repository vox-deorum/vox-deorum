# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers setting up an API key, choosing a provider and model, controlling cost, and running a local model for free.

## Setting your API key

An API key is what lets Vox Deorum talk to an LLM provider on your behalf. You need at least one.

The easiest place to manage keys is the **Config view in the dashboard** — the web page that opens when you launch Vox Deorum (by default at `http://localhost:5555`). Paste your key into the matching field and save; no files to edit by hand. The installer also offers to set a key the first time you install, and you can always come back to the dashboard to add more or change them.

Keys are stored on your own machine and are sent only to the provider you're using.

## Choosing a provider

Vox Deorum is provider-agnostic — you can use whichever LLM service you prefer, and you can mix several. Supported options include:

- **OpenAI** — get a key at <https://platform.openai.com/api-keys>
- **Anthropic** (Claude) — <https://console.anthropic.com/account/keys>
- **Google AI** (Gemini) — <https://aistudio.google.com/apikey>
- **OpenRouter**, a single account that resells many providers' models — <https://openrouter.ai/keys>
- Any **OpenAI-compatible endpoint** — including local models (below).

If you're just starting out and want the widest selection from one account, OpenRouter is the simplest. Otherwise, pick the provider whose models you want and add that key.

## Choosing a model

A model is the specific "brain" doing the thinking — for example `openai/gpt-5-mini` or a Claude or Gemini model. From the dashboard's **Config view** you can see the available models and pick which one the AI uses. The trade-off is always the same three-way balance:

- **Smarter models** play a sharper strategic game and hold better conversations, but cost more per turn and respond a little slower.
- **Smaller/faster models** are cheaper and quicker, at some cost to the quality of play.
- **Local models** are free to run but depend on your own hardware.

You can assign different models to different jobs — and even hand different AI civilizations in the same game to different models — so you could, for example, give the main opponents a strong model and let minor ones run on something cheap. A sensible starting point is a mid-tier model from your chosen provider; move up or down once you've seen how it plays.

## Controlling cost

Because every AI decision and every line of spokesperson dialogue is a call to the provider, **a game that uses a paid model costs money as you play.** A few ways to keep it in hand:

- Use a smaller or cheaper model for the AI players.
- Control fewer civilizations with the LLM, leaving the rest as ordinary game AI.
- Watch your usage and spending on your provider's own billing dashboard, and set spending limits there if it offers them.
- Run a **local model** and pay nothing per turn (below).

## Running local models

If you'd rather not pay per turn — or want to play fully offline — you can run a model on your own machine with a tool such as Ollama, LM Studio, or any server that exposes an **OpenAI-compatible endpoint**. Point Vox Deorum at that endpoint in the dashboard's Config view (as an OpenAI-compatible provider) and select your local model the same way you'd select any other.

Expect a trade-off: local models are free and private, but a model small enough to run comfortably on a typical PC won't play as sharply as a large hosted one, and speed depends entirely on your hardware. For watching games or casual play this is often fine; for the strongest opponents, a hosted model still has the edge.

## If something doesn't work

Missing or malformed keys and unreachable endpoints are the most common setup problems. See [Troubleshooting](troubleshooting.md) for the specific symptoms and fixes.
