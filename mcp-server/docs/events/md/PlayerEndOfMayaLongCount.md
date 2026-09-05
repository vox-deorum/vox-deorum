# Overview

The `PlayerEndOfMayaLongCount` event is triggered when a Maya civilization completes a baktun cycle in the Maya Long Count calendar system. This is a special event specific to Maya civilization mechanics that occurs when transitioning from one baktun to the next.

# Event Triggers

This event is triggered in the following scenario:

1. **Maya Long Count Cycle Completion**: When the `CvPlayerTraits::IsEndOfMayaLongCount` method detects that a baktun cycle has ended (baktun number has increased by 1)

The trigger occurs after the Maya calendar date has been computed and a baktun transition is detected, specifically when `m_iBaktunPreviousTurn + 1 == m_iBaktun`.

# Parameters

The event passes three parameters to event handlers:

| Parameter      | Type | Description                                          |
| -------------- | ---- | ---------------------------------------------------- |
| PlayerID       | int  | The ID of the Maya player (`m_pPlayer->GetID()`)     |
| CurrentBaktun  | int  | The current baktun number (`m_iBaktun`)              |
| PreviousBaktun | int  | The previous baktun number (`m_iBaktunPreviousTurn`) |

# Event Details

The event provides comprehensive information about the Maya Long Count transition:

- **Player Identification**: The `PlayerID` parameter identifies the Maya player experiencing the calendar cycle
- **Current Calendar State**: The `CurrentBaktun` parameter shows the new baktun number that has just begun
- **Previous Calendar State**: The `PreviousBaktun` parameter shows the baktun that just ended
- **Timing Context**: The event fires exactly when the baktun transitions, allowing handlers to process the calendar change

The event is only triggered for civilizations with the Maya calendar trait and occurs alongside the granting of instant yields (INSTANT_YIELD_TYPE_BAKTUN_END).

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvTraitClasses.cpp`

**Trigger Location**: Line 7026 in the `CvPlayerTraits::IsEndOfMayaLongCount` method

**Event System**: Uses the game event hook system via `GAMEEVENTINVOKE_HOOK()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_GOLDEN_AGE` is enabled

**Trait Dependency**: This event only occurs for players with Maya calendar bonuses trait (`IsMayaCalendarBonuses()`)

**Execution Context**: The event fires during Maya Long Count processing, specifically:

- After Maya calendar date computation (`ComputeMayaDate()`)
- When a baktun transition is detected (previous + 1 equals current)
- After instant yield processing for the baktun end
- Before the previous baktun value is updated for the next turn

**Maya Calendar System**: The Maya Long Count calendar uses cycles of time including baktuns (approximately 394 years), and this event marks the completion of these significant time periods in the game.
