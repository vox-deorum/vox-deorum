# Overview

The TeamSetEra event is triggered when a team advances to a new era through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, providing scripts with notification after all era advancement mechanics have been processed. Note that there's also a GameEvent version available when `MOD_EVENTS_NEW_ERA` is enabled.

# Event Triggers

This event is fired from `CvTeam::SetCurrentEra()` when:

- A team's era is changed through the `SetCurrentEra()` method
- The Lua script system is available and active
- The `MOD_EVENTS_NEW_ERA` option is disabled (otherwise the GameEvent version fires)
- Called at the end of era processing after all game mechanics have been updated

The hook fires after extensive era transition processing including unit upgrades, building updates, and minor civilization reward recalculation.

# Parameters

The event provides two integer parameters:

1. **Team ID** (`GetID()`): The team advancing to the new era
2. **New Era** (`GetCurrentEra()`): The era type that the team has advanced to

# Event Details

The era advancement system triggers numerous game mechanics before this hook:

**Unit System Updates:**

- Era-based combat strength adjustments for units with `isUnitEraUpgrade()`
- Unit combat type changes based on era progression
- New promotion availability based on era requirements

**Building and Yield Updates:**

- City yield recalculation from era-scaling buildings
- Building availability updates based on era requirements
- Various era-dependent bonuses and penalties

**Minor Civilization Updates:**

- Complete reward recalculation for all minor civilizations
- Updated bonuses based on the advancing team's new era
- Diplomatic relationship adjustments

**Economic and Strategic Effects:**

- Technology and research cost adjustments
- Unit production and upgrade cost changes
- Strategic resource availability modifications

**Dual Event System:** When `MOD_EVENTS_NEW_ERA` is enabled, a GameEvent is fired instead of this Lua hook, providing the same functionality through the standard event system rather than Lua scripting.

# Technical Details

**Source Location**: `CvTeam.cpp` line 8965  
**Hook Type**: Lua script hook (not GameEvent by default)  
**Triggering Function**: `SetCurrentEra()`  
**Prerequisites**: Lua script system must be available, `MOD_EVENTS_NEW_ERA` disabled

**Alternative Event System:** When `MOD_EVENTS_NEW_ERA` is enabled, `GAMEEVENT_TeamSetEra` fires instead with signature `"iib"` (team, era, is_first_team_to_reach_era).

**Era Transition Processing:** The function performs extensive updates before firing the hook:

- Individual player and unit processing loops
- City and building system updates
- Minor civilization diplomatic recalculation
- Economic system adjustments

**Script Integration:** This hook enables Lua scripts to implement custom era advancement behaviors, such as:

- Custom notifications or celebrations for era advancement
- Additional bonuses or penalties for reaching specific eras
- Historical milestone tracking and achievements
- Integration with mod-specific progression systems

The hook provides access to the complete post-transition game state, ensuring scripts receive accurate information about the team's new capabilities and status.
