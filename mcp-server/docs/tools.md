# MCP Server Tool Reference

Concise reference for all 41 tools exposed by the MCP Server. Tools are organized by category and registered in `src/tools/index.ts`.

## Architecture

- All tools extend abstract base classes (`DatabaseQueryTool`, `LuaFunctionTool`, `DynamicEventTool`) or `ToolBase` directly
- Factory pattern with lazy loading -- tools instantiated on first server init, cached afterward
- Zod schemas for input/output validation with `.describe()` on each field
- PlayerID range for major civs: 0-21 (`MaxMajorCivs - 1`)

## General Tools (3)

| Tool | Description | Key Input |
|------|-------------|-----------|
| `calculator` | Evaluates mathematical expressions using mathjs | `Expression`: string |
| `lua-executor` | Executes raw Lua scripts in game context via Bridge Service | `Script`: string, `Description?`: string |
| `search-database` | Fuzzy search across all database tools (techs, policies, buildings, civs, units, flavors) with reciprocal rank fusion reranking | `Keywords`: string[], `MaxResults?`: number (default: 10) |

## Database Query Tools (8)

All extend `DatabaseQueryTool`. Common input: `Search?`: string (fuzzy match), `MaxResults?`: number (default: 20). Returns full details automatically when search narrows to a single result.

| Tool | Description |
|------|-------------|
| `get-technology` | Technology info with prerequisites, unlocks |
| `get-policy` | Policy details and branch information |
| `get-building` | Building specifications and requirements |
| `get-civilization` | Civilization traits and leader abilities |
| `get-unit` | Unit statistics, promotions, upgrades |
| `get-economic-strategies` | AI economic strategy info with production/overall flavors |
| `get-military-strategies` | AI military strategy info with production/overall flavors |
| `get-flavors` | Flavor descriptions for AI preference tuning |

## Knowledge Query Tools (13)

| Tool | Description | Key Input |
|------|-------------|-----------|
| `get-events` | Recent game events, consolidated by turn with smart grouping | `Turn?`, `Type?`, `After?`, `Before?`, `PlayerID?`, `Original?` |
| `get-diplomatic-events` | Diplomatic events (wars, peace, deals, city-state, espionage, world congress) grouped by turn | `PlayerID`, `OtherPlayerID?`, `FromTurn?`, `ToTurn?`, `Formatted?` |
| `read-transcript` | Read the durable, append-ID-ordered conversation between two endpoints, optionally filtered by message type or speaker role | `PlayerAID`, `PlayerBID`, `MessageType?`, `Role?` |
| `inspect-deal` | Inspect a draft deal against live game state, including legality, advisory values, promise factors, and each side's tradable range | `PlayerAID`, `PlayerBID`, `ProposedDeal?` |
| `get-players` | Player summary with scores, era, resources, military, and diplomatic opinions | `PlayerID?` (0-21) |
| `get-opinions` | Diplomatic opinions to/from a player with all alive major civilizations | `PlayerID` (0-21), `RevealAll?` |
| `get-cities` | City info from a player's perspective with visibility filtering | `PlayerID?` (0-21), `Owner?` |
| `get-game-settings` | Static game settings (speed, map, difficulty, victory types, etc.) | `PlayerID?` |
| `get-metadata` | Read a metadata value by key from the knowledge store | `Key`: string |
| `get-options` | Available strategic options (techs, policies, strategies/flavors, persona) with current selections | `PlayerID` (0-21), `Mode?`: "Flavor" or "Strategy" |
| `summarize-units` | Unit overview grouped by civilization and AI type, with military stats | `PlayerID` |
| `get-military-report` | Military report with units by AI type and tactical zones | `PlayerID` (0-21) |
| `get-victory-progress` | Victory progress for all players, filtered by diplomatic visibility | `PlayerID?` (0-21) |

## Action Tools (14)

| Tool | Description | Key Input |
|------|-------------|-----------|
| `set-strategy` | Set grand/economic/military strategies by name | `PlayerID`, `GrandStrategy?`, `EconomicStrategies?`, `MilitaryStrategies?`, `Rationale` |
| `set-persona` | Set diplomatic personality values (1-10) across 26 personality fields | `PlayerID`, `[personality fields]`, `Rationale` |
| `set-relationship` | Set additive diplomatic modifiers with another major civ; positive MCP values mean friendlier intent | `PlayerID`, `TargetID`, `Public?` (-100 to 100), `Private?` (-100 to 100), `Rationale` |
| `set-flavors` | Set explicit flavor values (0-100) for tactical AI preferences and optionally set grand strategy as long-term victory direction / strategy state | `PlayerID`, `GrandStrategy?`, `Flavors?`: Record, `Rationale` |
| `unset-flavors` | Clear all custom flavor values, revert to defaults | `PlayerID` |
| `set-metadata` | Set a metadata key-value pair | `Key`, `Value` |
| `set-research` | Set next research technology by name | `PlayerID`, `Technology`, `Rationale` |
| `set-policy` | Set next policy or branch selection by name | `PlayerID`, `Policy`, `Rationale` |
| `keep-status-quo` | Maintain current strategy/flavors with documented rationale | `PlayerID`, `Mode?`: "Flavor" or "Strategy", `Rationale` |
| `relay-message` | Relay diplomatic or intelligence message as a game event; `Importance` 7+ interrupts important-event pacing | `PlayerID`, `FromPlayerID`, `Message`: "Diplomatic"/"Intelligence", `Content`, `Confidence` (0-9), `Importance` (0-9), `Categories`, `Memo`, `VisibleTo?` |
| `append-message` | Append an archival message to a durable diplomatic transcript; returns the stored message's canonical fields | `PlayerAID`, `PlayerBID`, `PlayerARole?`, `PlayerBRole?`, `SpeakerID`, `MessageType`, `Content`, `Payload?`, `Turn?` |
| `enact-agent-deal` | Enact the deal stored on a proposal, then record acceptance and enactment; returns record IDs plus `AlreadyEnacted` and `Enacted` status | `ProposalMessageID`, `Deal?`, `AccepterID?`, `Content?` |
| `post-notification` | Post a native notification to a human player; returns `true` only when Civ V creates it and `false` when Civ V rejects it | `PlayerID`, `CounterpartID?` (different from `PlayerID`), nonblank `Summary` (1-200 characters), nonblank `Message` (1-2000 characters) |
| `present-decision` | Present current Flavor-mode strategic options to the in-game human-control panel; returns whether delivery succeeded | `PlayerID`, `Turn?` (default: current turn) |

## Game Control Tools (3)

| Tool | Description | Key Input |
|------|-------------|-----------|
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
