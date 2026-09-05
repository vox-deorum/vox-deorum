# Overview

The `UnitCaptured` event is triggered when a unit is captured or converted by another player through various game mechanics. This event encompasses multiple scenarios including combat capture, barbarian conversion through religious beliefs or traits, and special unit abilities that allow capturing enemy units.

# Event Triggers

This event is triggered in several different contexts within the Community Patch DLL:

- **Combat Capture**: When a unit is captured during combat (CvUnit.cpp, line 2789 and 20078)
- **Religious Conversion**: When a barbarian unit is converted through religious beliefs (CvBeliefClasses.cpp, line 4683)
- **Trait-Based Conversion**: When units are captured or converted through civilization traits (CvTraitClasses.cpp, lines 7906, 7920, 7972)

All triggers require the `MOD_EVENTS_UNIT_CAPTURE` custom mod option to be enabled.

# Parameters

The event passes the following six parameters:

1. **Capturing Player ID** (`int`): The ID of the player who captured/converted the unit
2. **Capturing Unit ID** (`int`): The ID of the unit that performed the capture, or unit type if from capture definition
3. **Original Owner ID** (`int`): The ID of the player who originally owned the captured unit
4. **Captured Unit ID** (`int`): The unique identifier of the unit that was captured/converted
5. **Was Killed** (`bool`): Whether the unit was killed instead of captured (true = killed, false = captured)
6. **Capture Type** (`int`): An integer indicating the type/context of capture:
   - `0` = Standard combat capture/kill
   - `1` = Capture through combat mechanics using capture definition
   - `2` = Trait-based conversion/capture
   - `3` = Trait-based barbarian conversion with gold reward
   - `4` = Religious belief-based barbarian conversion

# Event Details

The `UnitCaptured` event provides comprehensive information about unit ownership changes through capture or conversion. This allows mods and scripts to:

- Track unit captures and conversions for scoring or achievement systems
- Implement custom effects when specific units are captured
- Monitor civilization-specific capture abilities and their usage
- Apply special bonuses or penalties based on capture context
- Differentiate between actual captures and units that were killed instead
- Track religious or trait-based conversion mechanics

The boolean parameter distinguishes between units that were successfully captured versus those that were killed in the attempt, while the capture type parameter allows handlers to respond differently based on the mechanism used.

# Technical Details

**Source Files**:

- `CvGameCoreDLL_Expansion2/CvUnit.cpp` (lines 2789, 20078)
- `CvGameCoreDLL_Expansion2/CvBeliefClasses.cpp` (line 4683)
- `CvGameCoreDLL_Expansion2/CvTraitClasses.cpp` (lines 7906, 7920, 7972)

**Condition**: Requires `MOD_EVENTS_UNIT_CAPTURE` to be enabled

The event is triggered using the `GAMEEVENTINVOKE_HOOK` mechanism with the following parameter format:

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_UnitCaptured,
    capturingPlayerID,    // Player who captured the unit
    capturingUnitID,      // Unit that did the capturing (or unit type)
    originalOwnerID,      // Original owner of captured unit
    capturedUnitID,       // The unit that was captured
    wasKilled,            // true if killed instead of captured
    captureType           // Context/method of capture
);
```

The event signature is defined as `"UnitCaptured"` with parameter format `"iiiibi"` (four integers, one boolean, one integer).
