# AGENTS.md

## Project Overview

Vox Deorum — LLM-Enhanced AI for Civilization V (Community Patch framework).

```
Civ 5 ↔ DLL ↔ Bridge Service ↔ MCP Server ↔ Vox Agents → LLM
     (Named Pipe) (REST/SSE)    (MCP/HTTP)     (LLMs)
```

1. **Community Patch DLL** (`civ5-dll/`) — C++ DLL with named pipe IPC. Build & deploy: `powershell -Command "& .\build-and-copy.bat"` from `civ5-dll/`
2. **Bridge Service** (`bridge-service/`) — REST/SSE bridge between Civ V and AI
3. **MCP Server** (`mcp-server/`) — MCP tools + SQLite game data access (Kysely)
4. **Vox Agents** (`vox-agents/`) — LLM-powered strategic AI framework
5. **Civ 5 Mod** (`civ5-mod/`) — Lua hooks and UI for game integration

Each component has its own AGENTS.md with detailed patterns — **read it before working in that directory**.

## Tool-Calling Rules

- **Use built-in tools instead of bash equivalents** — Read not `cat`/`head`/`tail`, Edit not `sed`/`awk`, Write not `echo >`, Grep not `grep`/`rg`, Glob not `find`/`ls`
- **Never cd to the working directory** — do `git diff --stat v0.8.1..HEAD`, not `cd f:/vox-deorum/vox-deorum && ...` or `git -C ...`
- **Always use relative paths** in bash — never absolute paths like `f:\vox-deorum\...`
- **Avoid noisy shell idioms** — no `2>/dev/null || echo "not found"`; the dedicated tools handle missing paths gracefully

## Workflow Rules

- Delegate to sub-agents for complex/multi-step features **with tool-calling rules in the prompt**
- Don't present action plans until requested; don't change test scripts unless asked
- **Release notes:** Read `release.txt` for the last version tag, then `git log <tag>..HEAD --oneline --no-merges` and `git diff --stat <tag>..HEAD`. Output short grouped bullets to console (don't write files).

## Code Rules

- **ESM everywhere** — all TS modules use `"type": "module"` with `.js` import extensions
- **npm workspaces** — always `npm install <pkg>` from the repo root, never from a workspace; sub-package `package.json` files stay minimal. Use `npm install` / `npm run build:all` / `npm run test:all` from root.
- **Vitest** for all TypeScript testing
- **Winston logger only** — never `console.log/error/warn` in production code (OK in tests)
- **camelCase for exported constants** (e.g., `export const apiKeyFields`)
- **Comment everywhere** — every function, at least, needs a comment
- **Acceptable `any` usage:** Kysely dynamic queries, Lua/game data boundaries, `Player${i}` access, third-party interop, arbitrary JSON
- Express route responses: union with `ErrorResponse` instead of casting `as any`
- Backend sends complete data; frontend decides formatting
- Use `// Vox Deorum:` prefix for C++ modifications outside CvConnectionService

## Documentation Rules

Documentation is centralized in `/docs/` with two audiences — players (how to play) and developers (what the repo does and how its pieces fit). See `docs/plan.md` for the organization.

- **Update docs in the same change** that alters behavior, configuration, or setup; never create docs proactively
- **Write in natural language** — plain prose, easy to read, easy to follow
- **No excessive detail** — especially no raw code in docs; describe behavior and name the source file instead
- **No line-number anchors** — they drift; refer to files, functions, or concepts by name
- Component `docs/` folders are only for component-specific reference material (e.g., `mcp-server/docs/events/`); no new root-level markdown in components

## Key Files

`docs/plan.md` | `*/AGENTS.md` | `*/tests/setup.ts` | `*/src/config.ts` | `*/vitest.config.ts`
