# MCP Server Tool Reference

Concise reference for all 43 tools exposed by the MCP Server. Tools are organized by category and registered in `src/tools/index.ts`.

## Architecture

- All tools extend abstract base classes (`DatabaseQueryTool`, `LuaFunctionTool`, `ActionTool`, `DynamicEventTool`) or `ToolBase` directly
- Factory pattern with lazy loading -- tools instantiated on first server init, cached afterward
- Zod schemas for input/output validation with `.describe()` on each field
- PlayerID constraints vary by tool. Most major-civ tools accept 0-21 (`MaxMajorCivs - 1`). Transcript IDs are integers at least `-1`, the observer sentinel; archival writes also validate major civilizations and real observer slots. `set-relationship` accepts nonnegative IDs with no schema upper bound. `post-notification` accepts recipients 0-63 (`MaxPlayers - 1`), including observer slots.

## General Tools (3)

| Tool | Description | Key Input |
| --- | --- | --- |
| `lua-executor` | Executes raw Lua scripts in game context via Bridge Service | `Script`: string, `Description?`: string |
| `call-lua-function` | Calls a Lua function registered by the game mod with structured arguments | `Name`: string, `Args`: array, `ExpectedGameID?` |
| `search-database` | Fuzzy search across all database tools (techs, policies, buildings, projects, civs, units, flavors) with reciprocal rank fusion reranking | `Keywords`: string[], `MaxResults?`: number (default: 10) |

## Database Query Tools (9)

All extend `DatabaseQueryTool`. Common input: `Search?`: string (fuzzy match), `MaxResults?`: number (default: 20), `Detailed?`: boolean (default: false; return full details for every result). Returns full details automatically when search narrows to a single result.

| Tool | Description |
| --- | --- |
| `get-technology` | Technology info with prerequisites and unlocks, including projects |
| `get-policy` | Policy details, branch information, and any projects the policy unlocks |
| `get-building` | Building specifications and requirements |
| `get-project` | Project cost, prerequisites (technology, policy, finished policy branches, and other projects), era, unique civilization, victory, repeatability, and instance limits |
| `get-civilization` | Civilization traits and leader abilities |
| `get-unit` | Unit statistics, promotions, upgrades |
| `get-economic-strategies` | AI economic strategy info with production/overall flavors |
| `get-military-strategies` | AI military strategy info with production/overall flavors |
| `get-flavors` | Flavor descriptions for AI preference tuning |

## Knowledge Query Tools (13)

| Tool | Description | Key Input |
| --- | --- | --- |
| `get-events` | Recent game events, consolidated by turn with smart grouping | `Turn?`, `Type?`, `After?`, `Before?`, `PlayerID?`, `Original?` |
| `get-diplomatic-events` | Diplomatic events grouped by turn, including relayed reports. `OtherPlayerID` matches report sources, recipients, and subjects; formatted reports include subject names | `PlayerID`, `OtherPlayerID?`, `FromTurn?`, `ToTurn?`, `Formatted?` |
| `read-transcript` | Read the durable, append-ID-ordered conversation between two endpoints, optionally filtered by message type or speaker role, with optional older-page cursors | `PlayerAID`, `PlayerBID`, `MessageType?`, `Role?`, `BeforeID?`, `Limit?` |
| `inspect-deal` | Inspect a draft deal against live game state: per-item and per-promise legality with reasons, advisory values, advisory promise agreeability factors, each side's tradable range, and the pair's war status (`atWar`, `warLockTurns`) | `PlayerAID`, `PlayerBID`, `ProposedDeal?` |
| `get-players` | Player summary with scores, era, resources, military, and diplomatic opinions | `PlayerID?` (0-21) |
| `get-opinions` | Diplomatic opinions to/from a player with all alive major civilizations | `PlayerID` (0-21), `RevealAll?` |
| `get-cities` | City info from a player's perspective with visibility filtering | `PlayerID?` (0-21), `Owner?` |
| `get-game-settings` | Static game settings (speed, map, difficulty, victory types, etc.). With `PlayerID`, `YouAre` describes that player's civilization, including `PermanentTeammates` when it shares a team | `PlayerID?` |
| `get-metadata` | Read a metadata value by key from the knowledge store | `Key`: string |
| `get-options` | Available strategic options (techs, policies, strategies/flavors, persona) with current selections | `PlayerID` (0-21), `Mode?`: "Flavor" or "Strategy" |
| `summarize-units` | Unit overview grouped by civilization and AI type, with military stats | `PlayerID` |
| `get-military-report` | Military report with units by AI type and tactical zones. Counts nukes and support units (generals, admirals, siege towers) alongside combat units | `PlayerID` (0-21) |
| `get-victory-progress` | Victory progress for all players, filtered by diplomatic visibility | `PlayerID?` (0-21) |

