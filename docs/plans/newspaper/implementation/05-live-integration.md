# Plan 5: live publication, MCP storage, and game reader

**Status: draft.** For developers integrating the newspaper after the offline evaluation gate in [the roadmap](../implementation.md). Recheck the named source files before implementation; this stage depends on the measured renderer and accepted editorial configuration.

## Goal and success criteria

Human civilizations receive background publications without requiring an LLM strategist. A Newspaper page in the VD UI shows scheduling controls, status, errors, and the current archive, with options to read in the browser or in game. MCP's per-game SQLite database stores the archive and editorial state. Each receiving civilization's game save data adds only a fixed-size checkpoint ID. With the matching database, loading restores the archive, votes, preferences, series memory, and publication cursor as of that checkpoint.

## Current state

| Existing source | Implication |
| --- | --- |
| `mcp-server/src/knowledge/manager.ts`, `store.ts` | The manager opens a per-game SQLite database. Same-campaign loads can leave the tracked turn stale, and reconnect cleanup can remove event rows whose IDs are reused. |
| `mcp-server/src/knowledge/getters/player-summary.ts`, `city-information.ts`, `victory-progress.ts` | Collection is tied to existing getter use. Newspaper snapshots need explicit collection for human play. |
| `mcp-server/lua/get-player-summary.lua`, `get-city-information.lua`, `game-identity.lua` | Existing values, visibility, and campaign UUID. Structured reporting provenance and branch identity are incomplete. |
| `vox-agents/src/strategist/session/strategist-session.ts`, `strategist/seats/vox-player.ts` | Existing notification and timeline-reset precedents. The newspaper lifecycle must also run without a strategist session. |
| `vox-agents/src/newspaper/export/{service,http}.ts`, `vox-agents/ui/src/views/DebugView.vue` | The normal VD server hosts the reader and export service, and Debug can display a proof issue in the game. Scheduling, the Newspaper page, and the live archive are not implemented. |
| `civ5-mod/UI/Diplomacy/VoxDeorumDiploTransport.lua`, `civ5-mod/UI/Shared/VoxDeorumSeat.lua` | Asynchronous UI transport and effective-seat identity. A pure observer has no receiving publication by default. |
| `mcp-server/src/tools/knowledge/get-newspaper-evidence.ts` | The evidence tool already uses the shared historical query. Live scheduling needs verified cutoff and timeline scope. |
| `civ5-dll/CvGameCoreDLL_Expansion2/CvGame.cpp` | The save visitor includes the game save database. `DoGameStarted` already resets recording capture on game start/load; verify that this boundary also covers newspaper reloads. |

The [UI research](../research/research-ui.md) describes the 65,536-byte JSON memory pool that limits outbound Lua events. Measure limits for issue delivery and render manifests separately from Lua requests.

## Approach and durable state

Reuse the evidence, editorial state, issue, and reader contracts. MCP handles game transport through `BridgeManager`; Vox Agents runs the editor and renders locally through installed Edge or Chrome.

**MCP owns the live archive.** Store immutable issue documents (including prose, links, page order, and presentation snapshots), completed checks and skips, evidence summaries, and compact decision records. Decision records retain seeds, choices, source references, configuration version/hash, and feedback inputs. Full LLM requests and responses can remain in diagnostics. Each change creates a checkpoint with a parent ID, publication cursor, series memory, votes, preferences, and unread position. Build the issue history from that lineage instead of copying it into every checkpoint.

**The game save stores a reference.** Reuse the existing campaign and player identity. Add one opaque 128-bit checkpoint ID per receiving player. The ID selects a durable MCP revision. Loading an older reference keeps later checkpoints in SQLite for other saves and excludes their issues and feedback from the loaded branch. Use a fresh runtime epoch on load, even if campaign, turn, and checkpoint ID match a prior session.

Offline replay keeps Plan 3's separate SQLite output. The live browser reader is read-only; in-game votes and preferences go through MCP. Rendered textures and interaction maps stay in the local cache. Native text works whenever MCP can serve the issue, even without a browser or textures. During a disconnection, keep the open issue readable in memory and disable feedback until reconnection. To move the archive, pair the save with a SQLite backup of the campaign database.

## Planned ownership

