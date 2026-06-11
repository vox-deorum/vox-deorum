# Troubleshooting

Common problems and how to fix them, in plain question-and-answer form. If your issue isn't here, the [Configuration](configuration.md) and [Getting Started](getting-started.md) pages cover most setup details.

## The dashboard doesn't open in my browser

When you launch Vox Deorum, a console window opens and starts the background services, then the dashboard should open at `http://localhost:5555`.

- Give it a few seconds — the services take a moment to come up the first time.
- If the page never appears, open that address in your browser by hand.
- **Keep the console window open.** Closing it stops everything. To shut down cleanly, follow the prompt in the console rather than closing the window.
- If the dashboard still won't load, another program may be using the port, or the services failed to start. Close any leftover Vox Deorum console windows and launch again.

## The AI isn't doing anything / a turn seems stuck

The single most common cause is that **the game is paused.** While the game is paused, it can't answer the AI's requests, so the AI looks frozen. Make sure the game is actually running (not sitting on a pause or a blocking pop-up), and it will pick up again.

If it's still stuck:

- Check the console window for errors.
- Make sure your API key is set and valid (see below) — without a working model, the AI can't make decisions.
- Larger models simply take longer to think; a slow response isn't always a stuck one.

## I get errors about a missing or invalid API key

The AI players can't run without a working LLM key.

- Open the dashboard's **Config view** and confirm a key is filled in for your provider.
- Make sure you pasted the **whole** key with no extra spaces before or after it.
- Confirm the key is still active and has credit in your provider's own account dashboard.

See [Configuration](configuration.md) for where to get keys and how to choose a provider.

## The AI stops responding partway through a game

This usually means Vox Deorum briefly lost its connection to the game — for instance the game was closed, restarted, or was mid-load. Vox Deorum reconnects automatically and keeps retrying, so:

- If you closed or reloaded the game, just let it finish coming back up; play resumes on its own.
- If the game crashed, relaunch it. The AI picks up roughly where it left off.
- A persistent disconnect usually points to the game itself having quit — check that Civilization V is still running.

## The mod doesn't seem active / it looks like normal Civ V

Start your games from the dashboard's **Session view**, not from Civ V's main menu. When you start from the dashboard, Vox Deorum launches the game with all the right mods already enabled. Launching the game on its own won't bring in the AI.

If you ran the installer but the game still can't find the mods at all, re-run the installer — it reinstalls the mod files and clears the game's cached data so changes take effect.

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

- Confirm your API key is valid (above).
- Make sure the game is running and not paused.
- Check the console window for provider errors such as an exhausted quota or an unreachable endpoint.
