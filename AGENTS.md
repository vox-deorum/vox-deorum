# AGENTS.md

## Project Overview

Vox Deorum is LLM-enhanced AI for Civilization V, built on the Community Patch framework.

```
Civ 5 ↔ DLL ↔ Bridge Service ↔ MCP Server ↔ Vox Agents → LLM
     (Named Pipe) (REST/SSE)    (MCP/HTTP)     (LLMs)
```

The system is made up of five components:

| Component | Directory | What it does |
| --- | --- | --- |
| Community Patch DLL | `civ5-dll/` | C++ DLL with named pipe IPC. Build and deploy with `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/`. |
| Bridge Service | `bridge-service/` | REST/SSE bridge between Civ V and the AI. |
| MCP Server | `mcp-server/` | MCP tools plus SQLite game data access (Kysely). |
| Vox Agents | `vox-agents/` | LLM-powered strategic AI framework. |
| Civ 5 Mod | `civ5-mod/` | Lua hooks and UI for game integration. |

Each component has its own AGENTS.md with detailed patterns. Read it before working in that directory.

## Use Subagents Whenever Appropriate
Always delegate less important or complicated work to subagents with less capabilities, e.g., from Claude Fable to Sonnet/Haiku. DO NOT spawn Fable subagents. Such work may involve exploring repo structure, finding references, summarizing information, or conducting small but extensive edits.

## Workflow Rules

- Delegate to sub-agents for complex or multi-step features, and include the tool-calling rules in the prompt.
- Don't present action plans until requested, and don't change test scripts unless asked.
- Release notes: read `release.txt` for the last version tag, then run `git log <tag>..HEAD --oneline --no-merges` and `git diff --stat <tag>..HEAD`. Output short grouped bullets to the console and don't write files.

## Writing Style

Write everything in natural language: docs, code comments, commit messages, release notes, console output, and the AGENTS.md files themselves. Keep the prose plain and easy to follow. Bullets, subbullets, and tables are encouraged wherever they make the content easier to scan.

Do not use em-dashes anywhere. Reach for a colon, a comma, parentheses, or two separate sentences instead. Every agent working in this repo must follow this rule.

## Code Rules

- ESM everywhere: all TS modules use `"type": "module"` with `.js` import extensions.
- npm workspaces: always run `npm install <pkg>` from the repo root, never from a workspace, and keep sub-package `package.json` files minimal. Use `npm install`, `npm run build:all`, and `npm run test:all` from root.
- Vitest for all TypeScript testing.
- Winston logger only: never use `console.log/error/warn` in production code (it is fine in tests).
- camelCase for exported constants (for example, `export const apiKeyFields`).
- Comment everywhere: every function, at least, needs a comment.
- Acceptable `any` usage: Kysely dynamic queries, Lua and game data boundaries, `Player${i}` access, third-party interop, and arbitrary JSON.
- Express route responses: union with `ErrorResponse` instead of casting `as any`.
- Backend sends complete data; the frontend decides formatting.
- Use the `// Vox Deorum:` prefix for C++ modifications outside CvConnectionService.

## Documentation Rules

Documentation is centralized in `/docs/` and serves two audiences: players (how to play) and developers (what the repo does and how its pieces fit). See `docs/plan.md` for the organization.

- Update docs in the same change that alters behavior, configuration, or setup, and never create docs proactively.
- Keep the detail light. Avoid raw code in docs; describe the behavior and name the source file instead.
- No line-number anchors. They drift, so refer to files, functions, or concepts by name.
- Component `docs/` folders are only for component-specific reference material (for example, `mcp-server/docs/events/`). Don't add new root-level markdown inside components.

## Key Files

- `docs/plan.md`
- `*/AGENTS.md`
- `*/tests/setup.ts`
- `*/src/config.ts`
- `*/vitest.config.ts`
