# Overview

The `IdeologyAdopted` event is triggered when a player adopts an ideology (Freedom, Order, or Autocracy) for the first time. Ideologies are powerful late-game policy branches that provide significant bonuses and shape a civilization's path to victory. This event enables tracking of ideological choices for diplomatic relationships, cultural pressure systems, and strategic analysis.

# Event Triggers

This event is triggered in the following scenarios:

- When a player unlocks and adopts their first ideology (Freedom, Order, or Autocracy)
- During the initial ideology selection in the Industrial Era or later
- When meeting ideology adoption requirements for the first time
- Does NOT trigger during ideological revolutions or switches (different event exists for that)

# Parameters

The event passes the following parameters:

1. **Player ID** (`m_pPlayer->GetID()`) - The unique identifier of the player adopting the ideology
2. **Branch Type** (`eBranchType`) - The policy branch type identifier representing which ideology was adopted (Freedom, Order, or Autocracy)

# Event Details

Ideologies represent the major political and economic systems that civilizations can adopt in the late game. The adoption of an ideology is a critical strategic decision that affects:

- **Diplomatic Relations:** Civilizations with different ideologies experience diplomatic penalties
- **Cultural Pressure:** Ideologies exert cultural influence on other civilizations, potentially causing happiness penalties
- **Victory Conditions:** Each ideology provides different paths and bonuses for achieving victory
- **Policy Benefits:** Access to powerful late-game policies with significant empire-wide effects

This event is particularly important for AI systems to track because:

- It signals a major shift in a civilization's strategic direction
- It affects international relations and alliance possibilities
- It enables prediction of future policy choices and victory pursuits
- It triggers ideological pressure mechanics between civilizations

The event specifically fires only for the initial adoption, not for ideological revolutions where a civilization switches from one ideology to another.

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPolicyClasses.cpp` (line 5547)

**Triggering Functions:**

- `CvPlayerPolicies::SetPolicyBranchUnlocked(PolicyBranchTypes eBranchType, bool bNewValue, bool bRevolution)` - Main function for unlocking policy branches including ideologies

**Event Conditions:**

- Only fires when `bRevolution` parameter is false, ensuring it doesn't trigger during ideology switches
- Requires `bNewValue` to be true, indicating the branch is being newly unlocked
- Associated with the policy branch unlocking system

**Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_IdeologyAdopted, m_pPlayer->GetID(), eBranchType);
```

**Related Systems:**

- `CvPlayerCulture::GetTurnIdeologyAdopted()` - Tracks when the player first adopted any ideology
- Policy branch system for managing ideology policies
- Cultural pressure and happiness systems affected by ideological differences
- Diplomatic relationship modifiers based on ideological alignment

**Ideology Types:**

- Freedom (POLICY_BRANCH_FREEDOM) - Democratic ideology focusing on growth and specialists
- Order (POLICY_BRANCH_ORDER) - Communist ideology emphasizing production and military
- Autocracy (POLICY_BRANCH_AUTOCRACY) - Fascist ideology promoting conquest and domination