These are implementation targets in the existing workspaces, extending the contracts and adapters introduced by earlier stages. Agents paths are relative to `vox-agents/src/`, MCP paths to `mcp-server/src/`, and Mod paths to `civ5-mod/`; browser paths are written in full. Unqualified backend paths in the steps use `vox-agents/src/newspaper/` unless an MCP owner is named.

| Owner | Responsibility |
| --- | --- |
| Agents `newspaper/live/{lifecycle,scheduler,mcp-store}.ts` | Lifecycle independent of strategist assignment, completed-turn scheduling, and reconciled MCP persistence adapter. |
| Agents `newspaper/contracts/publication.ts` | Versioned editorial state validated by the editor. Extend it only where live state needs new fields. |
| MCP `newspaper/protocol.ts` | Canonical envelopes, IDs, revisions, and archive query/index schemas; browser-safe and independent of Agents. |
| MCP `newspaper/{store,transport}.ts` | Durable revisions and archive reads on the existing knowledge-store connection through its serialized `runWriteTransaction` queue; BridgeManager transport and bounded batches. |
| MCP `knowledge/newspaper-collection.ts`, `knowledge/schema/newspaper.ts` | Human-play collection and publication table schemas/setup, with explicit upgrades for existing databases. |
| MCP `newspaper/projection.ts` | Single owner of visibility, field selection, and reporting grants from Stage 2; extend it without a separate reporting policy module. |
| Agents `newspaper/export/{service,http}.ts` | Stage 1 export service owns bundle queues, pins, and releases; HTTP composition accepts injected routes. Live adapters translate transport rather than duplicate this lifecycle. |
| VD UI `ui/src/views/NewspaperView.vue`, `ui/src/router/index.ts` | Dedicated Newspaper page for the scheduling toggle and status, current campaign and receiver archive list, shared browser reader, and open-in-game action. The toggle controls backend scheduling only. |
| Browser `vox-agents/newspaper/src/app/archive.ts` | Shared full archive UI; injected live read-only handlers use `live/mcp-store.ts` and shared archive contracts. Offline mutations remain in `replay/http.ts`. |
| Mod `UI/Newspaper/VoxDeorumNewspaperCheckpoint.lua`, `UI/Newspaper/VoxDeorumNewspaperTransport.lua` | Read and update the small save reference; request archives and submit feedback beside Stage 1 reader files, replacing the mock. |

MCP validates transport envelopes and queryable index fields while treating serialized editorial payloads as opaque. Vox Agents validates issue and editorial contracts. Lua validates checkpoint identity and delivered reader data. MCP stays independent of the Agents editor and renderer.

## Ordered implementation

### 1. Prove checkpoint restoration with the MCP store

Add `NewspaperCheckpoints`, `NewspaperChecks`, and `NewspaperIssues` to the per-game knowledge database through explicit schema upgrades. Index checkpoint identity and parent by receiver, and associate checks and issues with the checkpoint that introduced them. Give each new issue a unique identity across forks, even when the receiver and cutoff match. Use representative generated archives and fixtures to measure database growth and lookup time. Preserve revisions that an old save may still reference.

Use `Modding.OpenSaveData()` as the first choice, following `mcp-server/lua/game-identity.lua`. Add a namespaced key per receiver to its existing `Deorum` table, with the ID encoded as 32 hex characters and no row before the first checkpoint. Install IDs during play so serialization needs no backend call. Verify the stored value length and round-trip it through first, manual, and automatic saves, including two same-turn saves. If that API fails rollback or coexistence tests, prove a dedicated versioned DLL field with an empty default for older saves before building the live adapter.

Test an older save after publishing another issue and changing feedback, then load the newer save to confirm its branch remains available. With no reference, start an empty newspaper history. With a reference and an absent database, a database open error, or a missing revision, show the specific error and suspend newspaper writes for that receiver. Check whether the campaign database existed before normal knowledge initialization creates an empty file. Keep the reference intact. Restore a matching database with MCP stopped, then reopen the campaign.

At the load boundary, establish a game-generated epoch that lives only in memory and changes on every start/load. Verify the existing game-start path or add the signal to the DLL. Clear the old reader view and invalidate the old epoch before handling new requests. MCP reads the epoch, campaign, turn, and receiver references before opening live reads or writes, and resets its tracked turn even for the same campaign. The game rejects installs until a handshake binds them to this epoch. On reconnect, repeat the handshake before serving the active archive.

### 2. Collect completed-turn evidence for human civilizations

