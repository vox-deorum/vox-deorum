# Overview

The `UnitPromoted` event is triggered when a unit receives a promotion, gaining new abilities or bonuses. This event provides information about which unit was promoted and what promotion they received, allowing for tracking of unit advancement and implementing promotion-related effects.

# Event Triggers

This event is triggered by the `CvUnit` class in the Community Patch DLL when:

- A unit successfully receives a promotion
- The promotion is applied and the unit gains the associated benefits
- The promotion process completes successfully

The event occurs after the promotion has been granted to the unit and all related effects have been applied.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the promoted unit
2. **Unit ID** (`int`): The unique identifier of the unit that received the promotion
3. **Promotion ID** (`int`): The identifier of the promotion that was granted to the unit

# Event Details

The `UnitPromoted` event provides information about unit advancement through the promotion system. This allows mods and scripts to:

- Track promotion patterns and unit development strategies
- Implement custom effects when specific promotions are acquired
- Apply additional bonuses or penalties based on promotion choices
- Monitor military unit experience and advancement
- Coordinate with other systems that respond to unit improvements
- Record unit progression for achievement or scoring systems
- Balance or modify promotion effects dynamically

The event captures the specific promotion gained, allowing handlers to respond differently based on the type of advancement achieved.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 13784

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

```cpp
CvLuaArgsHandle args;
args->Push(((int)getOwner()));  // Player ID
args->Push(GetID());            // Unit ID
args->Push(ePromotion);         // Promotion ID

bool bResult = false;
LuaSupport::CallHook(pkScriptSystem, "UnitPromoted", args.get(), bResult);
```

This event is part of the unit advancement system and provides a hook for implementing custom promotion mechanics or effects that extend beyond the base promotion system.
