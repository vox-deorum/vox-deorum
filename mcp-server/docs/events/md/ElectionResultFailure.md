# Overview

The ElectionResultFailure event is triggered when a spy's attempt to rig elections in a minor civilization fails. This espionage-related event captures unsuccessful election interference operations, allowing AI systems to track failed covert activities and adjust espionage strategies accordingly.

# Event Triggers

This event is fired in the `CvMinorCivAI.cpp` file when a spy fails in their attempt to rig elections in a minor civilization's capital. The event occurs during the minor civilization's election processing phase and represents a failed espionage operation.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp:17336`

**Trigger Condition:** When a spy fails to successfully rig elections in a minor civilization

# Parameters

The ElectionResultFailure event passes the following parameters:

1. **Player ID** (`(int)ePlayer`) - The unique identifier of the player whose spy attempted the election rigging
2. **Spy ID** (`iSpyID`) - The unique identifier of the spy that failed the operation
3. **Diminish Amount** (`iDiminishAmount`) - The amount by which the player's influence with the minor civilization is reduced due to the failure
4. **Capital X Coordinate** (`pCapital->getX()`) - The X coordinate of the minor civilization's capital city where the operation failed
5. **Capital Y Coordinate** (`pCapital->getY()`) - The Y coordinate of the minor civilization's capital city where the operation failed

# Event Details

The ElectionResultFailure event occurs when a spy's covert election interference operation in a minor civilization is unsuccessful. This event provides critical information for AI systems to:

- Track failed espionage operations and their consequences
- Monitor spy performance and operational outcomes
- Adjust diplomatic relations based on failed covert activities
- Update espionage strategies based on operational failures
- Account for influence losses with minor civilizations

The event includes location data to help systems identify which minor civilization was targeted and where the failed operation took place.

# Technical Details

**Event Name:** `ElectionResultFailure` **Hook Type:** Game event invoke hook **Parameters Count:** 5 **Parameter Types:**

- Player ID (integer)
- Spy ID (integer)
- Diminish Amount (integer)
- X Coordinate (integer)
- Y Coordinate (integer)

**Source File:** `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp` **Function:** `DoElection()` **Line Number:** 17336 **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_ElectionResultFailure, (int)ePlayer, iSpyID, iDiminishAmount, pCapital->getX(), pCapital->getY());`

**Conditional Compilation:** This event is only triggered when `MOD_EVENTS_ESPIONAGE` is enabled, ensuring it's included only in builds that support extended espionage event handling.

The event is part of the espionage system's feedback mechanism, allowing external systems to monitor and respond to the outcomes of covert operations in minor civilizations.
