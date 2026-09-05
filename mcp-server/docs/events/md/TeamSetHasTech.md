# Overview

The TeamSetHasTech event is triggered when a team's technology ownership status changes through the Lua scripting system. This is a Lua hook rather than a standard GameEvent, allowing scripts to respond to both technology acquisition and loss after internal game state has been updated.

# Event Triggers

This event is fired from `CvTeamTechs::SetHasTech()` when:

- A team's technology ownership status is changed through the `SetHasTech()` method
- The technology status actually differs from the current status (prevents duplicate calls)
- The Lua script system is available and active
- Called after the internal technology state has been updated

The hook fires after the team's technology status has been modified and last acquired tech tracking has been updated (for newly acquired technologies).

# Parameters

The event provides three parameters with mixed types:

1. **Team ID** (`m_pTeam->GetID()`): The team whose technology status changed
2. **Technology Type** (`eIndex`): The technology type identifier that was gained or lost
3. **Has Technology** (`bNewValue`): Boolean indicating whether the team now has the technology (true = gained, false = lost)

# Event Details

The technology system manages team-level research and acquisition:

**Technology State Management:**

- Technologies are typically gained through research completion
- Technologies can potentially be lost through special game events or mechanics
- The system tracks the last technology acquired for historical purposes
- Technology ownership affects unit availability, building construction, and various game mechanics

**Team vs Player Technology:** This event captures team-level technology changes, which in most cases corresponds to all players on a team gaining access to the technology simultaneously. Team technology sharing is a core game mechanic.

**Technology Effects:** When technologies are gained or lost, numerous game systems are affected:

- Unit production options and upgrade paths
- Building availability and construction options
- Policy branch unlocking and advancement
- Resource visibility and improvement options
- Diplomatic options and trade capabilities

The hook provides notification after all internal bookkeeping is complete but before broader game system updates that depend on technology status.

# Technical Details

**Source Location**: `CvTechClasses.cpp` line 2372  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `SetHasTech()`  
**Prerequisites**: Lua script system must be available

**Technology State Tracking:**

- `m_pabHasTech[]`: Core array tracking technology ownership status
- `SetLastTechAcquired()`: Updates historical tracking for gained technologies
- Technology effects cascade through multiple game systems

**Script Integration:** This hook enables Lua scripts to implement custom technology-related behaviors, such as:

- Custom notifications or celebrations for technology breakthroughs
- Additional bonuses or penalties for specific technology acquisitions
- Alternative technology trees or progression systems
- Historical achievement tracking and milestone recognition
- Integration with mod-specific research mechanics

**Bidirectional Status:** The boolean parameter allows scripts to distinguish between gaining and losing technologies, enabling different responses for acquisition versus loss scenarios.

The event provides comprehensive information for scripts that need to track or respond to technological advancement and changes in team capabilities.