Add `mcp-server/src/knowledge/newspaper-collection.ts`, schema/setup changes in `knowledge/schema/newspaper.ts`, and the Agents `newspaper/live/mcp-store.ts` adapter. Select a verified completed-turn boundary from the actual event flow; collect the required summaries, cities, contact, and event references before exposing that cutoff to generation. Carry the observed turn and known-by turn explicitly. If the game advances during collection, discard that incomplete capture and establish a new valid boundary. Never relabel later observations as facts from the missed cutoff.

Reuse the existing collectors and field shapes. Record live newspaper observations with the epoch of their capture, including events, so the live query cannot mix evidence across loads. On a new epoch, build comparisons from fresh confirmed observations; skip checks that need an unavailable prior window. Extend collection only where a story or reporting rule needs more facts, such as structured route endpoints or spy permissions.

Extend the existing `get-newspaper-evidence` path to verify receiver, expected epoch/checkpoint, previous check, completed cutoff, and required comparison range for live requests. Reuse existing projection and keep offline queries compatible. Keep cited evidence summaries and their epoch with the issue, so audits do not depend on rows that reconnect cleanup can delete or reuse. Leave that cleanup and unrelated knowledge history outside the newspaper adapter.

### 3. Define and implement live reporting grants

Extend the existing `newspaper/projection.ts` policy owner rather than creating a second reporting policy. Before extending field selection, write one versioned matrix naming fields, locations, strength conditions, freshness, and historical periods for each new source. Preserve Plan 2's existing recorded-access rules unless deliberately changed. Own outgoing routes are the initial proposed source for civilian destination-city reports; incoming routes initially contribute the reader's own trade facts. This directional choice is a draft product decision to confirm at this stage.

For espionage, inspect the actual Lua bindings and distinguish rank, network points, surveillance, diplomat role, and city-screen permission. Define explicit increasing field tiers from inputs actually collected. Do not reuse the existing 200/500/800 national diplomat gates as city-news tiers. Resolve the documented `DiplomatPoints` producer/consumer mismatch if that signal is selected. Record each granted observation's source and acquisition turn, including any intentionally granted retrospective period.

### 4. Add lifecycle and background scheduling

Add `live/lifecycle.ts` and `live/scheduler.ts` under `vox-agents/src/newspaper/`, and expose their start/stop/status through the existing application lifecycle and VD server routes. Use existing MCP notification/client patterns, but make startup independent of strategist player assignment. Refresh required observations even in a game whose civilizations all use ordinary game AI except for the human reader.

The Newspaper page enables or disables background scheduling for the current receiver. The toggle changes a backend setting. Show running, disabled, and error states with the last completed check, and keep a failed check from stopping later checks.

Schedule every configured number of completed turns, scaled by game speed. Persist skipped checks as well as published ones. Capture an immutable evidence window and publication revision before generation. Serialize checks per receiving civilization, cancel obsolete jobs on load/game switch, and reject stale results before publication. Never let image generation block the game turn. If rendering fails, a valid issue may publish with the basic text presentation and acquire textures later.

### 5. Commit revisions in MCP and install the save reference

Expose MCP operations for the active checkpoint, bounded archive lists and issue reads, publication commits, votes, preferences, and read position. Mutations carry campaign, receiver, runtime epoch, expected checkpoint ID, and a unique operation ID. Serialize mutations and installs per receiver. In one SQLite transaction, record the operation result and the new immutable checkpoint, along with any check, issue, or decision it introduced. A retry in the same scope reuses the recorded result and completes any pending install. If feedback advances the checkpoint while a check runs, rerun the check against the new state before committing.

After SQLite commits, send the game only the new ID and its expected previous ID, scoped to the campaign, receiver, and epoch. The game installs it only if that scope and previous ID still match. Retrying an already installed ID is safe. Update the player's view and acknowledge the change only once installation is confirmed. A save taken during a pending install captures whichever ID was installed when the game serialized it. Both revisions are already durable when the new ID is sent.

On reconnect or lost acknowledgement, read the game's current ID before retrying. If it already holds the new ID, use that revision. Retry a pending install only in the same verified epoch and with the same base ID. On load, retire the old epoch, cancel jobs and pending installs, and read the archive at the loaded ID before resuming. Never select a revision just because it is the latest in SQLite or shares the loaded turn.

### 6. Add the Newspaper page and finish the player interface

