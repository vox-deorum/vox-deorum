# Overview

The `GreatWorkCreated` event is triggered when a Great Person successfully creates a Great Work. Great Works are cultural artifacts created by Great Artists, Great Writers, and Great Musicians that provide culture, tourism, and other benefits when placed in appropriate slots in cities. This event enables tracking of Great Work creation for cultural victory strategies and tourism management.

# Event Triggers

This event is triggered in the following scenarios:

- When a Great Artist creates a Great Work of Art
- When a Great Writer creates a Great Work of Writing
- When a Great Musician creates a Great Work of Music
- After the Great Work has been successfully created and assigned to an available slot
- Only when the MOD_BALANCE_CORE feature is enabled in the game configuration

# Parameters

The event passes the following parameters:

1. **Player ID** (`getOwner()`) - The unique identifier of the player who owns the Great Person that created the work
2. **Unit ID** (`GetID()`) - The unique identifier of the Great Person unit that created the Great Work
3. **Great Work Type** (`iValue`) - The integer representation of the Great Work type that was created (cast from `eGreatWorkType`)

# Event Details

Great Works are a key component of the cultural victory path and tourism generation in Civilization V. This event captures the moment when these valuable cultural artifacts are created, which is important for:

- Cultural victory planning and Great Work management
- Tourism output optimization through Great Work placement
- AI strategic decision-making regarding Great Person usage
- Tracking cultural development and artistic achievements
- Understanding the cultural influence generation of civilizations

The event fires after the Great Work has been successfully created and notifications have been sent to players. This ensures that the Great Work is fully integrated into the game systems before external systems respond to its creation.

Great Works provide ongoing benefits including:

- Culture output for the owning civilization
- Tourism points that influence other civilizations
- Theming bonuses when properly arranged in museums and other culture buildings
- Special bonuses depending on the specific work type and placement

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvUnit.cpp` (line 9590)

**Triggering Functions:**

- `CvUnit::createGreatWork()` - Main function handling Great Work creation by Great Person units

**Compilation Requirements:**

- Only active when `MOD_BALANCE_CORE` is defined during compilation
- Requires `CvGameCulture` system to be available

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_GreatWorkCreated, getOwner(), GetID(), iValue);
```

**Related Systems:**

- `CvGameCulture` - Manages Great Works database and storage
- Great Work slot management in cities and buildings
- Tourism and cultural influence systems
- Great Person expending mechanics

**Notification Integration:** The event triggers after appropriate notifications are sent to players, ensuring proper UI feedback before external systems process the Great Work creation.
