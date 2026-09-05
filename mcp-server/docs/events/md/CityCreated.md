# Overview

The `CityCreated` event is triggered when a city creates/produces a project through various methods including normal production or gold purchase. Despite its misleading name, this event specifically tracks project creation within cities, not actual city founding. This event is distinct from `CityProjectComplete` which fires after the project creation process is fully completed.

# Event Triggers

This event is triggered in two distinct scenarios:

1. **Normal Production Creation**: When a city finishes producing a project through regular production queue processing
2. **Gold Purchase Creation**: When a player purchases a project using gold currency

Both triggers occur within the `CvCity` class in the Community Patch DLL during project creation methods (`produce()` for normal production and `PurchaseProject()` for gold purchases).

# Parameters

The event passes five parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| Owner | PlayerTypes | The ID of the player who owns the city |
| CityID | int | The unique identifier of the city |
| ProjectType | ProjectTypes | The type of project that was created |
| bGold | bool | Whether the project was purchased with gold (true) or produced normally (false) |
| bFaith | bool | Whether the project was purchased with faith/culture - always false for projects |

# Event Details

The event provides comprehensive information about project creation circumstances:

- **Production Method Tracking**: The `bGold` parameter allows event handlers to distinguish between normal production and gold purchase
- **City Context**: The owner and city ID parameters provide full context for the project creation
- **Project Information**: The project type parameter identifies exactly what was created
- **Faith Parameter**: The `bFaith` parameter is always false for projects, as they cannot be purchased with faith or culture

The event occurs immediately after the project is successfully created in the city. Note that this is different from the `CityProjectComplete` event, which fires after additional project-related processing is completed.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvCity.cpp`

**Trigger Locations**:

- Line 29706: Normal production creation in `CvCity::produce(ProjectTypes, bool)`
- Line 30994: Gold purchase creation in `CvCity::PurchaseProject(ProjectTypes, YieldTypes)`

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Conditional Compilation**: The event uses MOD_EVENTS_CITY conditional compilation blocks with fallback to direct Lua hook calls for backward compatibility.

**Project Context**: Projects are special constructions that provide one-time or ongoing benefits to civilizations, such as space program components, world wonders, or special research initiatives. This event tracks their creation regardless of the acquisition method.

**Event Naming Note**: Despite being named "CityCreated", this event is not related to city founding (which uses `PlayerCityFounded` and `UnitCityFounded` events). The naming follows the Community Patch DLL convention where `CityCreated` refers to project creation, `CityConstructed` refers to building construction, and `CityTrained` refers to unit training.
