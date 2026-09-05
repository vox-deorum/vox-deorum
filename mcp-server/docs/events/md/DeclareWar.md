# Overview

The DeclareWar event is triggered when one team formally declares war on another team in Civilization V. This event captures the moment of diplomatic breakdown and the initiation of hostilities between civilizations, providing a critical hook for AI systems to respond to warfare declarations and adjust strategic planning accordingly.

# Event Triggers

This event is fired in the `CvTeam.cpp` file when a team declares war on another team. The event is invoked through the Lua scripting system hook mechanism, allowing external systems to monitor and respond to warfare declarations in real-time.

**Trigger Location:** `CvGameCoreDLL_Expansion2/CvTeam.cpp:1286`

**Trigger Condition:** When a team initiates a war declaration against another team

# Parameters

The DeclareWar event has two different implementations depending on the build configuration:

## Modern Game Event Hook (MOD_EVENTS_WAR_AND_PEACE enabled)

When `MOD_EVENTS_WAR_AND_PEACE` is enabled, the event passes these parameters:

1. **eOriginatingPlayer** (PlayerTypes) - The player who initiated the war declaration
2. **eTeam** (TeamTypes) - The target team that war is being declared against
3. **bAggressor** (bool) - Whether the declaring team is considered the aggressor

## Legacy Lua Hook (fallback)

When the modern events system is not available, the event uses the legacy Lua hook with these parameters:

1. **Declaring Team ID** (`GetID()`) - The unique identifier of the team that is declaring war
2. **Target Team ID** (`eTeam`) - The unique identifier of the team that war is being declared against

Both parameters are pushed to the Lua arguments stack in sequence, with the declaring team ID first, followed by the target team ID.

# Event Details

The DeclareWar event occurs during the diplomatic phase when teams transition from peaceful relations to active warfare. This event serves as a notification mechanism for external systems to:

- Track warfare initiation between civilizations
- Adjust diplomatic strategies and alliances
- Trigger AI responses to new conflict situations
- Update military and economic planning based on new hostilities

The event is fired before the actual war state changes take effect, allowing systems to prepare for the incoming warfare state transition.

# Technical Details

**Event Name:** `DeclareWar` **Source File:** `CvGameCoreDLL_Expansion2/CvTeam.cpp` **Function:** `DoDeclareWar()`

## Modern Implementation (Line 1273)

**Hook Type:** Game Event Hook via `GAMEEVENTINVOKE_HOOK` **Parameters Count:** 3 **Parameter Types:**

- PlayerTypes (eOriginatingPlayer)
- TeamTypes (eTeam)
- bool (bAggressor) **Implementation:** `GAMEEVENTINVOKE_HOOK(GAMEEVENT_DeclareWar, eOriginatingPlayer, eTeam, bAggressor);`

## Legacy Implementation (Line 1286)

**Hook Type:** Lua scripting system hook **Parameters Count:** 2 **Parameter Types:**

- Team ID (integer, GetID())
- Target Team ID (integer, eTeam) **Implementation:** `LuaSupport::CallHook(pkScriptSystem, "DeclareWar", args.get(), bResult);`

The event implementation is conditionally compiled based on the `MOD_EVENTS_WAR_AND_PEACE` preprocessor directive. The modern game event hook is used when this feature is enabled, otherwise the legacy Lua hook serves as a fallback.
