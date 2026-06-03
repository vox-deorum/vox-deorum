# AGENTS.md

## Tool-Calling Rules (reduces unnecessary permission prompts)
- **Use built-in tools instead of bash equivalents** — Read not `cat`/`head`/`tail`, Edit not `sed`/`awk`, Write not `echo >`, Grep not `grep`/`rg`, Glob not `find`/`ls`
- **Never cd to the working directory** — do `git diff --stat v0.8.1..HEAD`, not `cd f:/vox-deorum/vox-deorum && git diff --stat v0.8.1..HEAD` or `git -C f:/vox-deorum/vox-deorum ...`
- **Always use relative paths** in bash — never absolute paths like `f:\vox-deorum\...` or `/f/vox-deorum/...`
- **Avoid noisy shell idioms** — don't use `2>/dev/null || echo "not found"` patterns; use the dedicated tools which handle missing paths gracefully

## Workflow Rules
- Delegate to sub-agents for complex/multi-step features **with tool-calling rules in the prompt**
- **Read the relevant submodule's AGENTS.md before working in that directory**
- Don't present action plans until requested; don't change test scripts unless asked
- **Release notes:** Read `release.txt` for last version tag, then `git log <tag>..HEAD --oneline --no-merges` and `git diff --stat <tag>..HEAD`. Output short grouped bullets to console (don't write files).

## Project Overview
Vox Deorum — LLM-Enhanced AI for Civilization V (Community Patch framework).

### Architecture
Each component has its own AGENTS.md with detailed patterns.

1. **Community Patch DLL** (`civ5-dll/`) — C++ DLL with named pipe IPC
   - Build & Deploy: `powershell -Command "& .\build-and-copy.bat"` (from `civ5-dll/`)
2. **Bridge Service** (`bridge-service/`) — REST/SSE bridge between Civ V and AI
3. **MCP Server** (`mcp-server/`) — MCP tools + SQLite game data access (Kysely)
4. **Vox Agents** (`vox-agents/`) — LLM-powered strategic AI framework
5. **Civ 5 Mod** (`civ5-mod/`) — Lua hooks and UI for game integration

```
Civ 5 ↔ DLL ↔ Bridge Service ↔ MCP Server ↔ Vox Agents → LLM
     (Named Pipe) (REST/SSE)    (MCP/HTTP)     (LLMs)
```

## Cross-Cutting Code Rules
- **ESM everywhere** — all TS modules use `"type": "module"` with `.js` import extensions
- **npm workspaces** — root `package.json` owns shared dependencies. Always `npm install <pkg>` from the repo root, not from a workspace (`vox-agents/`, `bridge-service/`, `mcp-server/`). Sub-package `package.json` files stay minimal — workspace hoisting resolves the dep. Use `npm install` / `npm run build:all` / `npm run test:all` from root.
- **Vitest** for all TypeScript testing
- **camelCase for exported constants** (e.g., `export const apiKeyFields`, not `API_KEY_FIELDS`)
- **Winston logger only** — never `console.log/error/warn` in production code (OK in tests)
- **Acceptable `any` usage**: Kysely dynamic queries, Lua/game data boundaries, `Player${i}` access, third-party interop, arbitrary JSON
- Express route responses: union with `ErrorResponse` instead of casting `as any`
- Backend sends complete data; frontend decides formatting
- Use `// Vox Deorum:` prefix for C++ modifications outside CvConnectionService
- Update existing docs after implementation; never create docs proactively; no concrete code in docs
- **Comment everywhere** - Every function, at least, needs to be commented


## Key Files
`protocol.md` | `*/AGENTS.md` | `*/tests/setup.ts` | `*/src/config.ts` | `*/vitest.config.ts`