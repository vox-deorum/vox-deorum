# Troubleshooting

Common problems and how to fix them. If your issue isn't here, the [Configuration](configuration.md) and [Getting Started](getting-started.md) pages cover most setup details.

| Symptom | Most likely fix |
| --- | --- |
| Dashboard doesn't open | Wait a few seconds, then open `http://localhost:5555` by hand; keep the console window open. |
| AI does nothing / turn stuck | Make sure the game isn't paused. |
| Missing or invalid API key error | Set a valid key in the Config view, or complete Codex device login. |
| AI stops responding mid-game | Let the game finish reloading; Vox Deorum reconnects on its own. |
| Looks like normal Civ V | Start games from the dashboard's Session view, not Civ V's menu. |
| Installer can't find Civ V | Install Civilization V through Steam, then re-run the installer. |
| Slow or costly responses | Switch to a smaller, faster, or local model. |
| Spokesperson chat doesn't reply | Check provider credentials, that the game is running, and the console for errors. |

## The dashboard doesn't open in my browser

When you launch Vox Deorum, a console window opens and starts the background services, then the dashboard should open at `http://localhost:5555`.

- Give it a few seconds. The services take a moment to come up the first time.
- If the page never appears, open that address in your browser by hand.
- **Keep the console window open.** Closing it stops everything. To shut down cleanly, follow the prompt in the console rather than closing the window.
- If the dashboard still won't load, another program may be using the port, or the services failed to start. Close any leftover Vox Deorum console windows and launch again.

## The AI isn't doing anything, or a turn seems stuck

The single most common cause is that **the game is paused.** While the game is paused, it can't answer the AI's requests, so the AI looks frozen. Make sure the game is actually running, not sitting on a pause or a blocking pop-up, and it will pick up again.

If it's still stuck:

- Check the console window for errors.
- Make sure your provider credential is valid (see below). Without a working model, the AI can't make decisions.
- Larger models simply take longer to think. A slow response isn't always a stuck one.

## I get errors about a missing or invalid API key

API-backed providers cannot run without a working LLM key. Codex uses ChatGPT login instead.

- Open the dashboard's **Config view** and confirm a key is filled in for your provider.
- Make sure you pasted the **whole** key with no extra spaces before or after it.
- Confirm the key is still active and has credit in your provider's own account dashboard.

See [Configuration](configuration.md) for where to get keys and how to choose a provider.

## Codex does not start or finish login

Codex is downloaded and started only on its first request. Check the Vox logs for the specific failure:

- For device login, open the logged verification URL and follow its instructions before `CODEX_PROXY_STARTUP_TIMEOUT` expires. Restarting Vox Deorum reuses a completed Codex login.
- If the configured port is occupied, stop the other service or change `CODEX_PROXY_PORT`. Vox Deorum accepts a listener with compatible health, protocol, and readiness shapes without requiring the pinned package version. When `/health` reports a proxy version, Vox Deorum includes it in the logs for diagnostics.
- If startup times out during login, raise `CODEX_PROXY_STARTUP_TIMEOUT` and, when needed, `CODEX_PROXY_TOOL_TIMEOUT`.

For foreground diagnosis, run the command below from a console and keep its structured stderr visible:

```text
npx --yes codex-openai-proxy@0.1.0-rc.2 serve --root C:\absolute\temporary\codex-root --port 8787 --request-timeout 30000ms --tool-timeout 300000ms --shutdown-timeout 10000ms
```

Do not configure a proxy API key. The adapter's `local` value is an inert placeholder for the OpenAI-compatible client, not a credential.

## The AI stops responding partway through a game

This usually means Vox Deorum briefly lost its connection to the game, for instance because the game was closed, restarted, or mid-load. Vox Deorum reconnects automatically and keeps retrying, so:

- If you closed or reloaded the game, let it finish coming back up. Play resumes on its own.
- If the game crashed, relaunch it. The AI picks up roughly where it left off.
- A persistent disconnect usually points to the game itself having quit. Check that Civilization V is still running.

## The mod doesn't seem active, or it looks like normal Civ V

Start your games from the dashboard's **Session view**, not from Civ V's main menu. When you start from the dashboard, Vox Deorum launches the game with all the right mods already enabled. Launching the game on its own won't bring in the AI.

If you ran the installer but the game still can't find the mods at all, re-run the installer. It reinstalls the mod files and clears the game's cached data so changes take effect.

## The installer couldn't find Civilization V

The installer checks for Civ V through Steam. If it can't find the game, it opens Steam so you can install it, then asks you to run the installer again once the download finishes. Install Civilization V (the full edition with both expansions is recommended), then re-run the Vox Deorum installer.

## Responses are slow, or the game is costing more than I expected

Both are usually about the model you've chosen. Every AI decision and every spokesperson reply is a call to your LLM provider, which takes time and, on paid models, money.

- Switch to a smaller or faster model in the dashboard's Config view.
- Have the AI control fewer civilizations.
- Run a **local model** to remove the per-turn cost entirely.

See [Configuration](configuration.md) for the full rundown on models, cost, and local setups.

## Chatting with a spokesperson doesn't respond

Spokesperson replies come from the language model in real time, so they stream in after a short delay. If nothing comes back:

- Confirm your API key is valid, or that Codex device login completed (see above).
- Make sure the game is running and not paused.
- Check the console window for provider errors such as an exhausted quota or an unreachable endpoint.
