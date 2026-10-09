# Configuration

The AI civilizations in Vox Deorum are powered by a large language model, and you decide which one. This page covers providers, credentials, models, cost, and running a model locally for free.

**The short version:** follow the **Setup** wizard in the dashboard (`http://localhost:5555`, opened automatically when you launch Vox Deorum): choose how to connect, provide a key or sign in, and pick your Main AI. Most hosted providers need an API key, and Codex uses your ChatGPT login.

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

A Codex or Claude Code model can reach the web during its turn when its model options include `"hostTools": ["Web"]`, and it is told when it has that access. `Web` is the only accepted entry. The older `Read`, `Write`, and `everything` entries were removed: a config that still lists them fails with an error naming `Web`. For files, use the `files` setting below instead, which works on every provider. See the [developer overview](../developers/vox-agents/overview.md#models-and-configuration) for the full policy.

## File workspace

The per-seat `files` setting gives one AI civilization's agents a `bash` tool: a simulated shell, on any provider, where they can keep notes and work with data. It is off by default. There is no network, Python, or JavaScript; common text tools, `jq`, and `sqlite3` work.

`"files": "write"` or `"read"` is the shorthand that gives your seat's game folder write or read access. The full form is:

```json
"files": { "game": "write", "shared": { "lessons": "read" }, "quota": 20 }
```

- `game` (`false`, `"read"`, or `"write"`): the seat's folder for the current game, shown as `/workspace/game` in the shell and saved on disk at `workspaces/games/<gameID>-player-<playerID>/` inside the telemetry folder. All agents of one player in one game share it.
- `shared`: named folders at `/workspace/shared/<name>`, saved under `workspaces/shared/`, that persist across games and seats. A name uses lowercase letters, digits, `-`, or `_`, starting with a letter or digit.
- `quota`: the step budget of one agent run with files on (default 20). Bash steps and the final decision share this budget, and an agent that already allows more steps keeps its own limit. Bash itself is cheap, but each step costs a full model call, so agents are told to batch commands and are reminded each step how many steps they have left to decide. A long run drops old command output once its prompt grows near the model's `continuityThreshold` option (300,000 tokens for Claude Code, Codex, OpenAI, and Anthropic models, 100,000 for others), after reminding agents to save what they need to their notes.

In the shell, `/tmp` is scratch space shared by one civilization's agents for the whole game, saved under `workspaces/scratch/`, and anything written elsewhere is discarded after each call. Nothing deletes workspace folders automatically; remove them from the telemetry folder when you no longer need them. Agents cannot change a `"read"` folder; a `"write"` folder is saved to disk. Each writable game or shared folder gets an `AGENTS.md` guide, created once and never overwritten, so agents and you can edit it.

Set `files` on a seat (`llmPlayers.<n>.files`), in the session config, or in `vox-agents/config.json`; the highest level that sets it wins and replaces lower ones whole, with no merging, the same as `triage`. An invalid value fails the session's preflight check before the game launches, and the error names the config path to fix. Two seats of the same game writing one shared name can pass information to each other, so use different names per seat or read access. The tool needs Node.js 22.17.0 or newer (Vox Deorum requires 22.23.3); on older Node it returns an error asking you to upgrade. See the [developer overview](../developers/vox-agents/overview.md#models-and-configuration) for the full policy.

## Custom prompts

The instructions each AI agent receives are plain Markdown files in `vox-agents/prompts/`. To change them, copy the built-in files you want to edit into a folder of your own (for example `vox-agents/my-prompts/`), keeping the same names and subfolders, and edit the copies. Then set `"prompts": "my-prompts"`, a folder relative to `vox-agents/`. Files you don't copy keep the built-in text.

- Each agent has its own file, such as `simple-strategist.md` or `diplomat.md`. The specialized briefer has one per mode, such as `specialized-briefer.military.md`.
- Text shared by several agents lives in `shared/`. Changing `shared/goals.md`, for example, changes every strategist that includes it.
- `{{name}}` inserts game data, such as `{{civilization}}`. `{{#flavor}}...{{/flavor}}` keeps a passage only when a condition holds, and `{{^flavor}}...{{/flavor}}` only when it does not. `{{> shared/goals}}`, on its own line, includes a shared file. These follow [Mustache](https://mustache.github.io/mustache.5.html).
- Keep the passages that tell an agent how to act, such as `{{> shared/decision}}` for strategists, which says which decision tool to call. Nothing checks that your text still makes sense.

Set `prompts` on a seat (`llmPlayers.<n>.prompts`), in the session config, or in `vox-agents/config.json`; the highest level wins, the same as `files`. `false`, the default, uses only the built-ins. Agents that run outside a game seat, such as the replay summarizer and the telepathist, use the `config.json` setting.

The files are read when a session starts, so edits apply to the next session. The folder set in `config.json` is also checked when Vox Deorum starts, and a Settings save with an invalid folder is refused with the reason. If Vox Deorum will not start because of this folder, fix the files or remove `prompts` from `config.json`. Either check fails, with an error naming the file, if a file name does not match a built-in one, a file includes a shared file that does not exist, or a file uses a `{{name}}` its built-in counterpart does not use in that place. For example, `{{civName}}` is only valid inside `{{#teammate}}...{{/teammate}}`, where the built-in uses it.

## Choosing a model

The wizard lists the models available through whatever you connected:

| Model type | Strengths | Costs |
| --- | --- | --- |
| Smarter models | Sharper strategic play, better conversations | More per turn, a little slower |
| Smaller / faster models | Cheaper, quicker | Lower quality of play |
| Local models | Free to run, private | Limited by your own hardware |

Your **Main AI** makes most of the AI civilizations' decisions. The service's usual pick is marked **Recommended**.

The optional **Judge AI** is experimental. It sizes up each moment and passes it to a **Quick AI** for small jobs (reports, small talk) or a **Deep AI** for big moments (war, peace, major deals). Either can stay on the Main AI. Once Quick and Deep are set, agents can also pick one themselves when handing off a job; for example, a diplomat asks for the Deep AI before passing a major deal to the negotiator.

You can change all of these in Settings under **Agent-Model Assignments**, including models for individual jobs. **More** finds additional models, and nothing is kept until you choose **Save All**. To give each civilization its own model, edit the game configuration file by hand (see the [developer overview](../developers/vox-agents/overview.md#models-and-configuration)). A mid-tier model is a sensible start; move up or down once you've seen it play.

## Controlling cost

Each decision the AI makes and each spokesperson reply goes through the provider; a paid model costs money as you play. A few ways to keep it down:

- Use a smaller or cheaper model for the AI players.
- Control fewer civilizations with the LLM; leave the rest to Civ V's built-in AI.
- Watch usage on your provider's billing page and set limits if it offers them.
- Run a local model and pay nothing per turn; see [Running local models](#running-local-models).

## Game settings

The **Game Settings** card on the Settings page covers how Vox Deorum starts Civilization V.

**Use DX11** is on by default and launches the DirectX 11 build of the game. It is the build Vox Deorum is developed against, and it is what the headless rendering and the OBS capture used by recording and livestreaming expect. Installs without a DirectX 11 build fall back to the standard one on their own, so the setting is safe to leave on. Turn it off if the DirectX 11 build misbehaves on your hardware and you want the standard build instead.

## Running local models

To play fully offline or without per-turn costs, run a model on your own machine with [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), or any server that speaks OpenAI's format. Choose the local option in the Setup wizard and enter the server's address; Vox Deorum checks the server, lists its models, and lets you pick one. The address stays editable in Settings. Local models run free and offline, and your hardware sets their speed and skill. A hosted model still plays the sharpest games.
