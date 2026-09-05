# Overview

The `GoodyHutReceivedBonus` event is triggered when a player's unit receives a bonus from exploring a goody hut (also known as ancient ruins or tribal villages). This event captures the specific bonus type and location where the goody hut interaction occurred.

# Event Triggers

This event is triggered in the following scenario:

- When a unit successfully explores a goody hut and receives a bonus reward
- The event fires after the bonus has been applied to the player but before cleanup operations
- Requires the MOD_EVENTS_GOODY_CHOICE configuration flag to be enabled

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerId` | `int` | The ID of the player who received the goody hut bonus |
| `unitId` | `int` | The ID of the unit that explored the goody hut (-1 if no unit) |
| `goodyType` | `int` | The type/ID of the bonus received from the goody hut |
| `x` | `int` | The X coordinate of the plot where the goody hut was located |
| `y` | `int` | The Y coordinate of the plot where the goody hut was located |

# Event Details

The `GoodyHutReceivedBonus` event provides comprehensive information about goody hut exploration outcomes. When a unit explores a goody hut, various types of bonuses can be received such as:

- Gold rewards
- Technology discoveries
- Unit spawns (scouts, warriors, etc.)
- Population growth for nearby cities
- Culture bonuses
- Faith bonuses
- Other civilization-specific rewards

The event captures both the spatial context (coordinates) and the specific reward type, allowing listeners to track exploration patterns and reward distribution across the map.

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlayer.cpp:13129`

**Trigger Context:** The event is invoked within the `CvPlayer::doGoody(CvPlot* pPlot, CvUnit* pUnit)` function during goody hut processing, specifically after the `receiveGoody()` method has been called but before achievement processing begins.

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_GoodyHutReceivedBonus`

**Configuration Dependency:** This event only fires when `MOD_EVENTS_GOODY_CHOICE` is enabled in the game configuration.

**Code Reference:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_GoodyHutReceivedBonus, GetID(), pUnit ? pUnit->GetID() : -1, eGoody, pPlot->getX(), pPlot->getY());
```

The event provides a reliable mechanism for tracking all goody hut interactions and their outcomes, making it valuable for gameplay analysis, achievement systems, and AI decision-making processes.
