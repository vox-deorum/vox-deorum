# Overview

The `CombatResult` event is triggered during the combat resolution process before the actual combat takes place. This event provides the predicted combat parameters and allows for intervention or analysis of the planned combat encounter. Unlike `CombatEnded`, this event represents the intended combat state and can be used to modify or abort combat before it occurs.

# Event Triggers

This event is triggered during the combat preparation phase in the `CvUnitCombat.cpp` file. The event fires when:

- Combat parameters have been calculated and prepared
- The combat system has determined damage values and participants
- Before the actual combat resolution occurs
- The `MOD_EVENTS_RED_COMBAT_RESULT` flag is enabled
- Combat has not been aborted by other systems

The event is conditionally called after combat abort checks have passed, allowing systems to receive combat predictions before final resolution.

# Parameters

The event passes the following parameters in order:

1. **iAttackingPlayer** (int) - Player ID of the attacking player
2. **iAttackingUnit** (int) - Unit ID of the attacking unit
3. **attackerDamage** (int) - Predicted initial damage for the attacker
4. **attackerFinalDamage** (int) - Predicted final damage state of the attacker
5. **attackerMaxHP** (int) - Maximum hit points of the attacking unit
6. **iDefendingPlayer** (int) - Player ID of the defending player
7. **iDefendingUnit** (int) - Unit ID of the defending unit
8. **defenderDamage** (int) - Predicted initial damage for the defender
9. **defenderFinalDamage** (int) - Predicted final damage state of the defender
10. **defenderMaxHP** (int) - Maximum hit points of the defending unit
11. **iInterceptingPlayer** (int) - Player ID of any intercepting unit (if applicable)
12. **iInterceptingUnit** (int) - Unit ID of any intercepting unit (if applicable)
13. **interceptorDamage** (int) - Predicted damage for interceptor
14. **plotX** (int) - X coordinate of the combat location
15. **plotY** (int) - Y coordinate of the combat location

# Event Details

The `CombatResult` event provides predictive combat information, including:

- **Pre-Combat State**: Information about units before combat resolution
- **Damage Predictions**: Calculated damage values that will be applied if combat proceeds
- **Combat Participants**: Full identification of all units involved in the encounter
- **Intervention Opportunity**: Allows systems to analyze or potentially influence combat before resolution
- **Location Context**: Map coordinates where combat is planned to occur

This event is particularly useful for:

- Pre-combat decision-making systems
- Combat prediction and analysis
- AI tactical evaluation before commitment
- Strategic planning based on expected outcomes
- Combat logging and statistics collection

The key difference from `CombatEnded` is timing: this event occurs before combat resolution and provides predicted values rather than final results.

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvUnitCombat.cpp` at line 3293

**Hook Mechanism**: Called via `LuaSupport::CallHook()` with the event name "CombatResult"

**Conditional Execution**: Only fires when `MOD_EVENTS_RED_COMBAT_RESULT` is enabled and combat has not been aborted

**Invocation Context**: The event occurs within the combat preparation flow, after damage calculations but before actual combat resolution. It's positioned after combat abort checks (`MustAbortAttack`) to ensure only valid combat scenarios trigger the event.

**Parameter Assembly**: Uses the same parameter structure as `CombatEnded` but represents predicted rather than final values

**Event Timing**: This is a pre-combat event that fires before combat resolution occurs, providing an opportunity for intervention or analysis of the planned encounter.
