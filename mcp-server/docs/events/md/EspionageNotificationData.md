# Overview

The EspionageNotificationData event is triggered when espionage activities generate notification data for players. This event captures detailed information about espionage operations, including technology theft and other covert activities, providing comprehensive data for AI systems to track and respond to espionage-related developments.

# Event Triggers

This event is fired in the `CvEspionageClasses.cpp` file when espionage operations generate notification messages for players. The event occurs during the processing of spy notification messages and provides detailed context about espionage activities.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp:4529`

**Trigger Condition:** When espionage operations generate notification data, requiring the `MOD_EVENTS_ESPIONAGE` mod to be enabled

# Parameters

The EspionageNotificationData event passes the following parameters:

1. **City X Coordinate** (`iCityX`) - The X coordinate of the city where the espionage activity occurred
2. **City Y Coordinate** (`iCityY`) - The Y coordinate of the city where the espionage activity occurred
3. **Attacking Player** (`eAttackingPlayer`) - The unique identifier of the player conducting the espionage operation
4. **Target Player ID** (`m_pPlayer->GetID()`) - The unique identifier of the player being targeted by the espionage operation
5. **Spy Result** (`iSpyResult`) - The outcome or result code of the espionage operation
6. **Stolen Technology** (`eStolenTech`) - The identifier of the technology that was stolen (if applicable)
7. **Amount Stolen** (`iAmountStolen`) - The quantity or value of resources/information stolen during the operation

# Event Details

The EspionageNotificationData event provides comprehensive information about espionage operations for AI systems to:

- Track detailed espionage activities between civilizations
- Monitor technology theft and intellectual property losses
- Assess the impact and effectiveness of spy operations
- Update diplomatic relations based on espionage activities
- Adjust counter-espionage strategies based on detected activities
- Analyze patterns in covert operations and their outcomes

The event includes both geographical and operational data, allowing systems to understand not just what happened, but where it occurred and with what impact.

# Technical Details

**Event Name:** `EspionageNotificationData` **Hook Type:** Game event invoke hook **Parameters Count:** 7 **Parameter Types:**

- City X Coordinate (integer)
- City Y Coordinate (integer)
- Attacking Player ID (integer)
- Target Player ID (integer)
- Spy Result (integer)
- Stolen Technology (integer/enum)
- Amount Stolen (integer)

**Source File:** `CvGameCoreDLL_Expansion2/CvEspionageClasses.cpp` **Line Number:** 4529 **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_EspionageNotificationData, iCityX, iCityY, eAttackingPlayer, m_pPlayer->GetID(), iSpyResult, eStolenTech, iAmountStolen);`

The event is conditionally compiled based on the `MOD_EVENTS_ESPIONAGE` preprocessor directive and is triggered as part of the spy notification message system, providing detailed feedback about espionage operations to external monitoring systems.
