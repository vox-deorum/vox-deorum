# Vox Deorum Observer API

Observer mods can listen to Vox Deorum's strategic decisions via LuaEvents. Events are fire-and-forget — no in-game storage. Observer mods handle their own state.

## LuaEvents

### VoxDeorumPlayerInfo

Fired when a player's AI model/strategist configuration is known.

```lua
LuaEvents.VoxDeorumPlayerInfo(playerID, aiLabel)
```

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | number | The player ID (0-21) |
| `aiLabel` | string | Combined label, e.g. `"deepseek-r1 / simple-strategist"` |

### VoxDeorumAction

Fired per strategic action. Includes the turn number for implicit turn tracking.

```lua
LuaEvents.VoxDeorumAction(playerID, turn, actionType, summary, rationale)
```

| Parameter    | Type   | Description                             |
| ------------ | ------ | --------------------------------------- |
| `playerID`   | number | The player ID (0-21)                    |
| `turn`       | number | Current game turn                       |
| `actionType` | string | One of the action types below           |
| `summary`    | string | Clean summary of what changed           |
| `rationale`  | string | Why the action was taken (may be empty) |

## Action Types

| Type            | Description                                 |
| --------------- | ------------------------------------------- |
| `strategy`      | Grand/economic/military strategy changes    |
| `research`      | Next research technology selection          |
| `policy`        | Next policy or policy branch selection      |
| `relationship`  | Diplomatic modifier changes                 |
| `persona`       | AI personality value adjustments            |
| `flavors`       | AI flavor preference changes                |
| `unset-flavors` | Custom flavors cleared (revert to defaults) |
| `status-quo`    | Decision to maintain current direction      |

## Turn Tracking

Observer mods can track turns implicitly: when the `turn` parameter changes for a given player, a new turn has started. Clear per-player caches when the turn number changes.

## Example Observer Mod

```lua
-- Accumulate actions per player per turn
local playerActions = {}
local playerTurns = {}

LuaEvents.VoxDeorumPlayerInfo.Add(function(playerID, aiLabel)
  print("AI Player " .. playerID .. " is running: " .. aiLabel)
end)

LuaEvents.VoxDeorumAction.Add(function(playerID, turn, actionType, summary, rationale)
  -- Reset on new turn
  if playerTurns[playerID] ~= turn then
    playerTurns[playerID] = turn
    playerActions[playerID] = {}
  end

  -- Accumulate
  table.insert(playerActions[playerID], {
    type = actionType,
    summary = summary,
    rationale = rationale
  })
end)
```
