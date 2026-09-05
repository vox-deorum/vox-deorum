# Overview

The SetAlly event is triggered when a city-state's ally relationship changes through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts and mods to respond to ally relationship changes between city-states and major civilizations.

# Event Triggers

This event is fired from `CvMinorCivAI::SetAlly()` when:

- A city-state's ally relationship changes after validation and internal processing
- The Lua script system is available and active
- Called at the end of the ally setting process, after all game mechanics have been applied
- Occurs for ally gains, losses, and switches between different major civilizations

The hook is called after all internal bookkeeping, diplomatic effects, resource updates, and victory condition testing has been completed.

# Parameters

The event provides three integer parameters:

1. **Minor Civ Player ID** (`m_pPlayer->GetID()`): The city-state whose ally relationship changed
2. **Old Ally Player ID** (`eOldAlly`): The previous ally (NO_PLAYER if none)
3. **New Ally Player ID** (`eNewAlly`): The current ally (NO_PLAYER if none)

# Event Details

The ally system manages exclusive relationships between city-states and major civilizations:

**Ally Relationship Changes:**

- **Ally Gained**: Old ally was NO_PLAYER, new ally is a major civilization
- **Ally Lost**: Old ally was a major civilization, new ally is NO_PLAYER
- **Ally Switched**: Both old and new allies are different major civilizations

**Associated Game Effects (Applied Before Hook):**

- Resource sharing updates between civilizations
- Happiness recalculation for affected players
- Great Person bonus applications for new allies
- War declarations based on ally's existing conflicts
- Diplomatic AI relationship adjustments
- City defense strength recalculation
- Domination victory condition testing

**Special Mechanics Handled:**

- Permanent ally relationships (cannot be overridden)
- NoAlly status restrictions
- Achievement system notifications
- Minor vs minor warfare resolution
- Skirmish ending with new allies

# Technical Details

**Source Location**: `CvMinorCivAI.cpp` line 12449  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `SetAlly()`  
**Prerequisites**: Lua script system must be available

**Related Systems:**

- `SetAllyInternal()`: Performs the actual ally relationship change
- `DoUpdateAlliesResourceBonus()`: Updates resource sharing
- `DoTestConquestVictory()`: Checks victory conditions
- Various diplomatic and economic update functions

**Script Integration:** This hook allows Lua scripts to implement custom behaviors when ally relationships change, such as:

- Custom notifications or UI updates
- Additional diplomatic consequences
- Economic or military bonuses/penalties
- Integration with mod-specific mechanics

The hook fires after all core game systems have processed the ally change, ensuring scripts receive accurate post-change game state information.
