# Troubleshooting

Common problems and how to fix them, in the order you'll meet them. If your issue isn't here, see [Playing](playing.md), [Configuration](configuration.md), and [Getting Started](getting-started.md).

| Symptom | Most likely fix |
| --- | --- |
| Installer can't find Civilization V | Install Civ V through Steam first, then confirm the game folder when the installer asks; see below. |
| Dashboard doesn't open | Wait a few seconds, then open `http://localhost:5555` by hand; keep the console window open. |
| Startup reports `ERR_PACKAGE_PATH_NOT_EXPORTED` | Close Vox Deorum and reinstall to replace incompatible dependencies; see below. |
| Setup rejects a key or cannot load models | Use the wizard's message to correct the key or connection; see below. |
| Codex login doesn't start or finish | Use the sign-in page and code shown in the dashboard; see below. |
| Mod doesn't seem active | Start games from the dashboard's Play page; see below. |
| Game won't start, or starts with graphics trouble | Try turning off **Use DX11** in Settings; see below. |
| Turn or AI looks frozen (game running) | Make sure the game isn't paused. |
| Game crashed or connection lost mid-game | Vox Deorum reconnects and relaunches on its own; wait it out; see below. |
| Spokesperson chat doesn't reply | Confirm your credential works and the game is running; check the console for errors. |
| Responses are slow or costly | Switch to a smaller, faster, or local model. |
| Need to report a bug | Download logs from the dashboard's **Debug** page; see below. |

## The installer couldn't find Civilization V

Install Civ V through Steam first, then run the installer again. It asks you to confirm the game folder: pre-filled when it detects one, otherwise a standard Steam path you can change. See [Getting Started](getting-started.md) for the full walkthrough.

## The dashboard doesn't open

Give it a few seconds. If it never appears, open `http://localhost:5555` in your browser by hand. Keep the console window open while you play, and use its prompt to stop at the end. Still nothing? Close leftover Vox Deorum console windows and launch again. See [Getting Started: First launch](getting-started.md#first-launch) for the normal startup sequence.

## Startup reports a package export error

`ERR_PACKAGE_PATH_NOT_EXPORTED` can mean an older dependency was left behind during an upgrade. Close Vox Deorum and run the installer again. The installer replaces the bundled `node_modules` folder before copying dependencies.

If you are using an older installer that still leaves this error, rename only the `node_modules` folder directly inside your Vox Deorum installation to `node_modules.old`, then reinstall. Keep your configuration and game data folders.

## Setup rejects my key or cannot load models

The wizard validates the key by fetching the provider's models, and tells you whether the problem is the credential, the network, or the provider. Re-enter the whole key with no extra spaces. On your provider's billing page, confirm the key is active and has credit. For a network or provider error, confirm you are online and check whether the provider is having an outage. For a local OpenAI-format server, confirm the server is running and the address is correct. Reopen the guided flow with the **Setup wizard** button on the Settings page. If Claude Code is missing or not signed in, listing its models shows an error. Provider details are in [Configuration](configuration.md).

## Codex login doesn't start or finish

The sign-in page and one-time code appear in the dashboard, and the console window prints the same link and code, so you can finish sign-in from another device or if the browser never opened. See [Configuration: Using Codex with ChatGPT](configuration.md#using-codex-with-chatgpt) for how ChatGPT device login normally works. If it goes wrong:

- **Browser never opened.** Use the sign-in link and code from the Setup wizard, or restart Vox Deorum to begin again.
- **Port busy.** Vox Deorum moves to the next free port by itself; startup fails only when every nearby port is taken.
- **Taking too long.** Vox Deorum waits up to five minutes by default.

If login still fails, the [developer Operations page](../developers/operations.md) covers running the proxy by hand for diagnosis.

## The mod doesn't seem active

Start games from the dashboard's **Play** page: that launch brings up Civ V with the mods and the AI ready. If the game still can't find the mods after installing, re-run the installer: it reinstalls the mod files and clears the game's cached localization text.

## The game won't start, or looks wrong when it does

Vox Deorum launches the DirectX 11 build of Civilization V by default, which is the build it is developed against. Installs without that build fall back to the standard one by themselves. If the game fails to start, crashes early, or shows visual corruption, turn off **Use DX11** in the Settings page's **Game Settings** card and start a new session; recording and livestreaming are tuned for the DirectX 11 build, so expect capture to be less reliable with the setting off.

## The AI isn't doing anything, or a turn seems stuck

The usual cause is a paused game, which holds the AI's requests. Check for a pause menu or blocking pop-up, then resume. Still stuck: check the console window for errors, confirm your credential works (the AI needs a working model to make decisions), and allow time for larger models to think.

## Game names appear in the wrong language

Vox Deorum follows Civilization V's language for game names such as civilizations, leaders, technologies, and buildings. If names remain English in a non-English game, an older configuration may still force English. Change `database.language` from `en_US` to `auto` in the MCP server's `config.json`, and remove or change any `DB_LANGUAGE=en_US` environment setting, which takes precedence. Restart Vox Deorum after changing configuration. See the [MCP configuration reference](../developers/mcp-server/configuration.md) for where these settings are read.

Translations come from the installed game and mods. Missing translations fall back to English, then to a text key if English is also missing.

## The AI stops responding partway through a game

Here the game has crashed or Vox Deorum has lost its connection. After a brief disconnect it reconnects and retries by itself. After a crash it relaunches Civilization V with the most recent save, up to three times. Step in when Vox Deorum gives up after those attempts, or when the game is set up to wait for you.

## Chatting with a spokesperson doesn't respond

Replies stream from the model, so expect a short delay. Confirm your API key is valid or the ChatGPT sign-in completed, make sure the game is running and not paused, and check the console window for provider errors such as an exhausted quota or an unreachable endpoint.

## Responses are slow, or the game costs more than expected

A smaller, faster, or local model helps both, as does having the AI control fewer civilizations. See [Configuration: Controlling cost](configuration.md#controlling-cost).

## Collecting logs for a bug report

The dashboard's **Debug** page collects the logs that help us diagnose a problem:

1. Open the dashboard and select **Debug**.
2. Turn on the **Civ 5 logging** switch, then restart Civ 5. The game reads this setting only when it starts.
3. Reproduce the problem in the game.
4. Click **Download all** to save a zip containing the latest Vox Deorum and Civ 5 log files plus a short setup summary.
5. Attach the zip to a [GitHub issue](https://github.com/CIVITAS-John/vox-deorum/issues).

The zip never includes your API keys or configuration files, so it is safe to share.
