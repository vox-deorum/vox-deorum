# Overview

The `BarbariansCampCleared` event is triggered when a barbarian camp is successfully cleared by a player unit in Civilization V. This event occurs as part of the barbarian management system and provides information about the location of the cleared camp and which player was responsible for clearing it.

This event is part of the MOD_EVENTS_BARBARIANS system and is only fired when this modular event system is enabled.

# Event Triggers

The event is triggered in the following scenario:

- **Function**: `CvBarbarians::DoBarbCampCleared(CvPlot* pPlot, PlayerTypes ePlayer, CvUnit* pUnit)`
- **Location**: `CvGameCoreDLL_Expansion2/CvBarbarians.cpp:370`
- **Condition**: When `MOD_EVENTS_BARBARIANS` is enabled
- **Context**: After a barbarian camp has been cleared and all associated rewards (gold, culture, instant yields) have been processed

The event fires after the following game mechanics have been resolved:

- Archaeological record creation for the cleared camp
- Instant yield rewards (gold, culture) granted to the clearing player
- Barbarian camp reward popup display (for human players)
- Minor civilization quest completion checks
- Steam achievement progress updates

# Parameters

The event is invoked with three integer parameters:

| Parameter | Type | Source | Description |
| --- | --- | --- | --- |
| `iPlotX` | int | `pPlot->getX()` | The X coordinate of the plot where the barbarian camp was located |
| `iPlotY` | int | `pPlot->getY()` | The Y coordinate of the plot where the barbarian camp was located |
| `iPlayer` | int | `ePlayer` | The player ID of the player who cleared the barbarian camp |

Parameter signature: `"iii"` (three integers)

# Event Details

**Event Name**: `BarbariansCampCleared`  
**Lua Callback Signature**: `GameEvents.BarbariansCampCleared.Add(function(iPlotX, iPlotY, iPlayer) end)`

This event provides modders and AI systems with notification that a barbarian camp has been cleared, allowing them to:

- Track barbarian camp clearing statistics for players
- Implement custom rewards or penalties based on camp clearing
- Monitor territorial control and barbarian activity patterns
- Trigger related gameplay events or diplomatic reactions

The event occurs after all standard game rewards have been processed, ensuring that any custom logic runs with the full context of the clearing action's effects.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvBarbarians.cpp`  
**Event Definition**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CustomMods.h:982`  
**Macro**: `GAMEEVENT_BarbariansCampCleared`  
**Event Hook**: `GAMEEVENTINVOKE_HOOK(GAMEEVENT_BarbariansCampCleared, pPlot->getX(), pPlot->getY(), ePlayer)`

**Prerequisites**:

- `MOD_EVENTS_BARBARIANS` must be enabled
- Valid plot with a barbarian camp
- Valid player who cleared the camp

**Event Timing**: The event is fired at the end of the camp clearing process, after:

1. Barbarian spawner data reset (cooldown timer, attack status, spawn counter)
2. Archaeological record creation
3. Player reward calculations and distribution
4. UI popup displays (for human players)
5. Minor civilization quest processing
6. Achievement progress updates

**Related Events**:

- `BarbariansCampFounded` - When a new barbarian camp is established
- `BarbariansSpawnedUnit` - When barbarians spawn units from camps
- `GoodyHutReceivedBonus` - Similar reward-based events for other map features
