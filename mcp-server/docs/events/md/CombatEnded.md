# Overview

The `CombatEnded` event is triggered after a combat encounter has concluded in Civilization V. This event provides comprehensive information about all participants in the combat, including damage dealt, final health states, and battlefield location. It serves as a post-combat summary that can be used for analysis, logging, or strategic decision-making by AI systems.

# Event Triggers

This event is triggered at the end of the combat resolution process in the `CvUnitCombat.cpp` file. The event fires when:

- A combat encounter between units has been completed (successful or aborted)
- All damage calculations have been finalized
- Unit states have been updated with combat results
- The combat system is ready to report the final outcome

The event is called through the Lua scripting system using `LuaSupport::CallHook()`, allowing modding systems and AI agents to respond to combat conclusions.

# Parameters

The event passes the following parameters in order:

1. **iAttackingPlayer** (int) - Player ID of the attacking player
2. **iAttackingUnit** (int) - Unit ID of the attacking unit
3. **attackerDamage** (int) - Initial damage value for the attacker
4. **attackerFinalDamage** (int) - Final damage state of the attacker
5. **attackerMaxHP** (int) - Maximum hit points of the attacking unit
6. **iDefendingPlayer** (int) - Player ID of the defending player
7. **iDefendingUnit** (int) - Unit ID of the defending unit
8. **defenderDamage** (int) - Initial damage value for the defender
9. **defenderFinalDamage** (int) - Final damage state of the defender
10. **defenderMaxHP** (int) - Maximum hit points of the defending unit
11. **iInterceptingPlayer** (int) - Player ID of any intercepting unit (if applicable)
12. **iInterceptingUnit** (int) - Unit ID of any intercepting unit (if applicable)
13. **interceptorDamage** (int) - Damage dealt by or to interceptor
14. **plotX** (int) - X coordinate of the combat location
15. **plotY** (int) - Y coordinate of the combat location

# Event Details

The `CombatEnded` event provides a complete snapshot of combat aftermath, including:

- **Combat Participants**: Full identification of attacking and defending units, including their owning players
- **Health Status**: Both initial and final damage states for all participants, allowing calculation of damage dealt/received
- **Interception Support**: Information about any air units that intercepted during the combat
- **Location Context**: Map coordinates where the combat took place
- **Combat Resolution**: Final state after all combat mechanics have been applied

This event is particularly useful for:

- Post-combat analysis and learning systems
- Strategic AI decision-making based on combat outcomes
- Logging and replay systems
- Diplomatic relationship calculations based on combat results

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvUnitCombat.cpp` at line 3454

**Hook Mechanism**: Called via `LuaSupport::CallHook()` with the event name "CombatEnded"

**Invocation Context**: The event is triggered within the combat resolution flow, specifically after all damage calculations and unit state updates have been completed. The event fires regardless of whether the combat resulted in unit destruction or was merely a damaging encounter.

**Parameter Assembly**: All parameters are prepared and pushed to a `CvLuaArgsHandle` object before being passed to the Lua scripting system, ensuring type safety and proper argument ordering.

**Event Timing**: This is a post-combat event that fires after `CombatResult` but represents the final state rather than the predicted outcome.
