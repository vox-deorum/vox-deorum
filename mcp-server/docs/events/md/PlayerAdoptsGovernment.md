# Overview

The `PlayerAdoptsGovernment` event is triggered when a player adopts a new government type or changes their current governmental system. This event captures significant political decisions that affect how a civilization operates, providing insights into a player's administrative and strategic choices.

# Event Triggers

This event is triggered when a player successfully adopts or changes their government type through the political system. The trigger occurs within the government management functionality of the `CvPlayer` class after the government change has been validated and processed.

The event fires during government adoption processes, which may include:

1. **Initial Government Selection**: When establishing a government for the first time
2. **Government Reform**: When changing from one government type to another
3. **Political Evolution**: When unlocking and adopting new governmental systems through technology or policy advancement

# Parameters

The event passes two parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | PlayerTypes | The ID of the player who adopted the government |
| GovernmentType | int | The ID/type of the government that was adopted |

# Event Details

The event provides essential information about governmental changes:

- **Political Significance**: Government types typically provide civilization-wide bonuses and affect how cities and policies function
- **Player Context**: The player ID identifies which civilization made the governmental choice
- **Government Information**: The government type parameter specifies exactly which system was adopted
- **Strategic Impact**: Government changes often represent major shifts in how a civilization operates
- **System Integration**: Occurs after government adoption is finalized and effects are applied

Government systems typically influence various aspects of civilization management, including policy costs, city management, military organization, and economic efficiency.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`

**Trigger Location**: Line 29568 within the player's government management system

**Event System**: Uses the game event system via `GAMEEVENTINVOKE_HOOK(GAMEEVENT_PlayerAdoptsGovernment)`

**Government Context**: Government systems in the game typically:

- Provide significant bonuses to various aspects of civilization management
- May have prerequisites in terms of technology, culture, or other advancement
- Can affect policy costs, unit maintenance, city growth, or economic efficiency
- Often represent major political and administrative choices that shape gameplay strategy
- May influence diplomatic relationships with other civilizations based on governmental compatibility

**Integration**: The event ensures that government adoptions are properly communicated to all game systems that may need to respond to such political changes.