Add the Newspaper page to the existing VD UI router. The page reads scheduler status and the active archive from MCP through VD server routes. Each issue opens in the shared browser reader or in game. Submit live votes and preferences from the game reader and show success once MCP has recorded the change and the game has installed its ID.

Add the discreet in-game unread entry, archive filters, earlier-report navigation, publication-frequency and LLM settings, and link resolution against current game identity. Use `VoxDeorumSeat.EffectiveSeat()` for publication ownership. Verify that delayed replies after seat changes cannot populate another reader. Keep the archive in a standard surrounding interface and open each issue with its saved design and page order.

Use the existing `export/service.ts` for bundle queuing, pins, and releases. Inject live read-only archive handlers into `export/http.ts`, backed by `live/mcp-store.ts` and the shared archive contracts. MCP serves the in-game reader bounded archive pages and the selected issue's text and supported actions. Tag batches with campaign, receiver, epoch, selected checkpoint, and request; discard stale or incomplete deliveries. The texture request is separate:

1. When the viewer opens, and whenever the game window or UI scale changes, it reports its viewport size and UI scale. The service selects the matching supported `RenderProfile`.
2. To open an issue, the viewer requests its bundle by issue ID and profile. If the local cache has a valid bundle, the service returns it at once. Otherwise it queues a render and answers with a pending status, and the viewer shows the basic text view until the bundle arrives.
3. The service sends the manifest (strip asset IDs, CSS dimensions, and action rectangles) in bounded batches tagged with epoch, issue, and profile. The viewer discards batches for another epoch, issue, or profile, and assembles a manifest only when every batch has arrived.
4. This request path also covers a deleted cache or a changed render profile. With the matching MCP database, a copied save can rebuild textures using the saved presentation and local assets. Without the database, show archive unavailability and retain the save reference.

Then complete the cache pin/release handshake that Plan 1 deferred. The viewer pins the bundle it displays and releases its textures before acknowledging a replacement or closing. After a backend restart, reconcile pins with the viewer before any cleanup. After a confirmed game-process exit, remove orphan pins. While viewer state is unknown, suspend eviction, and refuse new exports if the cache budget cannot be kept. Add the safe local availability check from Plan 1 and resolve asset paths on the current machine. Load and release only the needed texture strips.

When implementing this stage, update the component guides, [live integration guide](../../../developers/vox-agents/newspaper/live-integration.md), and player instructions for browser setup, cache limits, and controls. Document how to pair a save with a consistent campaign database backup. Reuse `snapshotDatabase` from `mcp-server/src/knowledge/helpers/archive.ts` so the backup includes recent writes still in SQLite's write-ahead log. Ship only production dependencies and assets, and recheck Plan 1's footprint.

## Verification

Place Agents coverage under `tests/mock/newspaper/{live,contracts,export}`, UI coverage under `vox-agents/ui/tests/mock/`, and MCP coverage under `tests/newspaper/`. Test database upgrades, SQLite rollback, checkpoint lineage, missing references, duplicate operations, saves during installation, lost acknowledgements and reconnects, stale epochs, completed-turn evidence, and partial or stale issue and manifest batches. Verify that sibling branches reusing the same event and turn IDs produce separate evidence and that both published issues remain inspectable. Load a save while an LLM call and texture export are pending. Run the focused tests and type checks in both workspaces, then root `npm run build:all` and `npm run test:all`.

Deploy the mod using its documented script and build/deploy the DLL if changed. Exercise human-only play, reloading an older turn in the same campaign, same-turn branches with both matching and different IDs, campaign and seat switches, disconnected MCP, missing browser, and deleted cache. Copy a save with and without the matching database backup, including a backup taken immediately after an acknowledged write. Verify that an open issue remains readable on disconnect and a vote cannot report success during the outage.

Use the retained rendering and reading fixtures to verify text quality, popup interaction, old-city links, large archives, and bounded memory/cache growth. Record the exact game/VP build and supported renderer; expand beyond DX11 only after a corresponding game test.

## Risks and open questions

Verify save-reference serialization, coexistence, and load detection before wiring live writes. Measure database growth and archive lookup time on long campaigns. The exact completed-turn collection barrier and the live espionage field matrix also need verification before their dependent steps.

## Out of scope

Archives carried inside save files, offline feedback writes, strategist consumption, multiplayer guarantees beyond validated seat behavior, full foreign intelligence reconstruction for old recordings, and the later media/gameplay extensions listed in the roadmap.
