# Overview

The `UnitUpgraded` event is triggered when a unit is upgraded to a more advanced unit type. This event captures both standard military upgrades and special upgrades from sources like goody huts, providing information about the old and new units involved in the upgrade process.

# Event Triggers

This event is triggered in two different contexts within the Community Patch DLL:

- **Standard Upgrades**: When a unit is upgraded through normal game mechanics (CvUnit.cpp, line 14314)
- **Goody Hut Upgrades**: When a unit is upgraded as a reward from a goody hut (CvPlayer.cpp, line 12760)

The event occurs after the upgrade process completes, when the old unit has been replaced by the new upgraded unit.

# Parameters

The event passes the following parameters:

1. **Player ID** (`int`): The ID of the player who owns the units being upgraded
2. **Old Unit ID** (`int`): The ID of the original unit before the upgrade
3. **New Unit ID** (`int`): The ID of the new unit after the upgrade
4. **Is Goody Hut** (`bool`): Whether this upgrade came from a goody hut (true) or standard upgrade mechanics (false)

# Event Details

The `UnitUpgraded` event provides information about unit advancement through the upgrade system. This allows mods and scripts to:

- Track military technological advancement and unit modernization
- Implement custom effects when specific unit types are upgraded
- Apply transfer mechanics for experience, promotions, or special abilities
- Monitor player military development and technological progress
- Differentiate between earned upgrades and goody hut bonuses
- Coordinate with other systems that need to respond to unit changes
- Record upgrade patterns for balancing or analysis purposes

The boolean parameter allows handlers to distinguish between upgrades earned through normal gameplay versus those granted as special rewards, enabling different processing for each type.

# Technical Details

**Source Files**:

- `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 14314) - Standard upgrades
- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (line 12760) - Goody hut upgrades

The event is triggered using the `LuaSupport::CallHook` mechanism with the following parameters:

**Standard Upgrade**:

```cpp
args->Push(((int)getOwner()));  // Player ID
args->Push(GetID());            // Old unit ID
args->Push(pNewUnit->GetID());  // New unit ID
args->Push(false);              // bGoodyHut = false
```

**Goody Hut Upgrade**:

```cpp
args->Push(GetID());            // Player ID
args->Push(pUnit->GetID());     // Old unit ID
args->Push(pNewUnit->GetID());  // New unit ID
args->Push(true);               // bGoodyHut = true
```

This event captures the transformation of units through upgrade mechanics and provides context about whether the upgrade was earned or granted as a special bonus.
