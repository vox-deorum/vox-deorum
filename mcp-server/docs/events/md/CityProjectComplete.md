# Overview

The `CityProjectComplete` event is triggered when a city completes the construction of a project in Civilization V. Projects are special constructions that provide empire-wide or city-specific benefits, often representing massive undertakings like spaceship components, world projects, or infrastructure initiatives that require significant investment but offer substantial strategic advantages upon completion.

# Event Triggers

This event is triggered when the `CreateProject()` function is called on a city with a valid project type, representing the successful completion of project construction.

**Specific trigger conditions:**

- **Project completion**: A city has finished constructing a specific project type
- **Valid project type**: The project must be a valid project available in the game
- **Resource fulfillment**: All required production and resources have been invested to complete the project
- **Construction success**: The project creation process has been successfully executed

**Related mechanics that can complete projects:**

- Standard city production focusing on projects over multiple turns
- Production overflow from other completed constructions being applied to projects
- Purchasing projects with gold (if enabled by game rules or modifications)
- Forced project completion through modding, scripting, or special game events
- AI decision-making systems that prioritize and complete strategic projects
- Wonder/project-related policies or bonuses that accelerate project completion

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `playerID` | integer | The ID of the player who owns the city completing the project (from `getOwner()`) |
| `cityID` | integer | The unique identifier of the city where the project is completed (from `GetID()`) |
| `projectType` | integer | The identifier of the specific project type being completed (`eProjectType`) |

# Event Details

Project completion represents the culmination of significant strategic investment in empire-wide capabilities or specialized city improvements. Projects differ from buildings and units in that they often provide unique, empire-spanning benefits and may contribute to victory conditions or unlock special gameplay mechanics.

**Project categories and types:**

- **Spaceship components**: Apollo Program, SS Cockpit, SS Life Support, SS Thrusters, SS Boosters
- **World projects**: Manhattan Project, UN construction, various wonder-like projects
- **Infrastructure projects**: City-specific improvements that provide ongoing benefits
- **Victory projects**: Projects that contribute directly to achieving victory conditions
- **Special projects**: Unique constructions that unlock specific game mechanics or bonuses

**Project completion effects:**

- **Empire-wide benefits**: Many projects provide bonuses to all cities or the entire civilization
- **Victory progress**: Some projects contribute to science, diplomatic, or other victory conditions
- **Resource costs**: Projects often require significant production investment and may have ongoing maintenance
- **Unlocked capabilities**: Completed projects may enable new units, buildings, or game mechanics

**Spaceship project mechanics:**

- **Apollo Program**: Enables spaceship construction and displays spaceship interface
- **Component assembly**: Individual spaceship parts contribute to overall space race progress
- **Victory conditions**: Completed spaceship components can trigger space race victory
- **Visual representation**: Spaceship progress is displayed graphically to players
- **Launch capability**: Complete spaceships enable victory launch sequences

**Project benefits and effects:**

- **Happiness modifiers**: Some projects provide empire-wide or city-specific happiness
- **Economic effects**: Projects may affect gold maintenance, production, or other economic factors
- **Unhappiness mitigation**: Projects can reduce various forms of unhappiness (distress, poverty, etc.)
- **Median modifiers**: Projects may affect the median levels of various city metrics
- **WLTKD generation**: Some projects provide "We Love The King Day" celebration turns

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvCity.cpp`, line 30026

**Function Context**: Called within `CvCity::CreateProject(ProjectTypes eProjectType)`

**Script System Integration**: Uses `GAMEEVENTINVOKE_HOOK` macro with `GAMEEVENT_CityProjectComplete`

**Preconditions**:

- `eProjectType` must be a valid project type available in the game
- City must have sufficient production and resources to complete the project
- Player must meet any prerequisite requirements for the project
- Project must not be already completed (for unique/one-time projects)

**Event Flow**:

1. `CreateProject` is called with a valid project type
2. Player and team references are obtained for project tracking
3. Team project count is incremented via `changeProjectCount()`
4. City-specific project count is updated
5. Spaceship project IDs are loaded from game configuration
6. Special spaceship handling begins for space race projects
7. Apollo Program creates initial spaceship frame and interface display
8. Other spaceship components update spaceship state and check for launch readiness
9. Victory condition checking occurs for completed spaceship components
10. Project effects are applied from project configuration data
11. City attributes are modified based on project benefits (happiness, maintenance, etc.)
12. WLTKD (We Love The King Day) is triggered if project provides celebration turns
13. `GAMEEVENT_CityProjectComplete` hook is invoked with player ID, city ID, and project type

**Project Effect Application**:

- **Gold maintenance**: Projects may have ongoing maintenance costs applied to treasury
- **Happiness effects**: Various happiness bonuses and unhappiness reductions are applied
- **Empire modifiers**: Empire-wide effects like size modifier reductions are applied
- **City-specific benefits**: Direct city attribute improvements are implemented
- **Security and espionage**: Spy security and other defensive bonuses are applied

**Spaceship Victory Integration**:

- **Launch checking**: System verifies if spaceship is complete and victory can be achieved
- **Visual updates**: Spaceship interface is updated to reflect new components
- **Victory trigger**: Complete spaceships can immediately trigger space race victory
- **Component tracking**: Individual spaceship parts are tracked for overall progress

**Related Events**:

- Victory achievement events when projects contribute to winning conditions
- Economic events related to project maintenance and costs
- Happiness events triggered by project completion benefits
- Spaceship construction and launch events for space race projects
