# Knowledge Management System

## Overview

The knowledge system provides persistent, per-game state tracking with player visibility filtering. It stores game events, player summaries, diplomatic opinions, city data, and AI decisions across sessions.

Architecture:
```
Bridge Service Events → KnowledgeManager → KnowledgeStore → SQLite (per game)
                              ↓
                    Lua Getters (game data extraction)
```

## Components

### KnowledgeManager (knowledge/manager.ts)

Central orchestrator. Responsibilities:
- Monitors Bridge Service for game events and DLL status
- Detects game context changes (new game, game switch)
- Manages per-game KnowledgeStore instances
- Auto-saves every 30 seconds
- Sends MCP client notifications (DLLConnected, DLLDisconnected, GameSwitched)
- Registers Lua functions for event visibility analysis

Key flow:
1. DLL connects → checkGameContext() → if game changed, switchGameContext()
2. Game events arrive → forwarded to KnowledgeStore.handleGameEvent()
3. Special events (PlayerDoneTurn) trigger data collection via Lua getters
4. Auto-save timer persists data every 30s
5. Shutdown saves pending data and closes connections

### KnowledgeStore (knowledge/store.ts)

SQLite persistence layer. One database per game at `data/{gameId}.db`.

Features:
- Kysely ORM with WAL mode for concurrency
- JSON serialization plugin for complex data types
- Write serialization via PQueue (concurrency: 1) to prevent conflicts
- Event validation against Zod schemas
- Event name remapping (e.g., "PlayerBuilt" → "UnitBuildCompleted")
- Resync handling: drops duplicate events after DLL reconnect

## Data Types

### GameMetadata

Simple key-value store. Used for turn tracking, timestamps, configuration.

### PublicKnowledge

Immutable data visible to all players. Currently used for:
- **PlayerInformations**: Civilization name, leader, team, human/AI status

Schema: Key (identifier), Data (JSON)

### TimedKnowledge

Time-stamped data with player visibility. Used for:
- **GameEvents**: All game events with type and payload
- **PlayerOptions**: Available technologies, policies, strategies per player
- **TacticalZones**: AI tactical analysis with zone territories, dominance, unit counts

Schema: ID (auto), Turn, Payload (JSON), CreatedAt, PlayerVisibility (Player0-Player21)

### MutableKnowledge

Versioned data with change tracking. Used for:
- **PlayerSummaries**: Score, economy, military, diplomacy (~30 fields)
- **PlayerOpinions**: Diplomatic opinions to/from each player
- **CityInformations**: Population, production, buildings, wonders (~20 fields)
- **StrategyChanges**: Grand/economic/military strategy selections
- **PolicyChanges**: Policy branch and policy selections
- **ResearchChanges**: Technology research decisions
- **PersonaChanges**: 22 AI personality trait values
- **FlavorChanges**: 34 flavor preferences (offense, defense, growth, etc.)
- **RelationshipChanges**: Diplomatic modifier values
- **VictoryProgress**: Domination, science, culture, diplomatic victory tracking

Schema: Extends TimedKnowledge + Key, Version, IsLatest, Changes (changed field names)

Versioning pattern:
1. Fetch latest version for key (IsLatest = 1)
2. Detect changes compared to previous version
3. Skip if no changes
4. Mark old version as not latest (IsLatest = 0)
5. Insert new version with incremented version number and changes array

## Player Visibility

Visibility is tracked per-player using 22 columns (Player0 through Player21). Values:
- `0` = not visible to player
- `1` = basic visibility (exists, location, basic stats)
- `2` = detailed visibility (production, yields, buildings)

Visibility is set when data is stored. Query helpers in expressions.ts:
- `isVisible(playerID, level)` - filter by visibility level
- `isAtTurn(turn)` - filter by turn
- `isAfter(ID)` / `isBeforeOrAt(ID)` - filter by event ID

## Event Processing Pipeline

1. Bridge Service sends game event via SSE/event pipe
2. KnowledgeManager receives event, forwards to KnowledgeStore
3. KnowledgeStore validates against Zod schema (eventSchemas map)
4. Event name is remapped if applicable
5. Visibility flags are applied
6. Event stored in GameEvents table
7. Special event handling:
   - **PlayerDoneTurn**: Triggers Lua getters for player summaries, opinions, strategies, personas, city info
   - **Victory events**: Archives game data, saves replay
   - **PlayerDoTurn**: Updates active player

## Getter Pattern (knowledge/getters/)

Getters extract game data by executing Lua scripts and storing results:

1. Execute Lua script via BridgeManager (inline or from lua/ directory)
2. Process returned data (convert IDs to names, filter buildings, etc.)
3. Store in KnowledgeStore with appropriate visibility using storeMutableKnowledge/Batch()
4. Return processed data

Examples:
- `game-identity.ts` - Game ID and session info
- `player-information.ts` - Immutable player data (PublicKnowledge)
- `player-strategy.ts` - Current AI strategies (MutableKnowledge, self-only visibility)
- `city-information.ts` - City data with building filtering and caching

## Database Schema

Created in schema/setup.ts. Tables are created if they don't exist (no migrations needed -- data is ephemeral per game).

### Tables

| Table | Type | Description |
|-------|------|-------------|
| GameMetadata | KV Store | Turn, timestamps, config |
| GameEvents | TimedKnowledge | All game events |
| PlayerOptions | TimedKnowledge | Available choices per player |
| TacticalZones | TimedKnowledge | AI tactical zone analysis |
| PlayerSummaries | MutableKnowledge | Player state snapshots |
| PlayerOpinions | MutableKnowledge | Diplomatic opinions matrix |
| CityInformations | MutableKnowledge | Detailed city data |
| StrategyChanges | MutableKnowledge | Strategy decisions |
| PolicyChanges | MutableKnowledge | Policy selections |
| ResearchChanges | MutableKnowledge | Research decisions |
| PersonaChanges | MutableKnowledge | Personality trait changes |
| FlavorChanges | MutableKnowledge | Flavor preference changes |
| RelationshipChanges | TimedKnowledge | Diplomatic modifier changes |
| VictoryProgress | MutableKnowledge | Victory condition progress |
| PlayerInformations | PublicKnowledge | Immutable player data |
