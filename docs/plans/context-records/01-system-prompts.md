# Stage 1: System prompt files and overrides

Part of the [context-records plan](../context-records.md). **Status: implemented.** The temporary golden tests and their fixture are kept locally, gitignored, until the main plan's acceptance checks.

## Objective

Move authored system prompts into editable Markdown templates while preserving default prompt output and adding validated seat, session, and root overrides.

## Dependencies

None. Capture the compatibility baseline before changing any prompt builder. Stage 2 also relies on it for initial messages. Keep these temporary golden tests as local, gitignored files until the acceptance checks in the main plan.

## Current state

| Area | Existing behavior and source |
| --- | --- |
| System prompts | `getSystem` implementations build JS template literals from static constants such as `SimpleStrategistBase.goalsPrompt` and `SimpleBriefer.citiesPrompt`, plus a few runtime values and conditional passages. Middleware later appends the workspace, tool-choice, and tool-protocol text. No config field accepts prompt text; the only override is the oracle's code-level `modifyPrompt`. |

## Approach

Built-in system prompts live in `vox-agents/prompts/`. Each agent's prompt is `<agent-name>.md`, and a variant is `<agent-name>.<variant>.md`. Shared fragments live under `shared/`. The folder is resolved from the module path, so `src` and `dist` both find it without a build copy step.

Files use [Mustache](https://mustache.github.io/mustache.5.html) with HTML escaping turned off, so `&` and `<` in game data stay intact. Mustache is small, has no dependencies, and is logic-less, so a prompt file cannot run code. Its variables, partials, sections, and inverted sections cover every conditional passage in today's prompts. `Mustache.parse` also exposes a token tree for validation. A hand-rolled replacer would need conditionals and a parser for the same result. Handlebars and LiquidJS add more than this needs, and EJS or Eta would execute code from user files.

Prose lives in files. Code passes only data, such as the formatted user description, and flags. Rendered output is trimmed, as today's `.trim()` does. Today's runtime values become these template names:

| Prompt | Runtime values today | In a prompt file |
| --- | --- | --- |
| Simple, briefed, staffed, and learned strategists | `getDecisionPrompt(mode)` picks the decision tool and adds Flavor guidance | A `shared/decision` fragment with a `flavor` section and its inverse |
| Learned strategist | An episodes line when working memory holds an episode request | `episodes` section |
| Specialized briefer | `input.mode` picks Military, Economy, or Diplomacy text | `specialized-briefer.military.md`, `.economy.md`, and `.diplomacy.md` |
| Diplomat and spokesperson | `formatUserDescription` and teammate passages from `getTeammateCounterpart` | `user`, and a `teammate` section over the teammate's fields |
| Negotiator | Leader, civilization, and teammate stance | `leader`, `civilization`, and `teammate` section |
| Diplomatic analyst and summarizer | Leader and civilization | `leader` and `civilization` |
| Talkative telepathist | Leader and civilization; a special message drops the tools passage | `leader`, `civilization`, and an inverted `special` section around the tools text |
| Simple briefer, keyword librarian, evaluator strategist | None | Static |
| None, null, and human strategists; episode retriever; oracle agent | No authored system text, or the recorded text | No file |

A custom prompt does not need to restate text added after `getSystem`. That includes the workspace section, which lists the records and reference mounts, the completion-tool instruction, and the tool protocol added by middleware. The records directions belong to the initial messages. Triple-brace special messages, now used only by the telepathist, are user-turn triggers and never appear in system text.

The `prompts` setting names a folder, relative to `vox-agents/` like `configs/`. `resolveSeatPrompts` in `strategist/seat-config.ts` resolves it seat over session over root, as it does for `files`. Runs outside a seat, such as the summarizer and telepathist, use the root setting. Lookup checks the custom folder first, then the built-in one. Partials resolve the same way, so overriding `shared/goals.md` changes every strategist that includes it.

Validation runs at session start and fails through the session's fatal setup path. Entry points that run agents outside a session (the web UI and summary preparation) validate the root folder the same way before any run, and a config save validates the proposed folder before writing it. It requires the following:

- Every `.md` file in the custom folder matches a built-in path, which catches misspelled names.
- Every partial exists.
- No partial includes itself.
- A file uses only the names its built-in counterpart uses, including through its partials, as the same kind (variable or section) and in the same section scope or an enclosing one. The check walks each file's parsed token tree.

Files are read and parsed once per session. Edits take effect in the next session.

Custom prompts replace system text only. Initial messages, section descriptions, records directions, reminders, and middleware text stay in code. The resource descriptions become shared fragments, so file mode keeps them. The oracle agent keeps returning the recorded system text, and `modifyPrompt` remains the replay-time override.

## Work items

### Capture the compatibility baseline

Create a compact recorded game-state fixture under `vox-agents/tests/fixtures/game-state/`, using local telemetry and cached tool definitions. Include metadata with `YouAre`, all six reports, and their Markdown configurations. Keep the fixture and any capture script local.

Add temporary golden tests under `vox-agents/tests/mock/prompts/` for the four LLM strategists, the simple briefer, all three specialized briefer modes, and `buildGameContextMessages`. Pre-fill briefings, include a past briefing, fix working-memory instructions, and mock episode retrieval. Capture `getSystem` and `getInitialMessages` before refactoring. Also capture `getSystem` for the diplomat and spokesperson (with and without a teammate), negotiator, diplomatic analyst, talkative telepathist (normal and special message), summarizer, keyword librarian, and evaluator strategist, and both decision modes for the strategists, since this stage moves all of them into files.

### Move and configure system prompts

Add `mustache` and its types to `vox-agents` from the repository root. Add the prompt loader and renderer in `utils/prompts/prompt-files.ts`, then port every `getSystem` listed above to it while keeping the golden tests unchanged. Remove the old prompt constants and `getDecisionPrompt`.

Add `prompts` to `PlayerConfig` and `StrategistSessionConfig` in `types/config.ts`, the root default in `utils/config/defaults.ts`, and `resolveSeatPrompts`. Add startup validation and the `context.prompts` attribute.

## Verify

| Area | Required checks |
| --- | --- |
| Prompt files | Byte-identical output without a custom folder; Strategy and Flavor modes, teammate, episodes, and special-message sections; overrides of agent files and shared fragments; partials resolved through the custom folder; `&` and `<` in game data left unescaped; independent per-seat folders; the root setting outside seats |
| Prompt validation | An unknown file, an unknown variable or section, and a missing partial each fail at session start, before any player loop |

## Documentation

Update `docs/developers/vox-agents/prompts.md` with Mustache usage, template names, and lookup order; `docs/players/configuration.md` with copying and editing built-ins and the `prompts` setting; and `vox-agents/AGENTS.md` with the rule that prompt prose belongs in files and code supplies data and flags.

## Risks and open questions

- **Custom prompt quality:** a replacement can drop essential instructions, such as which decision tool to call. Including `shared/decision` and the other shared fragments avoids this. Validation checks names and partials, not meaning.

## Done when

Default system prompts pass the unchanged golden tests, overrides resolve independently for each seat, and invalid templates stop setup before any player loop. Oracle still returns recorded system text without reading prompt files.
