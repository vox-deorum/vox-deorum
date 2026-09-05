# Overview

The `CityCaptureComplete` event is triggered when a city has been successfully transferred from one player to another through the `acquireCity` function in Civilization V. This comprehensive event captures all forms of city ownership changes, including military conquest, diplomatic trades, gifts, and liberations, making it essential for tracking territorial changes and diplomatic interactions.

# Event Triggers

This event is triggered at the completion of the `acquireCity()` function after all ownership transfer mechanics have been processed. The function handles various types of city acquisition:

**Military conquest:**

- **Unit capture**: Military units capturing enemy cities through combat
- **City bombardment**: Cities destroyed and captured through siege warfare
- **Naval conquest**: Coastal cities captured by naval forces

**Diplomatic transfers:**

- **Peace deal trades**: Cities traded as part of peace negotiations
- **Diplomatic exchanges**: Cities given as part of broader diplomatic agreements
- **City-state acquisitions**: Major civilizations acquiring city-state territories

**Special transfers:**

- **City gifting**: Cities given freely between players (AI to human, Austria/Venice abilities)
- **Liberation**: Cities returned to their original owners
- **Rebellion transfers**: Cities changing hands due to unhappiness or revolt mechanics
- **Script-initiated transfers**: Cities transferred through scenario or mod scripts

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `eOldOwner` | integer | The player ID of the city's previous owner |
| `bCapital` | boolean | True if the captured city was a capital city |
| `iCityX` | integer | The X coordinate of the captured city |
| `iCityY` | integer | The Y coordinate of the captured city |
| `newOwner` | integer | The player ID of the city's new owner (the acquiring player) |
| `iPopulation` | integer | The population of the city at the time of capture |
| `bConquest` | boolean | True if the city was taken through military conquest |
| `totalGreatWorks` | integer | Total number of Great Works that were in the city |
| `iCaptureGreatWorks` | integer | Number of Great Works successfully transferred to the new owner |

# Event Details

The CityCaptureComplete event represents the culmination of complex city transfer mechanics, providing comprehensive information about both the political and cultural implications of the ownership change. This event is crucial for victory condition tracking, diplomatic relationship management, and cultural heritage preservation.

**Transfer mechanics processed before event:**

- **Population management**: Resistance periods, population reduction, and happiness impacts
- **Building transfers**: Determining which buildings survive the transfer vs. destruction
- **Great Work handling**: Transferring cultural artifacts to available slots in the new empire
- **Unit displacement**: Moving or destroying units that can't remain in the captured territory
- **Plot ownership**: Updating territorial boundaries and resource access
- **Espionage impacts**: Handling spy displacement and intelligence network changes

**Strategic implications:**

- **Victory conditions**: Conquest victories depend on capturing original capitals (`bCapital` parameter)
- **Cultural heritage**: Great Work transfers impact cultural victory progress and tourism
- **Economic impact**: City population and buildings affect immediate economic benefits
- **Diplomatic consequences**: Conquest triggers relationship penalties with other civilizations
- **Resistance management**: Conquered cities may enter resistance periods reducing effectiveness

**Special acquisition types:**

- **Conquest (`bConquest=true`)**: Military capture with full conquest penalties and mechanics
- **Diplomatic transfer (`bConquest=false`)**: Peaceful transfers without resistance or penalties
- **Liberation**: Special case where cities return to original owners with diplomatic bonuses
- **Gift transfers**: Voluntary transfers that may trigger special diplomatic relationships

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`, line 4361

**Function Context**: Called at the end of `CvPlayer::acquireCity(CvCity* pCity, bool bConquest, bool bGift, bool bOriginally)`

**Script System Integration**: Uses `LuaSupport::CallHook` to notify registered Lua event listeners

**Preconditions**:

- City transfer must be valid and all ownership mechanics completed
- Great Work transfers must be processed and counted
- Plot ownership updates must be completed
- Unit displacement must be resolved
- Script system must be initialized and available

**Event Flow**:

1. `acquireCity()` called with source city and transfer parameters
2. City validation and pre-transfer processing occurs
3. Population, building, and resource calculations performed
4. Great Work transfer attempts made with success counting
5. Old city destroyed and new city created under new ownership
6. Plot ownership and territorial boundaries updated
7. Unit displacement and validation completed
8. Player proximity and diplomatic relationships updated
9. **CityCaptureComplete event triggered with comprehensive transfer data**
10. Post-transfer processing (victory checks, trait bonuses, etc.) executed

**Related mechanics:**

- Victory condition evaluation (conquest victory progress)
- Diplomatic relationship impacts (war weariness, conquest penalties)
- Cultural and tourism recalculations
- Trade route disruptions and updates
- Achievement tracking for conquest milestones

**Parameter relationships:**

- `bCapital` and conquest victory tracking
- `totalGreatWorks` vs `iCaptureGreatWorks` indicating cultural preservation success
- `iPopulation` reflecting city value and resistance potential
- `bConquest` determining post-capture mechanics and diplomatic penalties
