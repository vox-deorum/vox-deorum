# Overview

The `PlayerAdoptPolicy` event is triggered when a player adopts a new policy through the social policy system. This event captures policy adoption regardless of whether it was adopted for free or through spending culture points, providing insights into a player's strategic choices and civilization development.

# Event Triggers

This event is triggered when a player successfully adopts a policy via the `CvPlayer::setHasPolicy()` method. The trigger occurs after all policy-related calculations and effects have been applied, including:

1. **Culture Point Expenditure**: When a player spends accumulated culture to unlock a new policy
2. **Free Policy Grants**: When policies are granted through special circumstances (wonders, events, etc.)
3. **Policy System Updates**: After all yield recalculations and city citizen assignments are complete

The event is fired from within the `CvPlayer` class after policy adoption is finalized.

# Parameters

The event passes two parameters to event handlers:

| Parameter  | Type        | Description                                 |
| ---------- | ----------- | ------------------------------------------- |
| PlayerID   | PlayerTypes | The ID of the player who adopted the policy |
| PolicyType | PolicyTypes | The type of policy that was adopted         |

# Event Details

The event provides essential information about policy adoption:

- **Player Context**: The player ID identifies which civilization made the policy choice
- **Policy Information**: The policy type parameter specifies exactly which policy was adopted
- **Timing**: The event fires after all policy effects have been applied to the game state
- **System Integration**: Triggers after yield updates and citizen reassignments are complete

The event occurs within the social policy system after the player has successfully acquired a new policy, ensuring that all related game mechanics have been processed when event handlers execute.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp`

**Trigger Location**: Line 23576 in the `CvPlayer::setHasPolicy()` method

**Event System**: Uses the Lua scripting hook system via `LuaSupport::CallHook()`

**Function Context**: Occurs within the policy adoption sequence after:

- Policy validity checks
- Culture cost calculations
- Instant yield processing
- Great person progress updates
- City citizen updates
- Yield recalculations

**Policy System**: Policies are social and cultural choices that provide permanent bonuses and unlock new gameplay options. This event tracks their acquisition as a key indicator of player strategic direction and civilization development path.
