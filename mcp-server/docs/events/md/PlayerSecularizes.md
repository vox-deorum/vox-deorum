# Overview

The PlayerSecularizes event is triggered when a player's secularization status changes in Civilization V. This event captures when a civilization transitions to or from a secularized state, which affects their religious and cultural policies by separating religious influence from governmental affairs.

# Event Triggers

This event is triggered when:

- A player's secularization status is being modified through the `SetHasSecularized` function
- The secularization status is changing (either being enabled or disabled)
- The change affects the player's relationship with religion and state governance

The event fires immediately before the secularization status is officially updated in the player's data.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `GetID()` | PlayerID | The unique identifier of the player whose secularization status is changing |
| `GetReligions()->GetStateReligion()` | ReligionType | The player's current state religion at the time of secularization change |
| `bValue` | Boolean | The new secularization status (true = secularizing, false = ending secularization) |

# Event Details

The PlayerSecularizes event represents a significant shift in a civilization's religious and governmental structure. Secularization typically involves the separation of religious institutions from state affairs, which can have far-reaching implications for a civilization's policies and interactions.

Key aspects of secularization:

- **State Religion Context**: The event captures the current state religion, providing context for what religious influence is being separated from government
- **Direction of Change**: The `bValue` parameter indicates whether the player is adopting secularization or abandoning it
- **Cultural Impact**: Secularization affects how a civilization interacts with religious mechanics and potentially influences diplomatic relationships

The event occurs at the critical moment when this fundamental change in governance structure is being implemented, allowing for proper tracking and potential intervention by game systems or modifications.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (Line 29542)

**Execution Context**: The event is invoked:

- At the beginning of the `SetHasSecularized` function
- Before the actual secularization flag (`m_bJFDSecularized`) is updated
- While the current state religion information is still accessible

**Related Functions**: This event is part of the secularization system that includes:

- `HasSecularized()` - Check current secularization status
- `IsPagan()` - Determine if player has pantheon but no state religion and hasn't secularized

**Game State**: The event captures the transition moment, providing both the old state (through current religion) and new state (through the bValue parameter).
