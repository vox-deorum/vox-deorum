# AGENTS.md

NEVER STAGE YOUR CHANGES UNLESS EXPLICITLY ASKED! However, if a change gets externally staged, it is from the human reviewer. 

When asking questions, come with a clear, plain description with an example. Do not assume the owner knows every detail in your context. DO NOT ASK asynchronous questions.

## Use Subagents When Appropriate

Delegate less critical/lower-level BATCH work to subagents with less capabilities for exploring/batch editing. Always designate a model for subagents and report which model (or tool) you used in response text. Such work may involve exploring repo structure, finding references, summarizing information, or conducting less sophisticated edits in batches.

Use OpenCode delegation if such a skill exists, with clear, bounded instructions. If OpenCode does not work, switch back to native subagents.

DO NOT use weak models for complex diagnosis. For independent review, use OpenCode. For exploration and simple implementation task:
- Claude Code: always delegate to OpenCode. Never use Sonnet or Haiku.
- Codex: always delegate to OpenCode or GPT-6-Luna. Never use Sol.

## Project Overview

Vox Deorum (VD, do not use Vox alone) is LLM-enhanced AI for Civilization V, built on the Community Patch framework.

```
Civ 5 ↔ DLL ↔ Bridge Service ↔ MCP Server ↔ Vox Agents → LLM
     (Named Pipe) (REST/SSE)    (MCP/HTTP)     (LLMs)
```

The system is made up of five components:

| Component | Directory | What it does |
| --- | --- | --- |
| Community Patch DLL | `civ5-dll/` | C++ DLL with named pipe IPC. |
| Bridge Service | `bridge-service/` | REST/SSE bridge between Civ V and the AI. |
| MCP Server | `mcp-server/` | MCP tools plus SQLite game data access (Kysely). |
| Vox Agents | `vox-agents/` | LLM-powered strategic AI framework. |
| Civ 5 Mod | `civ5-mod/` | Lua hooks and UI for game integration. |

Read a component's `AGENTS.md` when working in that directory. Load other documentation as needed for the task.

## Build and Release Commands

- npm workspaces: run `npm install` and `npm install <pkg>` from the repository root. Root commands for full validation are `npm run build:all` and `npm run test:all`.
- DLL build and deployment: run `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/` when the task calls for building and deploying the DLL.
- Release notes: read `release.txt` for the last version tag, then run `git log <tag>..HEAD --oneline --no-merges` and `git diff --stat <tag>..HEAD`. Output short grouped bullets to the console and don't write files.

## Writing Style

Use plain, natural language in documentation, comments, commit messages, release notes, and responses. Use lists, tables, or diagrams as long as they improve clarity. Do not use em-dashes. These rules also apply to delegates. Rewrite documentation and plans for a coherent final result. Include revision history only when requested, and comparisons only when they help the reader make a decision.

## Code Rules

- Prefer simple implementations with only the abstractions and guardrails the task needs.
- ESM everywhere: all TS modules use `"type": "module"` with `.js` import extensions.
- Keep workspace `package.json` files minimal.
- Vitest for all TypeScript testing.
- Test behavior and contracts, not hard-coded prose. Avoid assertions tied to exact prompt, documentation, or message wording; use controlled inputs to check decisions, data flow, and observable effects.
- Winston logger only: never use `console.log/error/warn` in production code (it is fine in tests).
- camelCase for exported constants (for example, `export const apiKeyFields`).
- Give every function a comment describing its purpose.
- Use the `// Vox Deorum:` prefix for Vox Populi/Community Patch modifications outside CvConnectionService.

## Documentation Rules

Documentation is centralized in `/docs/` and serves two audiences: players (how to play) and developers (what the repo does and how its pieces fit).

- Update relevant docs alongside changes to behavior, configuration, or setup. Create documentation only when the task requires it.
- Keep the detail light. Avoid raw code in docs; describe the behavior and name the source file instead.
- No line-number anchors. They drift, so refer to files, functions, or concepts by name.
- Component `docs/` folders are only for component-specific reference material (for example, `mcp-server/docs/events/`). Don't add new root-level markdown inside components.
