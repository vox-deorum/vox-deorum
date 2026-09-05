# Overview

The `BarbariansCampFounded` event is triggered whenever a new barbarian camp is established on the game map. This event provides immediate notification when barbarian camps are founded, allowing mods and AI systems to react to the emergence of new barbarian threats or opportunities.

# Event Triggers

This event is triggered in the following scenario:

- **Barbarian Camp Placement**: When the `setImprovementType()` function is called on a plot with the barbarian camp improvement type (`GD_INT_GET(BARBARIAN_CAMP_IMPROVEMENT)`)
- **Location**: `CvPlot.cpp:8286` in the `CvPlot::setImprovementType()` method
- **Condition**: Only fires when the `MOD_EVENTS_BARBARIANS` configuration option is enabled
- **Context**: Occurs after the plot's previous barbarian camp clearer is reset and the barbarian spawning system is activated

The event is part of the barbarian camp lifecycle management system and complements other barbarian-related events like `BarbariansCampCleared`.

# Parameters

The event passes the following parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `iPlotX` | `int` | The X coordinate of the plot where the barbarian camp was founded |
| `iPlotY` | `int` | The Y coordinate of the plot where the barbarian camp was founded |

**Parameter Source**: The coordinates are obtained by calling `getX()` and `getY()` methods on the plot object where the barbarian camp is being established.

# Event Details

## Event Signature

- **Event Name**: `BarbariansCampFounded`
- **Parameter Format**: `"ii"` (two integer parameters)
- **Lua Callback Format**: `GameEvents.BarbariansCampFounded.Add(function(iPlotX, iPlotY) end)`

## Timing and Context

The event fires immediately when a barbarian camp improvement is set on a plot, specifically:

1. **After** the plot's `PlayerThatClearedBarbCampHere` is reset to `NO_PLAYER`
2. **After** the barbarian spawning system is activated for this plot via `CvBarbarians::ActivateBarbSpawner()`
3. **Before** the plot's upgrade progress is reset to 0
4. **Before** visibility updates are processed for teams

## Related Systems

This event integrates with several game systems:

- **Barbarian Spawning**: The `CvBarbarians::ActivateBarbSpawner()` call ensures the new camp becomes active for unit spawning
- **Plot Management**: Part of the broader improvement placement system in `setImprovementType()`
- **Event System**: Requires `MOD_EVENTS_BARBARIANS` to be enabled in the mod configuration

# Technical Details

## Implementation Location

- **File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlot.cpp`
- **Line**: 8286
- **Function**: `CvPlot::setImprovementType(ImprovementTypes eNewValue, PlayerTypes eBuilder)`

## Event Definition

- **Header File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CustomMods.h`
- **Definition Line**: 981
- **Macro**: `#define GAMEEVENT_BarbariansCampFounded "BarbariansCampFounded", "ii"`

## Configuration Requirements

- **Mod Option**: `MOD_EVENTS_BARBARIANS` must be enabled
- **Event Category**: Barbarian events (introduced in version 68 of the Community Patch)

## Code Context

```cpp
// Reset who cleared a Barb camp here last (if we're putting a new one down)
if (eNewValue == GD_INT_GET(BARBARIAN_CAMP_IMPROVEMENT))
{
    SetPlayerThatClearedBarbCampHere(NO_PLAYER);

    // Alert the barbarian spawning code to this new camp
    CvBarbarians::ActivateBarbSpawner(this);

    if (MOD_EVENTS_BARBARIANS)
        GAMEEVENTINVOKE_HOOK(GAMEEVENT_BarbariansCampFounded, getX(), getY());
}
```

## Usage Considerations

- The event only provides location information; additional plot data must be queried separately if needed
- This event occurs for all barbarian camp foundations, regardless of the cause (natural spawning, scenario setup, etc.)
- Mods can use this event to implement custom reactions to barbarian camp establishment, such as diplomatic notifications, AI strategy adjustments, or special mechanics
