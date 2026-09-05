# Overview

The TeamTechResearched event is triggered when a team completes technology research through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts to respond to technology completion after all technological effects have been applied to the team and its players.

# Event Triggers

This event is fired from `CvTeam::processTech()` when:

- A team completes research on a technology (typically `iChange` = 1)
- All technology effects have been processed and applied to the team
- The Lua script system is available and active
- Called near the end of the technology processing pipeline, after game mechanics updates

The hook fires after comprehensive technology processing including unit upgrades, building unlocks, route improvements, resource visibility changes, and various other technological benefits.

# Parameters

The event provides three integer parameters:

1. **Team ID** (`GetID()`): The team that completed the technology research
2. **Technology Type** (`eTech`): The technology type identifier that was researched
3. **Change Amount** (`iChange`): The amount of change (typically 1 for research completion, could be negative for tech loss)

# Event Details

The technology research system processes extensive game effects before this hook:

**Military and Unit Effects:**

- Unit upgrade and obsolescence processing
- New unit types becoming available for production
- Combat strength modifications and unit class changes
- Special unit promotions and abilities (like embarking improvements)
- Route movement bonuses and navigation improvements

**Economic and Infrastructure Effects:**

- Building construction options and prerequisite unlocks
- Resource visibility and improvement availability
- Trade route and exploration capabilities
- Specialist yield bonuses and city improvements

**Map and Exploration Updates:**

- Terrain and feature visibility changes
- Route construction and improvement options
- Plot yield updates from newly visible resources
- Map layout updates for revealed features

**Player and Civilization Benefits:**

- Happiness bonuses from technological advancement
- Policy branch unlocks and civic advancement options
- Wonder construction prerequisites
- City specialization resets for strategic AI planning

**End Game Detection:** If the technology has the `IsEndsGame()` flag, the game's end-game technology flag is set, potentially triggering victory conditions.

# Technical Details

**Source Location**: `CvTeam.cpp` line 8271  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `processTech()`  
**Prerequisites**: Lua script system must be available

**Processing Order:** The technology research processing follows this sequence:

1. Core technology effects and bonuses applied
2. Unit system updates (upgrades, promotions, availability)
3. Building and infrastructure updates
4. Map visibility and improvement updates
5. Player-specific bonuses and adjustments
6. Lua hook fired (TeamTechResearched)
7. End-game technology detection

**Script Integration:** This hook enables Lua scripts to implement custom technology research behaviors, such as:

- Custom notifications or celebrations for major technological breakthroughs
- Additional civilization-specific bonuses for key technologies
- Alternative technology progression or branching systems
- Historical milestone tracking and achievement systems
- Integration with mod-specific mechanics or victory conditions

**Change Parameter:** While typically 1 for research completion, the `iChange` parameter allows for different scenarios like technology loss (negative values) or bulk technology processing, enabling scripts to respond appropriately to different types of technological changes.
