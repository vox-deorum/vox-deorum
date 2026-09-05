# Overview

The MakePeace event is triggered when two teams formally establish peace and end their state of war in Civilization V. This diplomatic event captures the moment when hostilities cease and peaceful relations are restored between civilizations, providing a crucial hook for AI systems to respond to conflict resolution and adjust strategic planning accordingly.

# Event Triggers

This event is fired in the `CvTeam.cpp` file when a team makes peace with another team through the diplomatic system. The event uses different mechanisms depending on mod configuration.

**Trigger Locations:**

- `CvGameCoreDLL_Expansion2/CvTeam.cpp:2152` (Modern path)
- `CvGameCoreDLL_Expansion2/CvTeam.cpp:2164` (Legacy path)

**Trigger Condition:** When a team establishes peace with another team, ending their state of war

# Parameters

The MakePeace event passes different parameters depending on the implementation path:

**Modern Path (if MOD_EVENTS_WAR_AND_PEACE is enabled):**

1. **Originating Player ID** (`eOriginatingPlayer`) - The unique identifier of the player who initiated the peace
2. **Target Team ID** (`eTeam`) - The unique identifier of the team that peace is being made with
3. **Pacifier Flag** (`bPacifier`) - Boolean indicating if this is a "pacifier" peace (specific diplomatic context)

**Legacy Path (Lua Hook):**

1. **Initiating Team ID** (`GetID()`) - The unique identifier of the team that is making peace
2. **Target Team ID** (`eTeam`) - The unique identifier of the team that peace is being made with

# Event Details

The MakePeace event occurs during the diplomatic resolution phase when teams transition from warfare to peaceful relations. This event serves as a notification mechanism for external systems to:

- Track peace agreements and conflict resolution between civilizations
- Adjust diplomatic strategies and alliance considerations
- Trigger AI responses to new peaceful relationships
- Update military and economic planning based on ended hostilities
- Reset war-related damage counters and relationship modifiers

The event is fired before the actual peace state changes take effect, allowing systems to prepare for the incoming peaceful state transition and associated game mechanics.

# Technical Details

**Source File:** `CvGameCoreDLL_Expansion2/CvTeam.cpp`

**Triggering Function:**

- `CvTeam::makePeace(TeamTypes eTeam, bool bBumpUnits, bool bSuppressNotification, PlayerTypes eOriginatingPlayer)` - Main function handling peace between teams

**Event Implementation:** The event uses different mechanisms depending on mod configuration:

- **Modern Path:** Uses `GAMEEVENT_MakePeace` with extended parameters if `MOD_EVENTS_WAR_AND_PEACE` is enabled
- **Legacy Path:** Uses Lua script hook `MakePeace` with basic parameters for compatibility

**Modern Game Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_MakePeace, eOriginatingPlayer, eTeam, bPacifier);
```

**Legacy Lua Hook:**

```cpp
LuaSupport::CallHook(pkScriptSystem, "MakePeace", args.get(), bResult);
```

The event is triggered during the peace-making process, immediately followed by the actual state changes that set both teams to no longer be at war with each other (`setAtWar(eTeam, false, bPacifier)` and `kTeam.setAtWar(GetID(), false, !bPacifier)`). The event also coincides with the resetting of city damage counters between the formerly warring civilizations.
