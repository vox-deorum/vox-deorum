# Plan 5: live publication, save persistence, and game reader

**Status: draft.** For developers integrating the newspaper after the offline evaluation gate in [the roadmap](../implementation.md). Recheck the named source files before implementation; this stage depends on the measured renderer and accepted editorial configuration.

## Goal and success criteria

Human civilizations receive background publications without requiring an LLM strategist. A dedicated Newspaper page in the VD UI lets the player enable or disable background scheduling, inspect status and errors, browse historical issues for the current campaign and receiver from the reconciled MCP mirror, open the shared browser reader, and open an issue in the game. Saving and loading restores their issue archive, current votes, preferences, series memory, and publication cursor. The game reader uses Plan 1's texture viewer and remains readable while MCP or the renderer is unavailable.

## Current state

| Existing source | Implication |
| --- | --- |
| `mcp-server/src/knowledge/manager.ts`, `store.ts` | Live events and knowledge persistence exist; reconnect cleanup does not establish full historical rewind. |
| `mcp-server/src/knowledge/getters/player-summary.ts`, `city-information.ts`, `victory-progress.ts` | Collection is tied to existing getter use. Newspaper snapshots need explicit collection for human play. |
| `mcp-server/lua/get-player-summary.lua`, `get-city-information.lua`, `game-identity.lua` | Existing values, visibility, and campaign UUID. Structured reporting provenance and branch identity are incomplete. |
| `vox-agents/src/strategist/session/strategist-session.ts`, `strategist/seats/vox-player.ts` | Existing notification and timeline-reset precedents. The newspaper lifecycle must also run without a strategist session. |
| `vox-agents/src/newspaper/export/{service,http}.ts`, `vox-agents/ui/src/views/DebugView.vue` | The normal VD server hosts the reader and export service, and Debug can display a proof issue in the game. Scheduling, the Newspaper page, and the live archive are not implemented. |
| `civ5-mod/UI/Diplomacy/VoxDeorumDiploTransport.lua`, `civ5-mod/UI/Shared/VoxDeorumSeat.lua` | Asynchronous UI transport and effective-seat identity. A pure observer has no receiving publication by default. |
| `civ5-dll/CvGameCoreDLL_Expansion2/Lua/CvLuaPlayer.cpp`, `CvPlayer.cpp` | Player script data has Lua access and participates in player save serialization. Archive volume and coexistence need a proof. |

The [UI research](../research/research-ui.md) distinguishes save-backed reading from an MCP query and describes the 65,536-byte JSON memory pool that limits outbound Lua events. Measure batch limits for issues and render manifests separately in each direction.

## Approach and durable state

Reuse the evidence, editor, publication store, renderer, and action contracts. Add live adapters around them. Keep game transport in MCP through its `BridgeManager`; keep editorial orchestration in Vox Agents. The shared renderer continues to render locally through installed Edge or Chrome.

Add one Newspaper page to the existing VD UI and router. It reads scheduler state and the reconciled archive through VD server routes and reuses `export/service.ts` and `export/http.ts`. The page starts no second server or browser host. Its schedule toggle changes a backend setting; votes and preferences remain save-owned and appear read-only in the browser reader.

The **publication checkpoint** includes schema version, campaign and receiver, checkpoint/commit identity, saved revision, last completed check, issues and their presentation choices, series state, current votes, preferences, unread position, and compact decision records. Decision records retain random seeds, recorded choices, evidence summaries/references, configuration version/hash, and the feedback inputs/coefficients required to inspect the decision. Full LLM requests and responses can remain in backend diagnostics. Preferences and their precedence follow Plan 3. Loading establishes a new in-memory generation epoch; all outstanding work carries that epoch and is discarded if it no longer matches. Turn numbers alone cannot distinguish two branches from the same save.

Offline replay keeps Plan 3's local SQLite store. Live mode uses the planned `live/mcp-store.ts` adapter in Vox Agents and a publication mirror under `mcp-server/src/newspaper/`. Add `NewspaperCheckpoints` for the current receiver checkpoint and `NewspaperIssues` for immutable issue documents, cutoffs, evidence/decision records, and archive index fields. The per-game database supplies campaign scope; receiver and checkpoint lineage distinguish histories. MCP updates these tables from acknowledged game-owned state through `newspaper/mirror.ts`, on the existing knowledge-store connection and serialized `runWriteTransaction` queue. The in-game archive reads the save directly; the live browser archive reads this mirror only after checkpoint reconciliation. During live play the browser archive is read-only. Votes and preference changes happen in the game reader, which keeps the game checkpoint as the single place where feedback is written.

