# Overview

The `IdeologySwitched` event is triggered when a player switches from one ideology to another through an ideological revolution. This occurs when a civilization abandons their current ideology (Freedom, Order, or Autocracy) and adopts a different one, typically due to cultural pressure from other civilizations or strategic considerations.

# Event Triggers

This event is triggered in the following scenarios:

- When a player undergoes an ideological revolution and switches to a different ideology
- During forced ideology changes due to overwhelming cultural pressure from other civilizations
- When a player voluntarily chooses to switch ideologies through game mechanics
- As part of the ideology switching system that involves losing some previously adopted tenets

# Parameters

The event passes the following parameters:

1. **Player ID** (`GetPlayer()->GetID()`) - The unique identifier of the player switching ideologies
2. **Old Branch Type** (`eOldBranchType`) - The policy branch type identifier of the ideology being abandoned
3. **New Branch Type** (`eNewBranchType`) - The policy branch type identifier of the ideology being adopted

# Event Details

Ideological switching represents a major political upheaval within a civilization, typically triggered by:

- **Cultural Pressure:** When other civilizations with different ideologies exert significant cultural influence
- **Happiness Crisis:** Ideological pressure can cause severe happiness penalties, forcing a switch
- **Strategic Reorientation:** Players may choose to switch to align with powerful allies or change victory strategies
- **Diplomatic Considerations:** Switching can improve relations with civilizations sharing the new ideology

The switching process involves significant costs:

- Loss of previously adopted ideology tenets (policies)
- Temporary disruption during the transition period
- Potential diplomatic consequences with former ideological allies
- Need to rebuild the ideology tree with fewer available policies

This event is crucial for AI systems because:

- It indicates major strategic shifts and potential alliance changes
- It signals civilizations under pressure that may need support or present opportunities
- It affects the global ideological landscape and cultural pressure calculations
- It provides insights into which ideologies are gaining dominance

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (line 5788)

**Triggering Functions:**

- `CvPlayerPolicies::DoSwitchIdeologies(PolicyBranchTypes eNewBranchType)` - Main function implementing ideology switches

**Switch Mechanics:**

- Clears all policies from the old ideology branch
- Unlocks the new ideology branch
- Calculates tenet retention based on game configuration (loses 2-5 tenets typically)
- Updates diplomatic relationships and cultural pressure calculations

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_IdeologySwitched, GetPlayer()->GetID(), eOldBranchType, eNewBranchType);
```

**Related Systems:**

- `GetLateGamePolicyTree()` - Identifies the current ideology
- `GetNumPoliciesOwnedInBranch()` - Counts existing tenets for retention calculation
- `ClearPolicyBranch()` - Removes policies from the abandoned ideology
- Cultural pressure and happiness systems that drive ideology switches
- Diplomatic relationship modifiers based on ideological alignment

**Configuration:**

- `SWITCH_POLICY_BRANCHES_TENETS_LOST` - Game parameter determining how many tenets are lost during the switch (2 in Community Patch, 5 in Vox Populi)
