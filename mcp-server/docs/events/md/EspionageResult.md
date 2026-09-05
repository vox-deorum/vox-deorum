# Overview

The EspionageResult event is triggered when an espionage operation concludes and produces a result. This event captures the outcome of spy activities in cities, providing AI systems with essential feedback about the success or failure of covert operations and their specific results.

# Event Triggers

This event is fired in the `CvEspionageClasses.cpp` file when an espionage operation completes and sets a result for a specific player. The event occurs within the city espionage system when spy operation outcomes are finalized.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp:6959`

**Trigger Condition:** When an espionage operation produces a result, requiring the `MOD_EVENTS_ESPIONAGE` mod to be enabled

# Parameters

The EspionageResult event passes the following parameters:

1. **Spy Owner** (`(int) eSpyOwner`) - The unique identifier of the player who owns the spy conducting the operation
2. **Spy Index** (`iSpyIndex`) - The index identifier of the specific spy performing the operation
3. **Result** (`iResult`) - The numerical result or outcome code of the espionage operation
4. **City X Coordinate** (`m_pCity->getX()`) - The X coordinate of the city where the espionage operation took place
5. **City Y Coordinate** (`m_pCity->getY()`) - The Y coordinate of the city where the espionage operation took place

# Event Details

The EspionageResult event provides critical outcome information for AI systems to:

- Track the results of completed espionage operations
- Monitor spy performance and operational effectiveness
- Update strategic assessments based on operation outcomes
- Adjust future espionage planning based on historical results
- Correlate spy activities with their geographical locations
- Analyze patterns in espionage success and failure rates

The event serves as a completion notification for espionage operations, allowing external systems to record and respond to the final outcomes of covert activities.

# Technical Details

**Event Name:** `EspionageResult` **Hook Type:** Game event invoke hook **Parameters Count:** 5 **Parameter Types:**

- Spy Owner ID (integer)
- Spy Index (integer)
- Result Code (integer)
- City X Coordinate (integer)
- City Y Coordinate (integer)

**Source File:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp` **Line Number:** 6959 **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_EspionageResult, (int) eSpyOwner, iSpyIndex, iResult, m_pCity->getX(), m_pCity->getY());`

The event is triggered within the `CvCityEspionage` class as part of the result storage mechanism (`m_aiResult[eSpyOwner] = iResult`), ensuring that external systems receive notification whenever espionage operation outcomes are recorded.
