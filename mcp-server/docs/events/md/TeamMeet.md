# Overview

The TeamMeet event is triggered when two teams meet for the first time through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts and mods to respond to first contact between teams after all internal diplomatic mechanics have been processed.

# Event Triggers

This event is fired from `CvTeam::meet()` when:

- Two teams meet for the first time (`!isHasMet()` condition)
- Both teams are alive (the initiating team must be alive)
- The Lua script system is available and active
- Called after mutual "has met" status has been established through `makeHasMet()`

The hook fires after the bilateral diplomatic relationship has been established but before any subsequent processing.

# Parameters

The event provides two integer parameters representing team IDs:

1. **Other Team ID** (`eTeam`): The team being met by the current team
2. **Current Team ID** (`GetID()`): The team initiating the meeting

# Event Details

The team meeting system manages first contact between teams:

**Meeting Prerequisites:**

- The initiating team must be alive
- The teams must not have previously met each other
- Meeting can be triggered through various game mechanics (exploration, diplomacy, etc.)

**Bilateral Process:** The meeting process is mutual - when Team A meets Team B:

1. Team A sets "has met" status for Team B
2. Team B sets "has met" status for Team A
3. The Lua hook fires with both team identifiers

**Diplomatic Implications:**

- Establishes basic diplomatic contact between civilizations
- Enables future diplomatic interactions, trade, and warfare
- May trigger additional first contact mechanics for individual players within teams
- Can affect AI diplomatic strategies and relationship calculations

**Team vs Player Contact:** While individual players may have separate first contact events, this team-level event captures the broader diplomatic relationship establishment between entire teams (important in team-based multiplayer games).

# Technical Details

**Source Location**: `CvTeam.cpp` line 2528  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `meet()`  
**Prerequisites**: Lua script system must be available

**Related Functions:**

- `isHasMet()`: Checks if teams have previously met
- `makeHasMet()`: Establishes the "has met" diplomatic status
- Player-level first contact systems for individual civilizations

**Script Integration:** This hook enables Lua scripts to implement custom first contact behaviors, such as:

- Custom diplomatic bonuses or penalties for first meetings
- Historical tracking of exploration and discovery events
- Integration with mod-specific diplomatic systems
- Special mechanics for team-based scenarios or multiplayer games

**Message Suppression:** The `bSuppressMessages` parameter in the calling function can control whether standard first contact notifications are displayed, allowing scripts to potentially override default behavior while still receiving the hook notification.

The event provides the foundation for scripted diplomatic systems that need to respond to the establishment of contact between different teams in the game world.
