# Overview

The ElectionResultSuccess event is triggered when a spy successfully rigs elections in a minor civilization. This espionage-related event captures successful election interference operations, providing AI systems with information about successful covert activities and their impact on diplomatic relations with minor civilizations.

# Event Triggers

This event is fired in the `CvMinorCivAI.cpp` file when a spy successfully completes an election rigging operation in a minor civilization's capital. The event occurs during the minor civilization's election processing phase and represents a successful espionage operation.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp:17248`

**Trigger Condition:** When a spy successfully rigs elections in a minor civilization, requiring the `MOD_EVENTS_ESPIONAGE` mod to be enabled

# Parameters

The ElectionResultSuccess event passes the following parameters:

1. **Player ID** (`(int)ePlayer`) - The unique identifier of the player whose spy successfully rigged the election
2. **Spy ID** (`iSpyID`) - The unique identifier of the spy that performed the successful operation
3. **Value** (`iValue`) - The value or benefit gained from the successful election rigging operation
4. **Capital X Coordinate** (`pCapital->getX()`) - The X coordinate of the minor civilization's capital city where the operation succeeded
5. **Capital Y Coordinate** (`pCapital->getY()`) - The Y coordinate of the minor civilization's capital city where the operation succeeded

# Event Details

The ElectionResultSuccess event occurs when a spy's covert election interference operation in a minor civilization is successful. This event provides essential information for AI systems to:

- Track successful espionage operations and their benefits
- Monitor spy performance and operational effectiveness
- Adjust diplomatic strategies based on successful covert activities
- Update influence calculations with minor civilizations
- Trigger achievement unlocks for successful operations
- Award instant yields and experience points to successful spies

The event includes location data to identify which minor civilization was targeted and the geographical context of the successful operation.

# Technical Details

**Event Name:** `ElectionResultSuccess` **Hook Type:** Game event invoke hook **Parameters Count:** 5 **Parameter Types:**

- Player ID (integer)
- Spy ID (integer)
- Value (integer)
- X Coordinate (integer)
- Y Coordinate (integer)

**Source File:** `CvGameCoreDLL_Expansion2/CvMinorCivAI.cpp` **Function:** `DoElection()` **Line Number:** 17248 **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_ElectionResultSuccess, (int)ePlayer, iSpyID, iValue, pCapital->getX(), pCapital->getY());`

**Conditional Compilation:** This event is only triggered when `MOD_EVENTS_ESPIONAGE` is enabled, ensuring it's included only in builds that support extended espionage event handling.

The event is part of a sequence that includes achievement unlocks (`MOD_API_ACHIEVEMENTS`), instant yield bonuses (`MOD_BALANCE_VP`), and spy experience gains when successful election rigging occurs.
