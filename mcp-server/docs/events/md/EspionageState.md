# Overview

The EspionageState event is triggered when a spy's operational state changes during espionage activities. This event captures transitions in spy status, providing AI systems with real-time information about spy deployment, mission phases, and operational state changes throughout covert operations.

# Event Triggers

This event is fired in the `CvEspionageClasses.cpp` file when a spy's state is updated through the `SetSpyState` function. The event occurs whenever there is a change in a spy's operational status, such as moving between different phases of an espionage mission.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp:286`

**Trigger Condition:** When a spy's state is changed via the `SetSpyState` method, requiring the `MOD_EVENTS_ESPIONAGE` mod to be enabled

# Parameters

The EspionageState event passes the following parameters:

1. **Spy Owner** (`(int) eSpyOwner`) - The unique identifier of the player who owns the spy
2. **Spy Index** (`iSpyIndex`) - The index identifier of the specific spy whose state is changing
3. **Spy State** (`(int) eSpyState`) - The new state that the spy is transitioning to
4. **City X Coordinate** (`m_iCityX`) - The X coordinate of the city where the spy is currently operating
5. **City Y Coordinate** (`m_iCityY`) - The Y coordinate of the city where the spy is currently operating

# Event Details

The EspionageState event provides essential state transition information for AI systems to:

- Track spy deployment and mission progression
- Monitor operational phases of espionage activities
- Update tactical assessments based on spy status changes
- Coordinate multiple spy operations across different locations
- Analyze spy movement patterns and operational efficiency
- Respond to changes in covert operation states

The event enables external systems to maintain synchronized understanding of spy activities and their current operational status.

# Technical Details

**Event Name:** `EspionageState` **Hook Type:** Game event invoke hook **Parameters Count:** 5 **Parameter Types:**

- Spy Owner ID (integer)
- Spy Index (integer)
- Spy State (integer/enum)
- City X Coordinate (integer)
- City Y Coordinate (integer)

**Source File:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp` **Line Number:** 286 **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_EspionageState, (int) eSpyOwner, iSpyIndex, (int) eSpyState, m_iCityX, m_iCityY);`

The event is triggered within the `CvEspionageSpy::SetSpyState` method, ensuring that every spy state transition is communicated to external monitoring systems. The spy state is stored internally (`m_eSpyState = eSpyState`) before the event notification is sent.
