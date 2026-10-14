# Prompt files

Agent instructions live in template files, not in code. Each agent's system prompt is a Mustache file in `vox-agents/prompts/`. The agent's code only passes in data, such as the leader's name or which decision mode is on. Players can point a seat at their own folder of edited copies.

This page covers the built-in files, custom folders, and the game-state section registry that prompt builders share.

## The built-in files

`renderSystemPrompt` in `src/utils/prompts/prompt-files.ts` renders the templates.

| File | Use |
| --- | --- |
| `<agent-name>.md` | An agent's system prompt. |
| `<agent-name>.<variant>.md` | A variant. The specialized briefer has `.military`, `.economy`, and `.diplomacy`. |
| `strategist-triage.md` | The system prompt for [strategist triage](../models/tiers-and-triage.md#strategist-triage). It is not an agent. |
| `records-directions.md` | The records directions an agent adds to its opening messages in [file mode](prompts.md#file-mode). It is not an agent. |
| `records-notes.md` | The latest game notes an agent adds to its opening messages in file mode. It is not an agent. |
| `workspace.md` | The Workspace section of the [capability reminder](../models/middleware.md#capability-reminder) in the system prompt. It is not an agent. |
| `shared/*.md` | Passages several agents include, such as resource descriptions and decision instructions. |

A template's name is its path without `.md`, such as `shared/goals`. The folder is found relative to the module, so both `src` and `dist` builds read it, and the installer ships it.

### What each agent passes in

Prose stays in the files. `getSystem` passes only data and flags:

| Template | Data passed |
| --- | --- |
| Simple, briefed, staffed, and learned strategists | `flavor` (Flavor or Strategy mode, read by `shared/decision`), plus `episodes` for the learned strategist |
| Diplomat and spokesperson | `user`, and a `teammate` section |
| Negotiator | `leader`, `civilization`, a `teammate` section, and `coopWarLabel` (the joint-war term name from the deal schema) |
| Diplomatic analyst and summarizer | `leader` and `civilization` |
| Talkative telepathist | `leader`, `civilization`, and an inverted `special` section around the tools passage |
| Simple and specialized briefers, keyword librarian, evaluator strategist | Nothing |

### Rendering rules

- HTML escaping is off, so `&` and `<` in game data stay as they are. The result is trimmed.
- Put each partial on its own line at column 0. Mustache removes a standalone tag's line, so each fragment file ends with exactly one newline.
- The summarizer's turn instructions (`src/telepathist/preparation/instructions.ts`) also render `shared/historian-guidelines`, so they match its system prompt.
- Text added after `getSystem` stays in code. This includes the workspace section, the completion-tool sentence, and prompt-mode tool instructions.
- The Oracle's agent replays the recorded system text and never reads these files.

## Custom folders

The `prompts` setting names a folder relative to `vox-agents/`. Lookup checks that folder first, then the built-ins. Partials resolve the same way, so a custom `shared/goals.md` reaches every strategist that includes it.

**Where the setting comes from.** `resolveSeatPrompts` in `src/strategist/seat-config.ts` checks the seat, then the session config, then the root `config.json`. `VoxPlayer` stores the result on the seat's context. Work outside a seat uses the root setting.

**When folders are loaded.**

| Moment | What happens |
| --- | --- |
| A session starts | `StrategistSession.start` calls `reloadPromptSets` with every folder the session uses, before any player loop. |
| The web server starts, and before summary preparation | `reloadRootPrompts` loads and checks the root folder. |
| A dashboard config save | `validatePromptsSetting` checks the new value before anything is written, and refuses an invalid folder with the reason. |

Each folder is read and checked once. An invalid folder fails with an error naming the file:

- Every `.md` file must match a built-in path.
- Every partial must exist, and no partial may include itself. A missing partial is reported with the file that includes it. The built-ins get these checks too, because Mustache would quietly render a missing partial as nothing.
- A template may use only the names its built-in counterpart uses, including through partials. Each name keeps its kind (variable or section) and its scope. For example, a field the built-in reads inside `{{#teammate}}` is rejected outside it. A name the built-in reads outside a section is still allowed inside one, since Mustache looks names up through enclosing sections. Names a built-in has dropped but its caller still supplies stay allowed, so an older custom file keeps working. The records directions keep `hasTurns`, `turnRanges`, and `latestTurn` this way, along with the `notes` section that moved to `records-notes`.

Errors for a seat name the setting's path, such as `llmPlayers.2.prompts`.

**Reloading.** A failed reload keeps the previous sets. A reload leaves other folders alone, so a second session in the same process changes a running session's text only for folders both use. Edits take effect in the next session. Each agent span records the folder in use as `context.prompts`, or `false` for built-ins only.

The root `prompts` field is part of the runtime config and its saved diff (`src/utils/config.ts` and `src/utils/config/diff.ts`).

## Game-state sections

The game state is made of sections: situation, civilization, options, strategies, victory progress, players, cities, military, events, and briefings. Each section is defined once in the registry in `src/knowledge/sections.ts`, with:

- its key, default title, and description,
- whether it lasts the whole game or changes each turn,
- its default Markdown settings.

Prompt builders render a section with `renderSection`. It takes the data plus optional overrides for the heading, the description (`false` for none), the heading level, and the Markdown settings. Data that is already Markdown, such as a briefing, is inserted as is with the `rendered` override.

Builders still decide their own message order, field filtering, and cache anchors. But a builder that shows a section always goes through the registry instead of formatting the report itself.

The same definitions name the files in the [seat records](../workspace/store.md#records), so a prompt and a record file describe a section the same way. In [file mode](prompts.md#file-mode), the records directions use them to point to the sections left out of the prompt.
