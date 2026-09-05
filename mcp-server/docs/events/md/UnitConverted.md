# Overview

The `UnitConverted` event is triggered when a unit is converted from one player to another through various conversion mechanics. This includes religious conversion, diplomatic conversion, or other special abilities that change unit ownership without direct combat capture.

# Event Triggers

This event is triggered in the `CvUnit` class when:

- A unit undergoes conversion from one player to another
- The conversion process is completed successfully
- The conversion may be part of an upgrade process or a direct ownership change

The event occurs during the conversion process, typically when unit ownership is being transferred between players.

# Parameters

The event passes the following parameters:

1. **Original Owner ID** (`int`): The ID of the player who originally owned the unit before conversion
2. **New Owner ID** (`int`): The ID of the player who now owns the unit after conversion
3. **Original Unit ID** (`int`): The ID of the unit before conversion
4. **Converting Unit ID** (`int`): The ID of the unit performing the conversion or the new unit ID
5. **Is Upgrade** (`bool`): Whether this conversion is part of an upgrade process (true) or a direct conversion (false)

# Event Details

The `UnitConverted` event provides information about unit ownership changes through conversion mechanisms. This allows mods and scripts to:

- Track unit conversions for diplomatic or religious victory conditions
- Implement custom effects when units change allegiance
- Monitor the effectiveness of conversion abilities
- Apply special bonuses or penalties based on conversion context
- Differentiate between conversions that are upgrades versus direct ownership changes
- Coordinate with other systems that need to track unit loyalty changes

The boolean parameter distinguishes between conversions that are part of unit upgrades (where the unit type may change) versus direct conversions where only ownership changes.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvUnit.cpp`  
**Line**: Around 2257

The event is triggered using the `GAMEEVENTINVOKE_HOOK` mechanism with the following parameters:

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_UnitConverted,
    pUnit->getOwner(),  // Original owner ID
    getOwner(),         // New owner ID
    pUnit->GetID(),     // Original unit ID
    GetID(),            // Converting unit ID
    bIsUpgrade          // Whether this is an upgrade conversion
);
```

The event signature is defined as `"UnitConverted"` with parameter format `"iiiib"` (four integers, one boolean). This event captures the transition of unit ownership through non-combat means.
