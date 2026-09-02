# Troubleshooting

Common problems and how to fix them, roughly in the order you'll meet them. If your issue isn't here, check [Playing](playing.md), [Configuration](configuration.md), and [Getting Started](getting-started.md). Configuration is also where provider, credential, and API key are explained.

| Symptom | Most likely fix |
| --- | --- |
| Installer can't find Civilization V | Install Civ V through Steam first, then confirm the game folder when the installer asks. |
| Dashboard doesn't open in the browser | Wait a few seconds, then open `http://localhost:5555` by hand; keep the console window open. |
| Setup rejects a key or cannot load models | Use the wizard's authentication, network, or provider message to correct the key or connection. |
| Codex login doesn't start or finish | Use the device link and user code shown in the dashboard; the one-time user code is never written to the logs. |
| Mod doesn't seem active / looks like normal Civ V | Start games from the dashboard's Play page, not Civ V's own menu. |
| Turn or AI looks frozen (game running) | Make sure the game isn't paused. |
| Game crashed or connection lost mid-game | Vox Deorum reconnects and relaunches on its own; wait it out. |
| Spokesperson chat doesn't reply | Confirm your credential works and the game is running; check the console for errors. |
| Responses are slow or cost too much | Switch to a smaller, faster, or local model. |

## The installer couldn't find Civilization V

Install Civilization V through Steam first, then run the Vox Deorum installer. It always asks you to confirm the game's folder: pre-filled if it detected one, otherwise blank so you can browse to it. See [Getting Started](getting-started.md) for the full walkthrough, including the typical folder path.

## The dashboard doesn't open in my browser

See [Getting Started: First launch](getting-started.md#first-launch) for the normal startup sequence. If the dashboard still doesn't show up:

- Give it a few seconds. If the page never appears, open `http://localhost:5555` in your browser by hand.
- **Keep the console window open.** Closing it stops everything; shut down through its prompt instead.
- Still nothing? Close any leftover Vox Deorum console windows and launch again.

## Setup rejects my key or cannot load models

The Setup wizard validates an API-backed provider by using the key to fetch its current models. It distinguishes authentication failures from network and provider errors, so start with the message shown there.

- Re-enter the entire key with no extra spaces, then try validation again.
- On your provider's billing page, confirm the key is still active and has credit.
- For a network or provider error, confirm you are online and check whether the provider is having an outage.
- For a local OpenAI-compatible model, confirm the local server is running and that its address is correct.

You can reopen the guided flow with the **Setup wizard** button on the Settings page. Codex uses ChatGPT login rather than an API key, and Claude Code's model list comes from your local Claude Code sign-in. If Claude Code is missing or not signed in, listing its models shows an error. See [Configuration](configuration.md) for provider details.

## Codex login doesn't start or finish

See [Configuration: Using Codex with ChatGPT](configuration.md#using-codex-with-chatgpt) for how ChatGPT device login normally works. The device link and user code appear in the dashboard. The verification URL can also appear in the logs, but the one-time user code is never written there. If it goes wrong:

- **Browser never opened.** Open the device link from the Setup wizard yourself, enter the user code shown there, or restart Vox Deorum to begin again.
- **Port busy.** Vox Deorum moves to the next free port by itself; startup fails only if every nearby port is taken. Advanced users can change the starting port with `CODEX_PROXY_PORT`.
- **Taking too long.** Vox Deorum waits up to five minutes by default; advanced users can raise `CODEX_PROXY_STARTUP_TIMEOUT`.

If login still fails, the [developer guide](../developers/operations.md) covers running the proxy by hand for diagnosis.

## The mod doesn't seem active, or it looks like normal Civ V

Start your games from the dashboard's **Play** page, not Civ V's main menu: that's what enables the mods. Launching Civ V on its own won't bring in the AI.

If the game still can't find the mods after installing, re-run the installer. It reinstalls the mod files and clears the game's cached localization text.

## The AI isn't doing anything, or a turn seems stuck

The most common cause is that **the game is paused**. A paused game can't answer the AI's requests, so everything looks frozen. Check that it isn't sitting on a pause menu or a blocking pop-up.

If it's still stuck:

- Check the console window for errors.
- Make sure your provider credential is valid (see above); without a working model, the AI can't decide anything.
- A slow response isn't always a stuck one; larger models take longer to think.

## The AI stops responding partway through a game

This is different from the frozen turn above: the game has crashed or Vox Deorum has lost its connection, rather than the game just being paused. Vox Deorum handles most of it on its own:

- After a brief disconnect, it reconnects and retries by itself.
- After a crash, it automatically relaunches Civilization V with the latest autosave, up to three times.
- Step in yourself only if Vox Deorum gives up after those attempts, or if the game was set up to wait for you.

## Chatting with a spokesperson doesn't respond

Spokesperson replies stream in from the language model in real time, so expect a short delay. If nothing comes back:

- Confirm your API key is valid, or that ChatGPT device login completed (see above).
- Make sure the game is running and not paused.
- Check the console window for provider errors such as an exhausted quota or an unreachable endpoint.

## Responses are slow, or the game is costing more than I expected

Both usually come down to the model. Try a smaller, faster, or local one, or have the AI control fewer civilizations. See [Configuration: Controlling cost](configuration.md#controlling-cost) for the full rundown.
