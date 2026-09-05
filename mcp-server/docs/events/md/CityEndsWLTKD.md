# Overview

The `CityEndsWLTKD` event is triggered when a city's "We Love The King Day" (WLTKD) celebration period comes to an end. WLTKD is a happiness mechanic where cities demand specific luxury resources, and providing them grants bonuses for a limited duration.

# Event Triggers

This event is triggered in one specific scenario:

1. **WLTKD Timer Expiration**: When a city's We Love The King Day counter reaches zero, indicating the end of the celebration period

The trigger occurs within the city's turn processing during the resource demand and WLTKD management system.

# Parameters

The event passes four parameters to event handlers:

| Parameter | Type        | Description                                  |
| --------- | ----------- | -------------------------------------------- |
| Owner     | PlayerTypes | The ID of the player who owns the city       |
| X         | int         | The X coordinate of the city on the game map |
| Y         | int         | The Y coordinate of the city on the game map |
| Unused    | int         | An unused parameter, always set to 0         |

# Event Details

The event provides location and ownership information for WLTKD conclusion:

- **City Location**: The X and Y coordinates allow precise identification of the affected city's position
- **Ownership Context**: The owner parameter identifies which player's city has ended its WLTKD celebration
- **Timer-Based Trigger**: The event occurs exactly when the WLTKD counter decrements to zero
- **Resource Demand Reset**: After this event fires, the city may immediately demand a new luxury resource

The event occurs during the city's turn processing, specifically after the WLTKD counter has been decremented and reaches zero.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvCity.cpp`

**Trigger Location**:

- Line 10348: WLTKD conclusion in the resource demand testing system

**Event System**: Uses the GAMEEVENTINVOKE_HOOK macro system

**Context Function**: The event fires within the city's resource demand management, specifically in the function that handles WLTKD counter decrements and resource demand cycles.

**Gameplay Integration**: This event is closely tied to the happiness and luxury resource systems. When WLTKD ends, the city typically begins demanding a new luxury resource, potentially starting another WLTKD cycle if the demand is met.

**Turn Processing**: The event occurs during each city's turn processing, making it part of the regular game turn cycle rather than an immediate response to player actions.