Use namespaced player script data as the first save-storage candidate, preserving unrelated script data. Prove serialization, capacity, and coexistence before committing to the representation. If its measured limits are unsuitable, replace that storage adapter with dedicated DLL save serialization. `Modding.OpenSaveData()` requires its own save-rollback proof before it could substitute for either option.

## Planned ownership

These are implementation targets in the existing workspaces, extending the contracts and adapters introduced by earlier stages. Agents paths are relative to `vox-agents/src/`, MCP paths to `mcp-server/src/`, and Mod paths to `civ5-mod/`; browser paths are written in full. Unqualified backend paths in the steps use `vox-agents/src/newspaper/` unless an MCP owner is named.

| Owner | Responsibility |
| --- | --- |
| Agents `newspaper/live/{lifecycle,scheduler,mcp-store}.ts` | Lifecycle independent of strategist assignment, completed-turn scheduling, and reconciled MCP persistence adapter. |
| Agents `newspaper/contracts/checkpoint.ts` | Durable checkpoint schema, version, and migrations, shared with the early save-capacity proof. Other serialized contracts remain runtime-independent and infer types from schemas. |
| MCP `newspaper/protocol.ts` | Canonical envelopes, IDs, revisions, and archive query/index schemas; browser-safe and independent of Agents. |
| MCP `newspaper/{mirror,transport}.ts` | Mirror reconciliation on the existing knowledge-store connection through its serialized `runWriteTransaction` queue; BridgeManager transport and bounded batches. |
| MCP `knowledge/newspaper-collection.ts`, `knowledge/schema/newspaper.ts` | Human-play collection and publication table schemas/setup, with explicit upgrades for existing databases. |
| MCP `newspaper/projection.ts` | Single owner of visibility, field selection, and reporting grants from Stage 2; extend it without a separate reporting policy module. |
| Agents `newspaper/export/{service,http}.ts` | Stage 1 export service owns bundle queues, pins, and releases; HTTP composition accepts injected routes. Live adapters translate transport rather than duplicate this lifecycle. |
| VD UI `ui/src/views/NewspaperView.vue`, `ui/src/router/index.ts` | Dedicated Newspaper page for the scheduling toggle and status, current campaign and receiver archive list, shared browser reader, and open-in-game action. The toggle controls backend scheduling only. |
| Browser `vox-agents/newspaper/src/app/archive.ts` | Shared full archive UI; injected live read-only handlers use `live/mcp-store.ts` and shared archive contracts. Offline mutations remain in `replay/http.ts`. |
| Mod `UI/Newspaper/VoxDeorumNewspaperStore.lua`, `UI/Newspaper/VoxDeorumNewspaperTransport.lua` | Live save store and transport beside Stage 1 reader files, replacing its mock; Lua validates commits before acknowledgement. |

MCP validates transport envelopes and queryable index fields while treating serialized publication payloads as opaque. Vox Agents validates publication payloads; Lua validates the game commit. This keeps MCP independent of the Agents editor and renderer runtime.

## Ordered implementation

### 1. Prove save restoration before wiring generation

The [roadmap](../implementation.md) keeps this proof open before Plan 3 fixes durable formats. Use the existing fixture issue contract and feed the measured limits back into `IssueDocument` and decision records.

Define the durable version and migrations in `contracts/checkpoint.ts` and implement the candidate Lua store in `civ5-mod/UI/Newspaper/VoxDeorumNewspaperStore.lua` for this proof. Build a fixture archive with many issues, long text, changed votes, preferences, and different designs. Save it, mutate it, then reload the earlier save and check that every field returns to the saved revision. Include two saves at the same game turn and different campaign files. Measure serialization time, save growth, and load time at a late-campaign archive size.

Keep article text, links, evidence summaries, and editorial state in the save. Store cache identities and presentation choices, with absolute paths resolved locally. A missing texture uses the basic text view established in Plan 1. Rendering later restores the saved design/layout using compatible versioned assets; it never changes the article. Include a save-schema version and a defined migration path for future releases.

### 2. Collect completed-turn evidence for human civilizations

Add `mcp-server/src/knowledge/newspaper-collection.ts`, schema/setup changes in `knowledge/schema/newspaper.ts`, and the Agents `newspaper/live/mcp-store.ts` adapter. Select a verified completed-turn boundary from the actual event flow; collect the required summaries, cities, contact, and event references before exposing that cutoff to generation. Carry the observed turn and known-by turn explicitly. If the game advances during collection, discard that incomplete capture and establish a new valid boundary. Never relabel later observations as facts from the missed cutoff.

