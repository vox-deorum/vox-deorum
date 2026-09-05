# Overview

The `BuildFinished` event is triggered when a unit completes any build action on a plot in Civilization V. This includes constructing improvements, building routes, removing features, repairing pillaged tiles, or removing routes. The event provides information about the completed build action, including the player responsible, the plot location, and the improvement that was constructed (if applicable).

This event is part of the core build system and is always available, providing comprehensive coverage of all build completion activities in the game.

# Event Triggers

The event is triggered in the following scenario:

- **Function**: `CvPlot::changeBuildProgress(BuildTypes eBuild, int iChange, PlayerTypes ePlayer, bool bNewBuild)`
- **Location**: `CvGameCoreDLL_Expansion2/CvPlot.cpp:12838`
- **Condition**: When a build action reaches completion (`getBuildProgress(eBuild) >= getBuildTime(eBuild, ePlayer)`)
- **Context**: After all build effects have been applied but before the function returns

The event fires after the following build completion mechanics have been resolved:

- Improvement construction and placement
- Route construction
- Feature removal and production yields
- Repair of pillaged improvements or routes
- Route removal operations
- Archaeological discovery notifications (for applicable improvements)

# Parameters

The event is invoked with four parameters:

| Parameter | Type | Source | Description |
| --- | --- | --- | --- |
| `ePlayer` | PlayerTypes (int) | Function parameter | The player ID who completed the build action |
| `iPlotX` | int | `getX()` | The X coordinate of the plot where the build was completed |
| `iPlotY` | int | `getY()` | The Y coordinate of the plot where the build was completed |
| `eImprovement` | ImprovementTypes (int) | `pkBuildInfo->getImprovement()` | The improvement type defined in the build info (NO_IMPROVEMENT for non-improvement builds like routes, feature removal, repairs) |

Parameter signature: `"iiii"` (four integers)

# Event Details

**Event Name**: `BuildFinished`  
**Lua Callback Signature**: `GameEvents.BuildFinished.Add(function(ePlayer, iPlotX, iPlotY, eImprovement) end)`

This event provides modders and AI systems with notification that a build action has been completed, allowing them to:

- Track construction progress and territorial development
- Implement custom rewards or effects based on specific improvements
- Monitor player productivity and infrastructure development
- Trigger related gameplay events based on completed builds
- Analyze strategic patterns in player construction choices

The event occurs after all standard build effects have been processed, ensuring that the game state reflects the completed construction when the event handlers execute.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvPlot.cpp`  
**Function**: `changeBuildProgress`  
**Event Hook**: `LuaSupport::CallHook(pkScriptSystem, "BuildFinished", args.get(), bResult)`

**Prerequisites**:

- Valid build type with sufficient accumulated build progress
- Valid player performing the build action
- Build progress must reach or exceed the required build time

**Event Timing**: The event is fired at the end of the build completion process, after:

1. Improvement placement and configuration
2. Route construction
3. Feature removal and production yield calculation
4. Pillage repair operations
5. Route removal operations
6. Archaeological discovery processing and notifications
7. Achievement progress updates

**Build Types Covered**:

- **Improvement Construction**: Farms, mines, trading posts, and all other tile improvements
- **Route Construction**: Roads and railroads
- **Feature Removal**: Clearing forests, jungles, marshes, and other terrain features
- **Repair Operations**: Fixing pillaged improvements and routes
- **Route Removal**: Removing existing roads or railroads

**Related Functions**:

- `CvPlot::getBuildProgress()` - Retrieves current build progress
- `CvPlot::getBuildTime()` - Calculates required build time
- `CvPlot::setImprovementType()` - Places the completed improvement
- `CvPlot::setRouteType()` - Constructs or removes routes
