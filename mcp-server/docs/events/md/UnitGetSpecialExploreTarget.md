# Overview

The `UnitGetSpecialExploreTarget` event is triggered when the AI system queries for special exploration targets for a unit. This event allows mods and scripts to provide custom exploration objectives for AI-controlled units, extending beyond the standard AI exploration logic.

# Event Triggers

This event is triggered by the `CvHomelandAI` class when:

- The AI is determining exploration targets for a unit
- The system is looking for special or custom exploration objectives
- Standard AI exploration logic may be insufficient and custom targets are needed

The event occurs during AI turn processing when the homeland AI system is assigning exploration missions to units.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the unit seeking exploration targets
2. **Unit ID** (`int`): The unique identifier of the unit that needs an exploration target

# Event Details

The `UnitGetSpecialExploreTarget` event provides an opportunity for mods and scripts to influence AI exploration behavior. This allows for:

- Custom exploration priorities based on mod-specific objectives
- Directing units to explore specific areas of strategic importance
- Implementing specialized exploration patterns for different unit types
- Coordinating exploration efforts across multiple units
- Adding scenario-specific exploration goals
- Enhancing AI exploration intelligence with custom logic

This event is part of the AI decision-making process and allows external systems to provide exploration targets that the standard AI might not consider. The event handler can return specific coordinates or other targeting information to guide the unit's exploration behavior.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvHomelandAI.cpp`  
**Line**: Around 2344

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

```cpp
CvLuaArgsHandle args;
args->Push(pUnit->getOwner());  // Player ID
args->Push(pUnit->GetID());     // Unit ID

bool bResult = false;
LuaSupport::CallHook(pkScriptSystem, "UnitGetSpecialExploreTarget", args.get(), bResult);
```

This event is part of the AI homeland management system and allows for dynamic modification of exploration behavior. The event can return results that influence where the AI directs its exploration units, enabling more sophisticated and mod-specific exploration strategies.