Reuse the existing dated summary, city, and event tables. Extend collection only where a chosen story or reporting rule needs missing facts, such as structured route endpoints or spy permissions. Older databases remain readable; adding fields cannot rely on `CREATE TABLE IF NOT EXISTS` migrating existing tables.

Expose Plan 2's historical queries through an MCP `get-newspaper-evidence` tool with receiver, expected epoch/checkpoint, previous check, completed cutoff, and required comparison range. Return selected records and their source references using the same queries and field selection as standalone evaluation. Reject unavailable or mismatched boundaries; do not fall back to live getters for an older cutoff. Register it through `mcp-server/src/tools/index.ts`. Vox Agents calls it through the existing MCP client during live play.

### 3. Define and implement live reporting grants

Extend the existing `newspaper/projection.ts` policy owner rather than creating a second reporting policy. Before extending field selection, write one versioned matrix naming fields, locations, strength conditions, freshness, and historical periods for each new source. Preserve Plan 2's existing recorded-access rules unless deliberately changed. Own outgoing routes are the initial proposed source for civilian destination-city reports; incoming routes initially contribute the reader's own trade facts. This directional choice is a draft product decision to confirm at this stage.

For espionage, inspect the actual Lua bindings and distinguish rank, network points, surveillance, diplomat role, and city-screen permission. Define explicit increasing field tiers from inputs actually collected. Do not reuse the existing 200/500/800 national diplomat gates as city-news tiers. Resolve the documented `DiplomatPoints` producer/consumer mismatch if that signal is selected. Record each granted observation's source and acquisition turn, including any intentionally granted retrospective period.

### 4. Add lifecycle and background scheduling

Add `live/lifecycle.ts` and `live/scheduler.ts` under `vox-agents/src/newspaper/`, and expose their start/stop/status through the existing application lifecycle and VD server routes. Use existing MCP notification/client patterns, but make startup independent of strategist player assignment. Refresh required observations even in a game whose civilizations all use ordinary game AI except for the human reader.

The Newspaper page enables or disables background scheduling for the current receiver. The toggle changes backend scheduling only; votes and preferences remain game-owned. Show running, disabled, and error states with the last completed check, and keep a failed check from stopping later checks.

Schedule every configured number of completed turns, scaled by game speed. Persist skipped checks as well as published ones. Capture an immutable evidence window and publication revision before generation. Serialize checks per receiving civilization, cancel obsolete jobs on load/game switch, and reject stale results before publication. Never let image generation block the game turn. If rendering fails, a valid issue may publish with the basic text presentation and acquire textures later.

### 5. Commit to the game and reconcile MCP

Implement `VoxDeorumNewspaperStore.lua` and `VoxDeorumNewspaperTransport.lua` under `civ5-mod/UI/Newspaper/`, where Plan 1 already places the reader files, replacing its mock. MCP `newspaper/transport.ts` owns BridgeManager calls and batching; `protocol.ts` owns their canonical envelopes. Transfer issues and state in bounded batches identified by campaign, receiver, epoch, request, base checkpoint revision, and a unique commit ID. Stage the full batch in memory, validate it, then update the game-owned checkpoint atomically before acknowledging publication. Repeating a committed ID must return the prior result rather than duplicate an issue. Reused turn or revision numbers on another save branch must never identify the same commit.

Require the commit's base revision to match the game checkpoint. If a vote or preference changed while generation was running, reject the stale proposal, refresh publication state, and repeat that uncommitted check. Do not overwrite newer feedback with the editor's earlier snapshot. Loading creates a new game-owned epoch shared with the service before it can submit work.

Treat unacknowledged backend output as pending. On reconnection or an uncertain acknowledgement, query the game checkpoint before retrying. Votes and preferences update game-owned state first, including while the service is offline; synchronize by revision on reconnect. The renderer cache never determines whether an issue exists.

Define MCP publication read/sync operations for the live adapter: read a reconciled checkpoint or bounded issue list, and synchronize an acknowledged checkpoint obtained from the game transport. The sync operation updates the checkpoint row and issue mirror in one transaction, removes issues absent from the restored save, and refuses stale epochs. It indexes the serialized documents without importing Vox Agents' renderer/editor runtime. Live mode must not also write an independent authoritative copy through the offline SQLite store.

The Newspaper page reads historical issues for the current campaign and receiver from this reconciled mirror. Switching the loaded campaign or receiver changes the list, and rows from a discarded branch never appear.

On load, cancel old jobs, restore game state, and replace MCP's publication mirror from the saved checkpoint. Reconcile the observation timeline too: exclude all discarded-future rows, including same-turn branch data. Resume from a fresh confirmed snapshot when historical lineage is insufficient. Keep unrelated knowledge/history outside this adapter's ownership intact.

