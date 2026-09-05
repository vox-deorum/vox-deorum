# Overview

The `PlayerAdoptPolicyBranch` event is triggered when a player adopts or switches to a new policy branch (ideology) in the social policy system. This event captures significant strategic decisions about a player's ideological direction, including both initial adoptions and switches between different policy branches.

# Event Triggers

This event is triggered from three distinct locations within the policy system, representing different scenarios for policy branch adoption:

1. **AI Policy Branch Selection**: When the AI system automatically chooses a policy branch through strategic analysis
2. **Policy Branch Unlocking**: When a player meets requirements and unlocks access to a new policy branch
3. **Ideology Switching**: When a player changes from one policy branch to another (often due to pressure or strategic needs)

All triggers occur within the Community Patch DLL's policy management classes after branch adoption is validated and processed.

# Parameters

The event passes two parameters to event handlers:

| Parameter | Type | Description |
| --- | --- | --- |
| PlayerID | PlayerTypes | The ID of the player who adopted the policy branch |
| BranchType | PolicyBranchTypes | The type of policy branch that was adopted |

# Event Details

The event provides crucial information about ideological choices:

- **Strategic Significance**: Policy branches represent major ideological commitments that shape entire civilizations
- **Player Context**: The player ID identifies which civilization made the ideological choice
- **Branch Information**: The branch type specifies the exact ideology or policy tree adopted
- **Multiple Triggers**: The event can fire from AI decision-making, player unlocking, or branch switching contexts
- **System Integration**: Occurs after all validation and processing of the branch adoption

Policy branches typically include major ideological paths like Order, Autocracy, and Freedom, each providing distinct bonuses and unlocking unique policy options.

# Technical Details

**Source Files**:

- `CvGameCoreDLL_Expansion2/CvPolicyAI.cpp`
- `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp`

**Trigger Locations**:

- Line 743: AI policy branch selection in `CvPolicyAI` class
- Line 5363: Policy branch unlocking in `CvPlayerPolicies` class
- Line 5809: Policy branch switching in `CvPlayerPolicies` class

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Branch Context**: Policy branches are major ideological frameworks that:

- Provide significant civilization-wide bonuses
- Unlock unique policy trees with specialized benefits
- Can create diplomatic relationships and conflicts based on shared or opposing ideologies
- Often require substantial culture investments or specific game conditions to unlock
