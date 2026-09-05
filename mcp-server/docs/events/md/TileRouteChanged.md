# Overview

The `TileRouteChanged` event is triggered when a transportation route (road or railroad) on a tile is built, destroyed, or has its pillage state modified. This event tracks all modifications to the transportation infrastructure that connects cities and enables efficient movement across the map.

# Event Triggers

This event is triggered in the following scenarios:

- When a new route (road or railroad) is constructed on a tile
- When an existing route is upgraded (road to railroad)
- When a route is destroyed or removed
- When a route's pillage state changes (pillaged or repaired)

The event fires in two primary contexts:

1. **Route Type Changes**: When the actual route type is modified or created/destroyed
2. **Pillage State Changes**: When a route is pillaged or repaired without changing its type

# Parameters

| Parameter    | Type   | Description                                          |
| ------------ | ------ | ---------------------------------------------------- |
| `x`          | `int`  | The X coordinate of the tile where the route changed |
| `y`          | `int`  | The Y coordinate of the tile where the route changed |
| `owner`      | `int`  | The player ID of the tile's current owner (if any)   |
| `oldRoute`   | `int`  | The type/ID of the previous route (NO_ROUTE if none) |
| `newRoute`   | `int`  | The type/ID of the new route (NO_ROUTE if removed)   |
| `isPillaged` | `bool` | Whether the route is currently in a pillaged state   |

# Event Details

The `TileRouteChanged` event provides comprehensive tracking of transportation infrastructure modifications, which are crucial for economic and military efficiency in Civilization V:

**Economic Benefits:**

- **Trade Route Efficiency**: Roads and railroads increase trade route gold yields
- **City Connections**: Routes enable city connections for luxury and strategic resource sharing
- **Maintenance Costs**: Route construction and maintenance affect civilization budgets
- **Infrastructure Investment**: Route networks represent significant resource investments

**Military Advantages:**

- **Unit Movement**: Routes provide faster movement for military and civilian units
- **Strategic Mobility**: Good route networks enable rapid troop deployment
- **Supply Lines**: Routes act as supply lines for military campaigns
- **Defensive Networks**: Route networks support defensive positioning and reinforcement

**Strategic Infrastructure:**

- **Territory Development**: Route networks indicate territorial development and control
- **Economic Integration**: Routes integrate distant cities into the economic network
- **Expansion Support**: Routes enable and support territorial expansion
- **City Development**: Route connections are essential for city specialization and growth

**Route Types and Progression:**

- **Roads**: Basic routes providing movement and trade bonuses
- **Railroads**: Advanced routes with superior movement and economic benefits
- **Route Upgrades**: Technological progression from roads to railroads
- **Pillage States**: Damaged routes with reduced or eliminated benefits

**Common Route Changes:**

- **Worker Construction**: Building roads and railroads through worker actions
- **Technological Upgrades**: Upgrading roads to railroads with advanced technology
- **Military Pillaging**: Enemy units destroying or damaging route infrastructure
- **Repair Operations**: Workers restoring pillaged routes to full functionality

# Technical Details

**Source Locations:**

- `CvGameCoreDLL_Expansion2/CvPlot.cpp:9269` (Route type changes)
- `CvGameCoreDLL_Expansion2/CvPlot.cpp:9309` (Pillage state changes)

**Trigger Contexts:**

1. **Type Changes**: Fired when the route type is actually modified (construction, destruction, upgrade)
2. **Pillage Changes**: Fired when only the pillage state changes without type modification

**Event Hook:** Uses the `GAMEEVENTINVOKE_HOOK` macro with event type `GAMEEVENT_TileRouteChanged`

**Code References:**

```cpp
// Route type change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileRouteChanged, getX(), getY(), getOwner(), eOldRoute, eNewValue, IsRoutePillaged());

// Pillage state change
GAMEEVENTINVOKE_HOOK(GAMEEVENT_TileRouteChanged, getX(), getY(), getOwner(), getRouteType(), getRouteType(), IsRoutePillaged());
```

**Parameter Interpretation:**

- **Type Changes**: `oldRoute` and `newRoute` differ, showing the route transition
- **Pillage Changes**: Both route parameters are identical (current type), but `isPillaged` indicates the state change
- **NO_ROUTE**: Used when no route is present (before construction or after destruction)

**Route System Integration:** This event integrates with multiple game systems:

- **Worker actions and automation**
- **Military pillaging mechanics**
- **Trade route efficiency calculations**
- **City connection systems**

**Ownership Context:** The event includes owner information, enabling analysis of:

- Which civilizations are developing transportation infrastructure
- Infrastructure competition between neighboring civilizations
- The impact of territorial conquest on route networks

**Infrastructure Analysis:** The event supports comprehensive infrastructure analysis:

- **Network Development**: Tracking how civilizations build transportation networks
- **Strategic Connectivity**: Understanding route patterns and strategic priorities
- **Economic Efficiency**: Measuring infrastructure investment and economic benefits
- **Military Logistics**: Analyzing route networks for military strategic value

This event provides essential data for understanding transportation infrastructure development, economic efficiency, and military logistics in Civilization V, making it crucial for strategic analysis and AI decision-making systems.