### 6. Add the Newspaper page and finish the player interface

Add a dedicated Newspaper page to the VD UI router. It enables or disables background scheduling for the current receiver, shows scheduler status and errors, and lists historical issues for the current campaign and receiver from the reconciled MCP mirror. Each issue opens in the shared browser reader or in the game. The browser reader stays read-only for votes and preferences; those remain game-owned and change in the game reader. Reuse the existing VD server, `export/service.ts`, and `export/http.ts`.

Add the discreet in-game unread entry, archive filters, earlier-report navigation, publication-frequency and LLM settings, and link resolution against current game identity. Use `VoxDeorumSeat.EffectiveSeat()` for publication ownership. Verify that delayed replies after seat changes cannot populate another reader. Keep the archive in a standard surrounding interface and open each issue with its saved design and page order.

Use the existing `export/service.ts` for bundle queuing, pins, and releases; live transport translates game requests into that service. Inject live read-only archive handlers into `export/http.ts`, backed by `live/mcp-store.ts` and shared archive contracts; reuse `app/archive.ts` without live mutation endpoints. Deliver render bundles to the game through the same transport. Render bundles are cache data and stay out of the save, so the viewer requests them:

1. When the viewer opens, and whenever the game window or UI scale changes, it reports its viewport size and UI scale. The service selects the matching supported `RenderProfile`.
2. To open an issue, the viewer requests its bundle by issue ID and profile. If the local cache has a valid bundle, the service returns it at once. Otherwise it queues a render and answers with a pending status, and the viewer shows the basic text view until the bundle arrives.
3. The service sends the manifest (strip asset IDs, CSS dimensions, and action rectangles) in bounded batches tagged with epoch, issue, and profile. The viewer discards batches for another epoch, issue, or profile, and assembles a manifest only when every batch has arrived.
4. This request path also covers a save loaded on another machine, a deleted cache, and a changed render profile. Text already in the save stays readable whenever regeneration is unavailable.

Then complete the cache pin/release handshake that Plan 1 deferred. The viewer pins the bundle it displays and releases its textures before acknowledging a replacement or closing. After a backend restart, reconcile pins with the viewer before any cleanup. After a confirmed game-process exit, remove orphan pins. While viewer state is unknown, suspend eviction, and refuse new exports if the cache budget cannot be kept. Add the safe local availability check from Plan 1 and resolve asset paths on the current machine. Load and release only the needed texture strips.

When implementing this stage, update affected component `AGENTS.md` guidance and `docs/developers/vox-agents/newspaper/live-integration.md`, alongside installation and player/developer documentation for browser detection, optional renderer capability, source-build converter setup, cache location/limits, save portability, and the newspaper controls. Ship only production dependencies and assets. Recheck Plan 1's footprint measurements against the final catalogue.

## Verification

Place Agents coverage under `tests/mock/newspaper/{live,contracts,export}`, UI coverage under `vox-agents/ui/tests/mock/`, and MCP coverage under `tests/newspaper/`. Include shared checkpoint fixtures for Lua/TypeScript schema migration compatibility. Use Vitest for completed-turn boundaries, queued checks, skipped periods, duplicate deliveries, partial batches, lost acknowledgements, stale epochs, mirror replacement, source-policy projection, the page's scheduling controls and read-only archive, and render bundle requests with pending, partial, and stale manifest batches. Test a save load while an LLM call and a texture export are pending. Run focused tests in both `vox-agents` and `mcp-server`, their type checks, then root `npm run build:all` and `npm run test:all`.

Deploy the mod using its documented script. Build/deploy the DLL only if the chosen persistence or file-check adapter changes it. Exercise a human-only live game, save/reload, same-turn branches, campaign switches, observer/effective-seat behavior, disconnected MCP, missing browser, deleted cache, and a save copied to another machine. Check that offline votes survive loading and synchronize correctly afterward.

Use the retained rendering and reading fixtures to verify text quality, popup interaction, old-city links, large archives, and bounded memory/cache growth. Record the exact game/VP build and supported renderer; expand beyond DX11 only after a corresponding game test.

## Risks and open questions

Save capacity/coexistence, the exact completed-turn collection barrier, and the live espionage field matrix are explicit proof or design tasks at the start of their steps. They must be resolved before the dependent code is implemented. Existing recordings cannot establish all of them.

## Out of scope

Strategist consumption of newspapers, multiplayer guarantees beyond validated seat behavior, full foreign intelligence reconstruction for old recordings, and the later media/gameplay extensions listed in the roadmap.