For paged `read-transcript` calls, `hasMore` and `NextBeforeID` describe the raw ID scan before the optional `Role` filter. A filtered page can therefore contain no messages while `hasMore` is `true`.

## Action Tools (15)

Lua-backed steering tools and `post-notification` return `Success`, optional `Result`, and optional `Error` (`Code`, `Message`, optional `Details`). The eight steering tools share `Turn?`, defaulting to `-1` for the current turn. `set-metadata` and `present-decision` return plain booleans.

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `set-strategy` | Set grand, economic, and military strategies by name | `PlayerID`, `GrandStrategy?`, `EconomicStrategies?`: string[], `MilitaryStrategies?`: string[], `Rationale` |
| `set-persona` | Set any of 26 diplomatic personality fields, clamped to 1-10 | `PlayerID`, optional persona fields, `Rationale` |
| `set-relationship` | Set additive modifiers toward another major civ; positive values mean friendlier intent | `PlayerID`, `TargetID`, `Public?`, `Private?`, `Rationale` |
| `set-flavors` | Set tactical AI preferences, clamped to 0-100, and optional grand strategy | `PlayerID`, `GrandStrategy?`, `Flavors?`: record, `Rationale` |
| `unset-flavors` | Clear custom flavors and revert to defaults | `PlayerID` |
| `set-metadata` | Set a metadata key-value pair | `Key`, `Value`: strings |
| `set-research` | Set the next technology by name; `None` clears it | `PlayerID`, `Technology`, `Rationale` |
| `set-policy` | Set the next policy or branch by name; `None` clears it | `PlayerID`, `Policy`, `Rationale` |
| `keep-status-quo` | Reapply strategy or flavors with a rationale | `PlayerID`, `Mode?`: "Flavor" or "Strategy" (default), `Rationale` |
| [`relay-message`](#relay-message) | Store a report for a leader | Source, recipient, report, memo |
| [`append-message`](#append-message) | Archive a transcript message | Endpoints, speaker, type, content |
| [`enact-agent-deal`](#enact-agent-deal) | Enact a proposal and record its outcome | Proposal ID, optional acceptance details |
| [`reject-agent-deal`](#reject-agent-deal) | Reject or retract a proposal | Endpoints, proposal ID, speaker |
| [`post-notification`](#post-notification) | Post a native notification | Recipient, headline, body, optional counterpart |
| [`present-decision`](#present-decision) | Deliver options to the human-control panel | Player, optional turn |

`Public` and `Private` default to zero. Their documented range is -100 to 100; the tool accepts numbers without enforcing that range. See [diplomatic influence](influence/diplomacy.md) for persona fields and the current `DiplomaticBalance` setter mismatch.

### relay-message

Stores a report visible to the receiving leader. Returns `Success` with `EventID`, or an `Error`.

| Input | Contract |
| --- | --- |
| `PlayerID`, `FromPlayerID` | Recipient and source, 0-21. |
| `AboutPlayerIDs?` | Subject IDs, 0-21; omitted or empty means no subjects. |
| `Message` | `Diplomatic`, `Intelligence`, or `Rumor`. |
| `Content` | 1-4000 characters. |
| `Confidence` | 0-9. |
| `Importance` | 0-9; 7+ interrupts important-event pacing. |
| `Categories` | Array containing any of `Diplomacy`, `Military`, `Economy`, `Others`; may be empty. |
| `Memo` | 1-500 characters. |
| `MemoBy?` | `analyst` (default) or `diplomat`; sets memo attribution. |

Subject IDs are stored separately and resolved to names in formatted diplomatic history.

### append-message

Appends an archival transcript message and returns its canonical stored fields. Terminal answers (`deal-accept`, `deal-enacted`, `deal-reject`) must use the transactional tools below.

| Input | Contract |
| --- | --- |
| `PlayerAID`, `PlayerBID`, `SpeakerID` | Endpoints must differ; the speaker belongs to the pair. Supports observer endpoints. |
| `PlayerARole?`, `PlayerBRole?` | Endpoint roles; required except for the -1 observer sentinel. |
| `MessageType`, `Content` | Message type and free-text body. |
| `Payload?` | Metadata; proposals and counters require `Deal`. |
| `Turn?`, `ExpectedGameID?` | Optional turn and active-game identity guard. |

### enact-agent-deal

Enacts a stored proposal and records acceptance and enactment in one serialized store transaction.

| Input | Contract |
| --- | --- |
| `ProposalMessageID` | Proposal or counter to enact. |
| `Deal?` | Optional complete deal; its terms must match the stored proposal. |
| `AccepterID?` | Defaults to the proposal's recipient. |
| `Content?` | Optional acceptance line. |

Returns record IDs, full `AcceptRow`/`EnactedRow` projections, and `AlreadyEnacted`/`Enacted` status. A repeat returns the existing enactment without new writes. A moved proposal state returns `Conflict` with reason `superseded`, `answered`, or `wrong-recipient`; enactment does not run.

### reject-agent-deal

Rejects or retracts an open proposal transactionally. Either endpoint may reject; the proposer doing so retracts it.

| Input | Contract |
| --- | --- |
| `PlayerAID`, `PlayerBID` | Expected conversation endpoints. |
| `ProposalMessageID`, `SpeakerID` | Proposal to reject and the endpoint speaking. |
| `Content?`, `ExpectedGameID?` | Optional rejection line and active-game identity guard. |

Returns `rejected` or `already-rejected` with the exact durable `Row`; a repeated rejection by the same speaker creates no second row. A `conflict` has reason `not-found`, `not-a-proposal`, `superseded`, `rejected-by-other`, or `answered`.

### post-notification

Posts a native in-game notification. Its bridge envelope's `Result` is `true` when Civ V creates it and `false` when Civ V rejects it.

| Input | Contract |
| --- | --- |
| `PlayerID` | Integer recipient, 0-63, including observer slots. |
| `CounterpartID?` | Integer major civ, 0-21, different from `PlayerID`. |
| `Summary` | Nonblank, 1-200 characters; uses the highlighted headline style. |
| `Message` | Nonblank, 1-2000 characters; truncated to 400 including `...`. |

With a counterpart, clicking opens the conversation; otherwise it shows the message in a dialog. Notifications for a seat currently controlled by a pinned observer are redirected to that observer, since Civ V displays notifications for the active player.

### present-decision

Presents current Flavor-mode options to the in-game human-control panel. Returns whether delivery succeeded.

| Input      | Contract                         |
| ---------- | -------------------------------- |
| `PlayerID` | Human strategist's player, 0-21. |
| `Turn?`    | Defaults to the current turn.    |

## Game Control Tools (3)

| Tool | Description | Key Input |
| --- | --- | --- |
| `pause-game` | Pause the game during a specific player's turn | `PlayerID` (0-21) |
| `resume-game` | Resume the game during a specific player's turn | `PlayerID` (0-21) |
| `set-production-mode` | Enable or disable the DLL's production mode (AI turn cooldown); returns whether the bridge update succeeded | `enabled`: boolean |

## Tool Development

### Creating a New Tool

1. Choose base class: `DatabaseQueryTool` (DB queries), `LuaFunctionTool` (game scripts), `DynamicEventTool` (custom events), or `ToolBase`
2. Create file in the appropriate `src/tools/` subdirectory
3. Use factory function pattern (export default function creating tool instance)
4. Define Zod schemas with `.describe()` on each field
5. Register in `src/tools/index.ts`

### Base Class Quick Guide

**DatabaseQueryTool\<TSummary, TFull\>** -- For querying Civ5 databases

- Implement `fetchSummaries()`: cached list of all items
- Implement `fetchFullInfo(identifier)`: detailed single item
- Automatic fuzzy matching via fast-fuzzy and caching
- Returns full details when search resolves to a single result

**LuaFunctionTool\<TResult\>** -- For executing Lua in game

- Set `scriptFile` for file-based scripts (in `lua/` directory) or `script` for inline
- Define `arguments` array matching Lua function parameters
- Access results via the `call()` method

**DynamicEventTool** -- For creating custom game events

- Set `eventType` for the event type stored in GameEvents
- Implement `buildPayload()` to construct enriched event data
- Events stored with visibility analysis via `composeVisibility()`
- Override `getVisiblePlayerIds()` for custom visibility rules
