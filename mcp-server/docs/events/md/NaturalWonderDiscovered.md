# Overview

The `NaturalWonderDiscovered` event is triggered when a team discovers a natural wonder for the first time. This event captures the discovery of one of the game's unique geographical features that provide special bonuses and strategic value.

# Event Triggers

This event is triggered in the following scenarios:

- When a team's unit or vision reveals a natural wonder tile for the first time
- The event fires during the plot revelation process when a natural wonder feature is detected
- Only triggers for the first team to discover each specific natural wonder

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `teamId` | `int` | The ID of the team that discovered the natural wonder |
| `featureType` | `int` | The type/ID of the natural wonder feature discovered |
| `x` | `int` | The X coordinate of the natural wonder location |
| `y` | `int` | The Y coordinate of the natural wonder location |
| `isFirst` | `bool` | Whether this team is the first major civilization to discover this wonder |

# Event Details

The `NaturalWonderDiscovered` event provides comprehensive information about natural wonder discoveries, which are significant gameplay moments in Civilization V. Natural wonders are unique terrain features that:

- Provide special yields (food, production, gold, culture, faith, science)
- Often grant happiness bonuses to the discovering civilization
- Can influence city placement and strategic planning
- May unlock achievements or trigger other game effects
- Serve as important landmarks for navigation and territorial control

The event captures both the spatial location and the discovering team, with special attention to whether this is the first major civilization to find the wonder. This distinction is important because first discovery often comes with additional bonuses or recognition.

Key aspects tracked:

- **Discovery timing**: When in the game the wonder was found
- **Spatial context**: Exact location for strategic analysis
- **Team attribution**: Which civilization gets credit for the discovery
- **Priority status**: Whether this is a first-discovery by a major civ

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvPlot.cpp:11999`

**Trigger Context:** The event is invoked within the `CvPlot` class during the tile revelation process, specifically when a plot containing a natural wonder feature is being revealed to a team.

**Event Hook:** Uses `LuaSupport::CallHook` to integrate with the Lua scripting system for mod and scenario customization.

**Discovery Logic:** The event includes logic to determine if this is the first major civilization to discover the wonder using `getNumMajorCivsRevealed() == 0`.

**Code Reference:**

```cpp
args->Push(eTeam);
args->Push(getFeatureType());
args->Push(getX());
args->Push(getY());
args->Push((getNumMajorCivsRevealed() == 0)); // bFirst
LuaSupport::CallHook(pkScriptSystem, "NaturalWonderDiscovered", args.get(), bResult);
```

**Integration Points:** This event integrates with the game's exploration and vision systems, firing as part of the natural tile revelation mechanics when units move or gain line of sight.

The event provides essential data for tracking one of the most impactful exploration outcomes in Civilization V, enabling analysis of discovery patterns, strategic advantages, and the geographical distribution of these unique features across different games and civilizations.
