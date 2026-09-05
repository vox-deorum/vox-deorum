# Overview

The `PlaceResource` event is triggered when a resource is placed on the map, typically as part of a civilization's unique luxury resource system. This event captures the creation of new strategic or luxury resources through game mechanics rather than initial map generation.

# Event Triggers

This event is triggered in the following scenario:

- When a civilization's unique trait places a luxury resource near one of their cities
- The event fires during the unique luxury resource placement mechanism
- Typically occurs as part of special civilization abilities that grant unique resources

# Parameters

| Parameter      | Type  | Description                                         |
| -------------- | ----- | --------------------------------------------------- |
| `playerId`     | `int` | The ID of the player receiving the placed resource  |
| `resourceType` | `int` | The type/ID of the resource being placed            |
| `quantity`     | `int` | The quantity of the resource being placed           |
| `x`            | `int` | The X coordinate where the resource is being placed |
| `y`            | `int` | The Y coordinate where the resource is being placed |

# Event Details

The `PlaceResource` event tracks the dynamic placement of resources during gameplay, which is distinct from the resources that are generated during initial world creation. This event is particularly important for:

**Unique Civilization Mechanics:**

- Tracking when civilizations with unique luxury resource traits activate their abilities
- Recording the distribution of civilization-specific resources across the map
- Monitoring the economic advantages gained through unique resource placement

**Resource Economy Analysis:**

- Understanding how additional resources enter the game mid-play
- Tracking luxury resource availability and distribution
- Analyzing the impact of unique resources on trade and diplomacy

**Strategic Planning:**

- Identifying new resource locations for trade route planning
- Assessing changes in the strategic value of territories
- Understanding shifts in economic balance between civilizations

The event provides complete spatial and quantitative data about the resource placement, enabling comprehensive tracking of resource-based advantages and their geographic distribution.

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvTraitClasses.cpp:6784`

**Trigger Context:** The event is invoked within the trait system during unique luxury resource placement, specifically when processing civilization-specific resource generation abilities.

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_PlaceResource`

**Trait System Integration:** This event is part of the civilization trait system that handles unique abilities and bonuses specific to different civilizations.

**Code Reference:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlaceResource, m_pPlayer->GetID(), eResourceToGive, m_iUniqueLuxuryQuantity, pCity->getX(), pCity->getY());
```

**Resource Context Variables:**

- `eResourceToGive`: The specific resource type being placed (determined by trait logic)
- `m_iUniqueLuxuryQuantity`: The amount of the resource being added
- Location coordinates reference the associated city's position

**Unique Luxury System:** This event is specifically tied to civilizations that have unique luxury resource traits, capturing when these special abilities trigger and create new resource deposits on the map.

The event provides crucial insight into dynamic resource generation mechanics, which can significantly impact game balance, economic development, and diplomatic relationships through trade opportunities.
